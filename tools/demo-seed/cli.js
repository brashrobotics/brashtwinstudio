#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";

const baseUrl = (process.env.TWIN_API_BASE_URL ?? "http://127.0.0.1:4380").replace(/\/$/, "");
const objectStorePath = resolve(process.env.TWIN_OBJECT_STORE_PATH ?? ".local/object-store");
const store = new LocalMultipartArtifactStore(objectStorePath);
const operatorId = "demo-operator";

class ApiRequestError extends Error {
  constructor(method, path, code, detail) {
    super(`${method} ${path} failed: ${code} ${detail}`.trim());
    this.name = "ApiRequestError";
    this.code = code;
  }
}

await createCatalog();
await ensureRegistrationTarget();
const sources = sourceArtifacts();
const artifactUploads = [];
for (const source of sources) {
  const uploadId = `demo-${source.artifactId}`;
  await upload(uploadId, source.content, source.mediaType, source.path.split("/").at(-1));
  artifactUploads.push({ artifactId: source.artifactId, uploadId });
}
const manifest = surveyManifest(sources);
await upload("demo-survey-manifest", Buffer.from(JSON.stringify(manifest)), "application/json", "manifest.json");
const existingIntake = await getIfPresent(
  "/api/v1/survey-intakes/demo-intake-1",
  "SURVEY_INTAKE_NOT_FOUND",
);
if (!existingIntake) {
  await request("POST", "/api/v1/map-drafts/demo-draft-1/survey-intakes", {
    intakeId: "demo-intake-1",
    manifestUploadId: "demo-survey-manifest",
    artifactUploads,
    operatorId,
  });
}
await request("POST", "/api/v1/survey-intakes/demo-intake-1/verify", { operatorId });
const existingMaterialization = await getIfPresent(
  "/api/v1/survey-materializations/demo-materialization-1",
  "SURVEY_MATERIALIZATION_NOT_FOUND",
);
if (!existingMaterialization) {
  await request("POST", "/api/v1/survey-intakes/demo-intake-1/materializations", {
    jobId: "demo-materialization-1",
    operatorId,
  });
}
const materialization = await request("POST", "/api/v1/survey-materializations/demo-materialization-1/run", {
  workerId: "demo-materializer",
  operatorId,
});
const registrationList = await request("GET", "/api/v1/map-drafts/demo-draft-1/survey-registrations");
if (!registrationList.registrations.some(({ report }) => report.registrationId === "demo-registration-1")) {
  await request("POST", "/api/v1/map-drafts/demo-draft-1/survey-registrations", {
    registrationId: "demo-registration-1",
    materializationJobId: "demo-materialization-1",
    targetBindingId: "demo-floorplan-target",
    allowScale: false,
    operatorId,
    controlPoints: [
      { controlPointId: "cp-1", source: { x: -4, y: -3 }, target: { x: -9, y: -6 } },
      { controlPointId: "cp-2", source: { x: 4, y: -3 }, target: { x: -1, y: -6 } },
      { controlPointId: "cp-3", source: { x: 4, y: 3 }, target: { x: -1, y: 0 } },
    ],
  });
}

async function ensureRegistrationTarget() {
  const content = await readFile(resolve("tests/fixtures/floorplans/demo-floorplan.svg"));
  await upload("demo-floorplan-target", content, "image/svg+xml", "demo-floorplan.svg");
  const artifacts = await request("GET", "/api/v1/map-drafts/demo-draft-1/artifacts");
  if (artifacts.artifacts.some(({ bindingId }) => bindingId === "demo-floorplan-target")) return;
  await request("POST", "/api/v1/map-drafts/demo-draft-1/artifacts", {
    bindingId: "demo-floorplan-target",
    uploadId: "demo-floorplan-target",
    role: "FLOORPLAN_SOURCE",
    coordinateFrameId: "factory-floor",
    operatorId,
  });
}

