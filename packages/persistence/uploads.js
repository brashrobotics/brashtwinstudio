import { PersistenceError } from "./index.js";

export class InMemoryUploadRepository {
  #sessions = new Map();
  #artifacts = new Map();

  async create(record) {
    if (this.#sessions.has(record.uploadId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Upload session ${record.uploadId} already exists.`);
    }
    this.#sessions.set(record.uploadId, clone(record));
    return clone(record);
  }

  async get(uploadId) {
    return this.#sessions.has(uploadId) ? clone(this.#sessions.get(uploadId)) : null;
  }

  async list(status) {
    return [...this.#sessions.values()]
      .filter((record) => status === undefined || record.status === status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.uploadId.localeCompare(right.uploadId))
      .map(clone);
  }

  async complete(record, expectedRowVersion, artifact) {
    const current = this.#requireWritable(record, expectedRowVersion);
    validateArtifact(artifact, record);
    const existing = this.#artifacts.get(artifact.sha256);
    if (existing && (existing.bytes !== artifact.bytes || existing.objectKey !== artifact.objectKey)) {
      throw new PersistenceError("ARTIFACT_IDENTITY_CONFLICT", `Artifact ${artifact.sha256} metadata conflicts with stored content.`);
    }
    this.#artifacts.set(artifact.sha256, clone(existing ?? artifact));
    this.#sessions.set(record.uploadId, clone(record));
    return { session: clone(record), artifact: clone(existing ?? artifact), previous: clone(current) };
  }

  async save(record, expectedRowVersion) {
    this.#requireWritable(record, expectedRowVersion);
    this.#sessions.set(record.uploadId, clone(record));
    return clone(record);
  }

  async getArtifact(sha256) {
    return this.#artifacts.has(sha256) ? clone(this.#artifacts.get(sha256)) : null;
  }

  #requireWritable(record, expectedRowVersion) {
    const current = this.#sessions.get(record.uploadId);
    if (!current) throw new PersistenceError("NOT_FOUND", `Upload session ${record.uploadId} was not found.`);
    if (current.rowVersion !== expectedRowVersion || record.rowVersion !== expectedRowVersion + 1) {
      throw new PersistenceError("CONCURRENCY_CONFLICT", `Upload session ${record.uploadId} was modified concurrently.`);
    }
    if (!["INITIATED", "UPLOADING"].includes(current.status)) {
      throw new PersistenceError("UPLOAD_TERMINAL", `Upload session ${record.uploadId} is already ${current.status}.`);
    }
    return current;
  }
}

export class PostgresUploadRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function") {
      throw new PersistenceError("DATABASE_REQUIRED", "A database query port is required.");
    }
    this.#database = database;
  }

  async create(record) {
    try {
      const result = await this.#database.query(
        `INSERT INTO twin_upload_sessions
         (upload_id, status, expected_sha256, expected_bytes, observed_sha256, observed_bytes,
          artifact_sha256, media_type, original_name, part_size_bytes, maximum_parts,
          storage_provider, upload_key, quarantine_reason, expires_at, row_version,
          created_by, created_at, updated_by, updated_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $19, $20, $21)
         RETURNING *`,
        uploadParameters(record),
      );
      return uploadFromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, record.uploadId);
    }
  }

  async get(uploadId) {
    const result = await this.#database.query("SELECT * FROM twin_upload_sessions WHERE upload_id = $1", [uploadId]);
    return result.rows[0] ? uploadFromRow(result.rows[0]) : null;
  }

  async list(status) {
    const result = status === undefined
      ? await this.#database.query("SELECT * FROM twin_upload_sessions ORDER BY created_at, upload_id")
      : await this.#database.query(
        "SELECT * FROM twin_upload_sessions WHERE status = $1 ORDER BY created_at, upload_id",
        [status],
      );
    return result.rows.map(uploadFromRow);
  }

  async complete(record, expectedRowVersion, artifact) {
    if (typeof this.#database.transaction !== "function") {
      throw new PersistenceError("DATABASE_TRANSACTION_REQUIRED", "Completing an upload requires a database transaction port.");
    }
    validateArtifact(artifact, record);
    try {
      return await this.#database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO twin_artifacts (sha256, bytes, object_key, media_type, original_name, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (sha256) DO NOTHING`,
          [
            artifact.sha256,
            artifact.bytes,
            artifact.objectKey,
            artifact.mediaType,
            artifact.originalName,
            artifact.createdAt,
          ],
        );
        const artifactResult = await transaction.query("SELECT * FROM twin_artifacts WHERE sha256 = $1", [artifact.sha256]);
        const storedArtifact = artifactFromRow(artifactResult.rows[0]);
        if (storedArtifact.bytes !== artifact.bytes || storedArtifact.objectKey !== artifact.objectKey) {
          throw new PersistenceError(
            "ARTIFACT_IDENTITY_CONFLICT",
            `Artifact ${artifact.sha256} metadata conflicts with stored content.`,
          );
        }
        const update = await transaction.query(
          `${uploadUpdateSql()}
           WHERE upload_id = $1 AND row_version = $22 AND status IN ('INITIATED', 'UPLOADING')
           RETURNING *`,
          [...uploadParameters(record), expectedRowVersion],
        );
        if (!update.rows[0]) throw concurrencyError(record.uploadId);
        return { session: uploadFromRow(update.rows[0]), artifact: storedArtifact };
      });
    } catch (error) {
      throw translateDatabaseError(error, record.uploadId);
    }
  }

  async save(record, expectedRowVersion) {
    try {
      const result = await this.#database.query(
        `${uploadUpdateSql()}
         WHERE upload_id = $1 AND row_version = $22 AND status IN ('INITIATED', 'UPLOADING')
         RETURNING *`,
        [...uploadParameters(record), expectedRowVersion],
      );
      if (!result.rows[0]) throw concurrencyError(record.uploadId);
      return uploadFromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, record.uploadId);
    }
  }

  async getArtifact(sha256) {
    const result = await this.#database.query("SELECT * FROM twin_artifacts WHERE sha256 = $1", [sha256]);
    return result.rows[0] ? artifactFromRow(result.rows[0]) : null;
  }
}

