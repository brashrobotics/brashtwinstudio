import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ARTIFACT_ROLES, CONTRACT_VERSIONS } from "@brash-twin/contracts";
import { validateBundleDirectory } from "@brash-twin/validation";

const CORE_SCENE_INPUT_ROLES = Object.freeze([
  ARTIFACT_ROLES.coordinateFrames,
  ARTIFACT_ROLES.topology,
  ARTIFACT_ROLES.twinAssets,
  ARTIFACT_ROLES.zones,
]);
const DEFAULT_CONFIGURATION = Object.freeze({
  producerName: "brash-scene-worker",
  producerVersion: "1.0.0",
  tileSizeMeters: 16,
  maximumTileCount: 256,
  maximumLevelsPerTile: 2,
  maximumTileBytes: 4 * 1024 * 1024,
});

export class ScenePipelineError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ScenePipelineError";
    this.code = code;
    this.report = options.report;
  }
}

export async function packageOptimizedScene({
  sourceBundleDirectory,
  targetBundleDirectory,
  validationReportSha256,
  configuration = {},
} = {}) {
  const source = requiredDirectory(sourceBundleDirectory, "sourceBundleDirectory");
  const target = requiredDirectory(targetBundleDirectory, "targetBundleDirectory");
  if (source === target) fail("SCENE_TARGET_INVALID", "Source and target bundle directories must differ.");
  await assertTargetMissing(target);

  const sourceValidation = await validateBundleDirectory(source);
  if (!sourceValidation.valid) {
    throw new ScenePipelineError("SCENE_SOURCE_INVALID", "Source bundle failed validation.", { report: sourceValidation });
  }
  const sourceManifestBytes = await readFile(join(source, "manifest.json"));
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8"));
  const normalizedConfiguration = normalizeConfiguration(configuration);
  const configurationSha256 = sha256(canonicalJson(normalizedConfiguration));
  const sealedValidationSha256 = validationReportSha256 ?? sourceManifest.validationReportSha256;
  if (!sha256Value(sealedValidationSha256)) {
    fail("SCENE_VALIDATION_EVIDENCE_REQUIRED", "A sealed validationReportSha256 is required for Bundle v2.");
  }

  const artifactsByRole = new Map(sourceManifest.artifacts.map((artifact) => [artifact.role, artifact]));
  const inputArtifacts = CORE_SCENE_INPUT_ROLES.map((role) => {
    const artifact = artifactsByRole.get(role);
    if (!artifact) fail("SCENE_INPUT_REQUIRED", `Source bundle is missing ${role}.`);
    return Object.freeze({ role, sha256: artifact.sha256 });
  });
  const assets = await readArtifactJson(source, artifactsByRole.get(ARTIFACT_ROLES.twinAssets));
  const scenePlan = createScenePlan(sourceManifest, assets, normalizedConfiguration);

  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), `.scene-package-${basename(target)}-`));
  try {
    await cp(source, staging, { recursive: true, errorOnExist: true });
    await rm(join(staging, "scene"), { recursive: true, force: true });
    await mkdir(join(staging, "scene", "tiles"), { recursive: true });

    const sceneTiles = [];
    const tileArtifacts = [];
    let totalTileBytes = 0;
    for (const tile of scenePlan) {
      const levels = [];
      for (let level = 0; level < normalizedConfiguration.maximumLevelsPerTile; level += 1) {
        const path = `scene/tiles/${tile.tileId}-lod${level}.glb`;
        const content = createTileGlb({
          tile,
          level,
          producerVersion: normalizedConfiguration.producerVersion,
        });
        if (content.byteLength > normalizedConfiguration.maximumTileBytes) {
          fail("SCENE_TILE_BUDGET_EXCEEDED", `${path} exceeds the configured byte budget.`);
        }
        await writeFile(join(staging, path), content, { flag: "wx" });
        const identity = Object.freeze({
          role: ARTIFACT_ROLES.sceneTileset,
          path,
          mediaType: "model/gltf-binary",
          sha256: sha256(content),
          bytes: content.byteLength,
        });
        tileArtifacts.push(identity);
        levels.push(Object.freeze({
          level,
          path,
          mediaType: identity.mediaType,
          sha256: identity.sha256,
          bytes: identity.bytes,
          maximumScreenError: level === 0 ? 1 : 12,
          geometricErrorMeters: level === 0 ? 0.02 : 0.5,
        }));
        totalTileBytes += content.byteLength;
      }
      sceneTiles.push(Object.freeze({
        tileId: tile.tileId,
        bounds: tile.bounds,
        assetIds: Object.freeze(tile.assets.map((asset) => asset.assetId).sort()),
        levels: Object.freeze(levels),
      }));
    }

    const sceneManifest = Object.freeze({
      schemaVersion: CONTRACT_VERSIONS.sceneManifest,
      mapReleaseId: sourceManifest.mapReleaseId,
      frameId: sourceManifest.canonicalFrameId,
      bounds: sourceManifest.bounds,
      producer: Object.freeze({
        name: normalizedConfiguration.producerName,
        version: normalizedConfiguration.producerVersion,
        configurationSha256,
        inputArtifacts: Object.freeze(inputArtifacts),
      }),
      budgets: Object.freeze({
        tileSizeMeters: normalizedConfiguration.tileSizeMeters,
        maximumTileCount: normalizedConfiguration.maximumTileCount,
        maximumLevelsPerTile: normalizedConfiguration.maximumLevelsPerTile,
        maximumTileBytes: normalizedConfiguration.maximumTileBytes,
        totalTileBytes,
      }),
      tiles: Object.freeze(sceneTiles),
    });
    const sceneManifestBytes = Buffer.from(canonicalJson(sceneManifest));
    await writeFile(join(staging, "scene", "manifest.json"), sceneManifestBytes, { flag: "wx" });
    const sceneManifestArtifact = Object.freeze({
      role: ARTIFACT_ROLES.sceneManifest,
      path: "scene/manifest.json",
      mediaType: "application/json",
      sha256: sha256(sceneManifestBytes),
      bytes: sceneManifestBytes.byteLength,
    });
    const retainedArtifacts = sourceManifest.artifacts.filter(
      (artifact) => ![ARTIFACT_ROLES.sceneManifest, ARTIFACT_ROLES.sceneTileset].includes(artifact.role),
    );
    const bundleIdentitySeed = canonicalJson({
      mapReleaseId: sourceManifest.mapReleaseId,
      inputManifestSha256: sha256(sourceManifestBytes),
      configurationSha256,
      sceneManifestSha256: sceneManifestArtifact.sha256,
    });
    const outputManifest = {
      ...sourceManifest,
      schemaVersion: CONTRACT_VERSIONS.twinMapBundle,
      bundleId: `bundle-${slug(sourceManifest.mapReleaseId)}-${sha256(bundleIdentitySeed).slice(0, 16)}`,
      validationReportSha256: sealedValidationSha256,
      producer: {
        name: normalizedConfiguration.producerName,
        version: normalizedConfiguration.producerVersion,
        configurationSha256,
        inputManifestSha256: sha256(sourceManifestBytes),
      },
      artifacts: [...retainedArtifacts, sceneManifestArtifact, ...tileArtifacts],
      compatibility: {
        navigationTopologyContract: CONTRACT_VERSIONS.topology,
        sceneManifestContract: CONTRACT_VERSIONS.sceneManifest,
        fleetLiveOverlayContract: CONTRACT_VERSIONS.liveOverlay,
        fleetReplayContract: CONTRACT_VERSIONS.fleetReplay,
      },
    };
    await writeFile(join(staging, "manifest.json"), canonicalJson(outputManifest));

    const outputValidation = await validateBundleDirectory(staging);
    if (!outputValidation.valid) {
      throw new ScenePipelineError("SCENE_OUTPUT_INVALID", "Generated scene bundle failed validation.", { report: outputValidation });
    }
    await rename(staging, target);
    return Object.freeze({
      bundleDirectory: target,
      manifest: Object.freeze(structuredClone(outputManifest)),
      sceneManifest,
      tileCount: sceneTiles.length,
      levelCount: tileArtifacts.length,
      totalTileBytes,
      validation: outputValidation,
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function createScenePlan(manifest, assetsDocument, configuration) {
  const bounds = manifest.bounds;
  const width = bounds.maximum.x - bounds.minimum.x;
  const depth = bounds.maximum.y - bounds.minimum.y;
  if (!(width > 0) || !(depth > 0)) fail("SCENE_BOUNDS_INVALID", "Bundle XY bounds must have positive area.");
  const columns = Math.ceil(width / configuration.tileSizeMeters);
  const rows = Math.ceil(depth / configuration.tileSizeMeters);
  if (columns * rows > configuration.maximumTileCount) {
    fail("SCENE_TILE_COUNT_EXCEEDED", `Scene requires ${columns * rows} tiles; budget is ${configuration.maximumTileCount}.`);
  }
  const assets = Array.isArray(assetsDocument.assets) ? [...assetsDocument.assets] : [];
  const plan = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const minimumX = bounds.minimum.x + column * configuration.tileSizeMeters;
      const minimumY = bounds.minimum.y + row * configuration.tileSizeMeters;
      const tileBounds = Object.freeze({
        minimum: Object.freeze({ x: minimumX, y: minimumY, z: bounds.minimum.z }),
        maximum: Object.freeze({
          x: Math.min(bounds.maximum.x, minimumX + configuration.tileSizeMeters),
          y: Math.min(bounds.maximum.y, minimumY + configuration.tileSizeMeters),
          z: bounds.maximum.z,
        }),
      });
      const tileAssets = assets.filter((asset) => pointInsideTile(asset.pose?.position, tileBounds, column === columns - 1, row === rows - 1));
      plan.push(Object.freeze({
        tileId: `tile-${String(row).padStart(3, "0")}-${String(column).padStart(3, "0")}`,
        bounds: tileBounds,
        assets: Object.freeze(tileAssets.sort((left, right) => left.assetId.localeCompare(right.assetId))),
      }));
    }
  }
  return Object.freeze(plan);
}

function createTileGlb({ tile, level, producerVersion }) {
  const nodes = [];
  const floorSize = {
    x: tile.bounds.maximum.x - tile.bounds.minimum.x,
    y: tile.bounds.maximum.y - tile.bounds.minimum.y,
    z: 0.08,
  };
  nodes.push(glbNode(
    `${tile.tileId}-floor`,
    0,
    center(tile.bounds.minimum.x, tile.bounds.maximum.x, tile.bounds.minimum.y, tile.bounds.maximum.y, tile.bounds.minimum.z, tile.bounds.minimum.z + floorSize.z),
    floorSize,
  ));
  const visibleAssets = level === 0 ? tile.assets : coarseAssetGroups(tile.assets);
  for (const asset of visibleAssets) {
    const box = assetBox(asset);
    nodes.push(glbNode(asset.assetId, 1, box.center, box.size));
  }
  return encodeGlb({ nodes, generator: `Brash Scene Worker ${producerVersion} LOD${level}` });
}

function coarseAssetGroups(assets) {
  if (assets.length === 0) return [];
  const minimum = { x: Infinity, y: Infinity, z: Infinity };
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const asset of assets) {
    const bounds = asset.bounds3d;
    for (const axis of ["x", "y", "z"]) {
      minimum[axis] = Math.min(minimum[axis], bounds.minimum[axis]);
      maximum[axis] = Math.max(maximum[axis], bounds.maximum[axis]);
    }
  }
  return [{
    assetId: `coarse-assets-${assets.length}`,
    bounds3d: { minimum, maximum },
  }];
}

