import { describe, expect, it } from "vitest";
import type { AssetCandidateSetRecord } from "../../api/types";
import { semanticCandidateWorldEntities } from "./semanticCandidateWorld";

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
