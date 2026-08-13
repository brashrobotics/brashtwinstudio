import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryValidationJobRepository,
  PostgresValidationJobRepository,
} from "@brash-twin/persistence/validation-jobs";

test("in-memory validation repository persists the job and immutable run result", async () => {
  const repository = new InMemoryValidationJobRepository();
  const pending = jobRecord();
  await repository.create(pending);
  const running = await repository.start({
    ...pending,
    status: "RUNNING",
    attemptCount: 1,
    startedAt: "2026-08-13T20:01:00.000Z",
  });
  const completed = {
    ...running,
    status: "SUCCEEDED",
    output: { reportSha256: "b".repeat(64), outcome: "PASSED" },
    completedAt: "2026-08-13T20:02:00.000Z",
  };
  const result = await repository.complete(completed, runRecord());

  assert.equal(result.job.status, "SUCCEEDED");
  assert.equal((await repository.get("validation-job-1")).output.outcome, "PASSED");
});

test("PostgreSQL validation completion updates the job and inserts its run in one transaction", async () => {
  const calls = [];
  const completed = {
    ...jobRecord(),
    status: "SUCCEEDED",
    attemptCount: 1,
    output: { reportSha256: "b".repeat(64), outcome: "PASSED" },
    startedAt: "2026-08-13T20:01:00.000Z",
    completedAt: "2026-08-13T20:02:00.000Z",
  };
  const database = {
    query: async () => ({ rows: [] }),
    async transaction(operation) {
      return operation({
        async query(sql, parameters) {
          calls.push({ sql, parameters });
          if (sql.includes("UPDATE twin_processing_jobs")) return { rows: [jobRow(completed)] };
          if (sql.includes("INSERT INTO twin_validation_runs")) return { rows: [] };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      });
    },
  };
  const repository = new PostgresValidationJobRepository(database);
  const result = await repository.complete(completed, runRecord());

  assert.equal(result.job.status, "SUCCEEDED");
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /status = 'SUCCEEDED'/);
  assert.match(calls[1].sql, /INSERT INTO twin_validation_runs/);
  assert.equal(calls[1].parameters[3], "b".repeat(64));
});

function jobRecord() {
  return {
    jobId: "validation-job-1",
    draftId: "draft-1",
    jobType: "RELEASE_VALIDATION",
    status: "PENDING",
    input: { draftRowVersion: 2, bindings: [] },
    output: null,
    attemptCount: 0,
    maximumAttempts: 1,
    nextAttemptAt: "2026-08-13T20:00:00.000Z",
    createdBy: "engineer-1",
    createdAt: "2026-08-13T20:00:00.000Z",
    startedAt: null,
    completedAt: null,
    failureReason: null,
  };
}

function runRecord() {
  return {
    jobId: "validation-job-1",
    draftId: "draft-1",
    reportBindingId: "validation-report-1",
    reportSha256: "b".repeat(64),
    outcome: "PASSED",
    validator: { name: "validator", version: "1", configurationSha256: "c".repeat(64) },
    summary: { errorCount: 0, warningCount: 1, infoCount: 0 },
    startedAt: "2026-08-13T20:01:00.000Z",
    completedAt: "2026-08-13T20:02:00.000Z",
    createdBy: "engineer-1",
  };
}

function jobRow(record) {
  return {
    job_id: record.jobId,
    draft_id: record.draftId,
    job_type: record.jobType,
    status: record.status,
    input: record.input,
    output: record.output,
    attempt_count: record.attemptCount,
    maximum_attempts: record.maximumAttempts,
    next_attempt_at: record.nextAttemptAt,
    created_by: record.createdBy,
    created_at: record.createdAt,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    failure_reason: record.failureReason,
  };
}
