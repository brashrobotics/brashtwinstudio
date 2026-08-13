import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import {
  ARTIFACT_ROLES,
  CONTRACT_VERSIONS,
  REQUIRED_BUNDLE_ARTIFACT_ROLES,
} from "@brash-twin/contracts";
import { CoordinateFrameGraph } from "@brash-twin/coordinate-frames";

export class BundleValidationError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "BundleValidationError";
    this.report = report;
  }
}

export async function validateBundleDirectory(bundleDirectory, options = {}) {
  const verifyChecksums = options.verifyChecksums ?? true;
  const absoluteDirectory = resolve(bundleDirectory);
  const errors = [];
  const warnings = [];
  const documents = new Map();
  let manifest = null;

  try {
    const manifestPath = resolve(absoluteDirectory, "manifest.json");
    const manifestMetadata = await lstat(manifestPath);
    if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) throw new Error("Manifest must be a regular file.");
    manifest = await readJson(manifestPath);
  } catch (error) {
    issue(errors, "MANIFEST_UNREADABLE", "manifest.json", error.message);
    return report(false, errors, warnings, null);
  }

  validateManifest(manifest, errors, warnings);
  if (!Array.isArray(manifest.artifacts)) {
    return report(false, errors, warnings, summaryFrom(manifest, documents));
  }

  const roles = new Map();
  const paths = new Set();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const artifactPath = `artifacts[${index}]`;
    if (!isRecord(artifact)) {
      issue(errors, "ARTIFACT_INVALID", artifactPath, "Artifact must be an object.");
      continue;
    }
    if (!nonEmptyString(artifact.role)) issue(errors, "ARTIFACT_ROLE_REQUIRED", `${artifactPath}.role`, "Role is required.");
    if (!nonEmptyString(artifact.path)) {
      issue(errors, "ARTIFACT_PATH_REQUIRED", `${artifactPath}.path`, "Path is required.");
      continue;
    }
    if (roles.has(artifact.role)) {
      issue(errors, "ARTIFACT_ROLE_DUPLICATE", `${artifactPath}.role`, `Role ${artifact.role} is declared more than once.`);
    } else {
      roles.set(artifact.role, artifact);
    }
    if (paths.has(artifact.path)) {
      issue(errors, "ARTIFACT_PATH_DUPLICATE", `${artifactPath}.path`, `Path ${artifact.path} is declared more than once.`);
    }
    paths.add(artifact.path);

    const safePath = resolveArtifactPath(absoluteDirectory, artifact.path);
    if (!safePath) {
      issue(errors, "ARTIFACT_PATH_UNSAFE", `${artifactPath}.path`, "Artifact path must remain inside the bundle directory.");
      continue;
    }
    try {
      const content = await readFile(safePath);
      const metadata = await lstat(safePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Artifact must be a regular file.");
      if (artifact.bytes !== content.byteLength) {
        issue(errors, "ARTIFACT_SIZE_MISMATCH", `${artifactPath}.bytes`, `Declared ${artifact.bytes}; actual ${content.byteLength}.`);
      }
      if (verifyChecksums) {
        const digest = createHash("sha256").update(content).digest("hex");
        if (artifact.sha256 !== digest) {
          issue(errors, "ARTIFACT_CHECKSUM_MISMATCH", `${artifactPath}.sha256`, `Checksum does not match ${artifact.path}.`);
        }
      }
      if (artifact.mediaType === "application/json" || artifact.mediaType === "application/geo+json") {
        try {
          documents.set(artifact.role, JSON.parse(content.toString("utf8")));
        } catch (error) {
          issue(errors, "ARTIFACT_JSON_INVALID", artifact.path, error.message);
        }
      }
    } catch (error) {
      issue(errors, "ARTIFACT_UNREADABLE", artifact.path, error.message);
    }
  }

  for (const role of REQUIRED_BUNDLE_ARTIFACT_ROLES) {
    if (!roles.has(role)) issue(errors, "ARTIFACT_REQUIRED", "artifacts", `Required artifact role ${role} is missing.`);
  }

  validateDocuments(manifest, documents, errors, warnings);
  return report(errors.length === 0, errors, warnings, summaryFrom(manifest, documents));
}

