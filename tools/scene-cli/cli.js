#!/usr/bin/env node
import { packageOptimizedScene, ScenePipelineError } from "@brash-twin/scene-pipeline";

const [command, sourceBundleDirectory, targetBundleDirectory, ...options] = process.argv.slice(2);
if (command !== "package" || !sourceBundleDirectory || !targetBundleDirectory) usage();
const validationIndex = options.indexOf("--validation-report-sha256");
const validationReportSha256 = validationIndex >= 0 ? options[validationIndex + 1] : undefined;
try {
  const result = await packageOptimizedScene({
    sourceBundleDirectory,
    targetBundleDirectory,
    validationReportSha256,
  });
  process.stdout.write(`${JSON.stringify({
    bundleDirectory: result.bundleDirectory,
    bundleId: result.manifest.bundleId,
    mapReleaseId: result.manifest.mapReleaseId,
    tileCount: result.tileCount,
    levelCount: result.levelCount,
    totalTileBytes: result.totalTileBytes,
  }, null, 2)}\n`);
} catch (error) {
  if (error instanceof ScenePipelineError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    if (error.report) process.stderr.write(`${JSON.stringify(error.report, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}

function usage() {
  process.stderr.write("Usage: brash-scene package <source-bundle> <target-bundle> --validation-report-sha256 <sha256>\n");
  process.exit(2);
}
