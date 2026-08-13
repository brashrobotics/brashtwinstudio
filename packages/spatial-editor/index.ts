import type { Vector3Value, WorldEntity } from "@brash-twin/viewer-sdk";

export const SPATIAL_EDITOR_DOCUMENT_SCHEMA_VERSION = "brash.spatial-editor-document/v1";
const MAX_FEATURES = 10_000;
const MAX_HISTORY = 100;
const MAX_ZONE_POINTS = 1_000;
const MAX_ABSOLUTE_COORDINATE = 1_000_000;

export type SpatialEditorTool = "SELECT" | "NODE" | "EDGE" | "ZONE" | "ASSET";

export interface TopologyNodeFeature {
  kind: "NODE";
  featureId: string;
  label: string;
  position: Vector3Value;
}

export interface TopologyEdgeFeature {
  kind: "EDGE";
  featureId: string;
  label: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface ZoneFeature {
  kind: "ZONE";
  featureId: string;
  label: string;
  points: Vector3Value[];
}

export interface AssetFeature {
  kind: "ASSET";
  featureId: string;
  label: string;
  center: Vector3Value;
  width: number;
  depth: number;
  height: number;
  rotationZ: number;
}

export type SpatialFeature = TopologyNodeFeature | TopologyEdgeFeature | ZoneFeature | AssetFeature;

export interface SpatialEditorDocument {
  schemaVersion: typeof SPATIAL_EDITOR_DOCUMENT_SCHEMA_VERSION;
  revision: number;
  features: readonly Readonly<SpatialFeature>[];
}

export interface SpatialEditorSnapshot {
  document: Readonly<SpatialEditorDocument>;
  canUndo: boolean;
  canRedo: boolean;
  historyDepth: number;
}

export interface SpatialEditorStore {
  getSnapshot(): SpatialEditorSnapshot;
  subscribe(listener: () => void): () => void;
  addNode(position: Vector3Value, label?: string): string;
  addEdge(fromNodeId: string, toNodeId: string, label?: string): string;
  addZone(points: Vector3Value[], label?: string): string;
  addAsset(center: Vector3Value, options?: Partial<Omit<AssetFeature, "kind" | "featureId" | "center">>): string;
  updateNode(featureId: string, update: Partial<Pick<TopologyNodeFeature, "label" | "position">>): void;
  updateEdge(featureId: string, update: Partial<Pick<TopologyEdgeFeature, "label" | "fromNodeId" | "toNodeId">>): void;
  updateZone(featureId: string, update: Partial<Pick<ZoneFeature, "label" | "points">>): void;
  updateZoneVertex(featureId: string, index: number, position: Vector3Value): void;
  updateAsset(featureId: string, update: Partial<Omit<AssetFeature, "kind" | "featureId">>): void;
  removeFeature(featureId: string): void;
  undo(): void;
  redo(): void;
}

export class SpatialEditorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SpatialEditorError";
  }
}

