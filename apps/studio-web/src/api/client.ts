import type {
  Floor,
  MapDraft,
  MapFamily,
  Readiness,
  ReleaseManifest,
  Site,
  SurveyMaterializationJob,
  SurveyMaterializationPreview,
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
  listValidationJobs(draftId: string, signal?: AbortSignal): Promise<ValidationJob[]>;
  listSurveyMaterializations(draftId: string, signal?: AbortSignal): Promise<SurveyMaterializationJob[]>;
  getSurveyMaterializationPreview(jobId: string, signal?: AbortSignal): Promise<SurveyMaterializationPreview>;
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

  async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetchImplementation(`${normalizedBaseUrl}${path}`, {
        headers: { accept: "application/json" },
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
