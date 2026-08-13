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
});
