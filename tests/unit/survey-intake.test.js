import assert from "node:assert/strict";
import test from "node:test";
import {
  TwinDomainError,
  completeSurveyIntakeRecord,
  createSurveyMaterializationJobRecord,
  createSurveyIntakeRecord,
} from "@brash-twin/domain";

test("survey intake seals completed upload identities before one terminal verification", () => {
  const open = openRecord();
  assert.equal(open.status, "OPEN");
  assert.equal(open.rowVersion, 1);
  assert.equal(Object.isFrozen(open.artifactUploads), true);

  const accepted = completeSurveyIntakeRecord(open, {
    manifest: {
      schemaVersion: "brash.embodied-survey-package/v1",
      packageId: "package-1",
      surveyId: "survey-1",
      siteId: "site-1",
      floorId: "floor-1",
    },
    report: {
      manifestSha256: "d".repeat(64),
      outcome: "ACCEPTED_WITH_WARNINGS",
    },
    operatorId: "reviewer-1",
    occurredAt: "2026-08-14T12:01:00.000Z",
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.rowVersion, 2);
  assert.equal(accepted.packageId, "package-1");
  assert.equal(accepted.verifiedAt, "2026-08-14T12:01:00.000Z");

  assert.throws(
    () => completeSurveyIntakeRecord(accepted, {
      manifest: null,
      report: { manifestSha256: "d".repeat(64), outcome: "REJECTED" },
      operatorId: "reviewer-2",
    }),
    (error) => error instanceof TwinDomainError && error.code === "SURVEY_INTAKE_TRANSITION_INVALID",
  );
});

test("materialization job seals one immutable snapshot only from accepted intake evidence", () => {
  const accepted = completeSurveyIntakeRecord(openRecord(), {
    manifest: {
      schemaVersion: "brash.embodied-survey-package/v1",
      packageId: "package-1",
      surveyId: "survey-1",
      siteId: "site-1",
      floorId: "floor-1",
    },
    report: { manifestSha256: "d".repeat(64), outcome: "ACCEPTED" },
    operatorId: "reviewer-1",
  });
  const snapshot = {
    schemaVersion: "brash.survey-materialization-snapshot/v1",
    intakeId: accepted.intakeId,
    draftId: accepted.draftId,
    manifestSha256: accepted.manifestSha256,
    artifacts: [{ artifactId: "frames-1" }],
  };
  const job = createSurveyMaterializationJobRecord({
    jobId: "materialization-1",
    intake: accepted,
    snapshot,
    snapshotSha256: "e".repeat(64),
    operatorId: "operator-1",
    occurredAt: "2026-08-14T12:02:00.000Z",
  });
  assert.equal(job.status, "PENDING");
  assert.equal(job.rowVersion, 1);
  assert.equal(job.snapshotSha256, "e".repeat(64));
  assert.equal(Object.isFrozen(job.snapshot), true);

  assert.throws(
    () => createSurveyMaterializationJobRecord({
      jobId: "materialization-2",
      intake: openRecord(),
      snapshot,
      snapshotSha256: "e".repeat(64),
      operatorId: "operator-1",
    }),
    (error) => error instanceof TwinDomainError
      && error.code === "SURVEY_MATERIALIZATION_INTAKE_INELIGIBLE",
  );
});

test("survey intake rejects duplicate manifest and artifact upload identities", () => {
  assert.throws(
    () => openRecord({
      artifactUploads: [{
        artifactId: "frames-1",
        uploadId: "manifest-upload-1",
        artifactSha256: "b".repeat(64),
        bytes: 10,
        mediaType: "application/json",
      }],
    }),
    (error) => error instanceof TwinDomainError && error.code === "SURVEY_INTAKE_ARTIFACTS_INVALID",
  );
});

function openRecord(overrides = {}) {
  return createSurveyIntakeRecord({
    intakeId: "intake-1",
    draftId: "draft-1",
    manifestUploadId: "manifest-upload-1",
    manifestArtifactSha256: "a".repeat(64),
    artifactUploads: [{
      artifactId: "frames-1",
      uploadId: "artifact-upload-1",
      artifactSha256: "b".repeat(64),
      bytes: 10,
      mediaType: "application/json",
    }],
    operatorId: "operator-1",
    occurredAt: "2026-08-14T12:00:00.000Z",
    ...overrides,
  });
}
