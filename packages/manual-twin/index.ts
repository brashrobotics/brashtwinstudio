import { canonicalSha256 as sha256Canonical, type FloorplanImportReport } from "@brash-twin/importers/svg-floorplan";
import type { SpatialEditorDocument, SpatialFeature } from "@brash-twin/spatial-editor";
import type { Vector3Value, WorldEntity } from "@brash-twin/viewer-sdk";

export const REGISTRATION_REPORT_SCHEMA_VERSION = "brash.registration-report/v1";
export const MANUAL_TWIN_VALIDATION_SCHEMA_VERSION = "brash.manual-twin-validation/v1";
export const MANUAL_TWIN_RELEASE_SCHEMA_VERSION = "brash.manual-twin-release/v1";
const SOLVER_NAME = "brash.similarity-2d";
const SOLVER_VERSION = "1.0.0";
const MAX_CONTROL_POINTS = 1_000;

export interface Point2D {
  x: number;
  y: number;
}

export interface ControlPointPair {
  controlPointId: string;
  source: Point2D;
  target: Point2D;
}

export interface SimilarityTransform2D {
  scale: number;
  rotationRadians: number;
  translation: Point2D;
}

export interface RegistrationResidual {
  controlPointId: string;
  source: Point2D;
  target: Point2D;
  transformed: Point2D;
  dxMetres: number;
  dyMetres: number;
  errorMetres: number;
}

export interface RegistrationReport {
  schemaVersion: typeof REGISTRATION_REPORT_SCHEMA_VERSION;
  sourceFrameId: string;
  canonicalFrameId: string;
  solver: {
    name: typeof SOLVER_NAME;
    version: typeof SOLVER_VERSION;
    configurationSha256: string;
    allowScale: boolean;
  };
  transform: SimilarityTransform2D;
  residuals: RegistrationResidual[];
  metrics: {
    controlPointCount: number;
    rmseMetres: number;
    maximumErrorMetres: number;
    meanErrorMetres: number;
    scaleDeviation: number;
  };
}

export interface ManualTwinValidationPolicy {
  maximumRegistrationRmseMetres: number;
  maximumScaleDeviation: number;
  minimumAssets: number;
  minimumZones: number;
  minimumTopologyNodes: number;
  requireConnectedTopology: boolean;
}

export interface ManualTwinValidationIssue {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  featureId?: string;
}

export interface ManualTwinValidationReport {
  schemaVersion: typeof MANUAL_TWIN_VALIDATION_SCHEMA_VERSION;
  inputSha256: string;
  policy: ManualTwinValidationPolicy;
  valid: boolean;
  summary: {
    errorCount: number;
    warningCount: number;
    assetCount: number;
    zoneCount: number;
    topologyNodeCount: number;
    topologyEdgeCount: number;
  };
  issues: ManualTwinValidationIssue[];
}

export interface SpatialDocumentDiff {
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: string[];
  summary: {
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    unchangedCount: number;
  };
}

export interface ManualTwinRelease {
  schemaVersion: typeof MANUAL_TWIN_RELEASE_SCHEMA_VERSION;
  mapReleaseId: string;
  familyId: string;
  revision: number;
  canonicalFrameId: string;
  status: "PUBLISHED";
  publishedAt: string;
  approvals: {
    requestedBy: string;
    approvedBy: string;
  };
  snapshotSha256: string;
  releaseSha256: string;
  snapshot: {
    floorplanSourceSha256: string;
    floorplanConfigurationSha256: string;
    registration: RegistrationReport;
    editorDocument: SpatialEditorDocument;
    validation: ManualTwinValidationReport;
    diff: SpatialDocumentDiff;
    worldEntities: WorldEntity[];
  };
}

export class ManualTwinError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ManualTwinError";
  }
}

