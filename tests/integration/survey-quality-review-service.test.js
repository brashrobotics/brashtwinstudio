import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { SurveyQualityReviewError, SurveyQualityReviewService } from "@brash-twin/application/survey-quality-reviews";
import { UploadService } from "@brash-twin/application/uploads";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { InMemoryDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";

test("survey quality review seals metrics, coverage grid, and independent approval", async () => {
  const system = await qualitySystem(0.91);
  const quality = await system.qualityReviews.create("draft-1", {
    qualityReviewId: "quality-1",
    materializationJobId: "materialization-1",
    operatorId: "operator-1",
  });

  assert.equal(quality.report.schemaVersion, "brash.survey-quality-report/v1");
  assert.equal(quality.report.outcome, "PASSED");
  assert.equal(quality.report.metrics.declaredCoverageRatio, 0.91);
  assert.equal(quality.report.metrics.pointDensityPerSquareMetre, 4);
  assert.ok(quality.report.coverageGrid.cells.length > 0);
  assert.equal(quality.acceptance, null);

  const acceptance = await system.qualityReviews.review("draft-1", "quality-1", {
    decision: "APPROVED",
    reviewerId: "reviewer-1",
    note: "Coverage and trajectory evidence reviewed.",
  });
  assert.equal(acceptance.report.decision, "APPROVED");
  const approved = await system.qualityReviews.findApprovedForMaterialization("draft-1", "materialization-1");
  assert.equal(approved.acceptance.reportBindingId, acceptance.reportBindingId);
});

test("failed quality cannot be approved", async () => {
  const system = await qualitySystem(0.4);
  const quality = await system.qualityReviews.create("draft-1", {
    qualityReviewId: "quality-failed",
    materializationJobId: "materialization-1",
    operatorId: "operator-1",
  });
  assert.equal(quality.report.outcome, "FAILED");
  assert.ok(quality.report.issues.some((issue) => issue.code === "COVERAGE_BELOW_MINIMUM"));
  await assert.rejects(
    () => system.qualityReviews.review("draft-1", "quality-failed", {
      decision: "APPROVED",
      reviewerId: "reviewer-1",
    }),
    (error) => error instanceof SurveyQualityReviewError && error.code === "SURVEY_QUALITY_FAILED",
  );
});

async function qualitySystem(coverageRatio) {
  const clock = () => new Date("2026-08-14T16:00:00.000Z");
  const store = new LocalMultipartArtifactStore(await mkdtemp(join(tmpdir(), "brash-quality-")), { clock });
  const uploads = new UploadService({ repository: new InMemoryUploadRepository(), multipartStore: store, clock });
  const catalog = {
    getMapDraft: async (draftId) => ({ draftId, status: "DRAFT", canonicalFrameId: "plant-floor" }),
    getMapDraftContext: async (draftId) => ({ draft: { draftId, status: "DRAFT", canonicalFrameId: "plant-floor" } }),
  };
  const draftArtifacts = new DraftArtifactService({
    repository: new InMemoryDraftArtifactRepository(),
    catalog,
    uploads,
    clock,
  });
  const source = await upload(uploads, store, "source-upload", Buffer.from("source"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-source-1",
    uploadId: source.uploadId,
    role: "SURVEY_SOURCE",
    coordinateFrameId: "slam-map",
    operatorId: "operator-1",
  });
  const previewArtifact = await upload(uploads, store, "preview-upload", Buffer.from("preview"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-preview-1",
    uploadId: previewArtifact.uploadId,
    role: "SURVEY_PREVIEW",
    coordinateFrameId: "slam-map",
    inputBindingIds: ["survey-source-1"],
    producer: { name: "materializer", version: "1", parametersSha256: "a".repeat(64) },
    operatorId: "operator-1",
  });
  const materialization = {
    jobId: "materialization-1",
    draftId: "draft-1",
    status: "SUCCEEDED",
    snapshot: { quality: { coverageRatio } },
    output: {
      previewBindingId: "survey-preview-1",
      previewSha256: previewArtifact.artifactSha256,
      sourceFrameId: "slam-map",
    },
  };
  const preview = {
    coordinateSystem: { rootFrameId: "slam-map" },
    trajectory: {
      frameId: "slam-map",
      sampleCount: 5,
      timestamp: { durationSeconds: 4, nonIncreasingCount: 0 },
      sampling: { medianRateHz: 1 },
      maximumStepMetres: 2,
    },
    reconstruction: {
      frameId: "slam-map",
      vertexCount: 192,
      bounds: { minimum: [-4, -3, 0], maximum: [4, 3, 2] },
      preview: { points: [[-4, -3, 0, 1], [0, 0, 1, 2], [4, 3, 2, 3]] },
    },
    qualityWarnings: [],
  };
  const qualityReviews = new SurveyQualityReviewService({
    catalog,
    materializations: { get: async () => materialization, getPreview: async () => preview },
    draftArtifacts,
    uploads,
    multipartStore: store,
    clock,
  });
  return { qualityReviews };
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
