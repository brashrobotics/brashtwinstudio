import type { WorldEntity } from "@brash-twin/viewer-sdk";
import type {
  SurveyBounds,
  SurveyMaterializationPreview,
  SurveyQualityReport,
  SurveyRegistrationReport,
} from "../../api/types";

export function surveyPreviewWorldEntities(
  preview: SurveyMaterializationPreview,
  registration: SurveyRegistrationReport | null = null,
): WorldEntity[] {
  const trajectoryPoints = preview.trajectory.preview.poses.map((pose) => vector(pose.position, registration));
  const projection = preview.reconstruction.planProjection;
  const pointCloud = (projection?.samples ?? preview.reconstruction.preview.points)
    .map((point) => vector(point, registration));
  const bounds = projection ? projectionBounds(projection) : preview.reconstruction.bounds;
  const boundsMidpoint = transformPosition(midpoint(bounds), registration);
  const boundsExtent = extent(bounds);
  const scale = registration?.transform.scale ?? 1;
  const entities: WorldEntity[] = [
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
      position: boundsMidpoint,
      rotationZ: registration?.transform.rotationRadians ?? 0,
      geometry: {
        type: "BOX",
        size: { x: boundsExtent.x * scale, y: boundsExtent.y * scale, z: boundsExtent.z },
        style: "WIREFRAME",
      },
    },
  ];
  if (projection) {
    entities.push({
      entityId: "survey-operational-plan",
      layerId: "coverage",
      label: `${projection.projectedPointCount.toLocaleString()} points · ${projection.resolutionMetres.toFixed(2)} m plan projection`,
      position: { x: 0, y: 0, z: 0 },
      geometry: {
        type: "POINT_CLOUD",
        points: projection.samples.map((point) => transformPosition({
          x: point[0],
          y: point[1],
          z: projection.heightRangeMetres.minimum + 0.02,
        }, registration)),
        size: Math.min(1.25, projection.resolutionMetres * 0.82),
      },
    });
  }
  return entities;
}

export function surveyCoverageWorldEntities(
  quality: SurveyQualityReport,
  registration: SurveyRegistrationReport | null = null,
): WorldEntity[] {
  const { columns, rows, bounds } = quality.coverageGrid;
  const width = (bounds.maximum[0] - bounds.minimum[0]) / columns;
  const height = (bounds.maximum[1] - bounds.minimum[1]) / rows;
  return quality.coverageGrid.cells.map((cell) => {
    const minimumX = bounds.minimum[0] + cell.column * width;
    const minimumY = bounds.minimum[1] + cell.row * height;
    const maximumX = minimumX + width;
    const maximumY = minimumY + height;
    return {
      entityId: `survey-coverage-${cell.row}-${cell.column}`,
      layerId: "coverage",
      label: `Coverage cell · ${cell.sampleCount} samples`,
      position: { x: 0, y: 0, z: 0 },
      geometry: {
        type: "POLYGON",
        points: [
          { x: minimumX, y: minimumY, z: 0.04 },
          { x: maximumX, y: minimumY, z: 0.04 },
          { x: maximumX, y: maximumY, z: 0.04 },
          { x: minimumX, y: maximumY, z: 0.04 },
        ].map((point) => transformPosition(point, registration)),
      },
    };
  });
}

function vector(
  value: readonly number[],
  registration: SurveyRegistrationReport | null,
): { x: number; y: number; z: number } {
  return transformPosition(
    { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 },
    registration,
  );
}

function transformPosition(
  value: { x: number; y: number; z: number },
  registration: SurveyRegistrationReport | null,
): { x: number; y: number; z: number } {
  if (!registration) return value;
  const { scale, rotationRadians, translation } = registration.transform;
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  return {
    x: scale * (cosine * value.x - sine * value.y) + translation.x,
    y: scale * (sine * value.x + cosine * value.y) + translation.y,
    z: value.z,
  };
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

function projectionBounds(projection: NonNullable<SurveyMaterializationPreview["reconstruction"]["planProjection"]>): SurveyBounds {
  return {
    minimum: [
      projection.bounds.minimum[0],
      projection.bounds.minimum[1],
      projection.heightRangeMetres.minimum,
    ],
    maximum: [
      projection.bounds.maximum[0],
      projection.bounds.maximum[1],
      projection.heightRangeMetres.maximum,
    ],
  };
}