export async function solveSimilarity2D({
  controlPoints,
  sourceFrameId,
  canonicalFrameId,
  allowScale = true,
}: {
  controlPoints: ControlPointPair[];
  sourceFrameId: string;
  canonicalFrameId: string;
  allowScale?: boolean;
}): Promise<RegistrationReport> {
  requiredIdentifier(sourceFrameId, "sourceFrameId");
  requiredIdentifier(canonicalFrameId, "canonicalFrameId");
  const normalized = normalizeControlPoints(controlPoints);
  const sourceCentroid = centroid(normalized.map((pair) => pair.source));
  const targetCentroid = centroid(normalized.map((pair) => pair.target));
  let dot = 0;
  let cross = 0;
  let sourceEnergy = 0;
  for (const pair of normalized) {
    const sx = pair.source.x - sourceCentroid.x;
    const sy = pair.source.y - sourceCentroid.y;
    const tx = pair.target.x - targetCentroid.x;
    const ty = pair.target.y - targetCentroid.y;
    dot += sx * tx + sy * ty;
    cross += sx * ty - sy * tx;
    sourceEnergy += sx * sx + sy * sy;
  }
  if (sourceEnergy < 1e-12 || Math.hypot(dot, cross) < 1e-12) {
    throw new ManualTwinError("REGISTRATION_GEOMETRY_DEGENERATE", "Control points do not define a stable 2D transform.");
  }
  const rotationRadians = Math.atan2(cross, dot);
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  const scale = allowScale ? Math.hypot(dot, cross) / sourceEnergy : 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100) {
    throw new ManualTwinError("REGISTRATION_SCALE_INVALID", "Solved registration scale is outside the supported range.");
  }
  const translation = {
    x: targetCentroid.x - scale * (cosine * sourceCentroid.x - sine * sourceCentroid.y),
    y: targetCentroid.y - scale * (sine * sourceCentroid.x + cosine * sourceCentroid.y),
  };
  const transform: SimilarityTransform2D = {
    scale: round(scale),
    rotationRadians: round(rotationRadians),
    translation: roundedPoint(translation),
  };
  const residuals = normalized.map((pair): RegistrationResidual => {
    const transformed = applySimilarity2D(transform, pair.source);
    const dxMetres = transformed.x - pair.target.x;
    const dyMetres = transformed.y - pair.target.y;
    return {
      ...pair,
      transformed,
      dxMetres: round(dxMetres),
      dyMetres: round(dyMetres),
      errorMetres: round(Math.hypot(dxMetres, dyMetres)),
    };
  });
  const squaredError = residuals.reduce((sum, residual) => sum + residual.errorMetres ** 2, 0);
  const configurationSha256 = await sha256Canonical({
    solver: SOLVER_NAME,
    version: SOLVER_VERSION,
    allowScale,
    sourceFrameId,
    canonicalFrameId,
    controlPoints: normalized,
  });
  return deepFreeze({
    schemaVersion: REGISTRATION_REPORT_SCHEMA_VERSION,
    sourceFrameId,
    canonicalFrameId,
    solver: { name: SOLVER_NAME, version: SOLVER_VERSION, configurationSha256, allowScale },
    transform,
    residuals,
    metrics: {
      controlPointCount: residuals.length,
      rmseMetres: round(Math.sqrt(squaredError / residuals.length)),
      maximumErrorMetres: round(Math.max(...residuals.map((residual) => residual.errorMetres))),
      meanErrorMetres: round(residuals.reduce((sum, residual) => sum + residual.errorMetres, 0) / residuals.length),
      scaleDeviation: round(Math.abs(1 - transform.scale)),
    },
  });
}

export function applySimilarity2D(transform: SimilarityTransform2D, point: Point2D): Point2D {
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  return roundedPoint({
    x: transform.scale * (cosine * point.x - sine * point.y) + transform.translation.x,
    y: transform.scale * (sine * point.x + cosine * point.y) + transform.translation.y,
  });
}

export function transformWorldEntities2D(entities: readonly Readonly<WorldEntity>[], report: RegistrationReport): WorldEntity[] {
  return structuredClone(entities).map((entity) => {
    const position = applySimilarity2D(report.transform, entity.position);
    const transformed: WorldEntity = {
      ...entity,
      position: { x: position.x, y: position.y, z: entity.position.z },
      rotationZ: round((entity.rotationZ ?? 0) + report.transform.rotationRadians),
      geometry: entity.geometry,
    };
    if (entity.geometry.type === "POLYLINE" || entity.geometry.type === "POLYGON") {
      transformed.geometry = {
        ...entity.geometry,
        points: entity.geometry.points.map((point) => {
          const next = applySimilarity2D(report.transform, point);
          return { x: next.x, y: next.y, z: point.z };
        }),
      };
    } else if (entity.geometry.type === "BOX") {
      transformed.geometry = {
        ...entity.geometry,
        size: {
          x: round(entity.geometry.size.x * report.transform.scale),
          y: round(entity.geometry.size.y * report.transform.scale),
          z: entity.geometry.size.z,
        },
      };
    }
    return transformed;
  });
}

