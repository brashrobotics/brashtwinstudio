import { PersistenceError } from "./index.js";

export class InMemorySurveyMaterializationRepository {
  #jobs = new Map();

  async create(record) {
    if (this.#jobs.has(record.jobId)
      || [...this.#jobs.values()].some((job) => job.intakeId === record.intakeId)) {
      throw new PersistenceError(
        "ALREADY_EXISTS",
        `Survey materialization for intake ${record.intakeId} already exists.`,
      );
    }
    this.#jobs.set(record.jobId, clone(record));
    return clone(record);
  }

  async get(jobId) {
    return this.#jobs.has(jobId) ? clone(this.#jobs.get(jobId)) : null;
  }

  async list(draftId) {
    return [...this.#jobs.values()]
      .filter((record) => record.draftId === draftId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.jobId.localeCompare(right.jobId))
      .map(clone);
  }

  async claim(jobId, { workerId, claimedAt, leaseExpiresAt }) {
    const current = this.#require(jobId);
    const claimedMillis = Date.parse(claimedAt);
    const eligible = current.attemptCount < current.maximumAttempts && (
      (current.status === "PENDING" && Date.parse(current.nextAttemptAt) <= claimedMillis)
      || (current.status === "RUNNING" && Date.parse(current.leaseExpiresAt) <= claimedMillis)
    );
    if (!eligible) throw concurrency(jobId, "not claimable");
    const claimed = {
      ...current,
      status: "RUNNING",
      attemptCount: current.attemptCount + 1,
      leaseOwner: workerId,
      leaseExpiresAt,
      startedAt: claimedAt,
      completedAt: null,
      failureReason: null,
      rowVersion: current.rowVersion + 1,
      updatedAt: claimedAt,
    };
    this.#jobs.set(jobId, clone(claimed));
    return clone(claimed);
  }

  async complete(jobId, {
    workerId,
    output,
    outputUploadId,
    outputArtifactSha256,
    completedAt,
  }) {
    const current = this.#ownedRunning(jobId, workerId);
    if (Date.parse(current.leaseExpiresAt) <= Date.parse(completedAt)) {
      throw concurrency(jobId, "lease expired");
    }
    const completed = {
      ...current,
      status: "SUCCEEDED",
      output: clone(output),
      outputUploadId,
      outputArtifactSha256,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt,
      failureReason: null,
      rowVersion: current.rowVersion + 1,
      updatedAt: completedAt,
    };
    this.#jobs.set(jobId, clone(completed));
    return clone(completed);
  }

  async fail(jobId, { workerId, failureReason, failedAt, nextAttemptAt }) {
    const current = this.#ownedRunning(jobId, workerId);
    const terminal = current.attemptCount >= current.maximumAttempts;
    const failed = {
      ...current,
      status: terminal ? "FAILED" : "PENDING",
      output: null,
      outputUploadId: null,
      outputArtifactSha256: null,
      nextAttemptAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: terminal ? failedAt : null,
      failureReason,
      rowVersion: current.rowVersion + 1,
      updatedAt: failedAt,
    };
    this.#jobs.set(jobId, clone(failed));
    return clone(failed);
  }

  #require(jobId) {
    const current = this.#jobs.get(jobId);
    if (!current) throw new PersistenceError("NOT_FOUND", `Survey materialization ${jobId} was not found.`);
    return current;
  }

  #ownedRunning(jobId, workerId) {
    const current = this.#require(jobId);
    if (current.status !== "RUNNING" || current.leaseOwner !== workerId) {
      throw concurrency(jobId, `not owned by ${workerId}`);
    }
    return current;
  }
}

export class PostgresSurveyMaterializationRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function") {
      throw new PersistenceError(
        "DATABASE_REQUIRED",
        "Survey materialization persistence requires a database query port.",
      );
    }
    this.#database = database;
  }

  async create(record) {
    try {
      const result = await this.#database.query(
        `INSERT INTO twin_survey_materialization_jobs
         (job_id, intake_id, draft_id, status, manifest_sha256, snapshot_sha256,
          snapshot, output, output_upload_id, output_artifact_sha256,
          attempt_count, maximum_attempts, next_attempt_at, lease_owner,
          lease_expires_at, started_at, completed_at, failure_reason,
          row_version, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING *`,
        parameters(record),
      );
      return fromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, record);
    }
  }

  async get(jobId) {
    const result = await this.#database.query(
      "SELECT * FROM twin_survey_materialization_jobs WHERE job_id = $1",
      [jobId],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async list(draftId) {
    const result = await this.#database.query(
      `SELECT * FROM twin_survey_materialization_jobs
       WHERE draft_id = $1 ORDER BY created_at, job_id`,
      [draftId],
    );
    return result.rows.map(fromRow);
  }

  async claim(jobId, { workerId, claimedAt, leaseExpiresAt }) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_survey_materialization_jobs
         SET status = 'RUNNING', attempt_count = attempt_count + 1,
             lease_owner = $2, lease_expires_at = $4, started_at = $3,
             completed_at = NULL, failure_reason = NULL,
             row_version = row_version + 1, updated_at = $3
         WHERE job_id = $1 AND attempt_count < maximum_attempts
           AND ((status = 'PENDING' AND next_attempt_at <= $3)
             OR (status = 'RUNNING' AND lease_expires_at <= $3))
         RETURNING *`,
        [jobId, workerId, claimedAt, leaseExpiresAt],
      );
      if (!result.rows[0]) throw concurrency(jobId, "not claimable");
      return fromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, { jobId, intakeId: "unknown" });
    }
  }

  async complete(jobId, {
    workerId,
    output,
    outputUploadId,
    outputArtifactSha256,
    completedAt,
  }) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_survey_materialization_jobs
         SET status = 'SUCCEEDED', output = $3::jsonb,
             output_upload_id = $4, output_artifact_sha256 = $5,
             lease_owner = NULL, lease_expires_at = NULL,
             completed_at = $6, failure_reason = NULL,
             row_version = row_version + 1, updated_at = $6
         WHERE job_id = $1 AND status = 'RUNNING' AND lease_owner = $2
           AND lease_expires_at > $6
         RETURNING *`,
        [jobId, workerId, JSON.stringify(output), outputUploadId, outputArtifactSha256, completedAt],
      );
      if (!result.rows[0]) throw concurrency(jobId, "not owned or lease expired");
      return fromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, { jobId, intakeId: "unknown" });
    }
  }

  async fail(jobId, { workerId, failureReason, failedAt, nextAttemptAt }) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_survey_materialization_jobs
         SET status = CASE WHEN attempt_count >= maximum_attempts THEN 'FAILED' ELSE 'PENDING' END,
             output = NULL, output_upload_id = NULL, output_artifact_sha256 = NULL,
             next_attempt_at = $5, lease_owner = NULL, lease_expires_at = NULL,
             completed_at = CASE WHEN attempt_count >= maximum_attempts THEN $4 ELSE NULL END,
             failure_reason = $3, row_version = row_version + 1, updated_at = $4
         WHERE job_id = $1 AND status = 'RUNNING' AND lease_owner = $2
         RETURNING *`,
        [jobId, workerId, failureReason, failedAt, nextAttemptAt],
      );
      if (!result.rows[0]) throw concurrency(jobId, "not owned");
      return fromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, { jobId, intakeId: "unknown" });
    }
  }
}

function parameters(record) {
  return [
    record.jobId,
    record.intakeId,
    record.draftId,
    record.status,
    record.manifestSha256,
    record.snapshotSha256,
    JSON.stringify(record.snapshot),
    record.output === null ? null : JSON.stringify(record.output),
    record.outputUploadId,
    record.outputArtifactSha256,
    record.attemptCount,
    record.maximumAttempts,
    record.nextAttemptAt,
    record.leaseOwner,
    record.leaseExpiresAt,
    record.startedAt,
    record.completedAt,
    record.failureReason,
    record.rowVersion,
    record.createdBy,
    record.createdAt,
    record.updatedAt,
  ];
}

function fromRow(row) {
  return {
    jobId: row.job_id,
    intakeId: row.intake_id,
    draftId: row.draft_id,
    status: row.status,
    manifestSha256: row.manifest_sha256,
    snapshotSha256: row.snapshot_sha256,
    snapshot: json(row.snapshot),
    output: row.output === null ? null : json(row.output),
    outputUploadId: row.output_upload_id,
    outputArtifactSha256: row.output_artifact_sha256,
    attemptCount: Number(row.attempt_count),
    maximumAttempts: Number(row.maximum_attempts),
    nextAttemptAt: iso(row.next_attempt_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    startedAt: optionalIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    failureReason: row.failure_reason,
    rowVersion: Number(row.row_version),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function translateDatabaseError(error, record) {
  if (error instanceof PersistenceError) return error;
  if (error?.code === "23505") {
    return new PersistenceError(
      "ALREADY_EXISTS",
      `Survey materialization for intake ${record.intakeId} already exists.`,
      { cause: error },
    );
  }
  if (error?.code === "23503") {
    return new PersistenceError(
      "REFERENCE_NOT_FOUND",
      `Survey materialization ${record.jobId} references missing intake, draft, or output evidence.`,
      { cause: error },
    );
  }
  if (error?.code === "23514") {
    return new PersistenceError(
      "PROVENANCE_CONSTRAINT_VIOLATION",
      `Survey materialization ${record.jobId} violates lifecycle or provenance constraints.`,
      { cause: error },
    );
  }
  if (error?.code === "40001") return concurrency(record.jobId, "transition rejected");
  if (error?.code === "55000") {
    return new PersistenceError(
      "IMMUTABLE_IDENTITY",
      `Survey materialization ${record.jobId} input identity is immutable.`,
      { cause: error },
    );
  }
  return error;
}

function concurrency(jobId, reason) {
  return new PersistenceError(
    "CONCURRENCY_CONFLICT",
    `Survey materialization ${jobId} is ${reason}.`,
  );
}

function json(value) {
  return typeof value === "string" ? JSON.parse(value) : structuredClone(value);
}

function clone(value) {
  return structuredClone(value);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value) {
  return value === null || value === undefined ? null : iso(value);
}
