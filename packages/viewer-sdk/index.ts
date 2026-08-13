export type ViewerMode = "2D" | "3D";
export type LayerKind = "CAD" | "SURVEY" | "ASSET" | "ZONE" | "TOPOLOGY";

export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

export interface WorldLayer {
  layerId: string;
  label: string;
  kind: LayerKind;
  color: string;
  visible: boolean;
  selectable: boolean;
}

export type WorldGeometry =
  | { type: "BOX"; size: Vector3Value }
  | { type: "POINT"; radius: number }
  | { type: "POLYLINE"; points: Vector3Value[]; closed?: boolean }
  | { type: "POLYGON"; points: Vector3Value[] };

export interface WorldEntity {
  entityId: string;
  layerId: string;
  label: string;
  position: Vector3Value;
  rotationZ?: number;
  geometry: WorldGeometry;
}

export interface WorldSnapshot {
  canonicalFrameId: string;
  units: Readonly<{ length: "m"; angle: "rad" }>;
  viewMode: ViewerMode;
  layers: readonly Readonly<WorldLayer>[];
  entities: readonly Readonly<WorldEntity>[];
  selectedEntityId: string | null;
  pointerWorld: Readonly<Vector3Value> | null;
  revision: number;
}

export interface WorldStore {
  getSnapshot(): WorldSnapshot;
  subscribe(listener: () => void): () => void;
  setCanonicalFrame(canonicalFrameId: string): void;
  setViewMode(mode: ViewerMode): void;
  registerLayer(layer: Omit<WorldLayer, "visible"> & { visible?: boolean }): void;
  setLayerVisibility(layerId: string, visible: boolean): void;
  toggleLayer(layerId: string): void;
  setEntities(entities: WorldEntity[]): void;
  selectEntity(entityId: string | null): void;
  setPointerWorld(position: Vector3Value | null): void;
}

export class ViewerModelError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ViewerModelError";
  }
}

export function createWorldStore({
  canonicalFrameId,
  viewMode = "2D",
  layers = [],
  entities = [],
}: {
  canonicalFrameId: string;
  viewMode?: ViewerMode;
  layers?: Array<Omit<WorldLayer, "visible"> & { visible?: boolean }>;
  entities?: WorldEntity[];
}): WorldStore {
  requiredText(canonicalFrameId, "canonicalFrameId");
  const listeners = new Set<() => void>();
  let snapshot: WorldSnapshot = freezeSnapshot({
    canonicalFrameId,
    units: { length: "m", angle: "rad" },
    viewMode,
    layers: [],
    entities: [],
    selectedEntityId: null,
    pointerWorld: null,
    revision: 1,
  });

  function commit(next: Omit<WorldSnapshot, "revision">): void {
    snapshot = freezeSnapshot({ ...next, revision: snapshot.revision + 1 });
    listeners.forEach((listener) => listener());
  }

  const store: WorldStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setCanonicalFrame(nextFrameId) {
      requiredText(nextFrameId, "canonicalFrameId");
      if (snapshot.canonicalFrameId === nextFrameId) return;
      commit({ ...snapshot, canonicalFrameId: nextFrameId, selectedEntityId: null });
    },
    setViewMode(mode) {
      if (!(["2D", "3D"] as ViewerMode[]).includes(mode)) {
        throw new ViewerModelError("VIEWER_MODE_INVALID", `Unsupported viewer mode ${String(mode)}.`);
      }
      if (snapshot.viewMode === mode) return;
      commit({ ...snapshot, viewMode: mode });
    },
    registerLayer(layer) {
      const normalized = normalizeLayer(layer);
      if (snapshot.layers.some((candidate) => candidate.layerId === normalized.layerId)) {
        throw new ViewerModelError("VIEWER_LAYER_DUPLICATE", `Layer ${normalized.layerId} already exists.`);
      }
      commit({ ...snapshot, layers: [...snapshot.layers, normalized] });
    },
    setLayerVisibility(layerId, visible) {
      const layer = requireLayer(snapshot, layerId);
      if (layer.visible === visible) return;
      const selected = snapshot.entities.find((entity) => entity.entityId === snapshot.selectedEntityId);
      commit({
        ...snapshot,
        layers: snapshot.layers.map((candidate) => candidate.layerId === layerId
          ? { ...candidate, visible }
          : candidate),
        selectedEntityId: !visible && selected?.layerId === layerId ? null : snapshot.selectedEntityId,
      });
    },
    toggleLayer(layerId) {
      const layer = requireLayer(snapshot, layerId);
      store.setLayerVisibility(layerId, !layer.visible);
    },
    setEntities(nextEntities) {
      const normalized = normalizeEntities(nextEntities, snapshot.layers);
      const selectedStillExists = normalized.some((entity) => entity.entityId === snapshot.selectedEntityId);
      commit({
        ...snapshot,
        entities: normalized,
        selectedEntityId: selectedStillExists ? snapshot.selectedEntityId : null,
      });
    },
    selectEntity(entityId) {
      if (entityId === null) {
        if (snapshot.selectedEntityId !== null) commit({ ...snapshot, selectedEntityId: null });
        return;
      }
      const entity = snapshot.entities.find((candidate) => candidate.entityId === entityId);
      if (!entity) throw new ViewerModelError("VIEWER_ENTITY_NOT_FOUND", `Entity ${entityId} was not found.`);
      const layer = requireLayer(snapshot, entity.layerId);
      if (!layer.visible || !layer.selectable) {
        throw new ViewerModelError("VIEWER_ENTITY_NOT_SELECTABLE", `Entity ${entityId} is not selectable.`);
      }
      if (snapshot.selectedEntityId !== entityId) commit({ ...snapshot, selectedEntityId: entityId });
    },
    setPointerWorld(position) {
      const normalized = position === null ? null : vector(position, "pointerWorld");
      if (sameVector(snapshot.pointerWorld, normalized)) return;
      commit({ ...snapshot, pointerWorld: normalized });
    },
  };

  for (const layer of layers) store.registerLayer(layer);
  if (entities.length > 0) store.setEntities(entities);
  return Object.freeze(store);
}

