import { describe, expect, it } from "vitest";
import type { SensorVisibilityRecord } from "../../api/types";
import { sensorVisibilityWorldEntities } from "./sensorVisibilityWorld";

describe("sensor visibility world projection", () => {
  it("renders canonical sealed cells on the coverage layer", () => {
    const entities = sensorVisibilityWorldEntities(fixture());
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      entityId: "sensor-visibility-cell-1",
      layerId: "visibility",
      geometry: {
        type: "POLYGON",
        points: [
          { x: 5, y: 10, z: 0.06 },
          { x: 9, y: 10, z: 0.06 },
          { x: 9, y: 14, z: 0.06 },
          { x: 5, y: 14, z: 0.06 },
        ],
      },
    });
    expect(entities[0]?.label).toContain("95%");
    expect(entities[0]?.label).toContain("qualified cell");
  });
});

function fixture(): SensorVisibilityRecord {
  return {
    reportBindingId: "sensor-visibility-report-1",
    reportUploadId: "sensor-visibility-upload-1",
    reportSha256: "a".repeat(64),
    report: {
      schemaVersion: "brash.sensor-visibility-report/v1",
      visibilityReportId: "visibility-report-1",
      draftId: "draft-1",
      registrationId: "registration-1",
      registrationAcceptance: { bindingId: "registration-acceptance-1", sha256: "b".repeat(64) },
      observations: {
        bindingId: "visibility-observations-1",
        sha256: "c".repeat(64),
        visibilitySetId: "visibility-set-1",
        semanticObservationSetId: "semantic-set-1",
        sourceFrameId: "slam-map",
      },
      canonicalFrameId: "factory-floor",
      transformation: {
        name: "brash-sensor-visibility-transformer",
        version: "1.0.0",
        transformSha256: "d".repeat(64),
      },
      qualification: {
        outcome: "QUALIFIED",
        calibrated: true,
        poseSynchronized: true,
        occlusionAware: true,
        minimumVisibilityConfidence: 0.9,
        requiredMinimumConfidence: 0.8,
        issues: [],
      },
      evidence: [
        { kind: "CALIBRATION", bindingId: "calibration-1", artifactSha256: "e".repeat(64) },
        { kind: "SENSOR_POSES", bindingId: "poses-1", artifactSha256: "f".repeat(64) },
        { kind: "OCCLUSION_GEOMETRY", bindingId: "geometry-1", artifactSha256: "1".repeat(64) },
      ],
      coverage: {
        cellCount: 1,
        qualifiedCellCount: 1,
        summedCellAreaSquareMeters: 16,
        cells: [{
          cellId: "cell-1",
          footprint: [[5, 10], [9, 10], [9, 14], [5, 14]],
          minimumZ: 0,
          maximumZ: 3,
          visibilityConfidence: 0.95,
          sampleCount: 64,
          areaSquareMeters: 16,
        }],
      },
      createdBy: "visibility-worker",
      createdAt: "2026-08-23T12:00:00.000Z",
    },
  };
}
