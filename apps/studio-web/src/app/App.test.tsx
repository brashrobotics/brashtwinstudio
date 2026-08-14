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
      listDraftArtifacts: async () => [{
        bindingId: "floorplan-target-1", draftId: "draft-1", uploadId: "floorplan-upload-1", artifactSha256: "9".repeat(64), role: "FLOORPLAN_SOURCE", kind: "SOURCE", coordinateFrameId: "plant/floor-1", inputBindings: [], producer: null, createdBy: "operator", createdAt: "2026-08-13T00:00:00.000Z",
      }],
      listValidationJobs: async () => [{
        jobId: "validation-job-3", draftId: "draft-1", jobType: "RELEASE_VALIDATION", status: "SUCCEEDED", output: { reportBindingId: "report-3", reportSha256: "a".repeat(64), outcome: "PASSED", summary: { errorCount: 0, warningCount: 2, infoCount: 1 } }, attemptCount: 1, createdBy: "validator", createdAt: "2026-08-13T01:00:00.000Z", startedAt: "2026-08-13T01:00:00.000Z", completedAt: "2026-08-13T01:01:00.000Z", failureReason: null,
      }],
      listSurveyMaterializations: async () => [{
        jobId: "survey-materialization-1", intakeId: "intake-1", draftId: "draft-1", status: "SUCCEEDED", manifestSha256: "b".repeat(64), snapshotSha256: "c".repeat(64), output: { schemaVersion: "brash.survey-materialization-preview/v1", mediaType: "application/vnd.brash.survey-materialization-preview+json", previewUploadId: "preview-upload-1", previewBindingId: "survey-preview-1", previewSha256: "d".repeat(64), previewBytes: 1024, sourceFrameId: "slam-map", summary: { trajectoryPoseCount: 5, pointCloudVertexCount: 6, warningCount: 0 } }, attemptCount: 1, maximumAttempts: 3, nextAttemptAt: "2026-08-13T01:00:00.000Z", startedAt: "2026-08-13T01:00:00.000Z", completedAt: "2026-08-13T01:01:00.000Z", failureReason: null, rowVersion: 3, createdBy: "operator", createdAt: "2026-08-13T01:00:00.000Z", updatedAt: "2026-08-13T01:01:00.000Z",
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
      listSurveyQualityReviews: async () => [surveyQuality()],
      createSurveyQualityReview: async () => { throw new Error("Not used by this test."); },
      reviewSurveyQuality: async () => { throw new Error("Not used by this test."); },
      listSurveyRegistrations: async () => [surveyRegistration()],
      createSurveyRegistration: async () => { throw new Error("Not used by this test."); },
      reviewSurveyRegistration: async () => { throw new Error("Not used by this test."); },
      listSemanticCandidateSets: async () => [],
      createSemanticCandidateSet: async () => { throw new Error("Not used by this test."); },
      reviewSemanticCandidateSet: async () => { throw new Error("Not used by this test."); },
      listDraftTwinAssetSets: async () => [],
      promoteDraftTwinAssets: async () => { throw new Error("Not used by this test."); },
      listDraftAssetChangeSets: async () => [],
      detectDraftAssetChanges: async () => { throw new Error("Not used by this test."); },
      reviewDraftAssetChanges: async () => { throw new Error("Not used by this test."); },
      applyDraftAssetChanges: async () => { throw new Error("Not used by this test."); },
      listReleases: async () => [{
        schemaVersion: "brash.twin-map-bundle/v1", bundleId: "bundle-plant-2", mapReleaseId: "plant@2", familyId: "plant", revision: 2, status: "PUBLISHED", createdAt: "2026-08-13T00:00:00.000Z", canonicalFrameId: "plant/floor-1", artifacts: [],
      }],
    };

    render(<AppProviders api={api}><App api={api} /></AppProviders>);

    expect(await screen.findByText("Demo Factory")).toBeTruthy();
    expect(await screen.findByText("plant/floor-1")).toBeTruthy();
    expect(await screen.findByText("validation-job-3")).toBeTruthy();
    expect(await screen.findByText(/survey-materialization-1/)).toBeTruthy();
    expect(await screen.findByText("Registered survey overlay")).toBeTruthy();
    expect(await screen.findByText("Semantic asset candidates")).toBeTruthy();
    expect(await screen.findByText("Versioned Twin assets")).toBeTruthy();
    expect(await screen.findByText("91.0%")).toBeTruthy();
    expect(await screen.findByText("plant@2")).toBeTruthy();
  });
});