export async function inspectBundleDirectory(bundleDirectory) {
  const validation = await validateBundleDirectory(bundleDirectory);
  if (!validation.valid) throw new BundleValidationError("Bundle is invalid.", validation);
  const documents = await loadDocuments(bundleDirectory);
  return {
    ...validation.summary,
    artifactRoles: documents.manifest.artifacts.map((artifact) => artifact.role),
    semanticClasses: countBy(documents.assets.assets, (asset) => asset.semanticClass),
    nodeKinds: countBy(documents.topology.nodes, (node) => node.kind),
  };
}

export async function diffBundleDirectories(leftDirectory, rightDirectory) {
  const [leftValidation, rightValidation] = await Promise.all([
    validateBundleDirectory(leftDirectory),
    validateBundleDirectory(rightDirectory),
  ]);
  if (!leftValidation.valid) throw new BundleValidationError("Left bundle is invalid.", leftValidation);
  if (!rightValidation.valid) throw new BundleValidationError("Right bundle is invalid.", rightValidation);
  const [left, right] = await Promise.all([loadDocuments(leftDirectory), loadDocuments(rightDirectory)]);
  return {
    fromReleaseId: left.manifest.mapReleaseId,
    toReleaseId: right.manifest.mapReleaseId,
    canonicalFrameChanged: left.manifest.canonicalFrameId !== right.manifest.canonicalFrameId,
    nodes: setDiff(left.topology.nodes, right.topology.nodes, (value) => value.nodeId),
    edges: setDiff(left.topology.edges, right.topology.edges, (value) => value.edgeId),
    assets: setDiff(left.assets.assets, right.assets.assets, (value) => value.assetId),
  };
}

function validateManifest(manifest, errors, warnings) {
  if (!isRecord(manifest)) {
    issue(errors, "MANIFEST_INVALID", "manifest.json", "Manifest must be an object.");
    return;
  }
  equal(manifest.schemaVersion, CONTRACT_VERSIONS.twinMapBundle, errors, "schemaVersion", "MANIFEST_SCHEMA_UNSUPPORTED");
  for (const field of ["bundleId", "mapReleaseId", "familyId", "canonicalFrameId", "createdAt"]) {
    if (!nonEmptyString(manifest[field])) issue(errors, "MANIFEST_FIELD_REQUIRED", field, `${field} is required.`);
  }
  if (!Number.isInteger(manifest.revision) || manifest.revision < 1) {
    issue(errors, "MAP_REVISION_INVALID", "revision", "Revision must be a positive integer.");
  }
  equal(manifest.status, "PUBLISHED", errors, "status", "MAP_RELEASE_NOT_PUBLISHED");
  if (manifest.units?.length !== "m" || manifest.units?.angle !== "rad") {
    issue(errors, "MAP_UNITS_INVALID", "units", "Canonical bundle units must be metres and radians.");
  }
  validateBounds(manifest.bounds, errors, "bounds");
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    issue(errors, "ARTIFACTS_REQUIRED", "artifacts", "Manifest must declare at least one artifact.");
  }
  if (!Number.isFinite(Date.parse(manifest.createdAt))) {
    issue(errors, "MANIFEST_DATE_INVALID", "createdAt", "createdAt must be an ISO date-time.");
  }
  if (manifest.validationReportSha256 !== undefined
    && !/^[a-f0-9]{64}$/.test(manifest.validationReportSha256)) {
    issue(
      errors,
      "VALIDATION_REPORT_HASH_INVALID",
      "validationReportSha256",
      "validationReportSha256 must be 64 lowercase hexadecimal characters.",
    );
  }
  if (manifest.compatibility?.navigationTopologyContract !== CONTRACT_VERSIONS.topology) {
    issue(errors, "TOPOLOGY_CONTRACT_UNSUPPORTED", "compatibility.navigationTopologyContract", "Unsupported topology contract.");
  }
  if (manifest.compatibility?.sceneManifestContract !== CONTRACT_VERSIONS.sceneManifest) {
    issue(errors, "SCENE_CONTRACT_UNSUPPORTED", "compatibility.sceneManifestContract", "Unsupported scene contract.");
  }
  if (manifest.mapReleaseId && manifest.familyId && Number.isInteger(manifest.revision)) {
    const conventionalId = `${manifest.familyId}@${manifest.revision}`;
    if (manifest.mapReleaseId !== conventionalId) {
      issue(warnings, "MAP_RELEASE_ID_NONSTANDARD", "mapReleaseId", `Expected conventional release ID ${conventionalId}.`);
    }
  }
}

