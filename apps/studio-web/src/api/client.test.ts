import { describe, expect, it, vi } from "vitest";
import { createTwinApiClient, TwinApiClientError } from "./client";

describe("Twin API client", () => {
  it("encodes query identities and unwraps typed collections", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      families: [{ familyId: "plant-a", floorId: "floor / 1", displayName: "Plant A" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createTwinApiClient({ baseUrl: "http://twin.local/", fetchImplementation });

    const families = await api.listMapFamilies("floor / 1");

    expect(families[0]?.familyId).toBe("plant-a");
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://twin.local/api/v1/map-families?floorId=floor%20%2F%201",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("preserves structured API error codes", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "CATALOG_NOT_FOUND", message: "Floor was not found." },
    }), { status: 404, headers: { "content-type": "application/json" } }));
    const api = createTwinApiClient({ fetchImplementation });

    await expect(api.listFloors("missing-site")).rejects.toEqual(expect.objectContaining({
      name: "TwinApiClientError",
      code: "CATALOG_NOT_FOUND",
      status: 404,
    } satisfies Partial<TwinApiClientError>));
  });

  it("reads materialization jobs and their bounded previews through encoded paths", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [{ jobId: "job-1", status: "SUCCEEDED" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        preview: { schemaVersion: "brash.survey-materialization-preview/v1" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = createTwinApiClient({ baseUrl: "http://twin.local", fetchImplementation });

    expect((await api.listSurveyMaterializations("draft / 1"))[0]?.jobId).toBe("job-1");
    expect((await api.getSurveyMaterializationPreview("job / 1")).schemaVersion)
      .toBe("brash.survey-materialization-preview/v1");
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      "http://twin.local/api/v1/map-drafts/draft%20%2F%201/survey-materializations",
      "http://twin.local/api/v1/survey-materializations/job%20%2F%201/preview",
    ]);
  });

  it("creates a versioned survey registration through the draft boundary", async () => {
    const response = {
      registration: {
        reportBindingId: "survey-registration-report-registration-1",
        reportUploadId: "survey-registration-registration-1",
        reportSha256: "a".repeat(64),
        report: { registrationId: "registration-1" },
      },
    };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    const api = createTwinApiClient({ baseUrl: "http://twin.local", fetchImplementation });
    const input = {
      materializationJobId: "materialization-1",
      targetBindingId: "floorplan-target-1",
      operatorId: "operator-1",
      controlPoints: [
        { controlPointId: "cp-1", source: { x: 0, y: 0 }, target: { x: 1, y: 2 } },
        { controlPointId: "cp-2", source: { x: 1, y: 0 }, target: { x: 2, y: 2 } },
      ],
    };

    const registration = await api.createSurveyRegistration("draft / 1", input);

    expect(registration.reportBindingId).toBe("survey-registration-report-registration-1");
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://twin.local/api/v1/map-drafts/draft%20%2F%201/survey-registrations",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
  });

  it("lists design targets and creates immutable registration review evidence", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        artifacts: [{ bindingId: "floorplan-target-1", role: "FLOORPLAN_SOURCE" }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        acceptance: { reportBindingId: "acceptance-1", report: { decision: "APPROVED" } },
      }), { status: 201, headers: { "content-type": "application/json" } }));
    const api = createTwinApiClient({ baseUrl: "http://twin.local", fetchImplementation });

    expect((await api.listDraftArtifacts("draft / 1"))[0]?.bindingId).toBe("floorplan-target-1");
    const review = { decision: "APPROVED" as const, reviewerId: "reviewer-1" };
    expect((await api.reviewSurveyRegistration("draft / 1", "registration / 1", review)).report.decision)
      .toBe("APPROVED");
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      "http://twin.local/api/v1/map-drafts/draft%20%2F%201/artifacts",
      "http://twin.local/api/v1/map-drafts/draft%20%2F%201/survey-registrations/registration%20%2F%201/acceptance",
    ]);
    expect(fetchImplementation.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify(review),
    }));
  });
});
