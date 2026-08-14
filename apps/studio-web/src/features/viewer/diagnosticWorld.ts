import type { WorldEntity, WorldLayer } from "@brash-twin/viewer-sdk";

export const diagnosticLayers: Array<Omit<WorldLayer, "visible"> & { visible?: boolean }> = [
  { layerId: "cad", label: "CAD / BIM", kind: "CAD", color: "#54d6d0", selectable: true },
  { layerId: "survey", label: "Survey", kind: "SURVEY", color: "#97a4ad", selectable: true },
  { layerId: "coverage", label: "Coverage", kind: "ZONE", color: "#d8ff52", selectable: true },
  { layerId: "assets", label: "Assets", kind: "ASSET", color: "#b9f227", selectable: true },
  { layerId: "zones", label: "Zones", kind: "ZONE", color: "#7766e8", selectable: true },
  { layerId: "topology", label: "Topology", kind: "TOPOLOGY", color: "#ff9b4a", selectable: true },
];

export const diagnosticEntities: WorldEntity[] = [
  {
    entityId: "building-shell",
    layerId: "cad",
    label: "Production hall outline",
    position: { x: 0, y: 0, z: 0.02 },
    geometry: {
      type: "POLYLINE",
      closed: true,
      points: [
        { x: -13, y: -8, z: 0 },
        { x: 13, y: -8, z: 0 },
        { x: 13, y: 7, z: 0 },
        { x: 5, y: 7, z: 0 },
        { x: 5, y: 9, z: 0 },
        { x: -13, y: 9, z: 0 },
      ],
    },
  },
  {
    entityId: "survey-cluster-a",
    layerId: "survey",
    label: "Survey checkpoint A",
    position: { x: -8, y: -4, z: 0.28 },
    geometry: { type: "POINT", radius: 0.22 },
  },
  {
    entityId: "survey-cluster-b",
    layerId: "survey",
    label: "Survey checkpoint B",
    position: { x: 9, y: 5, z: 0.28 },
    geometry: { type: "POINT", radius: 0.22 },
  },
];
