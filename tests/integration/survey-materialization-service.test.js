import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SurveyMaterializationError,
  SurveyMaterializationService,
} from "@brash-twin/application/survey-materializations";
import { validateEmbodiedSurveyPackage } from "@brash-twin/embodied-survey";
import { InMemorySurveyMaterializationRepository } from "@brash-twin/persistence/survey-materializations";

const manifestUrl = new URL("../fixtures/surveys/embodied-demo.v1.json", import.meta.url);

test("accepted intake creates deterministic snapshot without reading heavy artifacts", async () => {
  const content = await readFile(manifestUrl);
  const manifest = JSON.parse(content);
  const report = validateEmbodiedSurveyPackage(manifest);
  const intake = acceptedIntake(manifest, report, content);
  const reads = [];
  const service = materializationService(intake, content, reads);

  const job = await service.create(intake.intakeId, {
    jobId: "materialization-1",
    operatorId: "operator-1",
  });
  assert.equal(job.status, "PENDING");
  assert.equal(job.snapshot.schemaVersion, "brash.survey-materialization-snapshot/v1");
  assert.equal(job.snapshot.coordinateSystem.rootFrameId, "slam-map");
  assert.equal(job.snapshot.artifacts.length, manifest.artifacts.length);
  assert.deepEqual(job.snapshot.artifacts.map((artifact) => artifact.artifactId), [
    "calibration-1",
    "frames-1",
    "point-cloud-map-1",
    "quality-report-1",
    "trajectory-1",
  ]);
  assert.match(job.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(reads, [intake.manifestArtifactSha256]);

  await assert.rejects(
    () => service.create(intake.intakeId, {
      jobId: "materialization-2",
      operatorId: "operator-1",
    }),
    (error) => error instanceof SurveyMaterializationError
      && error.code === "SURVEY_MATERIALIZATION_CONFLICT",
  );
});

test("rejected intake is ineligible before any object-store read", async () => {
  const content = await readFile(manifestUrl);
  const manifest = JSON.parse(content);
  const report = validateEmbodiedSurveyPackage(manifest);
  const intake = { ...acceptedIntake(manifest, report, content), status: "REJECTED" };
  const reads = [];
  const service = materializationService(intake, content, reads);
  await assert.rejects(
    () => service.create(intake.intakeId, { operatorId: "operator-1" }),
    (error) => error instanceof SurveyMaterializationError
      && error.code === "SURVEY_MATERIALIZATION_INTAKE_INELIGIBLE",
  );
  assert.deepEqual(reads, []);
});

test("accepted manifest raw bytes and canonical validation identity are rechecked", async () => {
  const content = await readFile(manifestUrl);
  const manifest = JSON.parse(content);
  const report = validateEmbodiedSurveyPackage(manifest);
  const intake = acceptedIntake(manifest, report, content);
  const changed = Buffer.from(content.toString("utf8").replace("0.1.0", "0.1.1"));
  const service = materializationService(intake, changed, []);
  await assert.rejects(
    () => service.create(intake.intakeId, { operatorId: "operator-1" }),
    (error) => error instanceof SurveyMaterializationError
      && error.code === "SURVEY_MATERIALIZATION_MANIFEST_INTEGRITY_FAILED",
  );
});

function materializationService(intake, content, reads) {
  return new SurveyMaterializationService({
    repository: new InMemorySurveyMaterializationRepository(),
    surveyIntakes: { get: async () => structuredClone(intake) },
    catalog: {
      getMapDraftContext: async () => ({
        draft: { draftId: intake.draftId, status: "DRAFT" },
        family: { familyId: "family-1" },
        floor: { floorId: "production-floor", siteId: "demo-site" },
      }),
    },
    multipartStore: {
      async get(sha256) {
        reads.push(sha256);
        return content;
      },
    },
    jobIdGenerator: () => "materialization-generated",
    clock: () => new Date("2026-08-14T13:00:00.000Z"),
  });
}

function acceptedIntake(manifest, report, content) {
  return {
    intakeId: "intake-1",
    draftId: "draft-1",
    manifestUploadId: "manifest-upload-1",
    manifestArtifactSha256: createHash("sha256").update(content).digest("hex"),
    status: "ACCEPTED",
    manifestSchemaVersion: manifest.schemaVersion,
    manifestSha256: report.manifestSha256,
    packageId: manifest.packageId,
    surveyId: manifest.surveyId,
    sourceSiteId: manifest.siteId,
    sourceFloorId: manifest.floorId,
    report,
    artifactUploads: manifest.artifacts.map((artifact, index) => ({
      artifactId: artifact.artifactId,
      uploadId: `artifact-upload-${index + 1}`,
      artifactSha256: artifact.sha256,
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
    })),
    rowVersion: 2,
    createdBy: "operator-1",
    createdAt: "2026-08-14T12:00:00.000Z",
    verifiedBy: "reviewer-1",
    verifiedAt: "2026-08-14T12:01:00.000Z",
  };
}
