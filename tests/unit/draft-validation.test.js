import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  DraftValidatorRegistry,
  createDraftValidationReport,
  serializeDraftValidationReport,
} from "@brash-twin/validation/draft";

test("draft validation report is machine-readable and passes a canonical source snapshot", () => {
  const report = createDraftValidationReport({
    reportId: "report-job-1",
    jobId: "job-1",
    draft: draft(),
    artifacts: [sourceArtifact()],
    registry: new DraftValidatorRegistry(),
    startedAt: "2026-08-13T20:00:00.000Z",
    completedAt: "2026-08-13T20:00:01.000Z",
  });

  assert.equal(report.schemaVersion, "brash.draft-validation-report/v2");
  assert.equal(report.outcome, "PASSED");
  assert.deepEqual(report.summary, { errorCount: 0, warningCount: 0, infoCount: 0 });
  assert.deepEqual(report.inputs, [{
    bindingId: "source-1",
    artifactSha256: "a".repeat(64),
    role: "BIM_SOURCE",
  }]);
  const content = serializeDraftValidationReport(report);
  assert.equal(JSON.parse(content.toString("utf8")).reportId, "report-job-1");
  assert.match(createHash("sha256").update(content).digest("hex"), /^[a-f0-9]{64}$/);
});

test("registered survey evidence requires a content-verified approved acceptance", () => {
  const registration = derivedArtifact({
    bindingId: "registration-report-1",
    role: "REGISTRATION_REPORT",
    artifactSha256: "b".repeat(64),
    inputBindings: [{ bindingId: "source-1", artifactSha256: "a".repeat(64) }],
  });
  const rejected = derivedArtifact({
    bindingId: "registration-acceptance-1",
    role: "REGISTRATION_ACCEPTANCE",
    artifactSha256: "c".repeat(64),
    inputBindings: [{ bindingId: registration.bindingId, artifactSha256: registration.artifactSha256 }],
    reviewDecision: "REJECTED",
  });
  const failed = validationReport("job-registration-rejected", [sourceArtifact(), registration, rejected]);
  assert.equal(failed.outcome, "FAILED");
  assert.equal(failed.issues.find((issue) => issue.code === "REGISTRATION_APPROVAL_REQUIRED")?.location.artifactBindingId, registration.bindingId);

  const passed = validationReport("job-registration-approved", [
    sourceArtifact(),
    registration,
    { ...rejected, reviewDecision: "APPROVED" },
  ]);
  assert.equal(passed.outcome, "PASSED");
  assert.equal(passed.inputs.at(-1).reviewDecision, "APPROVED");

  const bypass = validationReport("job-registered-output-bypass", [
    sourceArtifact(),
    derivedArtifact({
      bindingId: "registered-cloud-1",
      role: "REGISTERED_POINT_CLOUD",
      coordinateFrameId: "plant/floor-1",
    }),
  ]);
  assert.equal(bypass.outcome, "FAILED");
  assert.equal(bypass.issues.find((issue) => issue.code === "REGISTRATION_APPROVAL_REQUIRED")?.location.artifactBindingId, "registered-cloud-1");
});

test("draft validation emits UI-ready locations for broken derived provenance", () => {
  const report = createDraftValidationReport({
    reportId: "report-job-2",
    jobId: "job-2",
    draft: draft(),
    artifacts: [{
      bindingId: "derived-1",
      draftId: "draft-1",
      uploadId: "upload-2",
      artifactSha256: "b".repeat(64),
      role: "RECONSTRUCTED_MESH",
      kind: "DERIVED",
      coordinateFrameId: "plant/floor-1",
      inputBindings: [{ bindingId: "missing-source", artifactSha256: "a".repeat(64) }],
      producer: { name: "mesh-worker", version: "1", parametersSha256: "c".repeat(64) },
      createdBy: "worker-1",
      createdAt: "2026-08-13T19:00:00.000Z",
    }],
    registry: new DraftValidatorRegistry(),
    startedAt: "2026-08-13T20:00:00.000Z",
    completedAt: "2026-08-13T20:00:01.000Z",
  });

  assert.equal(report.outcome, "FAILED");
  assert.ok(report.summary.errorCount >= 2);
  const lineageIssue = report.issues.find((issue) => issue.code === "DERIVED_PROVENANCE_INVALID");
  assert.equal(lineageIssue.location.artifactBindingId, "derived-1");
  assert.equal(lineageIssue.location.coordinateFrameId, "plant/floor-1");
  assert.equal(lineageIssue.location.jsonPointer, "");
});

function draft() {
  return {
    draftId: "draft-1",
    familyId: "plant",
    revision: 1,
    canonicalFrameId: "plant/floor-1",
    status: "IN_REVIEW",
    rowVersion: 2,
  };
}

function sourceArtifact() {
  return {
    bindingId: "source-1",
    draftId: "draft-1",
    uploadId: "upload-1",
    artifactSha256: "a".repeat(64),
    role: "BIM_SOURCE",
    kind: "SOURCE",
    coordinateFrameId: "plant/floor-1",
    inputBindings: [],
    producer: null,
    createdBy: "engineer-1",
    createdAt: "2026-08-13T19:00:00.000Z",
  };
}

function derivedArtifact(overrides) {
  return {
    bindingId: "derived-1",
    draftId: "draft-1",
    uploadId: "upload-derived-1",
    artifactSha256: "d".repeat(64),
    role: "IMPORT_REPORT",
    kind: "DERIVED",
    coordinateFrameId: null,
    inputBindings: [{ bindingId: "source-1", artifactSha256: "a".repeat(64) }],
    producer: { name: "test-producer", version: "1", parametersSha256: "e".repeat(64) },
    createdBy: "worker-1",
    createdAt: "2026-08-13T19:00:00.000Z",
    ...overrides,
  };
}

function validationReport(jobId, artifacts) {
  return createDraftValidationReport({
    reportId: `report-${jobId}`,
    jobId,
    draft: draft(),
    artifacts,
    registry: new DraftValidatorRegistry(),
    startedAt: "2026-08-13T20:00:00.000Z",
    completedAt: "2026-08-13T20:00:01.000Z",
  });
}