console.log(JSON.stringify({
  siteId: "demo-site",
  draftId: "demo-draft-1",
  materializationJobId: materialization.job.jobId,
  previewBindingId: materialization.job.output.previewBindingId,
  registrationId: "demo-registration-1",
  studioUrl: "http://127.0.0.1:4390/",
}, null, 2));

async function createCatalog() {
  await createOrReuse("/api/v1/sites", {
    siteId: "demo-site",
    displayName: "Brash Demo Factory",
    timezone: "Europe/Istanbul",
    operatorId,
  });
  await createOrReuse("/api/v1/sites/demo-site/buildings", {
    buildingId: "main-building",
    displayName: "Main Building",
    operatorId,
  });
  await createOrReuse("/api/v1/sites/demo-site/buildings/main-building/floors", {
    floorId: "production-floor",
    displayName: "Production Floor",
    elevationMeters: 0,
    operatorId,
  });
  await createOrReuse("/api/v1/map-families", {
    familyId: "demo-factory-map",
    floorId: "production-floor",
    displayName: "Factory Twin",
    operatorId,
  });
  await createOrReuse("/api/v1/map-drafts", {
    draftId: "demo-draft-1",
    familyId: "demo-factory-map",
    revision: 1,
    canonicalFrameId: "factory-floor",
    operatorId,
  });
}

async function upload(uploadId, content, mediaType, originalName) {
  const expectedSha256 = sha256(content);
  const existing = await getIfPresent(`/api/v1/uploads/${uploadId}`, "UPLOAD_NOT_FOUND");
  if (existing) {
    const { session } = existing;
    if (session.status !== "COMPLETED"
      || session.expectedSha256 !== expectedSha256
      || session.expectedBytes !== content.byteLength
      || session.mediaType !== mediaType) {
      throw new Error(`Existing demo upload ${uploadId} does not match the deterministic seed.`);
    }
    return;
  }
  const initiated = await request("POST", "/api/v1/uploads", {
    uploadId,
    expectedSha256,
    expectedBytes: content.byteLength,
    mediaType,
    originalName,
    operatorId,
  });
  for (let offset = 0, part = 1;
    offset < content.byteLength;
    offset += initiated.upload.partSizeBytes, part += 1) {
    await store.putPart(uploadId, part, content.subarray(offset, offset + initiated.upload.partSizeBytes));
  }
  await request("POST", `/api/v1/uploads/${uploadId}/complete`, { operatorId });
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(
      method,
      path,
      payload.error?.code ?? String(response.status),
      payload.error?.message ?? "",
    );
  }
  return payload;
}

async function createOrReuse(path, body) {
  try {
    return await request("POST", path, body);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.code !== "CATALOG_CONFLICT") throw error;
    return null;
  }
}

async function getIfPresent(path, notFoundCode) {
  try {
    return await request("GET", path);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.code !== notFoundCode) throw error;
    return null;
  }
}

