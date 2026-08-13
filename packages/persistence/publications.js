import { PersistenceError } from "./index.js";
import { PostgresOutboxRepository } from "./outbox.js";

export class InMemoryPublicationRepository {
  #catalogRepository;
  #outboxRepository;
  #requests = new Map();
  #releases = new Map();

  constructor({ catalogRepository, outboxRepository }) {
    if (!catalogRepository
      || typeof catalogRepository.getMapDraft !== "function"
      || typeof catalogRepository.saveMapDraft !== "function"
      || typeof catalogRepository.snapshotForUnitOfWork !== "function") {
      throw new PersistenceError("PUBLICATION_CATALOG_INVALID", "Publication persistence requires a snapshot catalog.");
    }
    if (!outboxRepository
      || typeof outboxRepository.append !== "function"
      || typeof outboxRepository.snapshotForUnitOfWork !== "function") {
      throw new PersistenceError("PUBLICATION_OUTBOX_INVALID", "Publication persistence requires a snapshot outbox.");
    }
    this.#catalogRepository = catalogRepository;
    this.#outboxRepository = outboxRepository;
  }

  async create(record) {
    if (this.#requests.has(record.publicationId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Publication ${record.publicationId} already exists.`);
    }
    if ([...this.#requests.values()].some((item) => item.draftId === record.draftId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Draft ${record.draftId} already has a publication request.`);
    }
    this.#requests.set(record.publicationId, clone(record));
    return clone(record);
  }

  async get(publicationId) {
    return this.#requests.has(publicationId) ? clone(this.#requests.get(publicationId)) : null;
  }

  async list(draftId) {
    return [...this.#requests.values()]
      .filter((record) => draftId === undefined || record.draftId === draftId)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
      .map(clone);
  }

  async approve(record) {
    const current = this.#require(record.publicationId, "PENDING_APPROVAL");
    if (current.requestedBy === record.approvedBy) {
      throw new PersistenceError("TWO_PERSON_REQUIRED", "Publication approval requires a second person.");
    }
    this.#requests.set(record.publicationId, clone(record));
    return clone(record);
  }

  async claim(publicationId, { workerId, now, leaseSeconds }) {
    const current = this.#requests.get(publicationId);
    if (!current || current.status === "COMPLETED") return null;
    const time = new Date(now).getTime();
    const recoverable = current.status === "APPROVED"
      || (["PUBLISHING", "STORE_PUBLISHED"].includes(current.status)
        && (current.leaseExpiresAt === null || new Date(current.leaseExpiresAt).getTime() <= time));
    if (!recoverable || new Date(current.nextAttemptAt).getTime() > time) return null;
    const claimed = {
      ...current,
      status: current.status === "APPROVED" ? "PUBLISHING" : current.status,
      attemptCount: current.attemptCount + 1,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(time + leaseSeconds * 1_000).toISOString(),
      lastError: null,
      updatedAt: new Date(now).toISOString(),
    };
    this.#requests.set(publicationId, clone(claimed));
    return clone(claimed);
  }

  async listRecoverable({ now, batchSize }) {
    const time = new Date(now).getTime();
    return [...this.#requests.values()]
      .filter((record) => ["APPROVED", "PUBLISHING", "STORE_PUBLISHED"].includes(record.status))
      .filter((record) => new Date(record.nextAttemptAt).getTime() <= time)
      .filter((record) => record.leaseExpiresAt === null || new Date(record.leaseExpiresAt).getTime() <= time)
      .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt))
      .slice(0, batchSize)
      .map((record) => record.publicationId);
  }

  async markStorePublished(publicationId, workerId, occurredAt) {
    const current = this.#leased(publicationId, workerId, "PUBLISHING");
    const next = {
      ...current,
      status: "STORE_PUBLISHED",
      storePublishedAt: new Date(occurredAt).toISOString(),
      updatedAt: new Date(occurredAt).toISOString(),
    };
    this.#requests.set(publicationId, clone(next));
    return clone(next);
  }

  async recordFailure(publicationId, workerId, { error, nextAttemptAt, occurredAt }) {
    const current = this.#requests.get(publicationId);
    if (!current || current.leaseOwner !== workerId || !["PUBLISHING", "STORE_PUBLISHED"].includes(current.status)) {
      return null;
    }
    const next = {
      ...current,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(nextAttemptAt).toISOString(),
      lastError: errorMessage(error),
      updatedAt: new Date(occurredAt).toISOString(),
    };
    this.#requests.set(publicationId, clone(next));
    return clone(next);
  }

  async finalize(publicationId, workerId, { publishedDraft, event, publishedAt }) {
    const current = this.#leased(publicationId, workerId, "STORE_PUBLISHED");
    const catalogSnapshot = this.#catalogRepository.snapshotForUnitOfWork();
    const outboxSnapshot = this.#outboxRepository.snapshotForUnitOfWork();
    const requestsSnapshot = cloneMap(this.#requests);
    const releasesSnapshot = cloneMap(this.#releases);
    try {
      const draft = await this.#catalogRepository.getMapDraft(current.draftId);
      requireDraftSnapshot(current, draft, publishedDraft);
      if (this.#releases.has(current.releaseId)) {
        throw new PersistenceError("ALREADY_EXISTS", `Release ${current.releaseId} already exists.`);
      }
      const savedDraft = await this.#catalogRepository.saveMapDraft(publishedDraft, current.draftRowVersion);
      const release = releaseRecord(current, publishedAt);
      this.#releases.set(release.releaseId, clone(release));
      await this.#outboxRepository.append(event);
      const completed = {
        ...current,
        status: "COMPLETED",
        completedAt: new Date(publishedAt).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        updatedAt: new Date(publishedAt).toISOString(),
      };
      this.#requests.set(publicationId, clone(completed));
      return { publication: clone(completed), release: clone(release), draft: clone(savedDraft) };
    } catch (error) {
      this.#catalogRepository.restoreUnitOfWorkSnapshot(catalogSnapshot);
      this.#outboxRepository.restoreUnitOfWorkSnapshot(outboxSnapshot);
      this.#requests = requestsSnapshot;
      this.#releases = releasesSnapshot;
      throw error;
    }
  }

  async getRelease(releaseId) {
    return this.#releases.has(releaseId) ? clone(this.#releases.get(releaseId)) : null;
  }

  #require(publicationId, status) {
    const current = this.#requests.get(publicationId);
    if (!current) throw new PersistenceError("NOT_FOUND", `Publication ${publicationId} was not found.`);
    if (current.status !== status) throw concurrency(publicationId, status);
    return current;
  }

  #leased(publicationId, workerId, status) {
    const current = this.#require(publicationId, status);
    if (current.leaseOwner !== workerId) throw concurrency(publicationId, `${status} lease`);
    return current;
  }
}

export class PostgresPublicationRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function" || typeof database.transaction !== "function") {
      throw new PersistenceError("DATABASE_TRANSACTION_REQUIRED", "Publication persistence requires query and transaction ports.");
    }
    this.#database = database;
  }

  async create(record) {
    try {
      const result = await this.#database.query(
        `INSERT INTO twin_publication_requests
         (publication_id, draft_id, draft_row_version, validation_report_sha256,
          release_id, bundle_id, manifest_sha256, bundle_artifacts, status,
          requested_by, requested_at, attempt_count, next_attempt_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        requestParameters(record),
      );
      return requestFromRow({
        ...result.rows[0],
        approved_by: null,
        approved_at: null,
        family_id: record.bundle.familyId,
        revision: record.bundle.revision,
        canonical_frame_id: record.bundle.canonicalFrameId,
      });
    } catch (error) {
      throw translateDatabaseError(error, record.publicationId);
    }
  }

  async get(publicationId) {
    const result = await this.#database.query(`${requestSelect()} WHERE request.publication_id = $1`, [publicationId]);
    return result.rows[0] ? requestFromRow(result.rows[0]) : null;
  }

  async list(draftId) {
    const where = draftId === undefined ? "" : "WHERE request.draft_id = $1";
    const result = await this.#database.query(
      `${requestSelect()} ${where} ORDER BY request.requested_at, request.publication_id`,
      draftId === undefined ? [] : [draftId],
    );
    return result.rows.map(requestFromRow);
  }

  async approve(record) {
    try {
      return await this.#database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO twin_publication_approvals (publication_id, approved_by, approved_at)
           VALUES ($1, $2, $3)`,
          [record.publicationId, record.approvedBy, record.approvedAt],
        );
        const result = await transaction.query(
          `UPDATE twin_publication_requests
           SET status = 'APPROVED', updated_at = $2
           WHERE publication_id = $1 AND status = 'PENDING_APPROVAL'
           RETURNING *`,
          [record.publicationId, record.updatedAt],
        );
        if (!result.rows[0]) throw concurrency(record.publicationId, "PENDING_APPROVAL");
        return requestFromRow({
          ...result.rows[0],
          approved_by: record.approvedBy,
          approved_at: record.approvedAt,
          family_id: record.bundle.familyId,
          revision: record.bundle.revision,
          canonical_frame_id: record.bundle.canonicalFrameId,
        });
      });
    } catch (error) {
      throw translateDatabaseError(error, record.publicationId);
    }
  }

  async claim(publicationId, { workerId, now, leaseSeconds }) {
    const leaseExpiresAt = new Date(new Date(now).getTime() + leaseSeconds * 1_000).toISOString();
    try {
      const result = await this.#database.query(
        `UPDATE twin_publication_requests
         SET status = CASE WHEN status = 'APPROVED' THEN 'PUBLISHING' ELSE status END,
             attempt_count = attempt_count + 1,
             lease_owner = $2,
             lease_expires_at = $4,
             last_error = NULL,
             updated_at = $3
         WHERE publication_id = $1
           AND status IN ('APPROVED', 'PUBLISHING', 'STORE_PUBLISHED')
           AND next_attempt_at <= $3
           AND (lease_expires_at IS NULL OR lease_expires_at <= $3)
         RETURNING *`,
        [publicationId, workerId, now, leaseExpiresAt],
      );
      if (!result.rows[0]) return null;
      return this.get(publicationId);
    } catch (error) {
      throw translateDatabaseError(error, publicationId);
    }
  }

  async listRecoverable({ now, batchSize }) {
    const result = await this.#database.query(
      `SELECT publication_id
       FROM twin_publication_requests
       WHERE status IN ('APPROVED', 'PUBLISHING', 'STORE_PUBLISHED')
         AND next_attempt_at <= $1
         AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
       ORDER BY next_attempt_at, publication_id
       LIMIT $2`,
      [now, batchSize],
    );
    return result.rows.map((row) => row.publication_id);
  }

  async markStorePublished(publicationId, workerId, occurredAt) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_publication_requests
         SET status = 'STORE_PUBLISHED', store_published_at = $3, updated_at = $3
         WHERE publication_id = $1 AND status = 'PUBLISHING' AND lease_owner = $2
         RETURNING *`,
        [publicationId, workerId, occurredAt],
      );
      if (!result.rows[0]) throw concurrency(publicationId, "PUBLISHING lease");
      return this.get(publicationId);
    } catch (error) {
      throw translateDatabaseError(error, publicationId);
    }
  }

  async recordFailure(publicationId, workerId, { error, nextAttemptAt, occurredAt }) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_publication_requests
         SET lease_owner = NULL, lease_expires_at = NULL, next_attempt_at = $3,
             last_error = $4, updated_at = $5
         WHERE publication_id = $1 AND lease_owner = $2
           AND status IN ('PUBLISHING', 'STORE_PUBLISHED')
         RETURNING *`,
        [publicationId, workerId, nextAttemptAt, errorMessage(error), occurredAt],
      );
      if (!result.rows[0]) return null;
      return this.get(publicationId);
    } catch (databaseError) {
      throw translateDatabaseError(databaseError, publicationId);
    }
  }

  async finalize(publicationId, workerId, { publishedDraft, event, publishedAt }) {
    try {
      return await this.#database.transaction(async (transaction) => {
        const requestResult = await transaction.query(
          `${requestSelect()} WHERE request.publication_id = $1 FOR UPDATE OF request, draft`,
          [publicationId],
        );
        const request = requestResult.rows[0] ? requestFromRow(requestResult.rows[0]) : null;
        if (!request || request.status !== "STORE_PUBLISHED" || request.leaseOwner !== workerId) {
          throw concurrency(publicationId, "STORE_PUBLISHED lease");
        }
        const draftResult = await transaction.query(
          "SELECT * FROM twin_map_drafts WHERE draft_id = $1 FOR UPDATE",
          [request.draftId],
        );
        const draft = draftResult.rows[0];
        requirePostgresDraftSnapshot(request, draft, publishedDraft);
        const releaseResult = await transaction.query(
          `INSERT INTO twin_map_releases
           (release_id, family_id, source_draft_id, revision, canonical_frame_id,
            bundle_id, manifest_sha256, validation_report_sha256, published_by, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            request.releaseId,
            publishedDraft.familyId,
            publishedDraft.draftId,
            publishedDraft.revision,
            publishedDraft.canonicalFrameId,
            request.bundle.bundleId,
            request.bundle.manifestSha256,
            request.validationReportSha256,
            request.approvedBy,
            publishedAt,
          ],
        );
        for (const artifact of request.bundle.artifacts) {
          await transaction.query(
            `INSERT INTO twin_release_artifacts
             (release_id, role, artifact_sha256, bundle_path)
             VALUES ($1, $2, $3, $4)`,
            [request.releaseId, artifact.role, artifact.artifactSha256, artifact.bundlePath],
          );
        }
        await transaction.query(
          `INSERT INTO twin_map_release_state
           (release_id, lifecycle_state, updated_by, updated_at)
           VALUES ($1, 'PUBLISHED', $2, $3)`,
          [request.releaseId, request.approvedBy, publishedAt],
        );
        await transaction.query(
          `INSERT INTO twin_publication_audit
           (publication_id, draft_id, release_id, validation_report_sha256,
            actor_id, occurred_at, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            request.publicationId,
            request.draftId,
            request.releaseId,
            request.validationReportSha256,
            request.approvedBy,
            publishedAt,
            JSON.stringify({ requestedBy: request.requestedBy, approvedBy: request.approvedBy }),
          ],
        );
        const savedDraft = await transaction.query(
          `UPDATE twin_map_drafts
           SET status = 'PUBLISHED', row_version = $3, updated_by = $4, updated_at = $5
           WHERE draft_id = $1 AND status = 'VALIDATED' AND row_version = $2
             AND validation_report_sha256 = $6
           RETURNING *`,
          [
            request.draftId,
            request.draftRowVersion,
            publishedDraft.rowVersion,
            publishedDraft.updatedBy,
            publishedDraft.updatedAt,
            request.validationReportSha256,
          ],
        );
        if (!savedDraft.rows[0]) throw concurrency(publicationId, "sealed VALIDATED draft");
        await new PostgresOutboxRepository(transaction).append(event);
        const completedResult = await transaction.query(
          `UPDATE twin_publication_requests
           SET status = 'COMPLETED', completed_at = $3, lease_owner = NULL,
               lease_expires_at = NULL, last_error = NULL, updated_at = $3
           WHERE publication_id = $1 AND status = 'STORE_PUBLISHED' AND lease_owner = $2
           RETURNING *`,
          [publicationId, workerId, publishedAt],
        );
        return {
          publication: requestFromRow({ ...completedResult.rows[0], approved_by: request.approvedBy, approved_at: request.approvedAt }),
          release: releaseFromRow(releaseResult.rows[0]),
          draft: draftFromRow(savedDraft.rows[0]),
        };
      });
    } catch (error) {
      throw translateDatabaseError(error, publicationId);
    }
  }

  async getRelease(releaseId) {
    const result = await this.#database.query("SELECT * FROM twin_map_releases WHERE release_id = $1", [releaseId]);
    return result.rows[0] ? releaseFromRow(result.rows[0]) : null;
  }

}