export function createSpatialEditorStore(initialFeatures: SpatialFeature[] = []): SpatialEditorStore {
  const listeners = new Set<() => void>();
  let revision = 1;
  let features = normalizeFeatures(initialFeatures);
  let past: SpatialFeature[][] = [];
  let future: SpatialFeature[][] = [];
  let snapshot = createSnapshot(features, revision, past.length, future.length);

  const publish = (): void => {
    snapshot = createSnapshot(features, revision, past.length, future.length);
    listeners.forEach((listener) => listener());
  };

  const commit = (next: SpatialFeature[]): void => {
    const normalized = normalizeFeatures(next);
    if (JSON.stringify(normalized) === JSON.stringify(features)) return;
    past = [...past, cloneFeatures(features)].slice(-MAX_HISTORY);
    features = normalized;
    future = [];
    revision += 1;
    publish();
  };

  const store: SpatialEditorStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addNode(position, label) {
      const featureId = nextFeatureId("topology-node", features);
      const next: TopologyNodeFeature = {
        kind: "NODE",
        featureId,
        label: label?.trim() || `Navigation node ${numericSuffix(featureId)}`,
        position,
      };
      commit([...features, next]);
      return featureId;
    },
    addEdge(fromNodeId, toNodeId, label) {
      requireFeature(features, fromNodeId, "NODE");
      requireFeature(features, toNodeId, "NODE");
      if (fromNodeId === toNodeId) {
        throw new SpatialEditorError("EDITOR_EDGE_SELF_REFERENCE", "An edge must connect two different nodes.");
      }
      if (features.some((feature) => feature.kind === "EDGE"
        && feature.fromNodeId === fromNodeId && feature.toNodeId === toNodeId)) {
        throw new SpatialEditorError("EDITOR_EDGE_DUPLICATE", "This directed edge already exists.");
      }
      const featureId = nextFeatureId("topology-edge", features);
      commit([...features, {
        kind: "EDGE",
        featureId,
        label: label?.trim() || `Navigation edge ${numericSuffix(featureId)}`,
        fromNodeId,
        toNodeId,
      }]);
      return featureId;
    },
    addZone(points, label) {
      const featureId = nextFeatureId("zone", features);
      commit([...features, {
        kind: "ZONE",
        featureId,
        label: label?.trim() || `Operational zone ${numericSuffix(featureId)}`,
        points,
      }]);
      return featureId;
    },
    addAsset(center, options = {}) {
      const featureId = nextFeatureId("asset", features);
      commit([...features, {
        kind: "ASSET",
        featureId,
        label: options.label?.trim() || `Factory asset ${numericSuffix(featureId)}`,
        center,
        width: options.width ?? 1.2,
        depth: options.depth ?? 0.8,
        height: options.height ?? 1.5,
        rotationZ: options.rotationZ ?? 0,
      }]);
      return featureId;
    },
    updateNode(featureId, update) {
      requireFeature(features, featureId, "NODE");
      commit(features.map((feature) => feature.featureId === featureId
        ? { ...feature, ...update, kind: "NODE", featureId } as TopologyNodeFeature
        : feature));
    },
    updateEdge(featureId, update) {
      requireFeature(features, featureId, "EDGE");
      commit(features.map((feature) => feature.featureId === featureId
        ? { ...feature, ...update, kind: "EDGE", featureId } as TopologyEdgeFeature
        : feature));
    },
    updateZone(featureId, update) {
      requireFeature(features, featureId, "ZONE");
      commit(features.map((feature) => feature.featureId === featureId
        ? { ...feature, ...update, kind: "ZONE", featureId } as ZoneFeature
        : feature));
    },
    updateZoneVertex(featureId, index, position) {
      const zone = requireFeature(features, featureId, "ZONE");
      if (!Number.isInteger(index) || index < 0 || index >= zone.points.length) {
        throw new SpatialEditorError("EDITOR_ZONE_VERTEX_NOT_FOUND", `Zone vertex ${index} does not exist.`);
      }
      const points = zone.points.map((point, pointIndex) => pointIndex === index ? position : point);
      store.updateZone(featureId, { points });
    },
    updateAsset(featureId, update) {
      requireFeature(features, featureId, "ASSET");
      commit(features.map((feature) => feature.featureId === featureId
        ? { ...feature, ...update, kind: "ASSET", featureId } as AssetFeature
        : feature));
    },
    removeFeature(featureId) {
      const target = features.find((feature) => feature.featureId === featureId);
      if (!target) throw new SpatialEditorError("EDITOR_FEATURE_NOT_FOUND", `Feature ${featureId} was not found.`);
      commit(features.filter((feature) => feature.featureId !== featureId
        && !(target.kind === "NODE" && feature.kind === "EDGE"
          && (feature.fromNodeId === featureId || feature.toNodeId === featureId))));
    },
    undo() {
      const previous = past.at(-1);
      if (!previous) return;
      future = [cloneFeatures(features), ...future].slice(0, MAX_HISTORY);
      features = cloneFeatures(previous);
      past = past.slice(0, -1);
      revision += 1;
      publish();
    },
    redo() {
      const next = future[0];
      if (!next) return;
      past = [...past, cloneFeatures(features)].slice(-MAX_HISTORY);
      features = cloneFeatures(next);
      future = future.slice(1);
      revision += 1;
      publish();
    },
  };
  return Object.freeze(store);
}

