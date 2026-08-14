import type { WorldEntity } from "@brash-twin/viewer-sdk";
import type { AssetCandidateSetRecord } from "../../api/types";

export function semanticCandidateWorldEntities(candidateSet: AssetCandidateSetRecord): WorldEntity[] {
  const decisions = new Map(
    (candidateSet.review?.report.decisions ?? []).map((decision) => [decision.candidateId, decision]),
  );
  return candidateSet.report.candidates
    .filter((candidate) => decisions.get(candidate.candidateId)?.decision !== "REJECTED")
    .map((candidate) => {
      const decision = decisions.get(candidate.candidateId);
      return {
        entityId: `semantic-${candidate.candidateId}`,
        layerId: "assets",
        label: decision?.displayName ?? `${candidate.suggestedClass} · ${(candidate.confidence * 100).toFixed(0)}%`,
        position: {
          x: candidate.canonicalPosition[0],
          y: candidate.canonicalPosition[1],
          z: candidate.canonicalPosition[2],
        },
        geometry: {
          type: "POINT" as const,
          radius: Math.max(0.2, Math.min(0.65, Math.max(...candidate.dimensions) * 0.12)),
        },
      };
    });
}