export async function validateManualTwin({
  floorplan,
  registration,
  editorDocument,
  policy = defaultManualTwinValidationPolicy(),
}: {
  floorplan: FloorplanImportReport;
  registration: RegistrationReport;
  editorDocument: SpatialEditorDocument;
  policy?: ManualTwinValidationPolicy;
}): Promise<ManualTwinValidationReport> {
  validatePolicy(policy);
  const issues: ManualTwinValidationIssue[] = [];
  const features = editorDocument.features;
  const assets = features.filter((feature) => feature.kind === "ASSET");
  const zones = features.filter((feature) => feature.kind === "ZONE");
  const nodes = features.filter((feature) => feature.kind === "NODE");
  const edges = features.filter((feature) => feature.kind === "EDGE");
  if (floorplan.canonicalFrameId !== registration.canonicalFrameId) {
    issues.push(issue("ERROR", "MANUAL_TWIN_FRAME_MISMATCH", "Floorplan and registration canonical frames differ."));
  }
  if (registration.metrics.rmseMetres > policy.maximumRegistrationRmseMetres) {
    issues.push(issue("ERROR", "REGISTRATION_RMSE_EXCEEDED", `Registration RMSE is ${registration.metrics.rmseMetres} m.`));
  }
  if (registration.metrics.scaleDeviation > policy.maximumScaleDeviation) {
    issues.push(issue("ERROR", "REGISTRATION_SCALE_DEVIATION", `Registration scale deviation is ${registration.metrics.scaleDeviation}.`));
  }
  if (assets.length < policy.minimumAssets) {
    issues.push(issue("ERROR", "ASSET_COUNT_INSUFFICIENT", `At least ${policy.minimumAssets} assets are required.`));
  }
  if (zones.length < policy.minimumZones) {
    issues.push(issue("ERROR", "ZONE_COUNT_INSUFFICIENT", `At least ${policy.minimumZones} zones are required.`));
  }
  if (nodes.length < policy.minimumTopologyNodes) {
    issues.push(issue("ERROR", "TOPOLOGY_NODE_COUNT_INSUFFICIENT", `At least ${policy.minimumTopologyNodes} topology nodes are required.`));
  }
  if (policy.requireConnectedTopology && nodes.length >= policy.minimumTopologyNodes && !topologyConnected(features)) {
    issues.push(issue("ERROR", "TOPOLOGY_DISCONNECTED", "Every topology node must be connected to the same graph."));
  }
  const transformedBounds = transformBounds(floorplan.bounds, registration.transform);
  for (const asset of assets) {
    if (asset.kind === "ASSET" && !pointInsideBounds(asset.center, transformedBounds)) {
      issues.push(issue("WARNING", "ASSET_OUTSIDE_FLOORPLAN", "Asset centre lies outside the aligned floorplan bounds.", asset.featureId));
    }
  }
  const errorCount = issues.filter((candidate) => candidate.severity === "ERROR").length;
  const inputSha256 = await manualTwinInputSha256(floorplan, registration, editorDocument);
  return deepFreeze({
    schemaVersion: MANUAL_TWIN_VALIDATION_SCHEMA_VERSION,
    inputSha256,
    policy: structuredClone(policy),
    valid: errorCount === 0,
    summary: {
      errorCount,
      warningCount: issues.length - errorCount,
      assetCount: assets.length,
      zoneCount: zones.length,
      topologyNodeCount: nodes.length,
      topologyEdgeCount: edges.length,
    },
    issues,
  });
}

export function diffSpatialDocuments(
  baseline: readonly Readonly<SpatialFeature>[],
  current: readonly Readonly<SpatialFeature>[],
): SpatialDocumentDiff {
  const baselineById = new Map(baseline.map((feature) => [feature.featureId, canonicalJson(feature)]));
  const currentById = new Map(current.map((feature) => [feature.featureId, canonicalJson(feature)]));
  const added = [...currentById.keys()].filter((id) => !baselineById.has(id)).sort();
  const removed = [...baselineById.keys()].filter((id) => !currentById.has(id)).sort();
  const modified = [...currentById.keys()].filter((id) => baselineById.has(id) && baselineById.get(id) !== currentById.get(id)).sort();
  const unchanged = [...currentById.keys()].filter((id) => baselineById.get(id) === currentById.get(id)).sort();
  return deepFreeze({
    added,
    removed,
    modified,
    unchanged,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount: unchanged.length,
    },
  });
}

