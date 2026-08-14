import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TwinApiClient } from "../api/client";
import { AppProviders } from "./providers";
import { App } from "./App";

afterEach(cleanup);

describe("Studio Web shell", () => {
  it("loads the site-to-draft context and renders validation/release status", async () => {
    const api: TwinApiClient = {
      readiness: async () => ({ status: "ready", service: "brash-twin-api", persistence: { ready: true, mode: "memory" } }),
      listSites: async () => [{
        siteId: "site-1", displayName: "Demo Factory", timezone: "UTC", createdBy: "operator", createdAt: "2026-08-13T00:00:00.000Z",
      }],
      listFloors: async () => [{
        floorId: "floor-1", siteId: "site-1", buildingId: "building-1", displayName: "Production Floor", elevationMeters: 0, createdBy: "operator", createdAt: "2026-08-13T00:00:00.000Z",
      }],
      listMapFamilies: async () => [{
        familyId: "plant", floorId: "floor-1", displayName: "Main Plant", createdBy: "operator", createdAt: "2026-08-13T00:00:00.000Z",
      }],
      listMapDrafts: async () => [{
        draftId: "draft-1", familyId: "plant", revision: 3, canonicalFrameId: "plant/floor-1", status: "VALIDATED", validationReportSha256: "a".repeat(64), rowVersion: 8, createdBy: "operator", createdAt: "2026-08-13T00:00:00.000Z", updatedBy: "validator", updatedAt: "2026-08-13T01:00:00.000Z",
      }],
      listValidationJobs: async () => [{
        jobId: "validation-job-3", draftId: "draft-1", jobType: "RELEASE_VALIDATION", status: "SUCCEEDED", output: { reportBindingId: "report-3", reportSha256: "a".repeat(64), outcome: "PASSED", summary: { errorCount: 0, warningCount: 2, infoCount: 1 } }, attemptCount: 1, createdBy: "validator", createdAt: "2026-08-13T01:00:00.000Z", startedAt: "2026-08-13T01:00:00.000Z", completedAt: "2026-08-13T01:01:00.000Z", failureReason: null,
      }],
      listSurveyMaterializations: async () => [{
        jobId: "survey-materialization-1", intakeId: "intake-1", draftId: "draft-1", status: "SUCCEEDED", manifestSha256: "b".repeat(64), snapshotSha256: "c".repeat(64), output: { schemaVersion: "brash.survey-materialization-preview/v1", mediaType: "application/vnd.brash.survey-materialization-preview+json", previewUploadId: "preview-upload-1", previewSha256: "d".repeat(64), previewBytes: 1024, sourceFrameId: "slam-map", summary: { trajectoryPoseCount: 5, pointCloudVertexCount: 6, warningCount: 0 } }, attemptCount: 1, maximumAttempts: 3, nextAttemptAt: "2026-08-13T01:00:00.000Z", startedAt: "2026-08-13T01:00:00.000Z", completedAt: "2026-08-13T01:01:00.000Z", failureReason: null, rowVersion: 3, createdBy: "operator", createdAt: "2026-08-13T01:00:00.000Z", updatedAt: "2026-08-13T01:01:00.000Z",
      }],
      getSurveyMaterializationPreview: async () => ({
        schemaVersion: "brash.survey-materialization-preview/v1",
        source: { kind: "ACCEPTED_INTAKE", sourceId: "intake-1", revision: "b".repeat(64) },
        coordinateSystem: { rootFrameId: "slam-map", lengthUnit: "METRE", handedness: "RIGHT_HANDED", upAxis: "Z" },
        trajectory: { frameId: "slam-map", sampleCount: 5, pathLengthMetres: 4, positionBounds: { minimum: [0, 0, 0], maximum: [2, 2, 0.2] }, preview: { method: "STRIDE", sourceStride: 1, poses: [{ timestamp: 1, position: [0, 0, 0] }, { timestamp: 2, position: [2, 2, 0.2] }] } },
        coordinateFrames: { frameId: "slam-map", sampleCount: 3 },
        calibration: { calibrationId: "cal-1", sensorCount: 2, modalities: { LIDAR: 1, IMU: 1 } },
        reconstruction: { frameId: "slam-map", vertexCount: 6, bounds: { minimum: [-1, -2, 0], maximum: [3, 2, 2] }, preview: { method: "STRIDE", sourceStride: 1, points: [[-1, -2, 0, 1], [3, 2, 2, 50]] } },
        qualityWarnings: [],
        generatedBy: { name: "materializer", version: "1" },
      }),
      listReleases: async () => [{
        schemaVersion: "brash.twin-map-bundle/v1", bundleId: "bundle-plant-2", mapReleaseId: "plant@2", familyId: "plant", revision: 2, status: "PUBLISHED", createdAt: "2026-08-13T00:00:00.000Z", canonicalFrameId: "plant/floor-1", artifacts: [],
      }],
    };

    render(<AppProviders api={api}><App api={api} /></AppProviders>);

    expect(await screen.findByText("Demo Factory")).toBeTruthy();
    expect(await screen.findByText("plant/floor-1")).toBeTruthy();
    expect(await screen.findByText("validation-job-3")).toBeTruthy();
    expect(await screen.findByText(/survey-materialization-1/)).toBeTruthy();
    expect(await screen.findByText("Unaligned survey source · read-only")).toBeTruthy();
    expect(await screen.findByText("plant@2")).toBeTruthy();
  });
});
