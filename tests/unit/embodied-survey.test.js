import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateEmbodiedSurveyPackage } from "@brash-twin/embodied-survey";

const manifestPath = fileURLToPath(new URL("../fixtures/surveys/embodied-demo.v1.json", import.meta.url));
const grandTourPath = fileURLToPath(new URL("../fixtures/datasets/grandtour-eth2.selection.json", import.meta.url));

test("complete embodied survey manifest passes without reading large artifacts", async () => {
  const manifest = await loadJson(manifestPath);
  const report = validateEmbodiedSurveyPackage(manifest);
  assert.equal(report.outcome, "ACCEPTED");
  assert.equal(report.artifactCount, 5);
  assert.equal(report.declaredBytes, 8192);
  assert.equal(report.roles.POINT_CLOUD_MAP, 1);
  assert.equal(report.issues.length, 0);
  assert.equal(Object.isFrozen(report), true);

  const reversed = Object.fromEntries(Object.entries(manifest).reverse());
  assert.equal(validateEmbodiedSurveyPackage(reversed).manifestSha256, report.manifestSha256);
});

test("unsafe paths, duplicate identities, and invalid hashes are rejected", async () => {
  const manifest = await loadJson(manifestPath);
  manifest.artifacts[1].artifactId = manifest.artifacts[0].artifactId;
  manifest.artifacts[1].path = "../calibration.json";
  manifest.artifacts[1].sha256 = "bad";
  const report = validateEmbodiedSurveyPackage(manifest);
  assert.equal(report.outcome, "REJECTED");
  assert.deepEqual(new Set(report.issues.map((issue) => issue.code)), new Set([
    "ARTIFACT_ID_DUPLICATED",
    "ARTIFACT_PATH_UNSAFE",
    "ARTIFACT_HASH_INVALID",
  ]));
});

test("unknown manifest and artifact fields are rejected at the trust boundary", async () => {
  const manifest = await loadJson(manifestPath);
  manifest.vendorExtension = true;
  manifest.artifacts[0].mutable = true;
  const report = validateEmbodiedSurveyPackage(manifest);
  assert.equal(report.outcome, "REJECTED");
  assert.deepEqual(report.issues.map((issue) => issue.location), ["vendorExtension", "artifacts[0].mutable"]);
  assert.ok(report.issues.every((issue) => issue.code === "FIELD_UNSUPPORTED"));
});

test("required evidence, metric reconstruction, and spatial frame invariants are enforced", async () => {
  const manifest = await loadJson(manifestPath);
  manifest.artifacts = manifest.artifacts.filter((artifact) => artifact.role !== "QUALITY_REPORT" && artifact.role !== "POINT_CLOUD_MAP");
  delete manifest.artifacts.find((artifact) => artifact.role === "TRAJECTORY").frameId;
  const report = validateEmbodiedSurveyPackage(manifest);
  assert.equal(report.outcome, "REJECTED");
  assert.ok(report.issues.some((issue) => issue.code === "REQUIRED_ROLE_COUNT_INVALID"));
  assert.ok(report.issues.some((issue) => issue.code === "RECONSTRUCTION_REQUIRED"));
  assert.ok(report.issues.some((issue) => issue.code === "ARTIFACT_FRAME_REQUIRED"));
});

test("partial and warning packages require explicit policy but preserve warning evidence", async () => {
  const manifest = await loadJson(manifestPath);
  manifest.completionStatus = "PARTIAL";
  manifest.quality.outcome = "WARNING";
  const strict = validateEmbodiedSurveyPackage(manifest);
  assert.equal(strict.outcome, "REJECTED");
  const allowed = validateEmbodiedSurveyPackage(manifest, { allowPartial: true });
  assert.equal(allowed.outcome, "ACCEPTED_WITH_WARNINGS");
  assert.deepEqual(allowed.issues.map((issue) => issue.code), ["PARTIAL_SURVEY", "QUALITY_WARNING"]);
});

test("clock and byte policies reject manifests before any artifact download", async () => {
  const manifest = await loadJson(manifestPath);
  manifest.clock.maximumOffsetMilliseconds = 60;
  const report = validateEmbodiedSurveyPackage(manifest, { maximumDeclaredBytes: 8191 });
  assert.equal(report.outcome, "REJECTED");
  assert.ok(report.issues.some((issue) => issue.code === "CLOCK_OFFSET_POLICY_EXCEEDED"));
  assert.ok(report.issues.some((issue) => issue.code === "DECLARED_BYTES_POLICY_EXCEEDED"));
});

test("GrandTour ETH-2 metadata plan stays below the one-gigabyte local policy", async () => {
  const selection = await loadJson(grandTourPath);
  const baseBytes = selection.baseSelection.files.reduce((sum, file) => sum + file.bytes, 0);
  const optionalBytes = selection.optionalEvidence.files.reduce((sum, file) => sum + file.bytes, 0);
  assert.equal(baseBytes, selection.baseSelection.declaredBytes);
  assert.equal(baseBytes + optionalBytes, selection.optionalEvidence.declaredBytesWithBase);
  assert.ok(selection.optionalEvidence.declaredBytesWithBase < selection.diskPolicy.maximumDownloadBytes);
  assert.equal(selection.diskPolicy.downloadByDefault, false);
  for (const file of [...selection.baseSelection.files, ...selection.optionalEvidence.files]) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
});

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
