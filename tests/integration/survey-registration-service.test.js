import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { SurveyRegistrationError, SurveyRegistrationService } from "@brash-twin/application/survey-registrations";
import { UploadService } from "@brash-twin/application/uploads";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { InMemoryDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";

test("survey registration persists a versioned report derived from a sealed preview", async () => {
  const system = await registrationSystem();
  const registration = await system.registrations.create("draft-1", {
    registrationId: "registration-1",
    materializationJobId: "materialization-1",
    targetBindingId: "floorplan-target-1",
    allowScale: false,
    operatorId: "operator-1",
    controlPoints: controlPoints(),
  });

  assert.equal(registration.report.schemaVersion, "brash.survey-registration-report/v2");
  assert.equal(registration.report.targetEvidence.bindingId, "floorplan-target-1");
  assert.equal(registration.report.targetEvidence.role, "FLOORPLAN_SOURCE");
  assert.equal(registration.report.transform.scale, 1);
  assert.ok(Math.abs(registration.report.transform.rotationRadians - Math.PI / 2) < 1e-10);
  assert.deepEqual(registration.report.transform.translation, { x: 10, y: 20 });
  assert.equal(registration.report.metrics.rmseMetres, 0);
  assert.equal(registration.report.quality.outcome, "PASSED");
  assert.equal(registration.acceptance, null);
  assert.equal(registration.reportBindingId, "survey-registration-report-registration-1");

  const listed = await system.registrations.list("draft-1");
  assert.deepEqual(listed, [registration]);
  const binding = (await system.draftArtifacts.list("draft-1")).find(
    (candidate) => candidate.bindingId === registration.reportBindingId,
  );
  assert.equal(binding.role, "REGISTRATION_REPORT");
  assert.deepEqual(binding.inputBindings.map((input) => input.bindingId), [
    "survey-preview-1",
    "floorplan-target-1",
    "survey-quality-acceptance-1",
  ]);

  const acceptance = await system.registrations.review("draft-1", "registration-1", {
    decision: "APPROVED",
    reviewerId: "reviewer-1",
    note: "Control points verified against the floorplan.",
  });
  assert.equal(acceptance.report.schemaVersion, "brash.survey-registration-acceptance/v1");
  assert.equal(acceptance.report.decision, "APPROVED");
  assert.equal(acceptance.report.registrationReport.bindingId, registration.reportBindingId);
  const reviewed = await system.registrations.list("draft-1");
  assert.deepEqual(reviewed[0].acceptance, acceptance);
});

test("survey registration rejects degenerate operator control points", async () => {
  const system = await registrationSystem();
  await assert.rejects(
    () => system.registrations.create("draft-1", {
      registrationId: "registration-bad",
      materializationJobId: "materialization-1",
      targetBindingId: "floorplan-target-1",
      operatorId: "operator-1",
      controlPoints: [
        { controlPointId: "cp-1", source: { x: 0, y: 0 }, target: { x: 1, y: 1 } },
        { controlPointId: "cp-2", source: { x: 0, y: 0 }, target: { x: 2, y: 2 } },
      ],
    }),
    (error) => error instanceof SurveyRegistrationError
      && error.code === "SURVEY_REGISTRATION_GEOMETRY_DEGENERATE",
  );
});

test("survey registration requires canonical design evidence and distinct quality approval", async () => {
  const system = await registrationSystem();
  await assert.rejects(
    () => system.registrations.create("draft-1", {
      registrationId: "registration-no-target",
      materializationJobId: "materialization-1",
      targetBindingId: "survey-source-1",
      operatorId: "operator-1",
      controlPoints: controlPoints(),
    }),
    (error) => error instanceof SurveyRegistrationError
      && error.code === "SURVEY_REGISTRATION_TARGET_INELIGIBLE",
  );
  const registration = await system.registrations.create("draft-1", {
    registrationId: "registration-review",
    materializationJobId: "materialization-1",
    targetBindingId: "floorplan-target-1",
    operatorId: "operator-1",
    controlPoints: controlPoints(),
  });
  await assert.rejects(
    () => system.registrations.review("draft-1", registration.report.registrationId, {
      decision: "APPROVED",
      reviewerId: "operator-1",
    }),
    (error) => error instanceof SurveyRegistrationError
      && error.code === "SURVEY_REGISTRATION_REVIEWER_CONFLICT",
  );

  const failedQuality = await system.registrations.create("draft-1", {
    registrationId: "registration-failed-quality",
    materializationJobId: "materialization-1",
    targetBindingId: "floorplan-target-1",
    operatorId: "operator-1",
    controlPoints: [
      ...controlPoints().slice(0, 2),
      { controlPointId: "cp-3", source: { x: 1, y: 1 }, target: { x: 3, y: 4 } },
    ],
  });
  assert.equal(failedQuality.report.quality.outcome, "FAILED");
  assert.ok(failedQuality.report.quality.issues.length > 0);
  await assert.rejects(
    () => system.registrations.review("draft-1", failedQuality.report.registrationId, {
      decision: "APPROVED",
      reviewerId: "reviewer-1",
    }),
    (error) => error instanceof SurveyRegistrationError
      && error.code === "SURVEY_REGISTRATION_QUALITY_FAILED",
  );
});

test("survey registration requires approved materialization quality", async () => {
  const system = await registrationSystem(false);
  await assert.rejects(
    () => system.registrations.create("draft-1", {
      registrationId: "registration-without-quality",
      materializationJobId: "materialization-1",
      targetBindingId: "floorplan-target-1",
      operatorId: "operator-1",
      controlPoints: controlPoints(),
    }),
    (error) => error instanceof SurveyRegistrationError
      && error.code === "SURVEY_REGISTRATION_QUALITY_REVIEW_REQUIRED",
  );
});

async function registrationSystem(approvedQuality = true) {
  const clock = () => new Date("2026-08-14T15:00:00.000Z");
  const store = new LocalMultipartArtifactStore(await mkdtemp(join(tmpdir(), "brash-registration-")), { clock });
  const uploads = new UploadService({
    repository: new InMemoryUploadRepository(),
    multipartStore: store,
    clock,
  });
  const catalog = {
    getMapDraft: async (draftId) => ({ draftId, status: "DRAFT", canonicalFrameId: "plant-floor" }),
    getMapDraftContext: async (draftId) => ({
      draft: { draftId, status: "DRAFT", canonicalFrameId: "plant-floor" },
    }),
  };
  const draftArtifacts = new DraftArtifactService({
    repository: new InMemoryDraftArtifactRepository(),
    catalog,
    uploads,
    clock,
  });
  const source = await upload(uploads, store, "survey-source-upload", Buffer.from("sealed source"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-source-1",
    uploadId: source.uploadId,
    role: "SURVEY_SOURCE",
    coordinateFrameId: "slam-map",
    operatorId: "operator-1",
  });
  const target = await upload(uploads, store, "floorplan-target-upload", Buffer.from("sealed floorplan"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "floorplan-target-1",
    uploadId: target.uploadId,
    role: "FLOORPLAN_SOURCE",
    coordinateFrameId: "plant-floor",
    operatorId: "operator-1",
  });
  const preview = await upload(uploads, store, "survey-preview-upload", Buffer.from("sealed preview"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-preview-1",
    uploadId: preview.uploadId,
    role: "SURVEY_PREVIEW",
    coordinateFrameId: "slam-map",
    inputBindingIds: ["survey-source-1"],
    producer: { name: "materializer", version: "1", parametersSha256: "a".repeat(64) },
    operatorId: "operator-1",
  });
  const qualityReport = await upload(uploads, store, "quality-report-upload", Buffer.from("sealed quality report"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-quality-report-1",
    uploadId: qualityReport.uploadId,
    role: "SURVEY_QUALITY_REPORT",
    coordinateFrameId: "slam-map",
    inputBindingIds: ["survey-preview-1"],
    producer: { name: "brash-survey-quality", version: "1", parametersSha256: "b".repeat(64) },
    operatorId: "operator-1",
  });
  const qualityAcceptance = await upload(uploads, store, "quality-acceptance-upload", Buffer.from("sealed quality acceptance"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-quality-acceptance-1",
    uploadId: qualityAcceptance.uploadId,
    role: "SURVEY_QUALITY_ACCEPTANCE",
    inputBindingIds: ["survey-quality-report-1"],
    producer: { name: "brash-survey-quality-review", version: "1", parametersSha256: "c".repeat(64) },
    operatorId: "reviewer-1",
  });
  const materialization = {
    jobId: "materialization-1",
    draftId: "draft-1",
    status: "SUCCEEDED",
    output: {
      previewBindingId: "survey-preview-1",
      previewSha256: preview.artifactSha256,
      sourceFrameId: "slam-map",
    },
  };
  const registrations = new SurveyRegistrationService({
    catalog,
    materializations: { get: async () => materialization },
    qualityReviews: {
      findApprovedForMaterialization: async () => approvedQuality ? ({
        acceptance: {
          reportBindingId: "survey-quality-acceptance-1",
          reportSha256: qualityAcceptance.artifactSha256,
        },
      }) : null,
    },
    draftArtifacts,
    uploads,
    multipartStore: store,
    clock,
  });
  return { registrations, draftArtifacts };
}

async function upload(uploads, store, uploadId, content) {
  const expectedSha256 = createHash("sha256").update(content).digest("hex");
  await uploads.initiate({
    uploadId,
    expectedSha256,
    expectedBytes: content.byteLength,
    mediaType: "application/octet-stream",
    originalName: `${uploadId}.bin`,
    operatorId: "operator-1",
  });
  await store.putPart(uploadId, 1, content);
  return uploads.complete(uploadId, { operatorId: "operator-1" });
}

function controlPoints() {
  return [
    { controlPointId: "cp-1", source: { x: 0, y: 0 }, target: { x: 10, y: 20 } },
    { controlPointId: "cp-2", source: { x: 1, y: 0 }, target: { x: 10, y: 21 } },
    { controlPointId: "cp-3", source: { x: 1, y: 1 }, target: { x: 9, y: 21 } },
  ];
}
