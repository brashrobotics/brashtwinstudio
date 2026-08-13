#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DatasetValidationError,
  boundsContain,
  boundsOverlap,
  inspectExternalDataset,
  loadDatasetDescriptor,
  verifyDatasetDirectory,
} from "@brash-twin/importers";

const executeFile = promisify(execFile);
const [command, descriptorPath, datasetDirectory, ...options] = process.argv.slice(2);

try {
  if (!["verify", "inspect"].includes(command) || !descriptorPath || !datasetDirectory) {
    usage();
    process.exitCode = 2;
  } else {
    const descriptor = await loadDatasetDescriptor(descriptorPath);
    if (command === "verify") {
      const result = await verifyDatasetDirectory(descriptor, datasetDirectory);
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
    } else {
      const result = await inspectExternalDataset(descriptor, datasetDirectory);
      const pythonExecutable = optionValue(options, "--ifcopenshell-python");
      if (pythonExecutable) {
        const bimFile = descriptor.files.find((file) => file.role === "BIM_REFERENCE");
        result.bim.geometry = await inspectGeometry(
          pythonExecutable,
          resolve(datasetDirectory, bimFile.path),
        );
        result.summary.trajectoryOverlapsBimBounds = boundsOverlap(
          result.summary.trajectoryBounds,
          result.bim.geometry.boundsMetres,
        );
        result.summary.trajectoryBoundsInsideBimBounds = boundsContain(
          result.bim.geometry.boundsMetres,
          result.summary.trajectoryBounds,
        );
      }
      console.log(JSON.stringify(result, null, 2));
    }
  }
} catch (error) {
  if (error instanceof DatasetValidationError) {
    console.error(error.message);
    console.error(JSON.stringify(error.report, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

async function inspectGeometry(pythonExecutable, ifcPath) {
  const cliDirectory = dirname(fileURLToPath(import.meta.url));
  const inspector = resolve(cliDirectory, "../../workers/fusion-worker/ifc_inspector.py");
  const { stdout } = await executeFile(resolve(pythonExecutable), [inspector, ifcPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function optionValue(options, name) {
  const index = options.indexOf(name);
  if (index === -1) return null;
  const value = options[index + 1];
  if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value.`);
  return value;
}

function usage() {
  console.log(`Usage:
  brash-dataset verify <descriptor.json> <dataset-directory>
  brash-dataset inspect <descriptor.json> <dataset-directory> [--ifcopenshell-python <python>]`);
}
