import assert from "node:assert/strict";
import test from "node:test";
import { createSurveyMaterializationJobRecord } from "@brash-twin/domain";
import { PostgresSurveyMaterializationRepository } from "@brash-twin/persistence/survey-materializations";

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
    row_version: record.rowVersion,
    created_by: record.createdBy,
    created_at: record.createdAt,
  };
}
