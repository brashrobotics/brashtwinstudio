import { describe, expect, it } from "vitest";
import {
  createSpatialEditorStore,
  snapToGrid,
  spatialFeaturesToWorldEntities,
  SpatialEditorError,
  type SpatialFeature,
} from "@brash-twin/spatial-editor";

function twoNodes(): SpatialFeature[] {
  return [
    { kind: "NODE", featureId: "node-a", label: "A", position: { x: 0, y: 0, z: 0 } },
    { kind: "NODE", featureId: "node-b", label: "B", position: { x: 2, y: 0, z: 0 } },
  ];
}

describe("manual spatial editor command store", () => {
  it("creates topology, zones, and assets with stable viewer identities", () => {
    const store = createSpatialEditorStore();
    const first = store.addNode({ x: 0, y: 0, z: 0 });
    const second = store.addNode({ x: 2, y: 0, z: 0 });
    const edge = store.addEdge(first, second);
    const zone = store.addZone([
      { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 2, z: 0 },
    ]);
    const asset = store.addAsset({ x: 1, y: 1, z: 0 });

    expect([first, second, edge, zone, asset]).toEqual([
      "topology-node-001", "topology-node-002", "topology-edge-001", "zone-001", "asset-001",
    ]);
    const world = spatialFeaturesToWorldEntities(store.getSnapshot().document.features);
    expect(world.map((entity) => entity.entityId)).toEqual([first, second, edge, zone, asset]);
    expect(world.find((entity) => entity.entityId === asset)).toEqual(expect.objectContaining({
      layerId: "assets",
      position: { x: 1, y: 1, z: 0.75 },
    }));
  });

  it("supports bounded immutable undo and redo", () => {
    const store = createSpatialEditorStore();
    store.addNode({ x: 0, y: 0, z: 0 });
    store.addAsset({ x: 2, y: 2, z: 0 });
    const revision = store.getSnapshot().document.revision;

    store.undo();
    expect(store.getSnapshot().document.features).toHaveLength(1);
    expect(store.getSnapshot().canRedo).toBe(true);
    store.redo();
    expect(store.getSnapshot().document.features).toHaveLength(2);
    expect(store.getSnapshot().document.revision).toBe(revision + 2);
  });

  it("updates connected edge geometry when a node moves", () => {
    const store = createSpatialEditorStore(twoNodes());
    const edgeId = store.addEdge("node-a", "node-b");
    store.updateNode("node-b", { position: { x: 4, y: 3, z: 0 } });

    const edge = spatialFeaturesToWorldEntities(store.getSnapshot().document.features)
      .find((entity) => entity.entityId === edgeId);
    expect(edge?.geometry).toEqual({
      type: "POLYLINE",
      points: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }],
    });
  });

  it("cascades connected edge removal with the node and restores both on undo", () => {
    const store = createSpatialEditorStore(twoNodes());
    store.addEdge("node-a", "node-b");
    store.removeFeature("node-a");
    expect(store.getSnapshot().document.features.map((feature) => feature.featureId)).toEqual(["node-b"]);

    store.undo();
    expect(store.getSnapshot().document.features.map((feature) => feature.kind)).toEqual(["NODE", "NODE", "EDGE"]);
  });

  it("rejects invalid geometry and references before committing", () => {
    const store = createSpatialEditorStore(twoNodes());
    expect(() => store.addEdge("node-a", "missing")).toThrowError(expect.objectContaining({
      code: "EDITOR_FEATURE_NOT_FOUND",
    } satisfies Partial<SpatialEditorError>));
    expect(() => store.addZone([
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
    ])).toThrowError(expect.objectContaining({ code: "EDITOR_ZONE_AREA_INVALID" } satisfies Partial<SpatialEditorError>));
    expect(() => store.addAsset({ x: 0, y: 0, z: 0 }, { height: 0 }))
      .toThrowError(expect.objectContaining({ code: "EDITOR_DIMENSION_INVALID" } satisfies Partial<SpatialEditorError>));
    expect(store.getSnapshot().document.features).toHaveLength(2);
  });

  it("snaps canonical positions to a controlled metre grid", () => {
    expect(snapToGrid({ x: 1.13, y: -2.37, z: 0.02 }, 0.25)).toEqual({ x: 1.25, y: -2.25, z: 0 });
    expect(() => snapToGrid({ x: 0, y: 0, z: 0 }, 0)).toThrowError(expect.objectContaining({
      code: "EDITOR_GRID_INVALID",
    } satisfies Partial<SpatialEditorError>));
  });
});
