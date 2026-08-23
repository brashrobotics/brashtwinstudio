#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageOptimizedScene } from "@brash-twin/scene-pipeline";

const target = process.argv[2];
if (!target) {
  process.stderr.write("Usage: node tools/fleet-demo-fixture/cli.js <empty-target-directory>\n");
  process.exit(2);
}
const source = fileURLToPath(new URL("../../tests/fixtures/bundles/demo-plant@1", import.meta.url));
const staging = await mkdtemp(join(tmpdir(), "brash-fleet-demo-source-"));
try {
  await cp(source, staging, { recursive: true, errorOnExist: true });
  for (const path of ["coordinate-frames.json", "topology.json", "assets.json", "zones.geojson", "scene/manifest.json"]) {
    const document = JSON.parse(await readFile(join(staging, path), "utf8"));
    await writeFile(join(staging, path), canonicalJson(replaceReleaseIdentity(document)));
  }
  const sourceManifest = replaceReleaseIdentity(JSON.parse(await readFile(join(staging, "manifest.json"), "utf8")));
  sourceManifest.bundleId = "bundle-demo-plant-2-staging";
  sourceManifest.revision = 2;
  sourceManifest.createdAt = "2026-08-23T18:00:00.000Z";
  sourceManifest.validationReportSha256 = "b".repeat(64);
  sourceManifest.artifacts = await Promise.all(sourceManifest.artifacts.map(async (artifact) => {
    const content = await readFile(join(staging, artifact.path));
    return {
      ...artifact,
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: content.byteLength,
    };
  }));
  await writeFile(join(staging, "manifest.json"), canonicalJson(sourceManifest));
  const result = await packageOptimizedScene({
    sourceBundleDirectory: staging,
    targetBundleDirectory: resolve(target),
    validationReportSha256: sourceManifest.validationReportSha256,
  });
  process.stdout.write(`${JSON.stringify({
    target: result.bundleDirectory,
    bundleId: result.manifest.bundleId,
    tileCount: result.tileCount,
    levelCount: result.levelCount,
    totalTileBytes: result.totalTileBytes,
  }, null, 2)}\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

function replaceReleaseIdentity(value) {
  if (typeof value === "string") return value === "demo-plant@1" ? "demo-plant@2" : value;
  if (Array.isArray(value)) return value.map(replaceReleaseIdentity);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceReleaseIdentity(entry)]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