function assetBox(asset) {
  const bounds = asset.bounds3d;
  if (!bounds?.minimum || !bounds?.maximum) fail("SCENE_ASSET_BOUNDS_REQUIRED", `Asset ${asset.assetId} has no 3D bounds.`);
  return {
    center: center(
      bounds.minimum.x, bounds.maximum.x,
      bounds.minimum.y, bounds.maximum.y,
      bounds.minimum.z, bounds.maximum.z,
    ),
    size: {
      x: Math.max(0.02, bounds.maximum.x - bounds.minimum.x),
      y: Math.max(0.02, bounds.maximum.y - bounds.minimum.y),
      z: Math.max(0.02, bounds.maximum.z - bounds.minimum.z),
    },
  };
}

function glbNode(name, mesh, translation, scale) {
  return { name, mesh, translation: [translation.x, translation.z, -translation.y], scale: [scale.x, scale.z, scale.y] };
}

function encodeGlb({ nodes, generator }) {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  const binary = Buffer.concat([
    Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength),
  ]);
  const document = {
    asset: { version: "2.0", generator },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes: [
      { name: "floor-box", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
      { name: "asset-box", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 1 }] },
    ],
    materials: [
      { name: "factory-floor", extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: [0.15, 0.2, 0.25, 1] } },
      { name: "reviewed-assets", extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: [0.1, 0.75, 0.72, 1] } },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: "SCALAR", min: [0], max: [7] },
    ],
  };
  const json = paddedBuffer(Buffer.from(JSON.stringify(document)), 0x20);
  const bin = paddedBuffer(binary, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.byteLength + 8 + bin.byteLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.byteLength, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binHeader, bin]);
}