function normalizeLayer(layer: Omit<WorldLayer, "visible"> & { visible?: boolean }): WorldLayer {
  if (!layer || typeof layer !== "object") throw new ViewerModelError("VIEWER_LAYER_REQUIRED", "Layer is required.");
  requiredIdentifier(layer.layerId, "layerId");
  requiredText(layer.label, "label");
  if (!(["CAD", "SURVEY", "ASSET", "ZONE", "TOPOLOGY"] as LayerKind[]).includes(layer.kind)) {
    throw new ViewerModelError("VIEWER_LAYER_KIND_INVALID", `Unsupported layer kind ${String(layer.kind)}.`);
  }
  if (!/^#[a-f0-9]{6}$/i.test(layer.color)) {
    throw new ViewerModelError("VIEWER_LAYER_COLOR_INVALID", "Layer color must be a six-digit hexadecimal value.");
  }
  if (typeof layer.selectable !== "boolean") {
    throw new ViewerModelError("VIEWER_LAYER_SELECTABLE_INVALID", "Layer selectable must be boolean.");
  }
  return {
    layerId: layer.layerId,
    label: layer.label.trim(),
    kind: layer.kind,
    color: layer.color.toLowerCase(),
    visible: layer.visible ?? true,
    selectable: layer.selectable,
  };
}

function normalizeEntities(entities: WorldEntity[], layers: readonly Readonly<WorldLayer>[]): WorldEntity[] {
  if (!Array.isArray(entities)) throw new ViewerModelError("VIEWER_ENTITIES_INVALID", "Entities must be an array.");
  const layerIds = new Set(layers.map((layer) => layer.layerId));
  const entityIds = new Set<string>();
  return entities.map((entity) => {
    if (!entity || typeof entity !== "object") throw new ViewerModelError("VIEWER_ENTITY_INVALID", "Entity must be an object.");
    requiredIdentifier(entity.entityId, "entityId");
    if (entityIds.has(entity.entityId)) {
      throw new ViewerModelError("VIEWER_ENTITY_DUPLICATE", `Entity ${entity.entityId} appears more than once.`);
    }
    entityIds.add(entity.entityId);
    if (!layerIds.has(entity.layerId)) {
      throw new ViewerModelError("VIEWER_ENTITY_LAYER_UNKNOWN", `Entity ${entity.entityId} references unknown layer ${entity.layerId}.`);
    }
    requiredText(entity.label, "label");
    const position = vector(entity.position, `${entity.entityId}.position`);
    const rotationZ = entity.rotationZ ?? 0;
    finite(rotationZ, `${entity.entityId}.rotationZ`);
    return {
      entityId: entity.entityId,
      layerId: entity.layerId,
      label: entity.label.trim(),
      position,
      rotationZ,
      geometry: normalizeGeometry(entity.geometry, entity.entityId),
    };
  });
}

