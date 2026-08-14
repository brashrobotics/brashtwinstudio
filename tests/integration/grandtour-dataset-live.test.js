import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  loadDatasetSelection,
  verifyDatasetSelection,
} from "@brash-twin/importers";

const executeFile = promisify(execFile);
const datasetDirectory = process.env.TWIN_TEST_GRANDTOUR_DIR;
const pythonExecutable = process.env.TWIN_GRANDTOUR_PYTHON;

test("real GrandTour ETH-2 processed survey produces a bounded materialization preview", {
  skip: datasetDirectory && pythonExecutable
    ? false
    : "Set TWIN_TEST_GRANDTOUR_DIR and TWIN_GRANDTOUR_PYTHON to run the external dataset integration test.",
}, async () => {
  const selectionPath = resolve("tests/fixtures/datasets/grandtour-eth2.selection.json");
  const selection = await loadDatasetSelection(selectionPath);
  const verification = await verifyDatasetSelection(selection, datasetDirectory);
  assert.equal(verification.valid, true);
  assert.equal(verification.declaredBytes, 290_764_702);

  const { stdout } = await executeFile(resolve(pythonExecutable), [
    resolve("workers/fusion-worker/grandtour_inspector.py"),
    selectionPath,
    resolve(datasetDirectory),
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const preview = JSON.parse(stdout);
  assert.equal(preview.schemaVersion, "brash.survey-materialization-preview/v1");
  assert.equal(preview.source.revision, "daf91c5e2b6db564822a35cc58222d73f8e75bab");
  assert.equal(preview.coordinateSystem.rootFrameId, "dlio_map");
  assert.equal(preview.trajectory.sampleCount, 4_305);
  assert.equal(preview.trajectory.pathLengthMetres, 210.590836741);
  assert.equal(preview.trajectory.preview.poses.length, 2_153);
  assert.equal(preview.coordinateFrames.sampleCount, 47_567);
  assert.equal(preview.coordinateFrames.timestamp.nonIncreasingCount, 16);
  assert.equal(preview.reconstruction.vertexCount, 17_388_758);
  assert.equal(preview.reconstruction.preview.points.length, 4_096);
  assert.deepEqual(preview.reconstruction.bounds, {
    minimum: [-52.970684052, -181.037918091, -33.419750214],
    maximum: [114.243049622, 98.840354919, 20.185142517],
  });
  assert.deepEqual(preview.qualityWarnings.map((warning) => warning.code), [
    "TF_TIMESTAMP_NON_INCREASING",
  ]);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "brash-grandtour-export-test-"));
  try {
    const outputDirectory = join(temporaryRoot, "survey");
    const exportedProcess = await executeFile(resolve(pythonExecutable), [
      resolve("workers/fusion-worker/grandtour_survey_exporter.py"),
      selectionPath,
      resolve(datasetDirectory),
      outputDirectory,
    ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    const exported = JSON.parse(exportedProcess.stdout);
    assert.equal(exported.schemaVersion, "brash.grandtour-survey-export/v1");
    assert.equal(exported.frameId, "dlio_map");
    assert.equal(exported.summary.trajectoryPoseCount, 4_305);
    assert.equal(exported.summary.pointCloudVertexCount, 17_388_758);
    assert.equal(exported.artifacts.find(({ role }) => role === "POINT_CLOUD_MAP").sha256,
      "c330c109191bb6e7bcb9bd334404982fab52273685aff52a910a0d77221fb0b6");
    const trajectory = await readFile(join(outputDirectory, "trajectory.tum"), "utf8");
    const lines = trajectory.trim().split("\n");
    assert.equal(lines.length, 4_305);
    assert.ok(lines.every((line) => line.trim().split(/\s+/).length === 8));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