export function spatialFeaturesToWorldEntities(features: readonly Readonly<SpatialFeature>[]): WorldEntity[] {
  const normalized = normalizeFeatures(features as SpatialFeature[]);
  const nodes = new Map(normalized.filter((feature): feature is TopologyNodeFeature => feature.kind === "NODE")
    .map((node) => [node.featureId, node]));
  return normalized.map((feature): WorldEntity => {
    if (feature.kind === "NODE") {
      return {
        entityId: feature.featureId,
        layerId: "topology",
        label: feature.label,
        position: { x: feature.position.x, y: feature.position.y, z: feature.position.z + 0.16 },
        geometry: { type: "POINT", radius: 0.24 },
      };
    }
    if (feature.kind === "EDGE") {
      const from = nodes.get(feature.fromNodeId)!;
      const to = nodes.get(feature.toNodeId)!;
      return {
        entityId: feature.featureId,
        layerId: "topology",
        label: feature.label,
        position: { x: 0, y: 0, z: 0.14 },
        geometry: {
          type: "POLYLINE",
          points: [
            { x: from.position.x, y: from.position.y, z: from.position.z },
            { x: to.position.x, y: to.position.y, z: to.position.z },
          ],
        },
      };
    }
    if (feature.kind === "ZONE") {
      return {
        entityId: feature.featureId,
        layerId: "zones",
        label: feature.label,
        position: { x: 0, y: 0, z: 0.04 },
        geometry: { type: "POLYGON", points: feature.points },
      };
    }
    return {
      entityId: feature.featureId,
      layerId: "assets",
      label: feature.label,
      position: {
        x: feature.center.x,
        y: feature.center.y,
        z: feature.center.z + feature.height / 2,
      },
      rotationZ: feature.rotationZ,
      geometry: {
        type: "BOX",
        size: { x: feature.width, y: feature.depth, z: feature.height },
      },
    };
  });
}

export function snapToGrid(position: Vector3Value, gridMetres = 0.25): Vector3Value {
  if (!Number.isFinite(gridMetres) || gridMetres <= 0 || gridMetres > 100) {
    throw new SpatialEditorError("EDITOR_GRID_INVALID", "Grid size must be greater than zero and at most 100 metres.");
  }
  return {
    x: roundTo(position.x, gridMetres),
    y: roundTo(position.y, gridMetres),
    z: roundTo(position.z, gridMetres),
  };
}

export function findSpatialFeature(
  features: readonly Readonly<SpatialFeature>[],
  featureId: string | null,
): Readonly<SpatialFeature> | null {
  if (!featureId) return null;
  return features.find((feature) => feature.featureId === featureId) ?? null;
}

function createSnapshot(
  features: SpatialFeature[],
  revision: number,
  historyDepth: number,
  futureDepth: number,
): SpatialEditorSnapshot {
  const frozenFeatures = Object.freeze(cloneFeatures(features).map((feature) => deepFreeze(feature)));
  return Object.freeze({
    document: Object.freeze({
      schemaVersion: SPATIAL_EDITOR_DOCUMENT_SCHEMA_VERSION,
      revision,
      features: frozenFeatures,
    }),
    canUndo: historyDepth > 0,
    canRedo: futureDepth > 0,
    historyDepth,
  });
}

function normalizeFeatures(input: SpatialFeature[]): SpatialFeature[] {
  if (!Array.isArray(input)) throw new SpatialEditorError("EDITOR_FEATURES_INVALID", "Features must be an array.");
  if (input.length > MAX_FEATURES) {
    throw new SpatialEditorError("EDITOR_FEATURE_LIMIT_EXCEEDED", `Editor supports at most ${MAX_FEATURES} features.`);
  }
  const ids = new Set<string>();
  const normalized = input.map((feature) => normalizeFeature(feature, ids));
  const nodeIds = new Set(normalized.filter((feature) => feature.kind === "NODE").map((feature) => feature.featureId));
  for (const feature of normalized) {
    if (feature.kind === "EDGE" && (!nodeIds.has(feature.fromNodeId) || !nodeIds.has(feature.toNodeId))) {
      throw new SpatialEditorError("EDITOR_EDGE_NODE_UNKNOWN", `Edge ${feature.featureId} references an unknown node.`);
    }
  }
  return normalized;
}

