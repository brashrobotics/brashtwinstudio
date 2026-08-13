import { PersistenceError } from "./index.js";

export class InMemoryValidationJobRepository {
  #jobs = new Map();
  #runs = new Map();

  async create(record) {
    if (this.#jobs.has(record.jobId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Validation job ${record.jobId} already exists.`);
    }
    this.#jobs.set(record.jobId, clone(record));
    return clone(record);
  }

  async get(jobId) {
    return this.#jobs.has(jobId) ? clone(this.#jobs.get(jobId)) : null;
  }

  async list(draftId) {
    return [...this.#jobs.values()]
      .filter((job) => job.draftId === draftId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.jobId.localeCompare(right.jobId))
      .map(clone);
  }

  async start(record) {
    const current = this.#requireStatus(record.jobId, "PENDING");
    if (record.attemptCount !== current.attemptCount + 1) {
      throw new PersistenceError("CONCURRENCY_CONFLICT", `Validation job ${record.jobId} attempt is stale.`);
    }
    this.#jobs.set(record.jobId, clone(record));
    return clone(record);
  }

  async complete(record, run) {
    this.#requireStatus(record.jobId, "RUNNING");
    if (this.#runs.has(record.jobId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Validation run ${record.jobId} already exists.`);
    }
    this.#jobs.set(record.jobId, clone(record));
    this.#runs.set(record.jobId, clone(run));
    return { job: clone(record), run: clone(run) };
  }

  async fail(record) {
    this.#requireStatus(record.jobId, "RUNNING");
    this.#jobs.set(record.jobId, clone(record));
    return clone(record);
  }

  #requireStatus(jobId, status) {
    const current = this.#jobs.get(jobId);
    if (!current) throw new PersistenceError("NOT_FOUND", `Validation job ${jobId} was not found.`);
    if (current.status !== status) {
      throw new PersistenceError("CONCURRENCY_CONFLICT", `Validation job ${jobId} is ${current.status}, expected ${status}.`);
    }
    return current;
  }
}

export class PostgresValidationJobRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function" || typeof database.transaction !== "function") {
      throw new PersistenceError(
        "DATABASE_TRANSACTION_REQUIRED",
        "Validation job persistence requires query and transaction ports.",
      );
    }
    this.#database = database;
  }

  async create(record) {
    try {
      const result = await this.#database.query(
        `INSERT INTO twin_processing_jobs
         (job_id, draft_id, job_type, status, input, output, attempt_count,
          maximum_attempts, next_attempt_at, created_by, created_at)
         VALUES ($1, $2, 'RELEASE_VALIDATION', $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
         RETURNING *`,
        jobParameters(record),
      );
      return jobFromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, record.jobId);
    }
  }

  async get(jobId) {
    const result = await this.#database.query(
      "SELECT * FROM twin_processing_jobs WHERE job_id = $1 AND job_type = 'RELEASE_VALIDATION'",
      [jobId],
    );
    return result.rows[0] ? jobFromRow(result.rows[0]) : null;
  }

  async list(draftId) {
    const result = await this.#database.query(
      `SELECT * FROM twin_processing_jobs
       WHERE draft_id = $1 AND job_type = 'RELEASE_VALIDATION'
       ORDER BY created_at, job_id`,
      [draftId],
    );
    return result.rows.map(jobFromRow);
  }

  async start(record) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_processing_jobs
         SET status = 'RUNNING', attempt_count = $2, started_at = $3,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE job_id = $1 AND job_type = 'RELEASE_VALIDATION' AND status = 'PENDING'
         RETURNING *`,
        [record.jobId, record.attemptCount, record.startedAt],
      );
      if (!result.rows[0]) throw concurrency(record.jobId, "PENDING");
      return jobFromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, record.jobId);
    }
  }

  async complete(record, run) {
    try {
      return await this.#database.transaction(async (transaction) => {
        const result = await transaction.query(
          `UPDATE twin_processing_jobs
           SET status = 'SUCCEEDED', output = $2::jsonb, completed_at = $3,
               failure_reason = NULL, lease_owner = NULL, lease_expires_at = NULL
           WHERE job_id = $1 AND job_type = 'RELEASE_VALIDATION' AND status = 'RUNNING'
           RETURNING *`,
          [record.jobId, JSON.stringify(record.output), record.completedAt],
        );
        if (!result.rows[0]) throw concurrency(record.jobId, "RUNNING");
        await transaction.query(
          `INSERT INTO twin_validation_runs
           (job_id, draft_id, report_binding_id, report_sha256, outcome,
            validator_name, validator_version, configuration_sha256,
            error_count, warning_count, info_count, started_at, completed_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            run.jobId,
            run.draftId,
            run.reportBindingId,
            run.reportSha256,
            run.outcome,
            run.validator.name,
            run.validator.version,
            run.validator.configurationSha256,
            run.summary.errorCount,
            run.summary.warningCount,
            run.summary.infoCount,
            run.startedAt,
            run.completedAt,
            run.createdBy,
          ],
        );
        return { job: jobFromRow(result.rows[0]), run: clone(run) };
      });
    } catch (error) {
      throw translateDatabaseError(error, record.jobId);
    }
  }

  async fail(record) {
    try {
      const result = await this.#database.query(
        `UPDATE twin_processing_jobs
         SET status = 'FAILED', completed_at = $2, failure_reason = $3,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE job_id = $1 AND job_type = 'RELEASE_VALIDATION' AND status = 'RUNNING'
         RETURNING *`,
        [record.jobId, record.completedAt, record.failureReason],
      );
      if (!result.rows[0]) throw concurrency(record.jobId, "RUNNING");
      return jobFromRow(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, record.jobId);
    }
  }
}

function jobParameters(record) {
  return [
    record.jobId,
    record.draftId,
    record.status,
    JSON.stringify(record.input),
    record.output === null ? null : JSON.stringify(record.output),
    record.attemptCount,
    record.maximumAttempts,
    record.nextAttemptAt,
    record.createdBy,
    record.createdAt,
  ];
}

function jobFromRow(row) {
  return {
    jobId: row.job_id,
    draftId: row.draft_id,
    jobType: row.job_type,
    status: row.status,
    input: json(row.input),
    output: row.output === null ? null : json(row.output),
    attemptCount: Number(row.attempt_count),
    maximumAttempts: Number(row.maximum_attempts),
    nextAttemptAt: iso(row.next_attempt_at),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    startedAt: row.started_at === null ? null : iso(row.started_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at),
    failureReason: row.failure_reason,
  };
}

function translateDatabaseError(error, jobId) {
  if (error instanceof PersistenceError) return error;
  if (error?.code === "23505") {
    return new PersistenceError("ALREADY_EXISTS", `Validation job ${jobId} already exists.`, { cause: error });
  }
  if (error?.code === "23503") {
    return new PersistenceError("REFERENCE_NOT_FOUND", `Validation job ${jobId} references missing data.`, { cause: error });
  }
  if (error?.code === "23514") {
    return new PersistenceError("VALIDATION_RUN_INVALID", `Validation job ${jobId} violates persistence rules.`, { cause: error });
  }
  return error;
}

function concurrency(jobId, expected) {
  return new PersistenceError("CONCURRENCY_CONFLICT", `Validation job ${jobId} is not ${expected}.`);
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
