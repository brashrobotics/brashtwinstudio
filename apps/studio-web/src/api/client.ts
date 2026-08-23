import type {
  Floor,
  DraftArtifactBinding,
  MapDraft,
  MapFamily,
  Readiness,
  ReleaseManifest,
  Site,
  SurveyMaterializationJob,
  SurveyMaterializationPreview,
  SurveyQualityAcceptanceRecord,
  SurveyQualityRecord,
  SurveyRegistrationRecord,
  CreateSurveyRegistrationInput,
  ReviewSurveyRegistrationInput,
  SurveyRegistrationAcceptanceRecord,
  AssetCandidateSetRecord,
  AssetCandidateReviewRecord,
  ReviewAssetCandidateSetInput,
  DraftTwinAssetSetRecord,
  AssetChangeSetRecord,
  AssetChangeReviewRecord,
  SensorVisibilityRecord,
  ReviewAssetChangesInput,
  TwinApiErrorBody,
  ValidationJob,
} from "./types";

export class TwinApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TwinApiClientError";
  }
}

export interface TwinApiClient {
  readiness(signal?: AbortSignal): Promise<Readiness>;
  listSites(signal?: AbortSignal): Promise<Site[]>;
  listFloors(siteId: string, signal?: AbortSignal): Promise<Floor[]>;
  listMapFamilies(floorId: string, signal?: AbortSignal): Promise<MapFamily[]>;
  listMapDrafts(familyId: string, signal?: AbortSignal): Promise<MapDraft[]>;
  listDraftArtifacts(draftId: string, signal?: AbortSignal): Promise<DraftArtifactBinding[]>;
  listValidationJobs(draftId: string, signal?: AbortSignal): Promise<ValidationJob[]>;
  listSurveyMaterializations(draftId: string, signal?: AbortSignal): Promise<SurveyMaterializationJob[]>;
  getSurveyMaterializationPreview(jobId: string, signal?: AbortSignal): Promise<SurveyMaterializationPreview>;
  listSurveyQualityReviews(draftId: string, signal?: AbortSignal): Promise<SurveyQualityRecord[]>;
  createSurveyQualityReview(draftId: string, input: { materializationJobId: string; operatorId: string }, signal?: AbortSignal): Promise<SurveyQualityRecord>;
  reviewSurveyQuality(draftId: string, qualityReviewId: string, input: ReviewSurveyRegistrationInput, signal?: AbortSignal): Promise<SurveyQualityAcceptanceRecord>;
  listSurveyRegistrations(draftId: string, signal?: AbortSignal): Promise<SurveyRegistrationRecord[]>;
  createSurveyRegistration(draftId: string, input: CreateSurveyRegistrationInput, signal?: AbortSignal): Promise<SurveyRegistrationRecord>;
  reviewSurveyRegistration(draftId: string, registrationId: string, input: ReviewSurveyRegistrationInput, signal?: AbortSignal): Promise<SurveyRegistrationAcceptanceRecord>;
  listSemanticCandidateSets(draftId: string, signal?: AbortSignal): Promise<AssetCandidateSetRecord[]>;
  createSemanticCandidateSet(draftId: string, input: { registrationId: string; observationBindingId: string; operatorId: string }, signal?: AbortSignal): Promise<AssetCandidateSetRecord>;
  reviewSemanticCandidateSet(draftId: string, candidateSetId: string, input: ReviewAssetCandidateSetInput, signal?: AbortSignal): Promise<AssetCandidateReviewRecord>;
  listSensorVisibilityReports(draftId: string, signal?: AbortSignal): Promise<SensorVisibilityRecord[]>;
  createSensorVisibilityReport(draftId: string, input: { registrationId: string; observationBindingId: string; operatorId: string }, signal?: AbortSignal): Promise<SensorVisibilityRecord>;
  listDraftTwinAssetSets(draftId: string, signal?: AbortSignal): Promise<DraftTwinAssetSetRecord[]>;
  promoteDraftTwinAssets(draftId: string, input: { candidateSetId: string; operatorId: string }, signal?: AbortSignal): Promise<DraftTwinAssetSetRecord>;
  listDraftAssetChangeSets(draftId: string, signal?: AbortSignal): Promise<AssetChangeSetRecord[]>;
  detectDraftAssetChanges(draftId: string, input: { candidateSetId: string; visibilityReportId: string; operatorId: string }, signal?: AbortSignal): Promise<AssetChangeSetRecord>;
  reviewDraftAssetChanges(draftId: string, changeSetId: string, input: ReviewAssetChangesInput, signal?: AbortSignal): Promise<AssetChangeReviewRecord>;
  applyDraftAssetChanges(draftId: string, changeSetId: string, input: { operatorId: string }, signal?: AbortSignal): Promise<DraftTwinAssetSetRecord>;
  listReleases(signal?: AbortSignal): Promise<ReleaseManifest[]>;
}