function validateDocuments(manifest, documents, errors, warnings) {
  const frames = documents.get(ARTIFACT_ROLES.coordinateFrames);
  const topology = documents.get(ARTIFACT_ROLES.topology);
  const assets = documents.get(ARTIFACT_ROLES.twinAssets);
  const zones = documents.get(ARTIFACT_ROLES.zones);
  const scene = documents.get(ARTIFACT_ROLES.sceneManifest);

  let frameGraph = null;
  if (frames) {
    equal(frames.schemaVersion, CONTRACT_VERSIONS.coordinateFrames, errors, "coordinate-frames.schemaVersion", "FRAMES_SCHEMA_UNSUPPORTED");
    equal(frames.mapReleaseId, manifest.mapReleaseId, errors, "coordinate-frames.mapReleaseId", "MAP_RELEASE_MISMATCH");
    equal(frames.canonicalFrameId, manifest.canonicalFrameId, errors, "coordinate-frames.canonicalFrameId", "CANONICAL_FRAME_MISMATCH");
    try {
      frameGraph = new CoordinateFrameGraph(frames.frames);
      if (!frameGraph.has(manifest.canonicalFrameId)) throw new Error(`Canonical frame ${manifest.canonicalFrameId} was not found.`);
    } catch (error) {
      issue(errors, "COORDINATE_FRAME_INVALID", "coordinate-frames.frames", error.message);
    }
  }

  const nodeIds = new Set();
  const edgeIds = new Set();
  if (topology) {
    equal(topology.schemaVersion, CONTRACT_VERSIONS.topology, errors, "topology.schemaVersion", "TOPOLOGY_SCHEMA_UNSUPPORTED");
    equal(topology.mapReleaseId, manifest.mapReleaseId, errors, "topology.mapReleaseId", "MAP_RELEASE_MISMATCH");
    if (frameGraph && !frameGraph.has(topology.frameId)) issue(errors, "TOPOLOGY_FRAME_UNKNOWN", "topology.frameId", `Unknown frame ${topology.frameId}.`);
    if (!Array.isArray(topology.nodes) || topology.nodes.length === 0) {
      issue(errors, "TOPOLOGY_NODE_REQUIRED", "topology.nodes", "Topology needs at least one node.");
    } else {
      topology.nodes.forEach((node, index) => {
        const path = `topology.nodes[${index}]`;
        uniqueId(node?.nodeId, nodeIds, errors, path, "NODE");
        if (!nonEmptyString(node?.label)) issue(errors, "NODE_LABEL_REQUIRED", `${path}.label`, "Node label is required.");
        if (!["WAYPOINT", "INTERSECTION", "STATION", "HOLDING_POINT"].includes(node?.kind)) {
          issue(errors, "NODE_KIND_INVALID", `${path}.kind`, "Unsupported node kind.");
        }
        vector3(node?.position, errors, `${path}.position`);
      });
    }
    if (!Array.isArray(topology.edges)) {
      issue(errors, "TOPOLOGY_EDGES_INVALID", "topology.edges", "Topology edges must be an array.");
    } else {
      topology.edges.forEach((edge, index) => {
        const path = `topology.edges[${index}]`;
        uniqueId(edge?.edgeId, edgeIds, errors, path, "EDGE");
        if (!nodeIds.has(edge?.fromNodeId) || !nodeIds.has(edge?.toNodeId)) {
          issue(errors, "EDGE_NODE_UNKNOWN", path, `Edge ${edge?.edgeId ?? "<unknown>"} references an unknown node.`);
        }
        if (edge?.fromNodeId === edge?.toNodeId) issue(errors, "EDGE_LOOP_INVALID", path, "An edge cannot connect a node to itself.");
        positiveNumber(edge?.lengthMeters, errors, `${path}.lengthMeters`);
        positiveNumber(edge?.travelTimeSeconds, errors, `${path}.travelTimeSeconds`);
        if (typeof edge?.directed !== "boolean") issue(errors, "EDGE_DIRECTION_INVALID", `${path}.directed`, "directed must be boolean.");
      });
      const disconnected = disconnectedNodeIds(topology.nodes ?? [], topology.edges);
      if (disconnected.length > 0) {
        issue(warnings, "TOPOLOGY_DISCONNECTED", "topology", `Disconnected nodes: ${disconnected.join(", ")}.`);
      }
    }
  }

  if (zones) validateZones(zones, manifest, errors);
  const zoneIds = new Set((zones?.features ?? []).map((feature) => feature?.properties?.zoneId).filter(nonEmptyString));

  if (assets) {
    equal(assets.schemaVersion, CONTRACT_VERSIONS.twinAssets, errors, "assets.schemaVersion", "ASSETS_SCHEMA_UNSUPPORTED");
    equal(assets.mapReleaseId, manifest.mapReleaseId, errors, "assets.mapReleaseId", "MAP_RELEASE_MISMATCH");
    if (!Array.isArray(assets.assets)) {
      issue(errors, "ASSETS_INVALID", "assets.assets", "Assets must be an array.");
    } else {
      const assetIds = new Set();
      assets.assets.forEach((asset, index) => {
        const path = `assets.assets[${index}]`;
        uniqueId(asset?.assetId, assetIds, errors, path, "ASSET");
        if (frameGraph && !frameGraph.has(asset?.frameId)) issue(errors, "ASSET_FRAME_UNKNOWN", `${path}.frameId`, `Unknown frame ${asset?.frameId}.`);
        vector3(asset?.pose?.position, errors, `${path}.pose.position`);
        for (const binding of asset?.topologyBindings ?? []) {
          const known = binding.kind === "NODE" ? nodeIds.has(binding.targetId)
            : binding.kind === "EDGE" ? edgeIds.has(binding.targetId)
              : binding.kind === "ZONE" ? zoneIds.has(binding.targetId) : false;
          if (!known) issue(errors, "ASSET_BINDING_UNKNOWN", `${path}.topologyBindings`, `Unknown ${binding.kind} binding ${binding.targetId}.`);
        }
      });
    }
  }

  if (scene) {
    equal(scene.schemaVersion, CONTRACT_VERSIONS.sceneManifest, errors, "scene.schemaVersion", "SCENE_SCHEMA_UNSUPPORTED");
    equal(scene.mapReleaseId, manifest.mapReleaseId, errors, "scene.mapReleaseId", "MAP_RELEASE_MISMATCH");
    if (frameGraph && !frameGraph.has(scene.frameId)) issue(errors, "SCENE_FRAME_UNKNOWN", "scene.frameId", `Unknown frame ${scene.frameId}.`);
    validateBounds(scene.bounds, errors, "scene.bounds");
  }
}

