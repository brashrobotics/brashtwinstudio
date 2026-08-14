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

export interface DraftArtifactBinding {
  bindingId: string;
  draftId: string;
  uploadId: string;
  artifactSha256: string;
  role: "BIM_SOURCE" | "FLOORPLAN_SOURCE" | string;
  kind: "SOURCE" | "DERIVED";
  coordinateFrameId: string | null;
  inputBindings: Array<{ bindingId: string; artifactSha256: string }>;
  producer: null | { name: string; version: string; parametersSha256: string };
  createdBy: string;
  createdAt: string;
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
    schemaVersion: "brash.survey-materialization-preview/v1" | "brash.survey-materialization-preview/v2";
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
  schemaVersion: "brash.survey-materialization-preview/v1" | "brash.survey-materialization-preview/v2";
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
    planProjection?: {
      method: "TRAJECTORY_ENVELOPE_XY";
      resolutionMetres: number;
      columns: number;
      rows: number;
      bounds: { minimum: [number, number]; maximum: [number, number] };
      heightRangeMetres: { minimum: number; maximum: number };
      sourcePointCount: number;
      projectedPointCount: number;
      samples: Array<[number, number, number, number, number]>;
    };
  };
  qualityWarnings: Array<{ code: string; message: string }>;
  generatedBy: { name: string; version: string };
}

export interface SurveyQualityReport {
  schemaVersion: "brash.survey-quality-report/v1";
  qualityReviewId: string;
  draftId: string;
  materializationJobId: string;
  sourcePreview: { bindingId: string; sha256: string; frameId: string };
  outcome: "PASSED" | "FAILED";
  metrics: {
    declaredCoverageRatio: number | null;
    sampledOccupancyRatio: number;
    trajectoryPoseCount: number;
    trajectoryDurationSeconds: number;
    trajectoryMedianRateHz: number;
    trajectoryMaximumStepMetres: number;
    trajectoryNonIncreasingTimestampCount: number;
    reconstructionVertexCount: number;
    reconstructionFootprintSquareMetres: number;
    pointDensityPerSquareMetre: number;
    previewWarningCount: number;
    frameConsistent: boolean;
  };
  policy: {
    thresholds: {
      minimumCoverageRatio: number;
      minimumTrajectoryPoseCount: number;
      maximumTrajectoryStepMetres: number;
      maximumNonIncreasingTimestamps: number;
      minimumPointDensityPerSquareMetre: number;
      maximumPreviewWarnings: number;
    };
    policySha256: string;
  };
  issues: Array<{ code: string; metric: string; observed: number | boolean | null; limit: number | boolean }>;
  coverageGrid: {
    frameId: string;
    columns: number;
    rows: number;
    bounds: { minimum: [number, number]; maximum: [number, number] };
    cells: Array<{ column: number; row: number; sampleCount: number }>;
  };
  createdBy: string;
  createdAt: string;
}

export interface SurveyQualityAcceptanceReport {
  schemaVersion: "brash.survey-quality-acceptance/v1";
  qualityReviewId: string;
  draftId: string;
  qualityReport: { bindingId: string; sha256: string };
  decision: "APPROVED" | "REJECTED";
  qualityOutcome: "PASSED" | "FAILED";
  reviewerId: string;
  note: string | null;
  reviewedAt: string;
}

export interface SurveyQualityAcceptanceRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: SurveyQualityAcceptanceReport;
}

export interface SurveyQualityRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: SurveyQualityReport;
  acceptance: SurveyQualityAcceptanceRecord | null;
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
  schemaVersion: "brash.survey-registration-report/v2";
  registrationId: string;
  draftId: string;
  materializationJobId: string;
  sourcePreview: { bindingId: string; sha256: string; frameId: string };
  targetEvidence: {
    bindingId: string;
    sha256: string;
    role: "BIM_SOURCE" | "FLOORPLAN_SOURCE";
    frameId: string;
  };
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
  quality: {
    outcome: "PASSED" | "FAILED";
    thresholds: {
      maximumRmseMetres: number;
      maximumErrorMetres: number;
      maximumScaleDeviation: number;
    };
    policySha256: string;
    issues: Array<{ code: string; observed: number; limit: number }>;
  };
  createdBy: string;
  createdAt: string;
}

