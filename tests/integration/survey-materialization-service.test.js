import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SurveyMaterializationError,
  SurveyMaterializationService,
} from "@brash-twin/application/survey-materializations";
import { validateEmbodiedSurveyPackage } from "@brash-twin/embodied-survey";
import { createSurveyMaterializationJobRecord } from "@brash-twin/domain";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { UploadService } from "@brash-twin/application/uploads";
import { InMemorySurveyMaterializationRepository } from "@brash-twin/persistence/survey-materializations";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";

const manifestUrl = new URL("../fixtures/surveys/embodied-demo.v1.json", import.meta.url);

test("accepted intake creates deterministic snapshot without reading heavy artifacts", async () => {
  const content = await readFile(manifestUrl);
  const manifest = JSON.parse(content);
  const report = validateEmbodiedSurveyPackage(manifest);
  const intake = acceptedIntake(manifest, report, content);
  const reads = [];
  const service = materializationService(intake, content, reads);

  const job = await service.create(intake.intakeId, {
    jobId: "materialization-1",
    operatorId: "operator-1",
  });
  assert.equal(job.status, "PENDING");
  assert.equal(job.snapshot.schemaVersion, "brash.survey-materialization-snapshot/v1");
  assert.equal(job.snapshot.coordinateSystem.rootFrameId, "slam-map");
  assert.equal(job.snapshot.artifacts.length, manifest.artifacts.length);
  assert.deepEqual(job.snapshot.artifacts.map((artifact) => artifact.artifactId), [
    "calibration-1",
    "frames-1",
    "point-cloud-map-1",
    "quality-report-1",
    "trajectory-1",
  ]);
  assert.match(job.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(reads, [intake.manifestArtifactSha256]);

  await assert.rejects(
    () => service.create(intake.intakeId, {
      jobId: "materialization-2",
      operatorId: "operator-1",
    }),
    (error) => error instanceof SurveyMaterializationError
      && error.code === "SURVEY_MATERIALIZATION_CONFLICT",
  );
});

test("rejected intake is ineligible before any object-store read", async () => {
  const content = await readFile(manifestUrl);
  const manifest = JSON.parse(content);
  const report = validateEmbodiedSurveyPackage(manifest);
  const intake = { ...acceptedIntake(manifest, report, content), status: "REJECTED" };
  const reads = [];
  const service = materializationService(intake, content, reads);
  await assert.rejects(
    () => service.create(intake.intakeId, { operatorId: "operator-1" }),
    (error) => error instanceof SurveyMaterializationError
      && error.code === "SURVEY_MATERIALIZATION_INTAKE_INELIGIBLE",
  );
  assert.deepEqual(reads, []);
});

test("accepted manifest raw bytes and canonical validation identity are rechecked", async () => {
  const content = await readFile(manifestUrl);
  const manifest = JSON.parse(content);
  const report = validateEmbodiedSurveyPackage(manifest);
  const intake = acceptedIntake(manifest, report, content);
  const changed = Buffer.from(content.toString("utf8").replace("0.1.0", "0.1.1"));
  const service = materializationService(intake, changed, []);
  await assert.rejects(
    () => service.create(intake.intakeId, { operatorId: "operator-1" }),
    (error) => error instanceof SurveyMaterializationError
      && error.code === "SURVEY_MATERIALIZATION_MANIFEST_INTEGRITY_FAILED",
  );
});

test("leased materialization streams standard inputs into an integrity-checked preview artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-materialization-"));
  const clock = () => new Date("2026-08-14T13:00:00.000Z");
  const multipartStore = new LocalMultipartArtifactStore(root, { clock });
  const uploads = new UploadService({
    repository: new InMemoryUploadRepository(),
    multipartStore,
    clock,
  });
  const snapshot = await storedSnapshot(uploads, multipartStore);
  const repository = new InMemorySurveyMaterializationRepository();
  const intake = {
    intakeId: snapshot.intakeId,
    draftId: snapshot.draftId,
    status: "ACCEPTED",
    manifestSha256: snapshot.manifestSha256,
  };
  await repository.create(createSurveyMaterializationJobRecord({
    jobId: "materialization-stream-1",
    intake,
    snapshot,
    snapshotSha256: createHash("sha256").update(canonicalJson(snapshot)).digest("hex"),
    operatorId: "operator-1",
    occurredAt: clock(),
  }));
  const service = new SurveyMaterializationService({
    repository,
    surveyIntakes: { get: async () => intake },
    catalog: { getMapDraftContext: async () => ({ draft: { status: "DRAFT" } }) },
    uploads,
    multipartStore,
    clock,
  });

  const completed = await service.run("materialization-stream-1", {
    workerId: "materializer-1",
    operatorId: "operator-1",
  });
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.attemptCount, 1);
  assert.equal(completed.output.schemaVersion, "brash.survey-materialization-preview/v1");
  assert.equal(completed.output.summary.trajectoryPoseCount, 5);
  assert.equal(completed.output.summary.pointCloudVertexCount, 6);
  assert.match(completed.output.previewSha256, /^[a-f0-9]{64}$/);

  const preview = await service.getPreview(completed.jobId);
  assert.equal(preview.coordinateSystem.rootFrameId, "slam-map");
  assert.equal(preview.trajectory.preview.poses.length, 5);
  assert.equal(preview.reconstruction.preview.points.length, 6);
  assert.equal((await service.run(completed.jobId, {
    workerId: "materializer-2",
    operatorId: "operator-1",
  })).rowVersion, completed.rowVersion);
});

