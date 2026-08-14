import { describe, expect, it } from "vitest";
import type { SurveyMaterializationPreview, SurveyQualityReport, SurveyRegistrationReport } from "../../api/types";
import { surveyCoverageWorldEntities, surveyPreviewWorldEntities } from "./surveyPreviewWorld";

describe("survey preview world adapter", () => {
  it("creates bounded cloud, trajectory, and reconstruction extents in the source frame", () => {
    const entities = surveyPreviewWorldEntities(preview());
    expect(entities.map((entity) => entity.entityId)).toEqual([
      "survey-point-cloud-preview",
      "survey-trajectory-preview",
      "survey-reconstruction-bounds",
    ]);
    expect(entities[0]?.geometry).toEqual(expect.objectContaining({
      type: "POINT_CLOUD",
      points: [{ x: -1, y: -2, z: 0 }, { x: 3, y: 2, z: 2 }],
    }));
    expect(entities[2]).toEqual(expect.objectContaining({
      position: { x: 1, y: 0, z: 1 },
      geometry: { type: "BOX", size: { x: 4, y: 4, z: 2 }, style: "WIREFRAME" },
    }));
  });

  it("projects the source-frame preview into the canonical frame without changing height", () => {
    const entities = surveyPreviewWorldEntities(preview(), registration());
    expect(entities[0]?.geometry).toEqual(expect.objectContaining({
      type: "POINT_CLOUD",
      points: [{ x: 12, y: 19, z: 0 }, { x: 8, y: 23, z: 2 }],
    }));
    expect(entities[2]).toEqual(expect.objectContaining({
      position: { x: 10, y: 21, z: 1 },
      rotationZ: Math.PI / 2,
      geometry: { type: "BOX", size: { x: 4, y: 4, z: 2 }, style: "WIREFRAME" },
    }));
  });

  it("focuses a large raw reconstruction on its trajectory-envelope plan projection", () => {
    const source = preview();
    source.schemaVersion = "brash.survey-materialization-preview/v2";
    source.reconstruction.planProjection = {
      method: "TRAJECTORY_ENVELOPE_XY",
      resolutionMetres: 0.5,
      columns: 12,
      rows: 40,
      bounds: { minimum: [-4, -20], maximum: [2, 0] },
      heightRangeMetres: { minimum: -0.5, maximum: 3 },
      sourcePointCount: 17_000_000,
      projectedPointCount: 12_000_000,
      samples: [[-3.75, -19.75, 1.2, 20, 800], [1.75, -0.25, 2.1, 50, 600]],
    };
    const entities = surveyPreviewWorldEntities(source);
    expect(entities.map((entity) => entity.entityId)).toEqual([
      "survey-point-cloud-preview",
      "survey-trajectory-preview",
      "survey-reconstruction-bounds",
      "survey-operational-plan",
    ]);
    expect(entities[0]?.geometry).toEqual(expect.objectContaining({
      type: "POINT_CLOUD",
      points: [{ x: -3.75, y: -19.75, z: 1.2 }, { x: 1.75, y: -0.25, z: 2.1 }],
    }));
    expect(entities[2]).toEqual(expect.objectContaining({
      position: { x: -1, y: -10, z: 1.25 },
      geometry: { type: "BOX", size: { x: 6, y: 20, z: 3.5 }, style: "WIREFRAME" },
    }));
    expect(entities[3]).toEqual(expect.objectContaining({
      layerId: "coverage",
      geometry: expect.objectContaining({ type: "POINT_CLOUD", size: 0.41 }),
    }));
  });

  it("renders bounded occupancy evidence in source and registered frames", () => {
    const source = surveyCoverageWorldEntities(quality());
    const registered = surveyCoverageWorldEntities(quality(), registration());
    expect(source).toHaveLength(2);
    expect(source[0]).toEqual(expect.objectContaining({
      entityId: "survey-coverage-0-0",
      layerId: "coverage",
      geometry: expect.objectContaining({ type: "POLYGON" }),
    }));
    expect(registered[0]?.geometry).toEqual(expect.objectContaining({
      points: expect.arrayContaining([{ x: 12, y: 19, z: 0.04 }]),
    }));
  });
});