export async function publishManualTwinRelease({
  mapReleaseId,
  familyId,
  revision,
  canonicalFrameId,
  publishedAt,
  requestedBy,
  approvedBy,
  floorplan,
  registration,
  editorDocument,
  validation,
  diff,
  worldEntities,
}: {
  mapReleaseId: string;
  familyId: string;
  revision: number;
  canonicalFrameId: string;
  publishedAt: string;
  requestedBy: string;
  approvedBy: string;
  floorplan: FloorplanImportReport;
  registration: RegistrationReport;
  editorDocument: SpatialEditorDocument;
  validation: ManualTwinValidationReport;
  diff: SpatialDocumentDiff;
  worldEntities: WorldEntity[];
}): Promise<ManualTwinRelease> {
  requiredIdentifier(mapReleaseId, "mapReleaseId");
  requiredIdentifier(familyId, "familyId");
  requiredIdentifier(canonicalFrameId, "canonicalFrameId");
  requiredIdentifier(requestedBy, "requestedBy");
  requiredIdentifier(approvedBy, "approvedBy");
  if (requestedBy === approvedBy) {
    throw new ManualTwinError("MANUAL_TWIN_SELF_APPROVAL", "Requester and approver must be different identities.");
  }
  if (!Number.isInteger(revision) || revision < 1) {
    throw new ManualTwinError("MANUAL_TWIN_REVISION_INVALID", "Release revision must be a positive integer.");
  }
  if (!Number.isFinite(Date.parse(publishedAt))) {
    throw new ManualTwinError("MANUAL_TWIN_TIMESTAMP_INVALID", "publishedAt must be an ISO date-time.");
  }
  if (!validation.valid || validation.summary.errorCount !== 0) {
    throw new ManualTwinError("MANUAL_TWIN_VALIDATION_REQUIRED", "A passing validation report is required.");
  }
  const currentInputSha256 = await manualTwinInputSha256(floorplan, registration, editorDocument);
  if (currentInputSha256 !== validation.inputSha256) {
    throw new ManualTwinError("MANUAL_TWIN_VALIDATION_STALE", "Validation evidence does not match current milestone inputs.");
  }
  if (canonicalFrameId !== floorplan.canonicalFrameId || canonicalFrameId !== registration.canonicalFrameId) {
    throw new ManualTwinError("MANUAL_TWIN_FRAME_MISMATCH", "Release inputs do not share the canonical frame.");
  }
  const snapshot = {
    floorplanSourceSha256: floorplan.source.sha256,
    floorplanConfigurationSha256: floorplan.configuration.sha256,
    registration: structuredClone(registration),
    editorDocument: structuredClone(editorDocument),
    validation: structuredClone(validation),
    diff: structuredClone(diff),
    worldEntities: structuredClone(worldEntities),
  };
  const snapshotSha256 = await sha256Canonical(snapshot);
  const releaseHeader = {
    schemaVersion: MANUAL_TWIN_RELEASE_SCHEMA_VERSION as typeof MANUAL_TWIN_RELEASE_SCHEMA_VERSION,
    mapReleaseId,
    familyId,
    revision,
    canonicalFrameId,
    status: "PUBLISHED" as const,
    publishedAt,
    approvals: { requestedBy, approvedBy },
    snapshotSha256,
  };
  const releaseSha256 = await sha256Canonical(releaseHeader);
  return deepFreeze({ ...releaseHeader, releaseSha256, snapshot });
}

export function defaultManualTwinValidationPolicy(): ManualTwinValidationPolicy {
  return {
    maximumRegistrationRmseMetres: 0.05,
    maximumScaleDeviation: 0.02,
    minimumAssets: 4,
    minimumZones: 2,
    minimumTopologyNodes: 2,
    requireConnectedTopology: true,
  };
}

async function manualTwinInputSha256(
  floorplan: FloorplanImportReport,
  registration: RegistrationReport,
  editorDocument: SpatialEditorDocument,
): Promise<string> {
  return sha256Canonical({
    floorplanSourceSha256: floorplan.source.sha256,
    floorplanConfigurationSha256: floorplan.configuration.sha256,
    registration,
    editorDocument,
  });
}

