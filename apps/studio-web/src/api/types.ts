export type MapDraftStatus = "DRAFT" | "IN_REVIEW" | "VALIDATED" | "PUBLISHED";
export type ValidationJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type SurveyMaterializationStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface Site {
  siteId: string;
  displayName: string;
  timezone: string;
  createdBy: string;
  createdAt: string;
}

export interface Floor {
  floorId: string;
  siteId: string;
  buildingId: string;
  displayName: string;
  elevationMeters: number;
  createdBy: string;
  createdAt: string;
}

export interface MapFamily {
  familyId: string;
  floorId: string;
  displayName: string;
  createdBy: string;
  createdAt: string;
}

export interface MapDraft {
  draftId: string;
  familyId: string;
  revision: number;
  canonicalFrameId: string;
  status: MapDraftStatus;
  validationReportSha256: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ValidationSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface ValidationJob {
  jobId: string;
  draftId: string;
  jobType: "RELEASE_VALIDATION";
  status: ValidationJobStatus;
  output: null | {
    reportBindingId: string;
    reportSha256: string;
    outcome: "PASSED" | "FAILED";
    summary: ValidationSummary;
  };
  attemptCount: number;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
}

export interface SurveyMaterializationJob {
  jobId: string;
  intakeId: string;
  draftId: string;
  status: SurveyMaterializationStatus;
  manifestSha256: string;
  snapshotSha256: string;
  output: null | {
    schemaVersion: "brash.survey-materialization-preview/v1";
    mediaType: "application/vnd.brash.survey-materialization-preview+json";
    previewUploadId: string;
    previewBindingId: string;
    previewSha256: string;
    previewBytes: number;
    sourceFrameId: string;
    summary: {
      trajectoryPoseCount: number;
      pointCloudVertexCount: number;
      warningCount: number;
    };
  };
  attemptCount: number;
  maximumAttempts: number;
  nextAttemptAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyMaterializationPreview {
  schemaVersion: "brash.survey-materialization-preview/v1";
  source: {
    kind: "ACCEPTED_INTAKE" | "EXTERNAL_DATASET";
    sourceId: string;
    revision: string;
  };
  coordinateSystem: {
    rootFrameId: string;
    lengthUnit: "METRE";
    handedness: "RIGHT_HANDED";
    upAxis: "Z";
  };
  trajectory: {
    frameId: string;
    sampleCount: number;
    pathLengthMetres: number;
    positionBounds: SurveyBounds;
    preview: {
      method: "STRIDE";
      sourceStride: number;
      poses: Array<{ timestamp: number; position: [number, number, number] }>;
    };
  };
  coordinateFrames: { frameId: string; sampleCount: number };
  calibration?: {
    calibrationId: string;
    sensorCount: number;
    modalities: Partial<Record<"LIDAR" | "CAMERA" | "IMU" | "ODOMETRY", number>>;
  };
  reconstruction: {
    frameId: string;
    vertexCount: number;
    bounds: SurveyBounds;
    preview: {
      method: "STRIDE";
      sourceStride: number;
      points: Array<[number, number, number, number]>;
    };
  };
  qualityWarnings: Array<{ code: string; message: string }>;
  generatedBy: { name: string; version: string };
}

export interface SurveyBounds {
  minimum: [number, number, number];
  maximum: [number, number, number];
}

export interface RegistrationPoint2D {
  x: number;
  y: number;
}

export interface SurveyRegistrationControlPoint {
  controlPointId: string;
  source: RegistrationPoint2D;
  target: RegistrationPoint2D;
}

export interface SurveyRegistrationReport {
  schemaVersion: "brash.survey-registration-report/v1";
  registrationId: string;
  draftId: string;
  materializationJobId: string;
  sourcePreview: { bindingId: string; sha256: string; frameId: string };
  canonicalFrameId: string;
  solver: {
    name: "brash.similarity-2d";
    version: "1.0.0";
    configurationSha256: string;
    allowScale: boolean;
  };
  transform: {
    scale: number;
    rotationRadians: number;
    translation: RegistrationPoint2D;
  };
  residuals: Array<SurveyRegistrationControlPoint & {
    transformed: RegistrationPoint2D;
    dxMetres: number;
    dyMetres: number;
    errorMetres: number;
  }>;
  metrics: {
    controlPointCount: number;
    rmseMetres: number;
    maximumErrorMetres: number;
    meanErrorMetres: number;
    scaleDeviation: number;
  };
  createdBy: string;
  createdAt: string;
}

export interface SurveyRegistrationRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: SurveyRegistrationReport;
}

export interface CreateSurveyRegistrationInput {
  registrationId?: string;
  materializationJobId: string;
  controlPoints: SurveyRegistrationControlPoint[];
  allowScale?: boolean;
  operatorId: string;
}

export interface ReleaseManifest {
  schemaVersion: "brash.twin-map-bundle/v1";
  bundleId: string;
  mapReleaseId: string;
  familyId: string;
  revision: number;
  status: "PUBLISHED";
  createdAt: string;
  canonicalFrameId: string;
  validationReportSha256?: string;
  artifacts: Array<{
    role: string;
    path: string;
    mediaType: string;
    sha256: string;
    bytes: number;
  }>;
}

export interface Readiness {
  status: "ready" | "not-ready";
  service: string;
  persistence: {
    ready: boolean;
    mode: "memory" | "postgres";
    migrations?: {
      ready: boolean;
      currentVersion: number;
      latestVersion: number;
      pendingCount: number;
    };
  };
}

export interface TwinApiErrorBody {
  error: { code: string; message: string };
}