function requestSelect() {
  return `SELECT request.*, approval.approved_by, approval.approved_at,
                 draft.family_id, draft.revision, draft.canonical_frame_id
          FROM twin_publication_requests AS request
          LEFT JOIN twin_publication_approvals AS approval USING (publication_id)
          JOIN twin_map_drafts AS draft ON draft.draft_id = request.draft_id`;
}

function requestParameters(record) {
  return [
    record.publicationId,
    record.draftId,
    record.draftRowVersion,
    record.validationReportSha256,
    record.releaseId,
    record.bundle.bundleId,
    record.bundle.manifestSha256,
    JSON.stringify(record.bundle.artifacts),
    record.status,
    record.requestedBy,
    record.requestedAt,
    record.attemptCount,
    record.nextAttemptAt,
    record.updatedAt,
  ];
}

function requestFromRow(row) {
  return {
    publicationId: row.publication_id,
    draftId: row.draft_id,
    draftRowVersion: Number(row.draft_row_version),
    validationReportSha256: row.validation_report_sha256,
    releaseId: row.release_id,
    bundle: {
      bundleId: row.bundle_id,
      mapReleaseId: row.release_id,
      familyId: row.family_id,
      revision: Number(row.revision),
      canonicalFrameId: row.canonical_frame_id,
      validationReportSha256: row.validation_report_sha256,
      manifestSha256: row.manifest_sha256,
      artifacts: json(row.bundle_artifacts),
    },
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: iso(row.requested_at),
    approvedBy: row.approved_by ?? null,
    approvedAt: nullableIso(row.approved_at),
    attemptCount: Number(row.attempt_count),
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    nextAttemptAt: iso(row.next_attempt_at),
    storePublishedAt: nullableIso(row.store_published_at),
    completedAt: nullableIso(row.completed_at),
    lastError: row.last_error ?? null,
    updatedAt: iso(row.updated_at),
  };
}

