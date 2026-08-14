import { describe, expect, it } from "vitest";
import type { AssetCandidateSetRecord, AssetChangeSetRecord, DraftTwinAssetSetRecord } from "../../api/types";
import { assetChangeWorldEntities, draftTwinAssetWorldEntities, semanticCandidateWorldEntities } from "./semanticCandidateWorld";

describe("semanticCandidateWorldEntities", () => {
  it("renders canonical unreviewed/accepted candidates and hides rejected observations", () => {
    const candidateSet = fixture();
    expect(semanticCandidateWorldEntities(candidateSet)).toHaveLength(2);
    candidateSet.review = {
      reportBindingId: "review-1", reportUploadId: "upload-review-1", reportSha256: "d".repeat(64),
      report: {
        schemaVersion: "brash.asset-candidate-review/v1", candidateSetId: "set-1", draftId: "draft-1",
        candidateReport: { bindingId: "report-1", sha256: "c".repeat(64) }, reviewerId: "reviewer-1",
        note: null, reviewedAt: "2026-08-14T18:01:00.000Z", summary: { acceptedCount: 1, rejectedCount: 1 },
        decisions: [
          { candidateId: "candidate-1", decision: "ACCEPTED", displayName: "Panel A", assetType: "panel", properties: {} },
          { candidateId: "candidate-2", decision: "REJECTED", displayName: null, assetType: null, properties: {} },
        ],
      },
    };
    const entities = semanticCandidateWorldEntities(candidateSet);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ label: "Panel A", position: { x: 1, y: 2, z: 1 } });
  });

  it("renders promoted assets as boxes and review-required changes as spatial markers", () => {
    const assetSet = assetSetFixture();
    expect(draftTwinAssetWorldEntities(assetSet)[0]).toMatchObject({
      label: "Panel A",
      position: { x: 1, y: 2, z: 1 },
      geometry: { type: "BOX", size: { x: 1, y: 0.5, z: 2 } },
    });
    const changeSet = changeSetFixture();
    expect(assetChangeWorldEntities(changeSet)[0]).toMatchObject({
      label: "MOVED · electrical-panel · 95%",
      position: { x: 2, y: 2, z: 1 },
      geometry: { type: "POINT" },
    });
  });
});

function fixture(): AssetCandidateSetRecord {
  return {
    reportBindingId: "report-1", reportUploadId: "upload-report-1", reportSha256: "c".repeat(64), review: null,
    report: {
      schemaVersion: "brash.asset-candidate-report/v1", candidateSetId: "set-1", draftId: "draft-1",
      registrationId: "registration-1", registrationAcceptance: { bindingId: "acceptance-1", sha256: "a".repeat(64) },
      observations: { bindingId: "observations-1", sha256: "b".repeat(64), observationSetId: "observations-1", sourceFrameId: "slam-map" },
      canonicalFrameId: "plant-floor", extraction: { name: "extractor", version: "1", configurationSha256: "e".repeat(64) },
      createdBy: "operator-1", createdAt: "2026-08-14T18:00:00.000Z",
      candidates: [
        { candidateId: "candidate-1", sourceObservationId: "observation-1", suggestedClass: "panel", confidence: 0.9, canonicalPosition: [1, 2, 1], dimensions: [1, 1, 2], evidence: [] },
        { candidateId: "candidate-2", sourceObservationId: "observation-2", suggestedClass: "conveyor", confidence: 0.8, canonicalPosition: [3, 4, 1], dimensions: [2, 1, 1], evidence: [] },
      ],
    },
  };
}

function assetSetFixture(): DraftTwinAssetSetRecord {
  return {
    reportBindingId: "assets-1", reportUploadId: "assets-upload-1", reportSha256: "f".repeat(64),
    report: {
      schemaVersion: "brash.draft-twin-assets/v1", assetSetId: "set-1", draftId: "draft-1", revision: 1,
      canonicalFrameId: "plant-floor", predecessor: null,
      sourceCandidateSet: { candidateSetId: "candidates-1", report: { bindingId: "report-1", sha256: "a".repeat(64) }, review: { bindingId: "review-1", sha256: "b".repeat(64) } },
      promotedBy: "curator-1", promotedAt: "2026-08-14T20:00:00.000Z",
      assets: [{
        assetId: "asset-1", displayName: "Panel A", semanticClass: "electrical-panel", mobilityClass: "STATIC",
        frameId: "plant-floor", pose: { position: { x: 1, y: 2, z: 1 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        footprint: [{ x: 0.5, y: 1.75 }, { x: 1.5, y: 1.75 }, { x: 1.5, y: 2.25 }],
        bounds3d: { minimum: { x: 0.5, y: 1.75, z: 0 }, maximum: { x: 1.5, y: 2.25, z: 2 } },
        properties: {}, topologyBindings: [],
        changePolicy: { positionToleranceMeters: 0.5, minimumConfidence: 0.75, requiredConfirmations: 1 },
        source: { candidateSetId: "candidates-1", candidateId: "candidate-1", sourceObservationId: "observation-1", suggestedClass: "electrical-panel" },
      }],
    },
  };
}

function changeSetFixture(): AssetChangeSetRecord {
  return {
    reportBindingId: "changes-1", reportUploadId: "changes-upload-1", reportSha256: "e".repeat(64),
    report: {
      schemaVersion: "brash.asset-change-report/v1", changeSetId: "changes-1", draftId: "draft-1", canonicalFrameId: "plant-floor",
      baseline: { assetSetId: "set-1", revision: 1, bindingId: "assets-1", sha256: "f".repeat(64) },
      observations: { candidateSetId: "candidates-2", bindingId: "report-2", sha256: "d".repeat(64) },
      policy: { matchingAlgorithm: "CLASS_NEAREST_NEIGHBOR", maximumMatchDistanceMeters: 5, coverageMode: "OBSERVED_ENVELOPE", coveragePaddingMeters: 1.5 },
      coverage: { minimum: [0, 0, 0], maximum: [3, 3, 2], baselineAssetsEvaluated: 1 },
      summary: { movedCount: 1, missingCount: 0, appearedCount: 0, unchangedCount: 0, ignoredObservationCount: 0 },
      changes: [{ changeId: "changes-1-moved-asset-1", changeType: "MOVED", assetId: "asset-1", candidateId: "candidate-2", semanticClass: "electrical-panel", confidence: 0.95, fromPosition: [1, 2, 1], toPosition: [2, 2, 1], distanceMeters: 1, reviewStatus: "REVIEW_REQUIRED" }],
      createdBy: "worker-1", createdAt: "2026-08-14T21:00:00.000Z",
    },
  };
}