function normalizeGeometry(geometry: WorldGeometry, entityId: string): WorldGeometry {
  if (!geometry || typeof geometry !== "object") {
    throw new ViewerModelError("VIEWER_GEOMETRY_REQUIRED", `Entity ${entityId} geometry is required.`);
  }
  if (geometry.type === "BOX") {
    const size = vector(geometry.size, `${entityId}.geometry.size`);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
      throw new ViewerModelError("VIEWER_GEOMETRY_SIZE_INVALID", `Entity ${entityId} box size must be positive.`);
    }
    return { type: "BOX", size };
  }
  if (geometry.type === "POINT") {
    finite(geometry.radius, `${entityId}.geometry.radius`);
    if (geometry.radius <= 0) throw new ViewerModelError("VIEWER_GEOMETRY_SIZE_INVALID", `Entity ${entityId} radius must be positive.`);
    return { type: "POINT", radius: geometry.radius };
  }
  if (geometry.type === "POLYLINE" || geometry.type === "POLYGON") {
    const minimum = geometry.type === "POLYGON" ? 3 : 2;
    if (!Array.isArray(geometry.points) || geometry.points.length < minimum) {
      throw new ViewerModelError("VIEWER_GEOMETRY_POINTS_INVALID", `Entity ${entityId} requires at least ${minimum} points.`);
    }
    const points = geometry.points.map((point, index) => vector(point, `${entityId}.geometry.points[${index}]`));
    return geometry.type === "POLYGON"
      ? { type: "POLYGON", points }
      : { type: "POLYLINE", points, closed: geometry.closed ?? false };
  }
  throw new ViewerModelError("VIEWER_GEOMETRY_TYPE_INVALID", `Entity ${entityId} has unsupported geometry.`);
}

function freezeSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return Object.freeze({
    ...snapshot,
    units: Object.freeze({ ...snapshot.units }),
    layers: Object.freeze(snapshot.layers.map((layer) => Object.freeze({ ...layer }))),
    entities: Object.freeze(snapshot.entities.map((entity) => Object.freeze(structuredClone(entity)))),
    pointerWorld: snapshot.pointerWorld === null ? null : Object.freeze({ ...snapshot.pointerWorld }),
  });
}

function requireLayer(snapshot: WorldSnapshot, layerId: string): Readonly<WorldLayer> {
  const layer = snapshot.layers.find((candidate) => candidate.layerId === layerId);
  if (!layer) throw new ViewerModelError("VIEWER_LAYER_NOT_FOUND", `Layer ${layerId} was not found.`);
  return layer;
}

function vector(value: Vector3Value, field: string): Vector3Value {
  if (!value || typeof value !== "object") throw new ViewerModelError("VIEWER_VECTOR_INVALID", `${field} must be a vector.`);
  finite(value.x, `${field}.x`);
  finite(value.y, `${field}.y`);
  finite(value.z, `${field}.z`);
  return { x: value.x, y: value.y, z: value.z };
}

function finite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new ViewerModelError("VIEWER_NUMBER_INVALID", `${field} must be finite.`);
}

function sameVector(left: Readonly<Vector3Value> | null, right: Vector3Value | null): boolean {
  return left === null && right === null
    || left !== null && right !== null && left.x === right.x && left.y === right.y && left.z === right.z;
}

function requiredIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new ViewerModelError("VIEWER_ID_INVALID", `${field} must be lowercase kebab-case.`);
  }
}

function requiredText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ViewerModelError("VIEWER_TEXT_REQUIRED", `${field} is required.`);
  }
}