function normalizeControlPoints(controlPoints: ControlPointPair[]): ControlPointPair[] {
  if (!Array.isArray(controlPoints) || controlPoints.length < 3 || controlPoints.length > MAX_CONTROL_POINTS) {
    throw new ManualTwinError("REGISTRATION_CONTROL_POINT_COUNT", `Registration requires 3 to ${MAX_CONTROL_POINTS} control points.`);
  }
  const ids = new Set<string>();
  return controlPoints.map((pair, index) => {
    requiredIdentifier(pair?.controlPointId, `controlPoints[${index}].controlPointId`);
    if (ids.has(pair.controlPointId)) throw new ManualTwinError("REGISTRATION_CONTROL_POINT_DUPLICATE", `Control point ${pair.controlPointId} is duplicated.`);
    ids.add(pair.controlPointId);
    return {
      controlPointId: pair.controlPointId,
      source: finitePoint(pair.source, `controlPoints[${index}].source`),
      target: finitePoint(pair.target, `controlPoints[${index}].target`),
    };
  });
}

function centroid(points: Point2D[]): Point2D {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function topologyConnected(features: readonly Readonly<SpatialFeature>[]): boolean {
  const nodes = features.filter((feature) => feature.kind === "NODE");
  if (nodes.length === 0) return false;
  const adjacency = new Map(nodes.map((node) => [node.featureId, new Set<string>()]));
  for (const feature of features) {
    if (feature.kind !== "EDGE") continue;
    adjacency.get(feature.fromNodeId)?.add(feature.toNodeId);
    adjacency.get(feature.toNodeId)?.add(feature.fromNodeId);
  }
  const visited = new Set<string>();
  const queue = [nodes[0]!.featureId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    adjacency.get(current)?.forEach((candidate) => { if (!visited.has(candidate)) queue.push(candidate); });
  }
  return visited.size === nodes.length;
}

function transformBounds(
  bounds: FloorplanImportReport["bounds"],
  transform: SimilarityTransform2D,
): FloorplanImportReport["bounds"] {
  const corners = [
    { x: bounds.minimum.x, y: bounds.minimum.y },
    { x: bounds.maximum.x, y: bounds.minimum.y },
    { x: bounds.maximum.x, y: bounds.maximum.y },
    { x: bounds.minimum.x, y: bounds.maximum.y },
  ].map((point) => applySimilarity2D(transform, point));
  return {
    minimum: { x: Math.min(...corners.map((point) => point.x)), y: Math.min(...corners.map((point) => point.y)), z: bounds.minimum.z },
    maximum: { x: Math.max(...corners.map((point) => point.x)), y: Math.max(...corners.map((point) => point.y)), z: bounds.maximum.z },
  };
}

function pointInsideBounds(point: Vector3Value, bounds: FloorplanImportReport["bounds"]): boolean {
  return point.x >= bounds.minimum.x && point.x <= bounds.maximum.x
    && point.y >= bounds.minimum.y && point.y <= bounds.maximum.y;
}

function validatePolicy(policy: ManualTwinValidationPolicy): void {
  for (const field of ["maximumRegistrationRmseMetres", "maximumScaleDeviation"] as const) {
    if (!Number.isFinite(policy[field]) || policy[field] < 0) throw new ManualTwinError("MANUAL_TWIN_POLICY_INVALID", `${field} must be non-negative.`);
  }
  for (const field of ["minimumAssets", "minimumZones", "minimumTopologyNodes"] as const) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0) throw new ManualTwinError("MANUAL_TWIN_POLICY_INVALID", `${field} must be a non-negative integer.`);
  }
}

function finitePoint(point: Point2D, field: string): Point2D {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new ManualTwinError("REGISTRATION_POINT_INVALID", `${field} must contain finite X and Y coordinates.`);
  }
  if (Math.abs(point.x) > 1_000_000 || Math.abs(point.y) > 1_000_000) {
    throw new ManualTwinError("REGISTRATION_POINT_OUT_OF_RANGE", `${field} exceeds the coordinate limit.`);
  }
  return roundedPoint(point);
}

function issue(
  severity: ManualTwinValidationIssue["severity"],
  code: string,
  message: string,
  featureId?: string,
): ManualTwinValidationIssue {
  return featureId ? { severity, code, message, featureId } : { severity, code, message };
}

function requiredIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/.test(value)) {
    throw new ManualTwinError("MANUAL_TWIN_IDENTIFIER_INVALID", `${field} must be a safe identifier.`);
  }
}

function roundedPoint(point: Point2D): Point2D {
  return { x: round(point.x), y: round(point.y) };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}
