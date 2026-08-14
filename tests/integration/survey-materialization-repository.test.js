import assert from "node:assert/strict";
import test from "node:test";
import { createSurveyMaterializationJobRecord } from "@brash-twin/domain";
import { PostgresSurveyMaterializationRepository } from "@brash-twin/persistence/survey-materializations";
import { InMemorySurveyMaterializationRepository } from "@brash-twin/persistence/survey-materializations";

test("PostgreSQL survey materialization repository parameterizes sealed snapshot insertion", async () => {
  const calls = [];
  const record = jobRecord();
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [row(record)] };
    },
  };
  const repository = new PostgresSurveyMaterializationRepository(database);
  const created = await repository.create(record);
  assert.equal(created.jobId, "materialization-1");
  assert.equal(created.status, "PENDING");
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO twin_survey_materialization_jobs/);
  assert.equal(calls[0].sql.includes("materialization-1"), false);
  assert.equal(JSON.parse(calls[0].parameters[6]).intakeId, "intake-1");
});

test("materialization leases reject concurrent owners and stop after bounded retries", async () => {
  const repository = new InMemorySurveyMaterializationRepository();
  await repository.create(jobRecord());
  const first = await repository.claim("materialization-1", {
    workerId: "worker-1",
    claimedAt: "2026-08-14T13:00:00.000Z",
    leaseExpiresAt: "2026-08-14T13:01:00.000Z",
  });
  assert.equal(first.attemptCount, 1);
  await assert.rejects(() => repository.claim("materialization-1", {
    workerId: "worker-2",
    claimedAt: "2026-08-14T13:00:30.000Z",
    leaseExpiresAt: "2026-08-14T13:01:30.000Z",
  }));

  const reclaimed = await repository.claim("materialization-1", {
    workerId: "worker-2",
    claimedAt: "2026-08-14T13:01:00.000Z",
    leaseExpiresAt: "2026-08-14T13:02:00.000Z",
  });
  assert.equal(reclaimed.attemptCount, 2);
  await assert.rejects(() => repository.complete("materialization-1", {
    workerId: "worker-1",
    output: {},
    outputUploadId: "output-1",
    outputArtifactSha256: "c".repeat(64),
    completedAt: "2026-08-14T13:01:10.000Z",
  }));
  const retry = await repository.fail("materialization-1", {
    workerId: "worker-2",
    failureReason: "Transient read failure.",
    failedAt: "2026-08-14T13:01:10.000Z",
    nextAttemptAt: "2026-08-14T13:01:20.000Z",
  });
  assert.equal(retry.status, "PENDING");

  await repository.claim("materialization-1", {
    workerId: "worker-3",
    claimedAt: "2026-08-14T13:01:20.000Z",
    leaseExpiresAt: "2026-08-14T13:02:20.000Z",
  });
  const terminal = await repository.fail("materialization-1", {
    workerId: "worker-3",
    failureReason: "Permanent format failure.",
    failedAt: "2026-08-14T13:01:30.000Z",
    nextAttemptAt: "2026-08-14T13:01:40.000Z",
  });
  assert.equal(terminal.status, "FAILED");
  assert.equal(terminal.attemptCount, 3);
  assert.equal(terminal.completedAt, "2026-08-14T13:01:30.000Z");
});

function jobRecord() {
  const intake = {
    intakeId: "intake-1",
    draftId: "draft-1",
    status: "ACCEPTED",
    manifestSha256: "a".repeat(64),
  };
  return createSurveyMaterializationJobRecord({
    jobId: "materialization-1",
    intake,
    snapshot: {
      schemaVersion: "brash.survey-materialization-snapshot/v1",
      intakeId: intake.intakeId,
      draftId: intake.draftId,
      manifestSha256: intake.manifestSha256,
      artifacts: [{ artifactId: "trajectory-1" }],
    },
    snapshotSha256: "b".repeat(64),
    operatorId: "operator-1",
    occurredAt: "2026-08-14T13:00:00.000Z",
  });
}

function row(record) {
  return {
    job_id: record.jobId,
    intake_id: record.intakeId,
    draft_id: record.draftId,
    status: record.status,
    manifest_sha256: record.manifestSha256,
    snapshot_sha256: record.snapshotSha256,
    snapshot: record.snapshot,
    output: record.output,
    output_upload_id: record.outputUploadId,
    output_artifact_sha256: record.outputArtifactSha256,
    attempt_count: record.attemptCount,
    maximum_attempts: record.maximumAttempts,
    next_attempt_at: record.nextAttemptAt,
    lease_owner: record.leaseOwner,
    lease_expires_at: record.leaseExpiresAt,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    failure_reason: record.failureReason,
    row_version: record.rowVersion,
    created_by: record.createdBy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}
