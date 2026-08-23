import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectBundleDirectory, validateBundleDirectory } from "@brash-twin/validation";

const fixture = fileURLToPath(new URL("../fixtures/bundles/demo-plant@1", import.meta.url));
const optimizedFixture = fileURLToPath(new URL("../fixtures/bundles/demo-plant@2", import.meta.url));

test("demo Twin Map Bundle passes integrity and semantic validation", async () => {
  const validation = await validateBundleDirectory(fixture);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));
  assert.deepEqual(validation.warnings, []);
  assert.deepEqual(validation.summary, {
    bundleId: "bundle-demo-plant-1",
    mapReleaseId: "demo-plant@1",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    artifactCount: 5,
    nodeCount: 4,
    edgeCount: 3,
    assetCount: 2,
    zoneCount: 2,
  });

  const inspection = await inspectBundleDirectory(fixture);
  assert.deepEqual(inspection.semanticClasses, { ELECTRICAL_PANEL: 1, CONVEYOR: 1 });
  assert.deepEqual(inspection.nodeKinds, { STATION: 2, INTERSECTION: 1, HOLDING_POINT: 1 });
});

test("optimized Bundle v2 binds every Scene Manifest LOD by immutable identity", async () => {
  const validation = await validateBundleDirectory(optimizedFixture);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(validation.summary.mapReleaseId, "demo-plant@2");
  assert.equal(validation.summary.artifactCount, 13);
  const manifest = JSON.parse(await readFile(join(optimizedFixture, "manifest.json"), "utf8"));
  const scene = JSON.parse(await readFile(join(optimizedFixture, "scene/manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, "brash.twin-map-bundle/v2");
  assert.equal(scene.schemaVersion, "brash.scene-manifest/v2");
  assert.equal(scene.tiles.length, 4);
  assert.equal(scene.tiles.flatMap((tile) => tile.levels).length, 8);
  assert.equal(
    scene.tiles.flatMap((tile) => tile.levels).reduce((total, level) => total + level.bytes, 0),
    scene.budgets.totalTileBytes,
  );
});

test("optimized scene level cannot diverge from its bound bundle artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brash-twin-v2-bundle-"));
  await cp(resolve(optimizedFixture), directory, { recursive: true });
  const scenePath = join(directory, "scene/manifest.json");
  const scene = JSON.parse(await readFile(scenePath, "utf8"));
  scene.tiles[0].levels[0].sha256 = "f".repeat(64);
  await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`);
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sceneArtifact = manifest.artifacts.find((artifact) => artifact.role === "SCENE_MANIFEST");
  const sceneBytes = await readFile(scenePath);
  sceneArtifact.sha256 = createHash("sha256").update(sceneBytes).digest("hex");
  sceneArtifact.bytes = sceneBytes.byteLength;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const validation = await validateBundleDirectory(directory);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "SCENE_LEVEL_IDENTITY_MISMATCH"));
});

test("checksum mutation is rejected", async () => {
  const directory = await copyFixture();
  const topologyPath = join(directory, "topology.json");
  const topology = JSON.parse(await readFile(topologyPath, "utf8"));
  topology.nodes[0].label = "Mutated after publication";
  await writeFile(topologyPath, `${JSON.stringify(topology, null, 2)}\n`);

  const validation = await validateBundleDirectory(directory);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "ARTIFACT_CHECKSUM_MISMATCH"));
});

test("artifact path traversal is rejected", async () => {
  const directory = await copyFixture();
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.artifacts[0].path = "../coordinate-frames.json";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const validation = await validateBundleDirectory(directory, { verifyChecksums: false });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "ARTIFACT_PATH_UNSAFE"));
});

test("symbolic-link artifacts are rejected before immutable publication", async () => {
  const directory = await copyFixture();
  const outsideDirectory = await mkdtemp(join(tmpdir(), "brash-twin-outside-"));
  const outsidePath = join(outsideDirectory, "topology.json");
  const artifactPath = join(directory, "topology.json");
  await writeFile(outsidePath, await readFile(artifactPath));
  await rm(artifactPath);
  await symlink(outsidePath, artifactPath);

  const validation = await validateBundleDirectory(directory);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "ARTIFACT_UNREADABLE"));
});

async function copyFixture() {
  const directory = await mkdtemp(join(tmpdir(), "brash-twin-bundle-"));
  await cp(resolve(fixture), directory, { recursive: true });
  return directory;
}
