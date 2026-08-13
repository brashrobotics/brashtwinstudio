import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import test from "node:test";
import {
  boundsContain,
  boundsOverlap,
  inspectExternalDataset,
  loadDatasetDescriptor,
} from "@brash-twin/importers";

const executeFile = promisify(execFile);
const datasetDirectory = process.env.TWIN_TEST_CONSLAM_DIR;
const pythonExecutable = process.env.TWIN_IFCOPENSHELL_PYTHON;

test("real ConSLAM BIM and trajectories pass provenance, structure, and geometry checks", {
  skip: datasetDirectory ? false : "Set TWIN_TEST_CONSLAM_DIR to run the external dataset integration test.",
}, async () => {
  const descriptor = await loadDatasetDescriptor(
    resolve("tests/fixtures/datasets/conslam-bim-gt.dataset.json"),
  );
  const report = await inspectExternalDataset(descriptor, datasetDirectory);
  assert.equal(report.verification.valid, true);
  assert.equal(report.bim.schema, "IFC2X3");
  assert.equal(report.bim.lengthUnit.toMetres, 0.001);
  assert.equal(report.bim.spatialStructure.projects, 1);
  assert.equal(report.bim.spatialStructure.buildings, 1);
  assert.equal(report.bim.elementCounts.walls, 1069);
  assert.equal(report.bim.spatialStructure.storeys.length, 32);
  assert.equal(report.summary.trajectorySessionCount, 4);
  assert.equal(report.summary.trajectorySampleCount, 1388);
  assert.equal(report.summary.trajectoryPathLengthMetres, 1246.587520212);
  assert.equal(report.trajectories[0].qualityWarnings[0].code, "REFERENCE_TRAJECTORY_GAP");

  if (pythonExecutable) {
    const ifcPath = resolve(datasetDirectory, descriptor.files[0].path);
    const { stdout } = await executeFile(resolve(pythonExecutable), [
      resolve("workers/fusion-worker/ifc_inspector.py"),
      ifcPath,
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const geometry = JSON.parse(stdout);
    assert.equal(geometry.engine, "IfcOpenShell");
    assert.ok(geometry.geometryProductCount > 0);
    assert.ok(geometry.triangleCount > 0);
    assert.equal(boundsOverlap(report.summary.trajectoryBounds, geometry.boundsMetres), true);
    assert.equal(boundsContain(geometry.boundsMetres, report.summary.trajectoryBounds), true);
  }
});