function releaseRecord(request, publishedAt) {
  return {
    releaseId: request.releaseId,
    familyId: request.bundle.familyId,
    sourceDraftId: request.draftId,
    revision: request.bundle.revision,
    canonicalFrameId: request.bundle.canonicalFrameId,
    bundleId: request.bundle.bundleId,
    manifestSha256: request.bundle.manifestSha256,
    validationReportSha256: request.validationReportSha256,
    publishedBy: request.approvedBy,
    publishedAt: new Date(publishedAt).toISOString(),
  };
}

function releaseFromRow(row) {
  return {
    releaseId: row.release_id,
    familyId: row.family_id,
    sourceDraftId: row.source_draft_id,
    revision: Number(row.revision),
    canonicalFrameId: row.canonical_frame_id,
    bundleId: row.bundle_id,
    manifestSha256: row.manifest_sha256,
    validationReportSha256: row.validation_report_sha256,
    publishedBy: row.published_by,
    publishedAt: iso(row.published_at),
  };
}

function draftFromRow(row) {
  return {
    draftId: row.draft_id,
    familyId: row.family_id,
    revision: Number(row.revision),
    canonicalFrameId: row.canonical_frame_id,
    status: row.status,
    validationReportSha256: row.validation_report_sha256,
    rowVersion: Number(row.row_version),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
  };
}

