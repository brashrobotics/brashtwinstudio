import type { WorldEntity } from "@brash-twin/viewer-sdk";
import type { AssetCandidateSetRecord, AssetChangeSetRecord, DraftTwinAssetSetRecord } from "../../api/types";

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

export function draftTwinAssetWorldEntities(assetSet: DraftTwinAssetSetRecord): WorldEntity[] {
  return assetSet.report.assets.map((asset) => ({
    entityId: `twin-asset-${asset.assetId}`,
    layerId: "assets",
    label: asset.displayName,
    position: { ...asset.pose.position },
    geometry: {
      type: "BOX" as const,
      size: {
        x: asset.bounds3d.maximum.x - asset.bounds3d.minimum.x,
        y: asset.bounds3d.maximum.y - asset.bounds3d.minimum.y,
        z: asset.bounds3d.maximum.z - asset.bounds3d.minimum.z,
      },
    },
  }));
}

export function assetChangeWorldEntities(changeSet: AssetChangeSetRecord): WorldEntity[] {
  return changeSet.report.changes.map((change) => {
    const position = change.toPosition ?? change.fromPosition ?? [0, 0, 0];
    return {
      entityId: `asset-change-${change.changeId}`,
      layerId: "assets",
      label: `${change.changeType} · ${change.semanticClass} · ${(change.confidence * 100).toFixed(0)}%`,
      position: { x: position[0], y: position[1], z: position[2] },
      geometry: { type: "POINT" as const, radius: change.changeType === "MISSING" ? 0.5 : 0.35 },
    };
  });
}
