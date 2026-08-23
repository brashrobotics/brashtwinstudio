import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { packageOptimizedScene, ScenePipelineError } from "@brash-twin/scene-pipeline";
import { validateBundleDirectory } from "@brash-twin/validation";
import { ImmutableReleaseStore } from "@brash-twin/artifact-store";

const sourceBundle = fileURLToPath(new URL("../fixtures/bundles/demo-plant@1", import.meta.url));
const validationReportSha256 = "a".repeat(64);

test("scene pipeline atomically packages deterministic GLB LODs into Bundle v2", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-scene-pipeline-"));
  const firstTarget = join(root, "bundle-first");
  const secondTarget = join(root, "bundle-second");
  const sourceManifestBefore = await readFile(join(sourceBundle, "manifest.json"));

  const first = await packageOptimizedScene({
    sourceBundleDirectory: sourceBundle,
    targetBundleDirectory: firstTarget,
    validationReportSha256,
  });
  const second = await packageOptimizedScene({
    sourceBundleDirectory: sourceBundle,
    targetBundleDirectory: secondTarget,
    validationReportSha256,
  });

  assert.equal(first.manifest.schemaVersion, "brash.twin-map-bundle/v2");
  assert.equal(first.sceneManifest.schemaVersion, "brash.scene-manifest/v2");
  assert.equal(first.tileCount, 4);
  assert.equal(first.levelCount, 8);
  assert.ok(first.totalTileBytes > 0);
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.sceneManifest, second.sceneManifest);
  assert.deepEqual(await readFile(join(sourceBundle, "manifest.json")), sourceManifestBefore);
  assert.equal((await validateBundleDirectory(firstTarget)).valid, true);
  const releaseStore = new ImmutableReleaseStore(join(root, "release-store"));
  const published = await releaseStore.publish(firstTarget);
  assert.equal(published.mapReleaseId, "demo-plant@1");
  assert.equal((await releaseStore.getManifest("demo-plant@1")).schemaVersion, "brash.twin-map-bundle/v2");

  for (const tile of first.sceneManifest.tiles) {
    assert.equal(tile.levels.length, 2);
    assert.ok(first.sceneManifest.bounds.minimum.x <= tile.bounds.minimum.x);
    for (const level of tile.levels) {
      const bytes = await readFile(join(firstTarget, level.path));
      assert.equal(bytes.readUInt32LE(0), 0x46546c67);
      assert.equal(bytes.readUInt32LE(4), 2);
      assert.equal(bytes.readUInt32LE(8), bytes.byteLength);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), level.sha256);
      assert.equal(bytes.byteLength, level.bytes);
    }
  }

  await assert.rejects(
    () => packageOptimizedScene({
      sourceBundleDirectory: sourceBundle,
      targetBundleDirectory: firstTarget,
      validationReportSha256,
    }),
    (error) => error instanceof ScenePipelineError && error.code === "SCENE_TARGET_EXISTS",
  );
});

test("scene pipeline rejects missing publication validation evidence before writing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-scene-evidence-"));
  await assert.rejects(
    () => packageOptimizedScene({
      sourceBundleDirectory: sourceBundle,
      targetBundleDirectory: join(root, "invalid"),
    }),
    (error) => error instanceof ScenePipelineError && error.code === "SCENE_VALIDATION_EVIDENCE_REQUIRED",
  );
});