function requireDraftSnapshot(request, draft, publishedDraft) {
  if (!draft
    || draft.status !== "VALIDATED"
    || draft.rowVersion !== request.draftRowVersion
    || draft.validationReportSha256 !== request.validationReportSha256
    || publishedDraft.draftId !== draft.draftId
    || publishedDraft.status !== "PUBLISHED"
    || publishedDraft.rowVersion !== draft.rowVersion + 1) {
    throw concurrency(request.publicationId, "sealed VALIDATED draft");
  }
}

function requirePostgresDraftSnapshot(request, row, publishedDraft) {
  if (!row) throw concurrency(request.publicationId, "sealed VALIDATED draft");
  requireDraftSnapshot(request, draftFromRow(row), publishedDraft);
}

function translateDatabaseError(error, publicationId) {
  if (error instanceof PersistenceError) return error;
  if (error?.code === "23505") {
    return new PersistenceError("ALREADY_EXISTS", `Publication ${publicationId} conflicts with existing data.`, { cause: error });
  }
  if (error?.code === "23503") {
    return new PersistenceError("REFERENCE_NOT_FOUND", `Publication ${publicationId} references missing immutable data.`, { cause: error });
  }
  if (error?.code === "23514") {
    return new PersistenceError("PUBLICATION_RULE_VIOLATION", `Publication ${publicationId} violates persistence rules.`, { cause: error });
  }
  if (error?.code === "55000") {
    return new PersistenceError("IMMUTABLE_HISTORY", `Publication ${publicationId} history is immutable.`, { cause: error });
  }
  return error;
}

function concurrency(publicationId, expected) {
  return new PersistenceError("CONCURRENCY_CONFLICT", `Publication ${publicationId} is not in ${expected} state.`);
}

function json(value) {
  return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
}

function clone(value) {
  return structuredClone(value);
}

function cloneMap(value) {
  return new Map([...value.entries()].map(([key, record]) => [key, clone(record)]));
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value) {
  return value === null || value === undefined ? null : iso(value);
}

function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error ?? "Publication failed."))
    .replaceAll(/[\r\n\t]/g, " ")
    .slice(0, 2_000);
}