function normalizeFeature(feature: SpatialFeature, ids: Set<string>): SpatialFeature {
  if (!feature || typeof feature !== "object") {
    throw new SpatialEditorError("EDITOR_FEATURE_INVALID", "Feature must be an object.");
  }
  identifier(feature.featureId, "featureId");
  if (ids.has(feature.featureId)) {
    throw new SpatialEditorError("EDITOR_FEATURE_DUPLICATE", `Feature ${feature.featureId} appears more than once.`);
  }
  ids.add(feature.featureId);
  const label = requiredLabel(feature.label);
  if (feature.kind === "NODE") {
    return { kind: "NODE", featureId: feature.featureId, label, position: vector(feature.position, "position") };
  }
  if (feature.kind === "EDGE") {
    identifier(feature.fromNodeId, "fromNodeId");
    identifier(feature.toNodeId, "toNodeId");
    if (feature.fromNodeId === feature.toNodeId) {
      throw new SpatialEditorError("EDITOR_EDGE_SELF_REFERENCE", "An edge must connect two different nodes.");
    }
    return { ...feature, label };
  }
  if (feature.kind === "ZONE") {
    if (!Array.isArray(feature.points) || feature.points.length < 3 || feature.points.length > MAX_ZONE_POINTS) {
      throw new SpatialEditorError("EDITOR_ZONE_POINTS_INVALID", `Zone requires 3 to ${MAX_ZONE_POINTS} points.`);
    }
    const points = feature.points.map((point, index) => vector(point, `points[${index}]`));
    if (Math.abs(polygonArea(points)) < 0.000001) {
      throw new SpatialEditorError("EDITOR_ZONE_AREA_INVALID", "Zone polygon must have a non-zero area.");
    }
    return { kind: "ZONE", featureId: feature.featureId, label, points };
  }
  if (feature.kind === "ASSET") {
    const width = positiveDimension(feature.width, "width");
    const depth = positiveDimension(feature.depth, "depth");
    const height = positiveDimension(feature.height, "height");
    finite(feature.rotationZ, "rotationZ");
    return {
      kind: "ASSET",
      featureId: feature.featureId,
      label,
      center: vector(feature.center, "center"),
      width,
      depth,
      height,
      rotationZ: feature.rotationZ,
    };
  }
  throw new SpatialEditorError("EDITOR_FEATURE_KIND_INVALID", "Feature kind is not supported.");
}

function requireFeature<K extends SpatialFeature["kind"]>(
  features: SpatialFeature[],
  featureId: string,
  kind: K,
): Extract<SpatialFeature, { kind: K }> {
  const feature = features.find((candidate) => candidate.featureId === featureId);
  if (!feature) throw new SpatialEditorError("EDITOR_FEATURE_NOT_FOUND", `Feature ${featureId} was not found.`);
  if (feature.kind !== kind) {
    throw new SpatialEditorError("EDITOR_FEATURE_KIND_MISMATCH", `Feature ${featureId} is not a ${kind}.`);
  }
  return feature as Extract<SpatialFeature, { kind: K }>;
}

function nextFeatureId(prefix: string, features: SpatialFeature[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const maximum = features.reduce((current, feature) => {
    const match = feature.featureId.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(3, "0")}`;
}

function numericSuffix(featureId: string): number {
  return Number(featureId.match(/(\d+)$/)?.[1] ?? 1);
}

function vector(value: Vector3Value, field: string): Vector3Value {
  if (!value || typeof value !== "object") throw new SpatialEditorError("EDITOR_COORDINATE_INVALID", `${field} is required.`);
  for (const [axis, number] of Object.entries(value)) {
    finite(number, `${field}.${axis}`);
    if (Math.abs(number) > MAX_ABSOLUTE_COORDINATE) {
      throw new SpatialEditorError("EDITOR_COORDINATE_OUT_OF_RANGE", `${field}.${axis} exceeds the coordinate limit.`);
    }
  }
  return { x: round(value.x), y: round(value.y), z: round(value.z) };
}

function positiveDimension(value: number, field: string): number {
  finite(value, field);
  if (value <= 0 || value > 1_000) {
    throw new SpatialEditorError("EDITOR_DIMENSION_INVALID", `${field} must be greater than zero and at most 1000 metres.`);
  }
  return round(value);
}

function finite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new SpatialEditorError("EDITOR_NUMBER_INVALID", `${field} must be finite.`);
}

function identifier(value: string, field: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/.test(value)) {
    throw new SpatialEditorError("EDITOR_IDENTIFIER_INVALID", `${field} must be a safe identifier.`);
  }
}

function requiredLabel(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200) {
    throw new SpatialEditorError("EDITOR_LABEL_INVALID", "Feature label must contain 1 to 200 characters.");
  }
  return value.trim();
}

function polygonArea(points: Vector3Value[]): number {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function cloneFeatures(features: readonly Readonly<SpatialFeature>[]): SpatialFeature[] {
  return structuredClone(features) as SpatialFeature[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}

function roundTo(value: number, step: number): number {
  return round(Math.round(value / step) * step);
}