function quality(): SurveyQualityReport {
  return {
    schemaVersion: "brash.survey-quality-report/v1", qualityReviewId: "quality-1", draftId: "draft-1", materializationJobId: "materialization-1",
    sourcePreview: { bindingId: "survey-preview-1", sha256: "b".repeat(64), frameId: "slam-map" }, outcome: "PASSED",
    metrics: { declaredCoverageRatio: 0.9, sampledOccupancyRatio: 0.5, trajectoryPoseCount: 5, trajectoryDurationSeconds: 4, trajectoryMedianRateHz: 1, trajectoryMaximumStepMetres: 2, trajectoryNonIncreasingTimestampCount: 0, reconstructionVertexCount: 6, reconstructionFootprintSquareMetres: 16, pointDensityPerSquareMetre: 0.375, previewWarningCount: 0, frameConsistent: true },
    policy: { thresholds: { minimumCoverageRatio: 0.8, minimumTrajectoryPoseCount: 3, maximumTrajectoryStepMetres: 3, maximumNonIncreasingTimestamps: 0, minimumPointDensityPerSquareMetre: 0.25, maximumPreviewWarnings: 0 }, policySha256: "f".repeat(64) },
    issues: [], coverageGrid: { frameId: "slam-map", columns: 2, rows: 2, bounds: { minimum: [-1, -2], maximum: [3, 2] }, cells: [{ column: 0, row: 0, sampleCount: 3 }, { column: 1, row: 1, sampleCount: 3 }] },
    createdBy: "operator-1", createdAt: "2026-08-14T15:00:00.000Z",
  };
}

function preview(): SurveyMaterializationPreview {
  return {
    schemaVersion: "brash.survey-materialization-preview/v1",
    source: { kind: "ACCEPTED_INTAKE", sourceId: "intake-1", revision: "a".repeat(64) },
    coordinateSystem: {
      rootFrameId: "slam-map",
      lengthUnit: "METRE",
      handedness: "RIGHT_HANDED",
      upAxis: "Z",
    },
    trajectory: {
      frameId: "slam-map",
      sampleCount: 5,
      pathLengthMetres: 4,
      positionBounds: { minimum: [0, 0, 0], maximum: [2, 2, 0.2] },
      preview: {
        method: "STRIDE",
        sourceStride: 1,
        poses: [
          { timestamp: 1, position: [0, 0, 0] },
          { timestamp: 2, position: [2, 2, 0.2] },
        ],
      },
    },
    coordinateFrames: { frameId: "slam-map", sampleCount: 3 },
    calibration: { calibrationId: "cal-1", sensorCount: 2, modalities: { LIDAR: 1, IMU: 1 } },
    reconstruction: {
      frameId: "slam-map",
      vertexCount: 6,
      bounds: { minimum: [-1, -2, 0], maximum: [3, 2, 2] },
      preview: {
        method: "STRIDE",
        sourceStride: 1,
        points: [[-1, -2, 0, 1], [3, 2, 2, 50]],
      },
    },
    qualityWarnings: [],
    generatedBy: { name: "materializer", version: "1" },
  };
}

function registration(): SurveyRegistrationReport {
  return {
    schemaVersion: "brash.survey-registration-report/v2",
    registrationId: "registration-1",
    draftId: "draft-1",
    materializationJobId: "materialization-1",
    sourcePreview: { bindingId: "survey-preview-1", sha256: "b".repeat(64), frameId: "slam-map" },
    targetEvidence: {
      bindingId: "floorplan-target-1",
      sha256: "e".repeat(64),
      role: "FLOORPLAN_SOURCE",
      frameId: "plant-floor",
    },
    canonicalFrameId: "plant-floor",
    solver: {
      name: "brash.similarity-2d",
      version: "1.0.0",
      configurationSha256: "c".repeat(64),
      allowScale: false,
    },
    transform: { scale: 1, rotationRadians: Math.PI / 2, translation: { x: 10, y: 20 } },
    residuals: [],
    metrics: { controlPointCount: 3, rmseMetres: 0, maximumErrorMetres: 0, meanErrorMetres: 0, scaleDeviation: 0 },
    quality: {
      outcome: "PASSED",
      thresholds: { maximumRmseMetres: 0.25, maximumErrorMetres: 0.5, maximumScaleDeviation: 0.02 },
      policySha256: "d".repeat(64),
      issues: [],
    },
    createdBy: "operator-1",
    createdAt: "2026-08-14T15:00:00.000Z",
  };
}