export function createTwinApiClient({
  baseUrl = "",
  fetchImplementation = fetch,
}: {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
} = {}): TwinApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, signal?: AbortSignal, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetchImplementation(`${normalizedBaseUrl}${path}`, {
        ...init,
        headers: { accept: "application/json", ...init.headers },
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new TwinApiClientError(
        "API_UNREACHABLE",
        "Twin API could not be reached. Check the local service or network connection.",
        0,
      );
    }
    const body = await parseJson(response);
    if (!response.ok) {
      const apiError = body as Partial<TwinApiErrorBody>;
      throw new TwinApiClientError(
        apiError.error?.code ?? "API_REQUEST_FAILED",
        apiError.error?.message ?? `Twin API returned HTTP ${response.status}.`,
        response.status,
      );
    }
    return body as T;
  }

  const client: TwinApiClient = {
    readiness: async (signal) => request<Readiness>("/health/ready", signal),
    listSites: async (signal) => (await request<{ sites: Site[] }>("/api/v1/sites", signal)).sites,
    listFloors: async (siteId, signal) => (
      await request<{ floors: Floor[] }>(`/api/v1/floors?siteId=${encodeURIComponent(siteId)}`, signal)
    ).floors,
    listMapFamilies: async (floorId, signal) => (
      await request<{ families: MapFamily[] }>(`/api/v1/map-families?floorId=${encodeURIComponent(floorId)}`, signal)
    ).families,
    listMapDrafts: async (familyId, signal) => (
      await request<{ drafts: MapDraft[] }>(`/api/v1/map-drafts?familyId=${encodeURIComponent(familyId)}`, signal)
    ).drafts,
    listDraftArtifacts: async (draftId, signal) => (
      await request<{ artifacts: DraftArtifactBinding[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/artifacts`,
        signal,
      )
    ).artifacts,
    listValidationJobs: async (draftId, signal) => (
      await request<{ jobs: ValidationJob[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/validation-jobs`,
        signal,
      )
    ).jobs,
    listSurveyMaterializations: async (draftId, signal) => (
      await request<{ jobs: SurveyMaterializationJob[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/survey-materializations`,
        signal,
      )
    ).jobs,
    getSurveyMaterializationPreview: async (jobId, signal) => (
      await request<{ preview: SurveyMaterializationPreview }>(
        `/api/v1/survey-materializations/${encodeURIComponent(jobId)}/preview`,
        signal,
      )
    ).preview,
    listSurveyQualityReviews: async (draftId, signal) => (
      await request<{ qualityReviews: SurveyQualityRecord[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/survey-quality-reviews`,
        signal,
      )
    ).qualityReviews,
    createSurveyQualityReview: async (draftId, input, signal) => (
      await request<{ qualityReview: SurveyQualityRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/survey-quality-reviews`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).qualityReview,
    reviewSurveyQuality: async (draftId, qualityReviewId, input, signal) => (
      await request<{ acceptance: SurveyQualityAcceptanceRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/survey-quality-reviews/${encodeURIComponent(qualityReviewId)}/acceptance`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).acceptance,
    listSurveyRegistrations: async (draftId, signal) => (
      await request<{ registrations: SurveyRegistrationRecord[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/survey-registrations`,
        signal,
      )
    ).registrations,
    createSurveyRegistration: async (draftId, input, signal) => (
      await request<{ registration: SurveyRegistrationRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/survey-registrations`,
        signal,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      )
    ).registration,
    reviewSurveyRegistration: async (draftId, registrationId, input, signal) => (
      await request<{ acceptance: SurveyRegistrationAcceptanceRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/survey-registrations/${encodeURIComponent(registrationId)}/acceptance`,
        signal,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      )
    ).acceptance,
    listSemanticCandidateSets: async (draftId, signal) => (
      await request<{ candidateSets: AssetCandidateSetRecord[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/semantic-candidates`,
        signal,
      )
    ).candidateSets,
    createSemanticCandidateSet: async (draftId, input, signal) => (
      await request<{ candidateSet: AssetCandidateSetRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/semantic-candidates`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).candidateSet,
    reviewSemanticCandidateSet: async (draftId, candidateSetId, input, signal) => (
      await request<{ review: AssetCandidateReviewRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/semantic-candidates/${encodeURIComponent(candidateSetId)}/review`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).review,
    listSensorVisibilityReports: async (draftId, signal) => (
      await request<{ visibilityReports: SensorVisibilityRecord[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/sensor-visibility`,
        signal,
      )
    ).visibilityReports,
    createSensorVisibilityReport: async (draftId, input, signal) => (
      await request<{ visibilityReport: SensorVisibilityRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/sensor-visibility`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).visibilityReport,
    listDraftTwinAssetSets: async (draftId, signal) => (
      await request<{ assetSets: DraftTwinAssetSetRecord[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/twin-assets`,
        signal,
      )
    ).assetSets,
    promoteDraftTwinAssets: async (draftId, input, signal) => (
      await request<{ assetSet: DraftTwinAssetSetRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/twin-assets`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).assetSet,
    listDraftAssetChangeSets: async (draftId, signal) => (
      await request<{ changeSets: AssetChangeSetRecord[] }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/asset-changes`,
        signal,
      )
    ).changeSets,
    detectDraftAssetChanges: async (draftId, input, signal) => (
      await request<{ changeSet: AssetChangeSetRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/asset-changes`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).changeSet,
    reviewDraftAssetChanges: async (draftId, changeSetId, input, signal) => (
      await request<{ review: AssetChangeReviewRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/asset-changes/${encodeURIComponent(changeSetId)}/review`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).review,
    applyDraftAssetChanges: async (draftId, changeSetId, input, signal) => (
      await request<{ assetSet: DraftTwinAssetSetRecord }>(
        `/api/v1/map-drafts/${encodeURIComponent(draftId)}/asset-changes/${encodeURIComponent(changeSetId)}/apply`,
        signal,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
      )
    ).assetSet,
    listReleases: async (signal) => (
      await request<{ releases: ReleaseManifest[] }>("/api/v1/releases", signal)
    ).releases,
  };
  return Object.freeze(client);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TwinApiClientError(
      "API_RESPONSE_INVALID",
      `Twin API returned a non-JSON response for HTTP ${response.status}.`,
      response.status,
    );
  }
}
