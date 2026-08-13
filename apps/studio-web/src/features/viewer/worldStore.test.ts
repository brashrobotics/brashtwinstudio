import { describe, expect, it } from "vitest";
import { createWorldStore, ViewerModelError } from "@brash-twin/viewer-sdk";
import { spatialFeaturesToWorldEntities } from "@brash-twin/spatial-editor";
import { diagnosticEntities, diagnosticLayers } from "./diagnosticWorld";
import { diagnosticEditorFeatures } from "./editorSeed";

const allDiagnosticEntities = [...diagnosticEntities, ...spatialFeaturesToWorldEntities(diagnosticEditorFeatures)];

describe("shared world store", () => {
  it("preserves one selection while switching between 2D and 3D", () => {
    const store = createWorldStore({
      canonicalFrameId: "plant/floor-1",
      layers: diagnosticLayers,
      entities: allDiagnosticEntities,
    });
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });

    store.selectEntity("asset-panel-01");
    store.setViewMode("3D");

    expect(store.getSnapshot().viewMode).toBe("3D");
    expect(store.getSnapshot().selectedEntityId).toBe("asset-panel-01");
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it("clears a selection when its layer is hidden", () => {
    const store = createWorldStore({
      canonicalFrameId: "plant/floor-1",
      layers: diagnosticLayers,
      entities: allDiagnosticEntities,
    });
    store.selectEntity("asset-conveyor-01");
    store.setLayerVisibility("assets", false);

    expect(store.getSnapshot().selectedEntityId).toBeNull();
    expect(store.getSnapshot().layers.find((layer) => layer.layerId === "assets")?.visible).toBe(false);
  });

  it("rejects duplicate identities and unknown layer references", () => {
    expect(() => createWorldStore({
      canonicalFrameId: "plant/floor-1",
      layers: [diagnosticLayers[0]!, diagnosticLayers[0]!],
    })).toThrowError(expect.objectContaining({ code: "VIEWER_LAYER_DUPLICATE" } satisfies Partial<ViewerModelError>));

    expect(() => createWorldStore({
      canonicalFrameId: "plant/floor-1",
      layers: diagnosticLayers,
      entities: [{ ...allDiagnosticEntities[0]!, layerId: "missing" }],
    })).toThrowError(expect.objectContaining({ code: "VIEWER_ENTITY_LAYER_UNKNOWN" } satisfies Partial<ViewerModelError>));
  });

  it("keeps diagnostic entity and layer identities unique", () => {
    expect(new Set(diagnosticLayers.map((layer) => layer.layerId)).size).toBe(diagnosticLayers.length);
    expect(new Set(allDiagnosticEntities.map((entity) => entity.entityId)).size).toBe(allDiagnosticEntities.length);
    const layerIds = new Set(diagnosticLayers.map((layer) => layer.layerId));
    expect(allDiagnosticEntities.every((entity) => layerIds.has(entity.layerId))).toBe(true);
  });
});
