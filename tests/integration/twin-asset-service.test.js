import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { TwinAssetError, TwinAssetService } from "@brash-twin/application/twin-assets";
import { UploadService } from "@brash-twin/application/uploads";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { InMemoryDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";

test("reviewed semantic candidates become an immutable versioned Twin asset set", async () => {
  const system = await twinAssetSystem();
  const promoted = await system.twinAssets.promote("draft-1", {
    assetSetId: "asset-set-1",
    candidateSetId: "baseline-candidates",
    operatorId: "asset-curator",
  });

  assert.equal(promoted.report.schemaVersion, "brash.draft-twin-assets/v1");
  assert.equal(promoted.report.revision, 1);
  assert.equal(promoted.report.predecessor, null);
  assert.equal(promoted.report.assets.length, 2);
  assert.deepEqual(promoted.report.assets.map((asset) => asset.displayName).sort(), ["Line Conveyor", "Main Electrical Panel"]);
  assert.ok(promoted.report.assets.every((asset) => asset.frameId === "plant-floor"));
  assert.ok(promoted.report.assets.every((asset) => asset.source.candidateSetId === "baseline-candidates"));

  const binding = (await system.draftArtifacts.list("draft-1")).find(
    (candidate) => candidate.bindingId === promoted.reportBindingId,
  );
  assert.equal(binding.role, "TWIN_ASSETS");
  assert.deepEqual(binding.inputBindings.map((input) => input.bindingId), [
    "candidate-report-baseline-candidates",
    "candidate-review-baseline-candidates",
  ]);
  assert.deepEqual(await system.twinAssets.list("draft-1"), [promoted]);
  await assert.rejects(
    () => system.twinAssets.promote("draft-1", {
      assetSetId: "asset-set-2",
      candidateSetId: "baseline-candidates",
      operatorId: "asset-curator",
    }),
    (error) => error instanceof TwinAssetError && error.code === "TWIN_ASSET_PROMOTION_CONFLICT",
  );
});

test("later registered observations produce moved, missing, and appeared review candidates", async () => {
  const system = await twinAssetSystem();
  const baseline = await system.twinAssets.promote("draft-1", {
    assetSetId: "asset-set-1",
    candidateSetId: "baseline-candidates",
    operatorId: "asset-curator",
  });
  const report = await system.twinAssets.detectChanges("draft-1", {
    changeSetId: "change-set-1",
    candidateSetId: "later-candidates",
    operatorId: "change-worker",
  });

  assert.equal(report.report.schemaVersion, "brash.asset-change-report/v1");
  assert.deepEqual(report.report.summary, {
    movedCount: 1,
    missingCount: 1,
    appearedCount: 1,
    unchangedCount: 0,
    ignoredObservationCount: 0,
  });
  assert.deepEqual(report.report.changes.map((change) => change.changeType).sort(), ["APPEARED", "MISSING", "MOVED"]);
  assert.ok(report.report.changes.every((change) => change.reviewStatus === "REVIEW_REQUIRED"));
  const moved = report.report.changes.find((change) => change.changeType === "MOVED");
  const panel = baseline.report.assets.find((asset) => asset.source.candidateId === "baseline-panel");
  assert.equal(moved.assetId, panel.assetId);
  assert.equal(moved.distanceMeters, 1);
  assert.deepEqual(moved.fromPosition, [1, 2, 1]);
  assert.deepEqual(moved.toPosition, [2, 2, 1]);
  assert.equal(report.report.coverage.baselineAssetsEvaluated, 2);

  const binding = (await system.draftArtifacts.list("draft-1")).find(
    (candidate) => candidate.bindingId === report.reportBindingId,
  );
  assert.equal(binding.role, "ASSET_CHANGE_REPORT");
  assert.deepEqual(binding.inputBindings.map((input) => input.bindingId), [
    baseline.reportBindingId,
    "candidate-report-later-candidates",
  ]);
  assert.deepEqual(await system.twinAssets.listChanges("draft-1"), [report]);
  system.later.review = {
    reportBindingId: "candidate-review-later-candidates",
    reportSha256: "f".repeat(64),
    report: {
      summary: { acceptedCount: 2, rejectedCount: 0 },
      decisions: system.later.report.candidates.map((candidate) => decision(
        candidate.candidateId,
        candidate.suggestedClass,
        candidate.suggestedClass,
      )),
    },
  };
  await assert.rejects(
    () => system.twinAssets.promote("draft-1", {
      candidateSetId: "later-candidates",
      operatorId: "asset-curator",
    }),
    (error) => error instanceof TwinAssetError && error.code === "TWIN_ASSET_CHANGE_WORKFLOW_REQUIRED",
  );
});

test("promotion requires reviewed candidates and change detection rejects its own baseline evidence", async () => {
  const system = await twinAssetSystem();
  await assert.rejects(
    () => system.twinAssets.promote("draft-1", {
      candidateSetId: "later-candidates",
      operatorId: "asset-curator",
    }),
    (error) => error instanceof TwinAssetError && error.code === "TWIN_ASSET_REVIEW_REQUIRED",
  );
  await system.twinAssets.promote("draft-1", {
    assetSetId: "asset-set-1",
    candidateSetId: "baseline-candidates",
    operatorId: "asset-curator",
  });
  await assert.rejects(
    () => system.twinAssets.detectChanges("draft-1", {
      candidateSetId: "baseline-candidates",
      operatorId: "change-worker",
    }),
    (error) => error instanceof TwinAssetError && error.code === "TWIN_ASSET_CHANGE_INPUT_INVALID",
  );
});

async function twinAssetSystem() {
  const clock = () => new Date("2026-08-14T20:00:00.000Z");
  const store = new LocalMultipartArtifactStore(await mkdtemp(join(tmpdir(), "brash-assets-")), { clock });
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
  const sourceUpload = await upload(uploads, store, "survey-source-upload", Buffer.from("source"));
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-source-1",
    uploadId: sourceUpload.uploadId,
    role: "SURVEY_SOURCE",
    coordinateFrameId: "slam-map",
    operatorId: "mapping-operator",
  });
  const baseline = await candidateSet({
    candidateSetId: "baseline-candidates",
    candidates: [
      candidate("baseline-panel", "panel-observation", "electrical-panel", [1, 2, 1]),
      candidate("baseline-conveyor", "conveyor-observation", "conveyor", [4, 2, 1]),
    ],
    decisions: [
      decision("baseline-panel", "Main Electrical Panel", "electrical-panel"),
      decision("baseline-conveyor", "Line Conveyor", "conveyor"),
    ],
    uploads,
    store,
    draftArtifacts,
  });
  const later = await candidateSet({
    candidateSetId: "later-candidates",
    candidates: [
      candidate("later-panel", "panel-observation-2", "electrical-panel", [2, 2, 1]),
      candidate("later-barrier", "barrier-observation", "safety-barrier", [3, 3, 1]),
    ],
    decisions: null,
    uploads,
    store,
    draftArtifacts,
  });
  const semanticCandidates = { list: async () => [baseline, later] };
  const twinAssets = new TwinAssetService({
    catalog,
    semanticCandidates,
    draftArtifacts,
    uploads,
    multipartStore: store,
    clock,
  });
  return { twinAssets, draftArtifacts, later };
}