function materializationService(intake, content, reads) {
  return new SurveyMaterializationService({
    repository: new InMemorySurveyMaterializationRepository(),
    surveyIntakes: { get: async () => structuredClone(intake) },
    catalog: {
      getMapDraftContext: async () => ({
        draft: { draftId: intake.draftId, status: "DRAFT" },
        family: { familyId: "family-1" },
        floor: { floorId: "production-floor", siteId: "demo-site" },
      }),
    },
    uploads: {
      async initiate() { throw new Error("Not used by snapshot creation tests."); },
      async get() { throw new Error("Not used by snapshot creation tests."); },
      async complete() { throw new Error("Not used by snapshot creation tests."); },
    },
    multipartStore: {
      async get(sha256) {
        reads.push(sha256);
        return content;
      },
      async openReadStream() { throw new Error("Not used by snapshot creation tests."); },
      async putPart() { throw new Error("Not used by snapshot creation tests."); },
    },
    jobIdGenerator: () => "materialization-generated",
    clock: () => new Date("2026-08-14T13:00:00.000Z"),
  });
}

function acceptedIntake(manifest, report, content) {
  return {
    intakeId: "intake-1",
    draftId: "draft-1",
    manifestUploadId: "manifest-upload-1",
    manifestArtifactSha256: createHash("sha256").update(content).digest("hex"),
    status: "ACCEPTED",
    manifestSchemaVersion: manifest.schemaVersion,
    manifestSha256: report.manifestSha256,
    packageId: manifest.packageId,
    surveyId: manifest.surveyId,
    sourceSiteId: manifest.siteId,
    sourceFloorId: manifest.floorId,
    report,
    artifactUploads: manifest.artifacts.map((artifact, index) => ({
      artifactId: artifact.artifactId,
      uploadId: `artifact-upload-${index + 1}`,
      artifactSha256: artifact.sha256,
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
    })),
    rowVersion: 2,
    createdBy: "operator-1",
    createdAt: "2026-08-14T12:00:00.000Z",
    verifiedBy: "reviewer-1",
    verifiedAt: "2026-08-14T12:01:00.000Z",
  };
}