export interface SurveyRegistrationRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: SurveyRegistrationReport;
  acceptance: SurveyRegistrationAcceptanceRecord | null;
  surveyQualityAcceptanceBindingId: string | null;
}

export interface SurveyRegistrationAcceptanceReport {
  schemaVersion: "brash.survey-registration-acceptance/v1";
  registrationId: string;
  draftId: string;
  registrationReport: { bindingId: string; sha256: string };
  decision: "APPROVED" | "REJECTED";
  qualityOutcome: "PASSED" | "FAILED";
  reviewerId: string;
  note: string | null;
  reviewedAt: string;
}

export interface SurveyRegistrationAcceptanceRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: SurveyRegistrationAcceptanceReport;
}

export interface CreateSurveyRegistrationInput {
  registrationId?: string;
  materializationJobId: string;
  targetBindingId: string;
  controlPoints: SurveyRegistrationControlPoint[];
  allowScale?: boolean;
  operatorId: string;
}

export interface ReviewSurveyRegistrationInput {
  decision: "APPROVED" | "REJECTED";
  reviewerId: string;
  note?: string;
}

export interface AssetCandidate {
  candidateId: string;
  sourceObservationId: string;
  suggestedClass: string;
  confidence: number;
  canonicalPosition: [number, number, number];
  dimensions: [number, number, number];
  evidence: Array<{ bindingId: string; artifactSha256: string }>;
}

export interface AssetCandidateReport {
  schemaVersion: "brash.asset-candidate-report/v1";
  candidateSetId: string;
  draftId: string;
  registrationId: string;
  registrationAcceptance: { bindingId: string; sha256: string };
  observations: { bindingId: string; sha256: string; observationSetId: string; sourceFrameId: string };
  canonicalFrameId: string;
  extraction: { name: string; version: string; configurationSha256: string };
  candidates: AssetCandidate[];
  createdBy: string;
  createdAt: string;
}

export interface AssetCandidateDecision {
  candidateId: string;
  decision: "ACCEPTED" | "REJECTED";
  displayName: string | null;
  assetType: string | null;
  properties: Record<string, string | number | boolean>;
}

export interface AssetCandidateReviewReport {
  schemaVersion: "brash.asset-candidate-review/v1";
  candidateSetId: string;
  draftId: string;
  candidateReport: { bindingId: string; sha256: string };
  decisions: AssetCandidateDecision[];
  summary: { acceptedCount: number; rejectedCount: number };
  reviewerId: string;
  note: string | null;
  reviewedAt: string;
}

export interface AssetCandidateReviewRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: AssetCandidateReviewReport;
}

export interface AssetCandidateSetRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: AssetCandidateReport;
  review: AssetCandidateReviewRecord | null;
}

export interface ReviewAssetCandidateSetInput {
  reviewerId: string;
  note?: string;
  decisions: Array<{
    candidateId: string;
    decision: "ACCEPTED" | "REJECTED";
    displayName?: string;
    assetType?: string;
    properties?: Record<string, string | number | boolean>;
  }>;
}

export interface DraftTwinAsset {
  assetId: string;
  displayName: string;
  semanticClass: string;
  mobilityClass: "STATIC" | "SEMI_STATIC" | "MOBILE";
  frameId: string;
  pose: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };
  footprint: Array<{ x: number; y: number }>;
  bounds3d: {
    minimum: { x: number; y: number; z: number };
    maximum: { x: number; y: number; z: number };
  };
  properties: Record<string, string | number | boolean>;
  topologyBindings: Array<{ kind: "NODE" | "EDGE" | "ZONE"; targetId: string }>;
  changePolicy: {
    positionToleranceMeters: number;
    minimumConfidence: number;
    requiredConfirmations: number;
  };
  source: {
    candidateSetId: string;
    candidateId: string;
    sourceObservationId: string;
    suggestedClass: string;
  };
}

