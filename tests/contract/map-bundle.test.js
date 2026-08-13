import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectBundleDirectory, validateBundleDirectory } from "@brash-twin/validation";

const fixture = fileURLToPath(new URL("../fixtures/bundles/demo-plant@1", import.meta.url));

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