async function storedSnapshot(uploads, store) {
  const frames = Buffer.from(JSON.stringify({
    schemaVersion: "brash.survey-coordinate-frames/v1",
    rootFrameId: "slam-map",
    frames: [
      frame("slam-map", null, [0, 0, 0]),
      frame("base-link", "slam-map", [0, 0, 0.4]),
      frame("lidar-link", "base-link", [0.2, 0, 0.3]),
    ],
  }));
  const calibration = Buffer.from(JSON.stringify({
    schemaVersion: "brash.survey-calibration/v1",
    calibrationId: "demo-calibration",
    sensors: [
      sensor("lidar-main", "lidar-link", "LIDAR", "hesai-xt32", "1"),
      sensor("imu-main", "base-link", "IMU", "hg4930", "2"),
    ],
  }));
  const trajectory = Buffer.from([
    "1000 0 0 0 0 0 0 1",
    "1000.1 1 0 0 0 0 0 1",
    "1000.2 2 0 0.1 0 0 0 1",
    "1000.3 2 1 0.1 0 0 0 1",
    "1000.4 2 2 0.2 0 0 0 1",
    "",
  ].join("\n"));
  const pointCloud = binaryPly([
    [-1, -2, 0, 1],
    [0, 0, 0.5, 10],
    [1, 1, 1, 20],
    [2, 2, 1.5, 30],
    [3, -1, 2, 40],
    [1, -2, 0.25, 50],
  ]);
  const artifacts = [];
  for (const source of [
    ["frames-1", "COORDINATE_FRAMES", "application/vnd.brash.survey-coordinate-frames+json", frames, null],
    ["calibration-1", "CALIBRATION", "application/vnd.brash.survey-calibration+json", calibration, null],
    ["trajectory-1", "TRAJECTORY", "application/vnd.brash.trajectory+tum", trajectory, "slam-map"],
    ["point-cloud-1", "POINT_CLOUD_MAP", "model/vnd.ply", pointCloud, "slam-map"],
  ]) {
    const [artifactId, role, mediaType, content, frameId] = source;
    const sha256 = createHash("sha256").update(content).digest("hex");
    const uploadId = `source-${artifactId}`;
    await uploads.initiate({
      uploadId,
      expectedSha256: sha256,
      expectedBytes: content.byteLength,
      mediaType,
      originalName: artifactId,
      operatorId: "operator-1",
    });
    await store.putPart(uploadId, 1, content);
    await uploads.complete(uploadId, { operatorId: "operator-1" });
    artifacts.push({
      artifactId,
      role,
      path: artifactId,
      mediaType,
      sha256,
      bytes: content.byteLength,
      uploadId,
      frameId,
      sourceSensorIds: [],
      timeRange: null,
    });
  }
  return {
    schemaVersion: "brash.survey-materialization-snapshot/v1",
    intakeId: "intake-stream-1",
    draftId: "draft-stream-1",
    packageId: "package-stream-1",
    surveyId: "survey-stream-1",
    manifestSha256: "a".repeat(64),
    producer: { interface: "brash-embodied-controller" },
    capture: {
      startedAt: "2026-08-14T08:00:00.000Z",
      completedAt: "2026-08-14T08:00:01.000Z",
    },
    clock: { timeBase: "UTC" },
    coordinateSystem: {
      rootFrameId: "slam-map",
      lengthUnit: "METRE",
      handedness: "RIGHT_HANDED",
      upAxis: "Z",
    },
    quality: { outcome: "PASSED", trajectoryPoseCount: 5 },
    artifacts,
  };
}

function frame(frameId, parentFrameId, [x, y, z]) {
  return {
    frameId,
    parentFrameId,
    transformToParent: {
      translation: { x, y, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
  };
}

function sensor(sensorId, frameId, modality, model, digit) {
  return { sensorId, frameId, modality, model, parametersSha256: digit.repeat(64) };
}

function binaryPly(points) {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property float intensity",
    "end_header",
    "",
  ].join("\n"));
  const body = Buffer.alloc(points.length * 16);
  points.forEach((point, index) => point.forEach((value, component) => {
    body.writeFloatLE(value, index * 16 + component * 4);
  }));
  return Buffer.concat([header, body]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
