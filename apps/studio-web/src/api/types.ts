export type MapDraftStatus = "DRAFT" | "IN_REVIEW" | "VALIDATED" | "PUBLISHED";
export type ValidationJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

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
