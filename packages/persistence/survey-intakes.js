import { PersistenceError } from "./index.js";

export class InMemorySurveyIntakeRepository {
  #intakes = new Map();

  async create(record) {
    if (this.#intakes.has(record.intakeId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Survey intake ${record.intakeId} already exists.`);
    }
    this.#intakes.set(record.intakeId, clone(record));
    return clone(record);
  }

  async get(intakeId) {
    return this.#intakes.has(intakeId) ? clone(this.#intakes.get(intakeId)) : null;
  }

  async list(draftId) {
    return [...this.#intakes.values()]
      .filter((record) => record.draftId === draftId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.intakeId.localeCompare(right.intakeId))
      .map(clone);
  }

  async complete(record, expectedRowVersion) {
    const current = this.#intakes.get(record.intakeId);
    if (!current) throw new PersistenceError("NOT_FOUND", `Survey intake ${record.intakeId} was not found.`);
    if (current.status !== "OPEN"
      || current.rowVersion !== expectedRowVersion
      || record.rowVersion !== expectedRowVersion + 1) {
      throw new PersistenceError(
        "CONCURRENCY_CONFLICT",
        `Survey intake ${record.intakeId} was already verified or modified concurrently.`,
      );
    }
    for (const field of [
      "intakeId", "draftId", "manifestUploadId", "manifestArtifactSha256", "createdBy", "createdAt",
    ]) {
      if (record[field] !== current[field]) {
        throw new PersistenceError("IMMUTABLE_IDENTITY", `Survey intake ${record.intakeId} identity changed.`);
      }
    }
    if (JSON.stringify(record.artifactUploads) !== JSON.stringify(current.artifactUploads)) {
      throw new PersistenceError("IMMUTABLE_IDENTITY", `Survey intake ${record.intakeId} upload mappings changed.`);
    }
    this.#intakes.set(record.intakeId, clone(record));
    return clone(record);
  }
}

export class PostgresSurveyIntakeRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function" || typeof database.transaction !== "function") {
      throw new PersistenceError(
        "DATABASE_TRANSACTION_REQUIRED",
        "Survey intake persistence requires database query and transaction ports.",
      );
    }
    this.#database = database;
  }

  async create(record) {
    try {
      return await this.#database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO twin_survey_intakes
           (intake_id, status, draft_id, manifest_upload_id, manifest_artifact_sha256,
            artifact_count, manifest_schema_version, manifest_sha256, package_id, survey_id,
            source_site_id, source_floor_id, report, row_version, created_by, created_at,
            verified_by, verified_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   $15, $16, $17, $18)`,
          intakeParameters(record),
        );
        for (const mapping of record.artifactUploads) {
          await transaction.query(
            `INSERT INTO twin_survey_intake_artifacts
             (intake_id, artifact_id, upload_id, artifact_sha256, bytes, media_type)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              record.intakeId,
              mapping.artifactId,
              mapping.uploadId,
              mapping.artifactSha256,
              mapping.bytes,
              mapping.mediaType,
            ],
          );
        }
        return clone(record);
      });
    } catch (error) {
      throw translateDatabaseError(error, record.intakeId);
    }
  }

  async get(intakeId) {
    const result = await this.#database.query(
      `${selectWithArtifactsSql()} WHERE intake.intake_id = $1 ORDER BY artifact.artifact_id`,
      [intakeId],
    );
    return result.rows.length > 0 ? intakeFromRows(result.rows) : null;
  }

  async list(draftId) {
    const result = await this.#database.query(
      `${selectWithArtifactsSql()}
       WHERE intake.draft_id = $1
       ORDER BY intake.created_at, intake.intake_id, artifact.artifact_id`,
      [draftId],
    );
    const grouped = new Map();
    for (const row of result.rows) {
      if (!grouped.has(row.intake_id)) grouped.set(row.intake_id, []);
      grouped.get(row.intake_id).push(row);
    }
    return [...grouped.values()].map(intakeFromRows);
  }

  async complete(record, expectedRowVersion) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_survey_intakes
         SET status = $2,
             manifest_schema_version = $7,
             manifest_sha256 = $8,
             package_id = $9,
             survey_id = $10,
             source_site_id = $11,
             source_floor_id = $12,
             report = $13,
             row_version = $14,
             verified_by = $17,
             verified_at = $18
         WHERE intake_id = $1 AND status = 'OPEN' AND row_version = $19
         RETURNING *`,
        [...intakeParameters(record), expectedRowVersion],
      );
      if (!result.rows[0]) {
        throw new PersistenceError(
          "CONCURRENCY_CONFLICT",
          `Survey intake ${record.intakeId} was already verified or modified concurrently.`,
        );
      }
      return { ...intakeFromRow(result.rows[0]), artifactUploads: clone(record.artifactUploads) };
    } catch (error) {
      throw translateDatabaseError(error, record.intakeId);
    }
  }
}

function selectWithArtifactsSql() {
  return `SELECT intake.*,
                 artifact.artifact_id,
                 artifact.upload_id AS artifact_upload_id,
                 artifact.artifact_sha256 AS mapped_artifact_sha256,
                 artifact.bytes AS mapped_bytes,
                 artifact.media_type AS mapped_media_type
          FROM twin_survey_intakes intake
          LEFT JOIN twin_survey_intake_artifacts artifact USING (intake_id)`;
}

function intakeParameters(record) {
  return [
    record.intakeId,
    record.status,
    record.draftId,
    record.manifestUploadId,
    record.manifestArtifactSha256,
    record.artifactUploads.length,
    record.manifestSchemaVersion,
    record.manifestSha256,
    record.packageId,
    record.surveyId,
    record.sourceSiteId,
    record.sourceFloorId,
    record.report === null ? null : JSON.stringify(record.report),
    record.rowVersion,
    record.createdBy,
    record.createdAt,
    record.verifiedBy,
    record.verifiedAt,
  ];
}

function intakeFromRows(rows) {
  return {
    ...intakeFromRow(rows[0]),
    artifactUploads: rows
      .filter((row) => row.artifact_id !== null)
      .map((row) => ({
        artifactId: row.artifact_id,
        uploadId: row.artifact_upload_id,
        artifactSha256: row.mapped_artifact_sha256,
        bytes: Number(row.mapped_bytes),
        mediaType: row.mapped_media_type,
      })),
  };
}

function intakeFromRow(row) {
  return {
    intakeId: row.intake_id,
    draftId: row.draft_id,
    manifestUploadId: row.manifest_upload_id,
    manifestArtifactSha256: row.manifest_artifact_sha256,
    status: row.status,
    manifestSchemaVersion: row.manifest_schema_version,
    manifestSha256: row.manifest_sha256,
    packageId: row.package_id,
    surveyId: row.survey_id,
    sourceSiteId: row.source_site_id,
    sourceFloorId: row.source_floor_id,
    report: typeof row.report === "string" ? JSON.parse(row.report) : row.report,
    rowVersion: Number(row.row_version),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at === null ? null : iso(row.verified_at),
  };
}

function translateDatabaseError(error, intakeId) {
  if (error instanceof PersistenceError) return error;
  if (error?.code === "23505") {
    return new PersistenceError("ALREADY_EXISTS", `Survey intake ${intakeId} conflicts with existing evidence.`, { cause: error });
  }
  if (error?.code === "23503") {
    return new PersistenceError(
      "REFERENCE_NOT_FOUND",
      `Survey intake ${intakeId} references a missing draft or incomplete upload.`,
      { cause: error },
    );
  }
  if (error?.code === "23514") {
    return new PersistenceError(
      "PROVENANCE_CONSTRAINT_VIOLATION",
      `Survey intake ${intakeId} violates sealed evidence constraints.`,
      { cause: error },
    );
  }
  if (error?.code === "55000") {
    return new PersistenceError("IMMUTABLE_IDENTITY", `Survey intake ${intakeId} is immutable.`, { cause: error });
  }
  return error;
}

function clone(value) {
  return structuredClone(value);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