function uploadUpdateSql() {
  return `UPDATE twin_upload_sessions
          SET status = $2,
              expected_sha256 = $3,
              expected_bytes = $4,
              observed_sha256 = $5,
              observed_bytes = $6,
              artifact_sha256 = $7,
              media_type = $8,
              original_name = $9,
              part_size_bytes = $10,
              maximum_parts = $11,
              storage_provider = $12,
              upload_key = $13,
              quarantine_reason = $14,
              expires_at = $15,
              row_version = $16,
              created_by = $17,
              created_at = $18,
              updated_by = $19,
              updated_at = $20,
              completed_at = $21`;
}

function uploadParameters(record) {
  return [
    record.uploadId,
    record.status,
    record.expectedSha256,
    record.expectedBytes,
    record.observedSha256,
    record.observedBytes,
    record.artifactSha256,
    record.mediaType,
    record.originalName,
    record.partSizeBytes,
    record.maximumParts,
    record.storageProvider,
    record.uploadKey,
    record.quarantineReason,
    record.expiresAt,
    record.rowVersion,
    record.createdBy,
    record.createdAt,
    record.updatedBy,
    record.updatedAt,
    record.completedAt,
  ];
}

function uploadFromRow(row) {
  return {
    uploadId: row.upload_id,
    status: row.status,
    expectedSha256: row.expected_sha256,
    expectedBytes: Number(row.expected_bytes),
    observedSha256: row.observed_sha256,
    observedBytes: row.observed_bytes === null ? null : Number(row.observed_bytes),
    artifactSha256: row.artifact_sha256,
    mediaType: row.media_type,
    originalName: row.original_name,
    partSizeBytes: Number(row.part_size_bytes),
    maximumParts: Number(row.maximum_parts),
    storageProvider: row.storage_provider,
    uploadKey: row.upload_key,
    quarantineReason: row.quarantine_reason,
    expiresAt: iso(row.expires_at),
    rowVersion: Number(row.row_version),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
  };
}

function artifactFromRow(row) {
  if (!row) throw new PersistenceError("ARTIFACT_NOT_FOUND", "Completed artifact metadata was not persisted.");
  return {
    sha256: row.sha256,
    bytes: Number(row.bytes),
    objectKey: row.object_key,
    mediaType: row.media_type,
    originalName: row.original_name,
    createdAt: iso(row.created_at),
  };
}

function validateArtifact(artifact, record) {
  if (!artifact || typeof artifact !== "object") {
    throw new PersistenceError("ARTIFACT_REQUIRED", "Completed artifact metadata is required.");
  }
  if (artifact.sha256 !== record.artifactSha256
    || artifact.sha256 !== record.expectedSha256
    || artifact.bytes !== record.expectedBytes
    || typeof artifact.objectKey !== "string"
    || artifact.objectKey.trim() === "") {
    throw new PersistenceError("ARTIFACT_INTEGRITY_FAILED", "Completed artifact does not match the upload session.");
  }
}

function translateDatabaseError(error, uploadId) {
  if (error instanceof PersistenceError) return error;
  if (error?.code === "23505") {
    return new PersistenceError("ALREADY_EXISTS", `Upload session ${uploadId} already exists.`, { cause: error });
  }
  if (error?.code === "23503") {
    return new PersistenceError("REFERENCE_NOT_FOUND", `Upload session ${uploadId} references missing metadata.`, { cause: error });
  }
  return error;
}

function concurrencyError(uploadId) {
  return new PersistenceError("CONCURRENCY_CONFLICT", `Upload session ${uploadId} was modified concurrently.`);
}

function clone(value) {
  return structuredClone(value);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