export interface DraftTwinAssetSetReport {
  schemaVersion: "brash.draft-twin-assets/v1" | "brash.draft-twin-assets/v2";
  assetSetId: string;
  draftId: string;
  revision: number;
  canonicalFrameId: string;
  predecessor: null | { assetSetId: string; revision: number; bindingId: string; sha256: string };
  sourceCandidateSet: null | {
    candidateSetId: string;
    report: { bindingId: string; sha256: string };
    review: { bindingId: string; sha256: string };
  };
  sourceChangeSet?: null | {
    changeSetId: string;
    report: { bindingId: string; sha256: string };
    review: { bindingId: string; sha256: string };
    observations: { bindingId: string; sha256: string };
  };
  assets: DraftTwinAsset[];
  promotedBy: string;
  promotedAt: string;
}

export interface DraftTwinAssetSetRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: DraftTwinAssetSetReport;
}

export type AssetChangeType = "MOVED" | "MISSING" | "APPEARED";

export interface AssetChange {
  changeId: string;
  changeType: AssetChangeType;
  assetId: string | null;
  candidateId: string | null;
  semanticClass: string;
  confidence: number;
  fromPosition: [number, number, number] | null;
  toPosition: [number, number, number] | null;
  distanceMeters: number | null;
  reviewStatus: "REVIEW_REQUIRED";
}

export interface AssetChangeSetReport {
  schemaVersion: "brash.asset-change-report/v1";
  changeSetId: string;
  draftId: string;
  canonicalFrameId: string;
  baseline: { assetSetId: string; revision: number; bindingId: string; sha256: string };
  observations: { candidateSetId: string; bindingId: string; sha256: string };
  policy: {
    matchingAlgorithm: "CLASS_NEAREST_NEIGHBOR";
    maximumMatchDistanceMeters: number;
    coverageMode: "OBSERVED_ENVELOPE";
    coveragePaddingMeters: number;
  };
  coverage: { minimum: [number, number, number]; maximum: [number, number, number]; baselineAssetsEvaluated: number };
  summary: {
    movedCount: number;
    missingCount: number;
    appearedCount: number;
    unchangedCount: number;
    ignoredObservationCount: number;
  };
  changes: AssetChange[];
  createdBy: string;
  createdAt: string;
}

export interface AssetChangeSetRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: AssetChangeSetReport;
  review: AssetChangeReviewRecord | null;
}

export interface AssetChangeReviewDecision {
  changeId: string;
  decision: "CONFIRMED" | "DISMISSED";
  displayName: string | null;
  assetType: string | null;
  properties: Record<string, string | number | boolean>;
  note: string | null;
}

export interface AssetChangeReviewReport {
  schemaVersion: "brash.asset-change-review/v1";
  reviewId: string;
  changeSetId: string;
  draftId: string;
  changeReport: { bindingId: string; sha256: string };
  coverageQualificationAcknowledged: boolean;
  decisions: AssetChangeReviewDecision[];
  summary: { confirmedCount: number; dismissedCount: number; criticalCount: number };
  reviewerId: string;
  note: string | null;
  sealedAt: string;
}

export interface AssetChangeReviewRecord {
  reportBindingId: string;
  reportUploadId: string;
  reportSha256: string;
  report: AssetChangeReviewReport;
}

export interface ReviewAssetChangesInput {
  reviewerId: string;
  coverageQualificationAcknowledged: boolean;
  note?: string;
  decisions: Array<{
    changeId: string;
    decision: "CONFIRMED" | "DISMISSED";
    displayName?: string;
    assetType?: string;
    properties?: Record<string, string | number | boolean>;
    note?: string;
  }>;
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