function validateZones(zones, manifest, errors) {
  if (zones?.type !== "FeatureCollection" || !Array.isArray(zones.features)) {
    issue(errors, "ZONES_GEOJSON_INVALID", "zones", "Zones must be a GeoJSON FeatureCollection.");
    return;
  }
  const ids = new Set();
  zones.features.forEach((feature, index) => {
    const zoneId = feature?.properties?.zoneId;
    uniqueId(zoneId, ids, errors, `zones.features[${index}]`, "ZONE");
    if (feature?.properties?.mapReleaseId !== manifest.mapReleaseId) {
      issue(errors, "MAP_RELEASE_MISMATCH", `zones.features[${index}].properties.mapReleaseId`, "Zone belongs to another release.");
    }
    if (!["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)) {
      issue(errors, "ZONE_GEOMETRY_INVALID", `zones.features[${index}].geometry`, "Zone geometry must be Polygon or MultiPolygon.");
    }
  });
}

async function loadDocuments(bundleDirectory) {
  const directory = resolve(bundleDirectory);
  const manifest = await readJson(resolve(directory, "manifest.json"));
  const byRole = new Map(manifest.artifacts.map((artifact) => [artifact.role, artifact]));
  const load = (role) => readJson(resolveArtifactPath(directory, byRole.get(role).path));
  return {
    manifest,
    frames: await load(ARTIFACT_ROLES.coordinateFrames),
    topology: await load(ARTIFACT_ROLES.topology),
    assets: await load(ARTIFACT_ROLES.twinAssets),
    zones: await load(ARTIFACT_ROLES.zones),
    scene: await load(ARTIFACT_ROLES.sceneManifest),
  };
}

function resolveArtifactPath(directory, artifactPath) {
  if (isAbsolute(artifactPath)) return null;
  const normalized = normalize(artifactPath);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${sep}`)) return null;
  const resolved = resolve(directory, normalized);
  const relation = relative(directory, resolved);
  if (relation.startsWith("..") || isAbsolute(relation)) return null;
  return resolved;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function report(valid, errors, warnings, summary) {
  return { valid, errors, warnings, summary };
}

function summaryFrom(manifest, documents) {
  if (!manifest) return null;
  const topology = documents.get(ARTIFACT_ROLES.topology);
  const assets = documents.get(ARTIFACT_ROLES.twinAssets);
  const zones = documents.get(ARTIFACT_ROLES.zones);
  return {
    bundleId: manifest.bundleId ?? null,
    mapReleaseId: manifest.mapReleaseId ?? null,
    revision: manifest.revision ?? null,
    canonicalFrameId: manifest.canonicalFrameId ?? null,
    artifactCount: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
    nodeCount: topology?.nodes?.length ?? 0,
    edgeCount: topology?.edges?.length ?? 0,
    assetCount: assets?.assets?.length ?? 0,
    zoneCount: zones?.features?.length ?? 0,
  };
}

function disconnectedNodeIds(nodes, edges) {
  if (nodes.length === 0) return [];
  const adjacency = new Map(nodes.map((node) => [node.nodeId, []]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.push(edge.fromNodeId);
  }
  const visited = new Set();
  const queue = [nodes[0].nodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    queue.push(...(adjacency.get(nodeId) ?? []).filter((candidate) => !visited.has(candidate)));
  }
  return nodes.map((node) => node.nodeId).filter((nodeId) => !visited.has(nodeId));
}

function setDiff(left, right, idOf) {
  const leftById = new Map(left.map((value) => [idOf(value), value]));
  const rightById = new Map(right.map((value) => [idOf(value), value]));
  return {
    added: [...rightById.keys()].filter((id) => !leftById.has(id)).sort(),
    removed: [...leftById.keys()].filter((id) => !rightById.has(id)).sort(),
    modified: [...leftById.keys()]
      .filter((id) => rightById.has(id) && JSON.stringify(leftById.get(id)) !== JSON.stringify(rightById.get(id)))
      .sort(),
  };
}

function countBy(values, classifier) {
  const counts = {};
  for (const value of values) {
    const key = classifier(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function validateBounds(bounds, errors, path) {
  if (!bounds) {
    issue(errors, "BOUNDS_REQUIRED", path, "Bounds are required.");
    return;
  }
  vector3(bounds.minimum, errors, `${path}.minimum`);
  vector3(bounds.maximum, errors, `${path}.maximum`);
  if (bounds.minimum && bounds.maximum && ["x", "y", "z"].some((axis) => bounds.minimum[axis] > bounds.maximum[axis])) {
    issue(errors, "BOUNDS_ORDER_INVALID", path, "Bounds minimum cannot exceed maximum.");
  }
}

function vector3(value, errors, path) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    issue(errors, "VECTOR3_INVALID", path, "Expected finite x, y, and z coordinates.");
  }
}

function positiveNumber(value, errors, path) {
  if (!Number.isFinite(value) || value <= 0) issue(errors, "POSITIVE_NUMBER_REQUIRED", path, "Expected a positive number.");
}

function uniqueId(id, known, errors, path, kind) {
  if (!nonEmptyString(id)) {
    issue(errors, `${kind}_ID_REQUIRED`, `${path}.${kind.toLowerCase()}Id`, `${kind} ID is required.`);
  } else if (known.has(id)) {
    issue(errors, `${kind}_ID_DUPLICATE`, `${path}.${kind.toLowerCase()}Id`, `Duplicate ${kind.toLowerCase()} ID ${id}.`);
  } else {
    known.add(id);
  }
}

function equal(actual, expected, errors, path, code) {
  if (actual !== expected) issue(errors, code, path, `Expected ${expected}; received ${String(actual)}.`);
}

function issue(collection, code, path, message) {
  collection.push({ code, path, message });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