function paddedBuffer(content, paddingByte) {
  const padding = (4 - (content.byteLength % 4)) % 4;
  return padding === 0 ? content : Buffer.concat([content, Buffer.alloc(padding, paddingByte)]);
}

function pointInsideTile(position, bounds, inclusiveX, inclusiveY) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
  return position.x >= bounds.minimum.x
    && (position.x < bounds.maximum.x || (inclusiveX && position.x === bounds.maximum.x))
    && position.y >= bounds.minimum.y
    && (position.y < bounds.maximum.y || (inclusiveY && position.y === bounds.maximum.y));
}

function center(minimumX, maximumX, minimumY, maximumY, minimumZ, maximumZ) {
  return {
    x: (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
    z: (minimumZ + maximumZ) / 2,
  };
}

function normalizeConfiguration(configuration) {
  const value = { ...DEFAULT_CONFIGURATION, ...configuration };
  boundedText(value.producerName, "producerName", 200);
  boundedText(value.producerVersion, "producerVersion", 100);
  positiveNumber(value.tileSizeMeters, "tileSizeMeters", 0.1, 1_000);
  positiveInteger(value.maximumTileCount, "maximumTileCount", 1, 4_096);
  positiveInteger(value.maximumLevelsPerTile, "maximumLevelsPerTile", 1, 4);
  positiveInteger(value.maximumTileBytes, "maximumTileBytes", 1_024, 512 * 1024 * 1024);
  return Object.freeze(value);
}

async function readArtifactJson(directory, artifact) {
  if (!artifact) fail("SCENE_INPUT_REQUIRED", "Scene input artifact is missing.");
  return JSON.parse(await readFile(join(directory, artifact.path), "utf8"));
}

async function assertTargetMissing(target) {
  try {
    await stat(target);
    fail("SCENE_TARGET_EXISTS", `Target bundle ${target} already exists.`);
  } catch (error) {
    if (error instanceof ScenePipelineError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

function requiredDirectory(value, field) {
  if (typeof value !== "string" || value.trim() === "") fail("SCENE_PATH_REQUIRED", `${field} is required.`);
  const absolute = resolve(value);
  if (relative("/", absolute) === "") fail("SCENE_PATH_INVALID", `${field} cannot be the filesystem root.`);
  return absolute;
}

function boundedText(value, field, maximum) {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > maximum) {
    fail("SCENE_CONFIGURATION_INVALID", `${field} must be a bounded non-empty string.`);
  }
}

function positiveNumber(value, field, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail("SCENE_CONFIGURATION_INVALID", `${field} must be between ${minimum} and ${maximum}.`);
  }
}

function positiveInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("SCENE_CONFIGURATION_INVALID", `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function sha256Value(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code, message) {
  throw new ScenePipelineError(code, message);
}