function surveyQuality() {
  return {
    reportBindingId: "survey-quality-report-1",
    reportUploadId: "survey-quality-upload-1",
    reportSha256: "1".repeat(64),
    report: {
      schemaVersion: "brash.survey-quality-report/v1" as const,
      qualityReviewId: "quality-1",
      draftId: "draft-1",
      materializationJobId: "survey-materialization-1",
      sourcePreview: { bindingId: "survey-preview-1", sha256: "d".repeat(64), frameId: "slam-map" },
      outcome: "PASSED" as const,
      metrics: { declaredCoverageRatio: 0.91, sampledOccupancyRatio: 0.5, trajectoryPoseCount: 5, trajectoryDurationSeconds: 4, trajectoryMedianRateHz: 1, trajectoryMaximumStepMetres: 2.8, trajectoryNonIncreasingTimestampCount: 0, reconstructionVertexCount: 6, reconstructionFootprintSquareMetres: 16, pointDensityPerSquareMetre: 1.5, previewWarningCount: 0, frameConsistent: true },
      policy: { thresholds: { minimumCoverageRatio: 0.8, minimumTrajectoryPoseCount: 3, maximumTrajectoryStepMetres: 3, maximumNonIncreasingTimestamps: 0, minimumPointDensityPerSquareMetre: 1, maximumPreviewWarnings: 0 }, policySha256: "2".repeat(64) },
      issues: [],
      coverageGrid: { frameId: "slam-map", columns: 2, rows: 2, bounds: { minimum: [-1, -2] as [number, number], maximum: [3, 2] as [number, number] }, cells: [{ column: 0, row: 0, sampleCount: 3 }, { column: 1, row: 1, sampleCount: 3 }] },
      createdBy: "quality-operator",
      createdAt: "2026-08-13T01:01:30.000Z",
    },
    acceptance: {
      reportBindingId: "survey-quality-acceptance-1",
      reportUploadId: "survey-quality-acceptance-upload-1",
      reportSha256: "3".repeat(64),
      report: { schemaVersion: "brash.survey-quality-acceptance/v1" as const, qualityReviewId: "quality-1", draftId: "draft-1", qualityReport: { bindingId: "survey-quality-report-1", sha256: "1".repeat(64) }, decision: "APPROVED" as const, qualityOutcome: "PASSED" as const, reviewerId: "quality-reviewer", note: null, reviewedAt: "2026-08-13T01:01:45.000Z" },
    },
  };
}

function surveyRegistration() {
  const residuals = [
    { controlPointId: "cp-1", source: { x: -1, y: -2 }, target: { x: 4, y: 8 } },
    { controlPointId: "cp-2", source: { x: 3, y: -2 }, target: { x: 8, y: 8 } },
    { controlPointId: "cp-3", source: { x: 3, y: 2 }, target: { x: 8, y: 12 } },
  ].map((pair) => ({ ...pair, transformed: pair.target, dxMetres: 0, dyMetres: 0, errorMetres: 0 }));
  return {
    reportBindingId: "survey-registration-report-1",
    reportUploadId: "survey-registration-upload-1",
    reportSha256: "e".repeat(64),
    report: {
      schemaVersion: "brash.survey-registration-report/v2" as const,
      registrationId: "registration-1",
      draftId: "draft-1",
      materializationJobId: "survey-materialization-1",
      sourcePreview: { bindingId: "survey-preview-1", sha256: "d".repeat(64), frameId: "slam-map" },
      targetEvidence: { bindingId: "floorplan-target-1", sha256: "9".repeat(64), role: "FLOORPLAN_SOURCE" as const, frameId: "plant/floor-1" },
      canonicalFrameId: "plant/floor-1",
      solver: {
        name: "brash.similarity-2d" as const,
        version: "1.0.0" as const,
        configurationSha256: "f".repeat(64),
        allowScale: false,
      },
      transform: { scale: 1, rotationRadians: 0, translation: { x: 5, y: 10 } },
      residuals,
      metrics: { controlPointCount: 3, rmseMetres: 0, maximumErrorMetres: 0, meanErrorMetres: 0, scaleDeviation: 0 },
      quality: { outcome: "PASSED" as const, thresholds: { maximumRmseMetres: 0.25, maximumErrorMetres: 0.5, maximumScaleDeviation: 0.02 }, policySha256: "8".repeat(64), issues: [] },
      createdBy: "operator",
      createdAt: "2026-08-13T01:02:00.000Z",
    },
    acceptance: null,
    surveyQualityAcceptanceBindingId: "survey-quality-acceptance-1",
  };
}
