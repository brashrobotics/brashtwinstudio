#!/usr/bin/env node
import {
  BundleValidationError,
  diffBundleDirectories,
  inspectBundleDirectory,
  validateBundleDirectory,
} from "@brash-twin/validation";
import { ImmutableReleaseStore } from "@brash-twin/artifact-store";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "validate" && args.length >= 1) {
    const report = await validateBundleDirectory(args[0]);
    print(report, args.includes("--json"));
    if (!report.valid) process.exitCode = 1;
  } else if (command === "inspect" && args.length === 1) {
    print(await inspectBundleDirectory(args[0]), true);
  } else if (command === "diff" && args.length === 2) {
    print(await diffBundleDirectories(args[0], args[1]), true);
  } else if (command === "publish" && args.length === 2) {
    const result = await new ImmutableReleaseStore(args[1]).publish(args[0]);
    console.log(`Published immutable release ${result.mapReleaseId}.`);
    console.log(result.releasePath);
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof BundleValidationError) {
    console.error(error.message);
    console.error(JSON.stringify(error.report, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

function print(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value.valid ? "Twin Map Bundle is valid." : "Twin Map Bundle is invalid.");
  if (value.summary) {
    console.log(
      `${value.summary.mapReleaseId}: ${value.summary.nodeCount} nodes, `
      + `${value.summary.edgeCount} edges, ${value.summary.assetCount} assets, `
      + `${value.summary.zoneCount} zones.`,
    );
  }
  for (const warning of value.warnings) console.log(`warning ${warning.code} ${warning.path}: ${warning.message}`);
  for (const error of value.errors) console.error(`error ${error.code} ${error.path}: ${error.message}`);
}

function usage() {
  console.log(`Usage:
  brash-map-bundle validate <bundle-directory> [--json]
  brash-map-bundle inspect <bundle-directory>
  brash-map-bundle diff <old-bundle-directory> <new-bundle-directory>
  brash-map-bundle publish <bundle-directory> <release-store-directory>`);
}