function sourceArtifacts() {
  const frames = Buffer.from(JSON.stringify({
    schemaVersion: "brash.survey-coordinate-frames/v1",
    rootFrameId: "slam-map",
    frames: [
      frame("slam-map", null, [0, 0, 0]),
      frame("base-link", "slam-map", [0, 0, 0.45]),
      frame("lidar-link", "base-link", [0.2, 0, 0.3]),
    ],
  }));
  const calibration = Buffer.from(JSON.stringify({
    schemaVersion: "brash.survey-calibration/v1",
    calibrationId: "demo-calibration",
    sensors: [
      { sensorId: "lidar-main", frameId: "lidar-link", modality: "LIDAR", model: "synthetic-32", parametersSha256: "8".repeat(64) },
      { sensorId: "imu-main", frameId: "base-link", modality: "IMU", model: "synthetic-imu", parametersSha256: "9".repeat(64) },
    ],
  }));
  const trajectory = Buffer.from([
    "1000 -4 -3 0 0 0 0 1",
    "1001 -2 -1 0.1 0 0 0 1",
    "1002 0 0 0.15 0 0 0 1",
    "1003 2 1 0.1 0 0 0 1",
    "1004 4 3 0 0 0 0 1",
    "",
  ].join("\n"));
  const points = [];
  for (let x = -4; x <= 4; x += 0.5) {
    for (let y = -3; y <= 3; y += 0.5) {
      const edge = Math.abs(x) === 4 || Math.abs(y) === 3;
      points.push([x, y, edge ? 1.8 : 0.08 + ((x + y + 7) % 4) * 0.08, edge ? 80 : 20]);
    }
  }
  const pointCloud = binaryPly(points);
  const quality = Buffer.from(JSON.stringify({ outcome: "PASSED", note: "Compact deterministic demo survey" }));
  return [
    artifact("frames-1", "COORDINATE_FRAMES", "frames/coordinate-frames.json", "application/vnd.brash.survey-coordinate-frames+json", frames),
    artifact("calibration-1", "CALIBRATION", "calibration/sensors.json", "application/vnd.brash.survey-calibration+json", calibration),
    artifact("trajectory-1", "TRAJECTORY", "trajectory/poses.tum", "application/vnd.brash.trajectory+tum", trajectory, "slam-map"),
    artifact("point-cloud-map-1", "POINT_CLOUD_MAP", "reconstruction/map.ply", "model/vnd.ply", pointCloud, "slam-map"),
    artifact("quality-report-1", "QUALITY_REPORT", "quality/report.json", "application/json", quality),
  ];
}

function artifact(artifactId, role, path, mediaType, content, frameId = null) {
  return { artifactId, role, path, mediaType, content, frameId, sha256: sha256(content), bytes: content.byteLength };
}

function surveyManifest(sources) {
  return {
    schemaVersion: "brash.embodied-survey-package/v1",
    packageId: "demo-package-1",
    surveyId: "demo-survey-1",
    siteId: "demo-site",
    floorId: "production-floor",
    robotId: "demo-robot",
    completionStatus: "COMPLETE",
    producer: {
      interface: "brash-embodied-controller",
      product: "brashembodiedcontroller",
      version: "0.1.0",
      buildSha256: "1".repeat(64),
      configurationSha256: "2".repeat(64),
      algorithm: { name: "synthetic-reconstruction", version: "1.0.0" },
    },
    capture: { startedAt: "2026-08-14T08:00:00.000Z", completedAt: "2026-08-14T08:00:04.000Z" },
    clock: { timeBase: "UTC", source: "demo", synchronized: true, maximumOffsetMilliseconds: 0 },
    coordinateSystem: { rootFrameId: "slam-map", robotBaseFrameId: "base-link", lengthUnit: "METRE", handedness: "RIGHT_HANDED", upAxis: "Z" },
    quality: { outcome: "PASSED", trajectoryPoseCount: 5, coverageRatio: 0.9, positionRmseMetres: 0.02 },
    artifacts: sources.map(({ content, frameId, ...source }) => ({
      ...source,
      ...(frameId ? { frameId } : {}),
      ...(source.role === "TRAJECTORY" ? {
        sourceSensorIds: ["lidar-main", "imu-main"],
        timeRange: { startedAt: "2026-08-14T08:00:00.000Z", completedAt: "2026-08-14T08:00:04.000Z" },
      } : {}),
      ...(source.role === "POINT_CLOUD_MAP" ? { sourceSensorIds: ["lidar-main"] } : {}),
    })),
  };
}

function frame(frameId, parentFrameId, [x, y, z]) {
  return { frameId, parentFrameId, transformToParent: { translation: { x, y, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
}

function binaryPly(points) {
  const header = Buffer.from([
    "ply", "format binary_little_endian 1.0", `element vertex ${points.length}`,
    "property float x", "property float y", "property float z", "property float intensity", "end_header", "",
  ].join("\n"));
  const body = Buffer.alloc(points.length * 16);
  points.forEach((point, index) => point.forEach((value, component) => body.writeFloatLE(value, index * 16 + component * 4)));
  return Buffer.concat([header, body]);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
