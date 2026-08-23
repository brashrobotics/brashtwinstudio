import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { SensorVisibilityError, SensorVisibilityService } from "@brash-twin/application/sensor-visibility";
import { UploadService } from "@brash-twin/application/uploads";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { InMemoryDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";

test("calibrated source-frame visibility becomes sealed canonical coverage", async () => {
  const system = await visibilitySystem({ approved: true, calibrated: true });
  const record = await system.sensorVisibility.create("draft-1", {
    visibilityReportId: "visibility-report-1",
    registrationId: "registration-1",
    observationBindingId: "visibility-observations-1",
    operatorId: "visibility-operator",
  });

  assert.equal(record.report.schemaVersion, "brash.sensor-visibility-report/v1");
  assert.equal(record.report.qualification.outcome, "QUALIFIED");
  assert.equal(record.report.coverage.qualifiedCellCount, 1);
  assert.deepEqual(record.report.coverage.cells[0].footprint, [[8, 21], [8, 23], [6, 23], [6, 21]]);
  assert.equal(record.report.coverage.summedCellAreaSquareMeters, 4);
  const binding = (await system.draftArtifacts.list("draft-1")).find(
    (candidate) => candidate.bindingId === record.reportBindingId,
  );
  assert.equal(binding.role, "SENSOR_VISIBILITY_REPORT");
  assert.deepEqual(binding.inputBindings.map((input) => input.bindingId), [
    "visibility-observations-1",
    "registration-acceptance-1",
  ]);
  assert.deepEqual(await system.sensorVisibility.list("draft-1"), [record]);
});

test("unqualified visibility remains visible evidence but cannot claim production coverage", async () => {
  const system = await visibilitySystem({ approved: true, calibrated: false });
  const record = await system.sensorVisibility.create("draft-1", {
    visibilityReportId: "visibility-report-1",
    registrationId: "registration-1",
    observationBindingId: "visibility-observations-1",
    operatorId: "visibility-operator",
  });
  assert.equal(record.report.qualification.outcome, "UNQUALIFIED");
  assert.deepEqual(record.report.qualification.issues, ["CALIBRATION_NOT_ASSERTED"]);
});

test("visibility transformation refuses unapproved registration evidence", async () => {
  const system = await visibilitySystem({ approved: false, calibrated: true });
  await assert.rejects(
    () => system.sensorVisibility.create("draft-1", {
      visibilityReportId: "visibility-report-1",
      registrationId: "registration-1",
      observationBindingId: "visibility-observations-1",
      operatorId: "visibility-operator",
    }),
    (error) => error instanceof SensorVisibilityError
      && error.code === "SENSOR_VISIBILITY_REGISTRATION_REQUIRED",
  );
});

async function visibilitySystem({ approved, calibrated }) {
  const clock = () => new Date("2026-08-23T12:00:00.000Z");
  const store = new LocalMultipartArtifactStore(await mkdtemp(join(tmpdir(), "brash-visibility-")), { clock });
  const uploads = new UploadService({ repository: new InMemoryUploadRepository(), multipartStore: store, clock });
  const catalog = {
    getMapDraft: async (draftId) => ({ draftId, status: "DRAFT", canonicalFrameId: "plant-floor" }),
    getMapDraftContext: async (draftId) => ({ draft: { draftId, status: "DRAFT", canonicalFrameId: "plant-floor" } }),
  };
  const draftArtifacts = new DraftArtifactService({
    repository: new InMemoryDraftArtifactRepository(),
    catalog,
    uploads,
    clock,
  });
  const sourceBindings = [];
  for (const name of ["calibration", "poses", "geometry"]) {
    const uploaded = await upload(uploads, store, `${name}-upload`, Buffer.from(name));
    sourceBindings.push(await draftArtifacts.bind("draft-1", {
      bindingId: `${name}-source`,
      uploadId: uploaded.uploadId,
      role: "SURVEY_SOURCE",
      coordinateFrameId: "slam-map",
      operatorId: "mapping-operator",
    }));
  }
  const registrationReport = await derivedBinding({
    uploads, store, draftArtifacts, uploadId: "registration-report-upload", bindingId: "registration-report-1",
    role: "REGISTRATION_REPORT", inputBindingIds: ["geometry-source"], coordinateFrameId: null,
    producerName: "brash-survey-registration",
  });
  const registrationAcceptance = await derivedBinding({
    uploads, store, draftArtifacts, uploadId: "registration-acceptance-upload", bindingId: "registration-acceptance-1",
    role: "REGISTRATION_ACCEPTANCE", inputBindingIds: [registrationReport.bindingId], coordinateFrameId: "plant-floor",
    producerName: "brash-survey-registration-review",
  });
  const model = { name: "fixture-visibility-worker", version: "1.0.0", parametersSha256: "f".repeat(64) };
  const byName = new Map(sourceBindings.map((binding) => [binding.bindingId, binding]));
  const content = Buffer.from(`${JSON.stringify({
    schemaVersion: "brash.sensor-visibility-observations/v1",
    visibilitySetId: "visibility-set-1",
    semanticObservationSetId: "semantic-observations-1",
    sourceFrameId: "slam-map",
    model,
    coverageModel: {
      method: "CALIBRATED_SENSOR_VISIBILITY_GRID",
      calibrated,
      poseSynchronized: true,
      occlusionAware: true,
      minimumVisibilityConfidence: 0.9,
    },
    evidence: [
      evidence("CALIBRATION", byName.get("calibration-source")),
      evidence("SENSOR_POSES", byName.get("poses-source")),
      evidence("OCCLUSION_GEOMETRY", byName.get("geometry-source")),
    ],
    cells: [{
      cellId: "cell-1",
      minimum: [1, 2, 0],
      maximum: [3, 4, 2],
      visibilityConfidence: 0.94,
      sampleCount: 28,
    }],
  }, null, 2)}\n`);
  const observationUpload = await upload(uploads, store, "visibility-observations-upload", content);
  await draftArtifacts.bind("draft-1", {
    bindingId: "visibility-observations-1",
    uploadId: observationUpload.uploadId,
    role: "SENSOR_VISIBILITY_OBSERVATIONS",
    coordinateFrameId: "slam-map",
    inputBindingIds: sourceBindings.map((binding) => binding.bindingId),
    producer: model,
    operatorId: "visibility-worker",
  });
  const registration = {
    report: {
      registrationId: "registration-1",
      sourcePreview: { frameId: "slam-map" },
      canonicalFrameId: "plant-floor",
      transform: { scale: 1, rotationRadians: Math.PI / 2, translation: { x: 10, y: 20 } },
      quality: { outcome: "PASSED" },
    },
    acceptance: approved ? {
      reportBindingId: registrationAcceptance.bindingId,
      reportSha256: registrationAcceptance.artifactSha256,
      report: { decision: "APPROVED" },
    } : null,
  };
  const sensorVisibility = new SensorVisibilityService({
    catalog,
    registrations: { list: async () => [registration] },
    draftArtifacts,
    uploads,
    multipartStore: store,
    clock,
  });
  return { sensorVisibility, draftArtifacts };
}

function evidence(kind, binding) {
  return { kind, bindingId: binding.bindingId, artifactSha256: binding.artifactSha256 };
}

async function derivedBinding({
  uploads, store, draftArtifacts, uploadId, bindingId, role, inputBindingIds, coordinateFrameId, producerName,
}) {
  const uploaded = await upload(uploads, store, uploadId, Buffer.from(bindingId));
  return draftArtifacts.bind("draft-1", {
    bindingId,
    uploadId: uploaded.uploadId,
    role,
    coordinateFrameId,
    inputBindingIds,
    producer: { name: producerName, version: "1", parametersSha256: "e".repeat(64) },
    operatorId: "worker-1",
  });
}

async function upload(uploads, store, uploadId, content) {
  const expectedSha256 = createHash("sha256").update(content).digest("hex");
  await uploads.initiate({
    uploadId,
    expectedSha256,
    expectedBytes: content.byteLength,
    mediaType: "application/json",
    originalName: `${uploadId}.json`,
    operatorId: "operator-1",
  });
  await store.putPart(uploadId, 1, content);
  return uploads.complete(uploadId, { operatorId: "operator-1" });
}
