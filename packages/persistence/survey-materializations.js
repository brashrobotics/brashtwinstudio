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
          snapshot, row_version, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    record.rowVersion,
    record.createdBy,
    record.createdAt,
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
    snapshot: typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : structuredClone(row.snapshot),
    rowVersion: Number(row.row_version),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
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
      `Survey materialization ${record.jobId} references missing intake or draft evidence.`,
      { cause: error },
    );
  }
  if (error?.code === "23514") {
    return new PersistenceError(
      "PROVENANCE_CONSTRAINT_VIOLATION",
      `Survey materialization ${record.jobId} violates accepted-intake snapshot constraints.`,
      { cause: error },
    );
  }
  if (error?.code === "55000") {
    return new PersistenceError(
      "IMMUTABLE_IDENTITY",
      `Survey materialization ${record.jobId} is immutable.`,
      { cause: error },
    );
  }
  return error;
}

function clone(value) {
  return structuredClone(value);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