async function candidateSet({ candidateSetId, candidates, decisions, uploads, store, draftArtifacts }) {
  const reportBinding = await derivedBinding({
    uploads,
    store,
    draftArtifacts,
    uploadId: `candidate-report-upload-${candidateSetId}`,
    bindingId: `candidate-report-${candidateSetId}`,
    role: "ASSET_CANDIDATE_REPORT",
    inputBindingIds: ["survey-source-1"],
    producerName: "brash-semantic-candidate-extractor",
  });
  const report = {
    schemaVersion: "brash.asset-candidate-report/v1",
    candidateSetId,
    draftId: "draft-1",
    canonicalFrameId: "plant-floor",
    candidates,
    createdBy: "semantic-worker",
    createdAt: "2026-08-14T19:00:00.000Z",
  };
  let review = null;
  if (decisions) {
    const reviewBinding = await derivedBinding({
      uploads,
      store,
      draftArtifacts,
      uploadId: `candidate-review-upload-${candidateSetId}`,
      bindingId: `candidate-review-${candidateSetId}`,
      role: "ASSET_CANDIDATE_REVIEW",
      inputBindingIds: [reportBinding.bindingId],
      producerName: "brash-asset-candidate-review",
      coordinateFrameId: null,
    });
    review = {
      reportBindingId: reviewBinding.bindingId,
      reportUploadId: reviewBinding.uploadId,
      reportSha256: reviewBinding.artifactSha256,
      report: {
        candidateSetId,
        decisions,
        summary: { acceptedCount: decisions.length, rejectedCount: 0 },
        reviewerId: "factory-reviewer",
      },
    };
  }
  return {
    reportBindingId: reportBinding.bindingId,
    reportUploadId: reportBinding.uploadId,
    reportSha256: reportBinding.artifactSha256,
    report,
    review,
  };
}

function candidate(candidateId, sourceObservationId, suggestedClass, canonicalPosition) {
  return {
    candidateId,
    sourceObservationId,
    suggestedClass,
    confidence: 0.95,
    canonicalPosition,
    dimensions: [1, 0.5, 2],
    evidence: [{ bindingId: "survey-source-1", artifactSha256: "a".repeat(64) }],
  };
}

function decision(candidateId, displayName, assetType) {
  return { candidateId, decision: "ACCEPTED", displayName, assetType, properties: {} };
}

async function derivedBinding({
  uploads, store, draftArtifacts, uploadId, bindingId, role, inputBindingIds, producerName, coordinateFrameId = "plant-floor",
}) {
  const uploaded = await upload(uploads, store, uploadId, Buffer.from(bindingId));
  return draftArtifacts.bind("draft-1", {
    bindingId,
    uploadId: uploaded.uploadId,
    role,
    coordinateFrameId,
    inputBindingIds,
    producer: { name: producerName, version: "1", parametersSha256: "e".repeat(64) },
    operatorId: "worker-1",
  });
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
