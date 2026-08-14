import type { WorldEntity } from "@brash-twin/viewer-sdk";
import type { SurveyBounds, SurveyMaterializationPreview } from "../../api/types";

export function surveyPreviewWorldEntities(preview: SurveyMaterializationPreview): WorldEntity[] {
  const trajectoryPoints = preview.trajectory.preview.poses.map((pose) => vector(pose.position));
  const pointCloud = preview.reconstruction.preview.points.map((point) => vector(point));
  const bounds = preview.reconstruction.bounds;
  return [
    {
      entityId: "survey-point-cloud-preview",
      layerId: "survey",
      label: `${preview.reconstruction.vertexCount.toLocaleString()} point survey preview`,
      position: { x: 0, y: 0, z: 0 },
      geometry: { type: "POINT_CLOUD", points: pointCloud, size: previewPointSize(bounds) },
    },
    {
      entityId: "survey-trajectory-preview",
      layerId: "survey",
      label: `${preview.trajectory.sampleCount.toLocaleString()} pose trajectory`,
      position: { x: 0, y: 0, z: 0 },
      geometry: { type: "POLYLINE", points: trajectoryPoints },
    },
    {
      entityId: "survey-reconstruction-bounds",
      layerId: "survey",
      label: "Survey reconstruction bounds",
      position: midpoint(bounds),
      geometry: { type: "BOX", size: extent(bounds), style: "WIREFRAME" },
    },
  ];
}

function vector(value: readonly number[]): { x: number; y: number; z: number } {
  return { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 };
}

function midpoint(bounds: SurveyBounds): { x: number; y: number; z: number } {
  return {
    x: (bounds.minimum[0] + bounds.maximum[0]) / 2,
    y: (bounds.minimum[1] + bounds.maximum[1]) / 2,
    z: (bounds.minimum[2] + bounds.maximum[2]) / 2,
  };
}

function extent(bounds: SurveyBounds): { x: number; y: number; z: number } {
  return {
    x: Math.max(0.02, bounds.maximum[0] - bounds.minimum[0]),
    y: Math.max(0.02, bounds.maximum[1] - bounds.minimum[1]),
    z: Math.max(0.02, bounds.maximum[2] - bounds.minimum[2]),
  };
}

function previewPointSize(bounds: SurveyBounds): number {
  const size = extent(bounds);
  return Math.min(0.25, Math.max(0.03, Math.hypot(size.x, size.y, size.z) / 500));
}
