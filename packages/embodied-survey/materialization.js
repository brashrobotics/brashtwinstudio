import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

export const SURVEY_MATERIALIZATION_PREVIEW_VERSION = "brash.survey-materialization-preview/v1";

const DEFAULT_LIMITS = Object.freeze({
  maximumJsonBytes: 1024 * 1024,
  maximumTrajectoryBytes: 256 * 1024 * 1024,
  maximumTrajectoryPoses: 5_000_000,
  maximumPointCloudBytes: 2 * 1024 * 1024 * 1024,
  maximumPointCloudVertices: 50_000_000,
  maximumPreviewSamples: 4_096,
  maximumPreviewBytes: 4 * 1024 * 1024,
});

export class SurveyMaterializationAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SurveyMaterializationAdapterError";
    this.code = code;
  }
}

export async function createSurveyMaterializationPreview(snapshot, {
  openArtifactStream,
  limits: overrides = {},
} = {}) {
  if (!record(snapshot) || snapshot.schemaVersion !== "brash.survey-materialization-snapshot/v1") {
    throw failure("SURVEY_SNAPSHOT_INVALID", "A materialization snapshot v1 object is required.");
  }
  if (typeof openArtifactStream !== "function") {
    throw failure("SURVEY_STREAM_PORT_REQUIRED", "An artifact stream opener is required.");
  }
  const limits = normalizeLimits(overrides);
  const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
  const framesArtifact = exactlyOne(artifacts, "COORDINATE_FRAMES");
  const calibrationArtifact = exactlyOne(artifacts, "CALIBRATION");
  const trajectoryArtifact = exactlyOne(artifacts, "TRAJECTORY");
  const pointCloudArtifact = exactlyOne(artifacts, "POINT_CLOUD_MAP");
  mediaType(framesArtifact, "application/vnd.brash.survey-coordinate-frames+json");
  mediaType(calibrationArtifact, "application/vnd.brash.survey-calibration+json");
  mediaType(trajectoryArtifact, "application/vnd.brash.trajectory+tum");
  mediaType(pointCloudArtifact, "model/vnd.ply");

  const framesDocument = await readVerifiedJson(framesArtifact, openArtifactStream, limits.maximumJsonBytes);
  const frames = inspectFrames(framesDocument, snapshot.capture);
  if (frames.frameId !== snapshot.coordinateSystem?.rootFrameId) {
    throw failure(
      "SURVEY_ROOT_FRAME_MISMATCH",
      `Frame artifact root ${frames.frameId} does not match manifest root ${String(snapshot.coordinateSystem?.rootFrameId)}.`,
    );
  }
  const calibrationDocument = await readVerifiedJson(calibrationArtifact, openArtifactStream, limits.maximumJsonBytes);
  const calibration = inspectCalibration(
    calibrationDocument,
    new Set(framesDocument.frames.map((frame) => frame.frameId)),
  );
  const trajectory = await inspectTumTrajectory(
    trajectoryArtifact,
    openArtifactStream,
    snapshot.quality?.trajectoryPoseCount,
    limits,
  );
  const reconstruction = await inspectBinaryPly(pointCloudArtifact, openArtifactStream, limits);
  for (const artifact of [trajectoryArtifact, pointCloudArtifact]) {
    if (artifact.frameId !== frames.frameId) {
      throw failure(
        "SURVEY_SPATIAL_FRAME_MISMATCH",
        `${artifact.role} frame ${String(artifact.frameId)} does not match root frame ${frames.frameId}.`,
      );
    }
  }

  const qualityWarnings = [...trajectory.qualityWarnings];
  delete trajectory.qualityWarnings;
  const preview = {
    schemaVersion: SURVEY_MATERIALIZATION_PREVIEW_VERSION,
    source: {
      kind: "ACCEPTED_INTAKE",
      sourceId: snapshot.intakeId,
      revision: snapshot.manifestSha256,
    },
    coordinateSystem: structuredClone(snapshot.coordinateSystem),
    trajectory,
    coordinateFrames: frames,
    calibration,
    reconstruction: { ...reconstruction, frameId: frames.frameId },
    qualityWarnings,
    generatedBy: { name: "brash-survey-materializer", version: "1.0.0" },
  };
  if (Buffer.byteLength(JSON.stringify(preview)) > limits.maximumPreviewBytes) {
    throw failure("SURVEY_PREVIEW_LIMIT_EXCEEDED", `Materialization preview exceeds ${limits.maximumPreviewBytes} bytes.`);
  }
  return deepFreeze(preview);
}

export function serializeSurveyMaterializationPreview(preview) {
  if (preview?.schemaVersion !== SURVEY_MATERIALIZATION_PREVIEW_VERSION) {
    throw failure("SURVEY_PREVIEW_INVALID", "A survey materialization preview v1 is required.");
  }
  return Buffer.from(`${JSON.stringify(preview)}\n`);
}

async function readVerifiedJson(artifact, openArtifactStream, maximumBytes) {
  if (artifact.bytes > maximumBytes) {
    throw failure("SURVEY_JSON_LIMIT_EXCEEDED", `${artifact.role} exceeds the ${maximumBytes}-byte JSON limit.`);
  }
  const chunks = [];
  for await (const chunk of verifiedChunks(artifact, openArtifactStream, maximumBytes)) chunks.push(chunk);
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!record(value)) throw new Error("JSON root is not an object.");
    return value;
  } catch (error) {
    throw failure("SURVEY_JSON_INVALID", `${artifact.role} is invalid JSON: ${error.message}`);
  }
}

function inspectFrames(document, capture) {
  if (document.schemaVersion !== "brash.survey-coordinate-frames/v1"
    || !text(document.rootFrameId)
    || !Array.isArray(document.frames)
    || document.frames.length < 1
    || document.frames.length > 256) {
    throw failure("SURVEY_FRAMES_INVALID", "Coordinate frames must follow brash.survey-coordinate-frames/v1.");
  }
  const byId = new Map();
  let rootCount = 0;
  const translations = [];
  const norms = [];
  for (const [index, frame] of document.frames.entries()) {
    if (!record(frame) || !text(frame.frameId) || byId.has(frame.frameId)) {
      throw failure("SURVEY_FRAMES_INVALID", `frames[${index}] has an invalid or duplicate frameId.`);
    }
    if (frame.parentFrameId === null) rootCount += 1;
    else if (!text(frame.parentFrameId)) throw failure("SURVEY_FRAMES_INVALID", `frames[${index}].parentFrameId is invalid.`);
    const translation = objectVector(frame.transformToParent?.translation, `frames[${index}].translation`);
    const rotation = objectQuaternion(frame.transformToParent?.rotation, `frames[${index}].rotation`);
    const norm = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
    if (Math.abs(1 - norm) > 0.01) {
      throw failure("SURVEY_FRAMES_INVALID", `frames[${index}] quaternion norm differs from one by more than 0.01.`);
    }
    byId.set(frame.frameId, frame);
    translations.push([translation.x, translation.y, translation.z]);
    norms.push(norm);
  }
  const root = byId.get(document.rootFrameId);
  if (!root || root.parentFrameId !== null || rootCount !== 1) {
    throw failure("SURVEY_FRAMES_INVALID", "Frame tree must contain exactly one declared root frame.");
  }
  for (const frame of document.frames) {
    if (frame.parentFrameId !== null && !byId.has(frame.parentFrameId)) {
      throw failure("SURVEY_FRAMES_INVALID", `Frame ${frame.frameId} references missing parent ${frame.parentFrameId}.`);
    }
    const visited = new Set();
    let current = frame;
    while (current.parentFrameId !== null) {
      if (visited.has(current.frameId)) throw failure("SURVEY_FRAMES_INVALID", "Frame tree contains a cycle.");
      visited.add(current.frameId);
      current = byId.get(current.parentFrameId);
    }
  }
  const representative = document.frames.find((frame) => frame.parentFrameId !== null) ?? root;
  return {
    format: "BRASH_SURVEY_COORDINATE_FRAMES_V1",
    frameId: document.rootFrameId,
    sampleCount: document.frames.length,
    timestamp: captureTimestamp(capture),
    translationBounds: bounds(translations),
    quaternionNorm: { minimum: round(Math.min(...norms)), maximum: round(Math.max(...norms)) },
    staticTransform: {
      base_frame_id: representative.parentFrameId ?? representative.frameId,
      child_frame_id: representative.frameId,
      translation: structuredClone(representative.transformToParent.translation),
      rotation: structuredClone(representative.transformToParent.rotation),
    },
  };
}

function inspectCalibration(document, frameIds) {
  if (document.schemaVersion !== "brash.survey-calibration/v1"
    || !text(document.calibrationId)
    || !Array.isArray(document.sensors)
    || document.sensors.length < 1
    || document.sensors.length > 256) {
    throw failure("SURVEY_CALIBRATION_INVALID", "Calibration must follow brash.survey-calibration/v1.");
  }
  const sensorIds = new Set();
  const modalities = {};
  for (const [index, sensor] of document.sensors.entries()) {
    if (!record(sensor)
      || !text(sensor.sensorId)
      || sensorIds.has(sensor.sensorId)
      || !frameIds.has(sensor.frameId)
      || !["LIDAR", "CAMERA", "IMU", "ODOMETRY"].includes(sensor.modality)
      || !text(sensor.model)
      || !/^[a-f0-9]{64}$/.test(sensor.parametersSha256 ?? "")) {
      throw failure("SURVEY_CALIBRATION_INVALID", `sensors[${index}] is invalid or references an unknown frame.`);
    }
    sensorIds.add(sensor.sensorId);
    modalities[sensor.modality] = (modalities[sensor.modality] ?? 0) + 1;
  }
  return {
    format: "BRASH_SURVEY_CALIBRATION_V1",
    calibrationId: document.calibrationId,
    sensorCount: document.sensors.length,
    modalities: Object.fromEntries(Object.entries(modalities).sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function inspectTumTrajectory(artifact, openArtifactStream, expectedPoseCount, limits) {
  if (!Number.isInteger(expectedPoseCount) || expectedPoseCount < 2 || expectedPoseCount > limits.maximumTrajectoryPoses) {
    throw failure("SURVEY_TRAJECTORY_LIMIT_INVALID", "Manifest trajectory pose count is outside the worker limit.");
  }
  if (artifact.bytes > limits.maximumTrajectoryBytes) {
    throw failure("SURVEY_TRAJECTORY_LIMIT_EXCEEDED", "Trajectory artifact exceeds the worker byte limit.");
  }
  const previewStride = Math.max(1, Math.ceil(expectedPoseCount / limits.maximumPreviewSamples));
  const preview = [];
  const periodSample = [];
  const positionBounds = emptyBounds();
  let sampleCount = 0;
  let lineNumber = 0;
  let previousTimestamp = null;
  let previousPosition = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let pathLength = 0;
  let maximumStep = 0;
  let maximumPeriod = 0;
  let minimumNorm = Number.POSITIVE_INFINITY;
  let maximumNorm = 0;
  const readable = Readable.from(verifiedChunks(artifact, openArtifactStream, limits.maximumTrajectoryBytes));
  const lines = createInterface({ input: readable, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length !== 8) throw failure("SURVEY_TRAJECTORY_INVALID", `TUM line ${lineNumber} must contain eight numbers.`);
    const values = tokens.map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      throw failure("SURVEY_TRAJECTORY_INVALID", `TUM line ${lineNumber} contains a non-finite value.`);
    }
    const [timestamp, x, y, z, qx, qy, qz, qw] = values;
    if (previousTimestamp !== null && timestamp <= previousTimestamp) {
      throw failure("SURVEY_TRAJECTORY_TIME_INVALID", `TUM timestamp at line ${lineNumber} is not strictly increasing.`);
    }
    const quaternionNorm = Math.hypot(qx, qy, qz, qw);
    if (Math.abs(1 - quaternionNorm) > 0.01) {
      throw failure("SURVEY_TRAJECTORY_QUATERNION_INVALID", `TUM quaternion at line ${lineNumber} is not normalized.`);
    }
    const position = [x, y, z];
    include(positionBounds, position);
    if (previousPosition) {
      const step = distance(previousPosition, position);
      pathLength += step;
      maximumStep = Math.max(maximumStep, step);
    }
    if (previousTimestamp !== null) {
      const period = timestamp - previousTimestamp;
      maximumPeriod = Math.max(maximumPeriod, period);
      if (periodSample.length < 8_192) periodSample.push(period);
    }
    if (sampleCount % previewStride === 0 && preview.length < limits.maximumPreviewSamples) {
      preview.push({ timestamp: round(timestamp), position: position.map(round) });
    }
    firstTimestamp ??= timestamp;
    lastTimestamp = timestamp;
    previousTimestamp = timestamp;
    previousPosition = position;
    minimumNorm = Math.min(minimumNorm, quaternionNorm);
    maximumNorm = Math.max(maximumNorm, quaternionNorm);
    sampleCount += 1;
    if (sampleCount > limits.maximumTrajectoryPoses) {
      throw failure("SURVEY_TRAJECTORY_LIMIT_EXCEEDED", "Trajectory pose count exceeds the worker limit.");
    }
  }
  if (sampleCount !== expectedPoseCount) {
    throw failure(
      "SURVEY_TRAJECTORY_COUNT_MISMATCH",
      `Manifest declares ${expectedPoseCount} poses but trajectory contains ${sampleCount}.`,
    );
  }
  periodSample.sort((left, right) => left - right);
  const medianPeriod = periodSample[Math.floor(periodSample.length / 2)];
  return {
    format: "TUM_TRAJECTORY",
    frameId: artifact.frameId,
    sampleCount,
    timestamp: {
      startEpochSeconds: round(firstTimestamp),
      endEpochSeconds: round(lastTimestamp),
      durationSeconds: round(lastTimestamp - firstTimestamp),
      nonIncreasingCount: 0,
    },
    sampling: { medianRateHz: round(1 / medianPeriod) },
    positionBounds: finalizedBounds(positionBounds),
    pathLengthMetres: round(pathLength),
    maximumStepMetres: round(maximumStep),
    quaternionNorm: { minimum: round(minimumNorm), maximum: round(maximumNorm) },
    preview: { method: "STRIDE", sourceStride: previewStride, poses: preview },
    qualityWarnings: maximumPeriod > 2
      ? [{ code: "TRAJECTORY_TIME_GAP", message: `Largest trajectory interval is ${round(maximumPeriod)} seconds.` }]
      : [],
  };
}

async function inspectBinaryPly(artifact, openArtifactStream, limits) {
  if (artifact.bytes > limits.maximumPointCloudBytes) {
    throw failure("SURVEY_POINT_CLOUD_LIMIT_EXCEEDED", "Point-cloud artifact exceeds the worker byte limit.");
  }
  const pointBounds = emptyBounds();
  let intensityMinimum = Number.POSITIVE_INFINITY;
  let intensityMaximum = Number.NEGATIVE_INFINITY;
  let header = Buffer.alloc(0);
  let headerBytes = null;
  let vertexCount = null;
  let previewStride = null;
  let recordBytes = Buffer.alloc(0);
  let observedVertices = 0;
  const preview = [];
  for await (const chunk of verifiedChunks(artifact, openArtifactStream, limits.maximumPointCloudBytes)) {
    let data = chunk;
    if (headerBytes === null) {
      header = Buffer.concat([header, data]);
      if (header.byteLength > 65_536) throw failure("SURVEY_PLY_HEADER_INVALID", "PLY header exceeds 64 KiB.");
      const end = plyHeaderEnd(header);
      if (end === -1) continue;
      const parsed = parsePlyHeader(header.subarray(0, end));
      vertexCount = parsed.vertexCount;
      if (vertexCount > limits.maximumPointCloudVertices) {
        throw failure("SURVEY_POINT_CLOUD_LIMIT_EXCEEDED", "PLY vertex count exceeds the worker limit.");
      }
      headerBytes = end;
      if (headerBytes + vertexCount * 16 !== artifact.bytes) {
        throw failure("SURVEY_PLY_SIZE_MISMATCH", "PLY byte length does not match its vertex declaration.");
      }
      previewStride = Math.max(1, Math.ceil(vertexCount / limits.maximumPreviewSamples));
      data = header.subarray(end);
      header = Buffer.alloc(0);
    }
    recordBytes = Buffer.concat([recordBytes, data]);
    const completeBytes = recordBytes.byteLength - (recordBytes.byteLength % 16);
    for (let offset = 0; offset < completeBytes; offset += 16) {
      const point = [
        recordBytes.readFloatLE(offset),
        recordBytes.readFloatLE(offset + 4),
        recordBytes.readFloatLE(offset + 8),
      ];
      const intensity = recordBytes.readFloatLE(offset + 12);
      if (![...point, intensity].every(Number.isFinite)) {
        throw failure("SURVEY_POINT_CLOUD_INVALID", `PLY vertex ${observedVertices} contains a non-finite value.`);
      }
      include(pointBounds, point);
      intensityMinimum = Math.min(intensityMinimum, intensity);
      intensityMaximum = Math.max(intensityMaximum, intensity);
      if (observedVertices % previewStride === 0 && preview.length < limits.maximumPreviewSamples) {
        preview.push([...point.map(round), round(intensity)]);
      }
      observedVertices += 1;
    }
    recordBytes = recordBytes.subarray(completeBytes);
  }
  if (headerBytes === null || recordBytes.byteLength !== 0 || observedVertices !== vertexCount) {
    throw failure("SURVEY_PLY_SIZE_MISMATCH", "PLY stream ended before its declared vertices were read.");
  }
  return {
    format: "PLY_BINARY_LITTLE_ENDIAN",
    vertexCount,
    attributes: ["x", "y", "z", "intensity"],
    bounds: finalizedBounds(pointBounds),
    intensity: { minimum: round(intensityMinimum), maximum: round(intensityMaximum) },
    preview: { method: "STRIDE", sourceStride: previewStride, points: preview },
  };
}

async function* verifiedChunks(artifact, openArtifactStream, maximumBytes) {
  if (!record(artifact)
    || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")
    || !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes < 1
    || artifact.bytes > maximumBytes) {
    throw failure("SURVEY_ARTIFACT_IDENTITY_INVALID", `${String(artifact?.role)} artifact identity is invalid.`);
  }
  const stream = await openArtifactStream(artifact.sha256);
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
    throw failure("SURVEY_STREAM_INVALID", `${artifact.role} stream is not async iterable.`);
  }
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    bytes += chunk.byteLength;
    if (bytes > artifact.bytes || bytes > maximumBytes) {
      throw failure("SURVEY_ARTIFACT_SIZE_MISMATCH", `${artifact.role} stream exceeds its sealed byte length.`);
    }
    digest.update(chunk);
    yield chunk;
  }
  if (bytes !== artifact.bytes || digest.digest("hex") !== artifact.sha256) {
    throw failure("SURVEY_ARTIFACT_INTEGRITY_FAILED", `${artifact.role} stream does not match its sealed identity.`);
  }
}

function parsePlyHeader(buffer) {
  const lines = buffer.toString("ascii").replaceAll("\r\n", "\n").trimEnd().split("\n");
  if (lines[0] !== "ply" || lines[1] !== "format binary_little_endian 1.0") {
    throw failure("SURVEY_PLY_FORMAT_UNSUPPORTED", "PLY must be binary little-endian version 1.0.");
  }
  const vertexLines = lines.filter((line) => line.startsWith("element vertex "));
  const properties = lines.filter((line) => line.startsWith("property "));
  if (vertexLines.length !== 1
    || properties.join("|") !== "property float x|property float y|property float z|property float intensity") {
    throw failure("SURVEY_PLY_FORMAT_UNSUPPORTED", "PLY must contain only float x, y, z, and intensity vertex properties.");
  }
  const vertexCount = Number(vertexLines[0].slice("element vertex ".length));
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 1) {
    throw failure("SURVEY_PLY_HEADER_INVALID", "PLY vertex count is invalid.");
  }
  return { vertexCount };
}

function plyHeaderEnd(buffer) {
  const unix = buffer.indexOf(Buffer.from("end_header\n"));
  if (unix !== -1) return unix + Buffer.byteLength("end_header\n");
  const windows = buffer.indexOf(Buffer.from("end_header\r\n"));
  return windows === -1 ? -1 : windows + Buffer.byteLength("end_header\r\n");
}

function exactlyOne(artifacts, role) {
  const matches = artifacts.filter((artifact) => artifact?.role === role);
  if (matches.length !== 1) {
    throw failure("SURVEY_ARTIFACT_ROLE_INVALID", `Materialization requires exactly one ${role} artifact.`);
  }
  return matches[0];
}

function mediaType(artifact, expected) {
  if (artifact.mediaType !== expected) {
    throw failure("SURVEY_ARTIFACT_MEDIA_TYPE_UNSUPPORTED", `${artifact.role} must use ${expected}.`);
  }
}

function captureTimestamp(capture) {
  const start = new Date(capture?.startedAt).getTime() / 1_000;
  const end = new Date(capture?.completedAt).getTime() / 1_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw failure("SURVEY_CAPTURE_INVALID", "Snapshot capture interval is invalid.");
  }
  return {
    startEpochSeconds: round(start),
    endEpochSeconds: round(end),
    durationSeconds: round(end - start),
    nonIncreasingCount: 0,
  };
}

function normalizeLimits(overrides) {
  if (!record(overrides)) throw failure("SURVEY_LIMITS_INVALID", "Worker limits must be an object.");
  const unsupported = Object.keys(overrides).filter((key) => !Object.hasOwn(DEFAULT_LIMITS, key));
  if (unsupported.length > 0) throw failure("SURVEY_LIMITS_INVALID", `Unsupported worker limits: ${unsupported.join(", ")}.`);
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw failure("SURVEY_LIMITS_INVALID", `${name} must be positive.`);
  }
  return Object.freeze(limits);
}

function objectVector(value, location) {
  if (!record(value) || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw failure("SURVEY_FRAMES_INVALID", `${location} must contain finite x, y, z values.`);
  }
  return value;
}

function objectQuaternion(value, location) {
  if (!record(value) || ![value.x, value.y, value.z, value.w].every(Number.isFinite)) {
    throw failure("SURVEY_FRAMES_INVALID", `${location} must contain finite x, y, z, w values.`);
  }
  return value;
}

function bounds(vectors) {
  const value = emptyBounds();
  for (const vector of vectors) include(value, vector);
  return finalizedBounds(value);
}

function emptyBounds() {
  return {
    minimum: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    maximum: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
}

function include(target, vector) {
  for (let index = 0; index < 3; index += 1) {
    target.minimum[index] = Math.min(target.minimum[index], vector[index]);
    target.maximum[index] = Math.max(target.maximum[index], vector[index]);
  }
}

function finalizedBounds(value) {
  return { minimum: value.minimum.map(round), maximum: value.maximum.map(round) };
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function round(value) {
  return Number(Number(value).toFixed(9));
}

function text(value) {
  return typeof value === "string" && value.trim() !== "" && value.length <= 256;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(code, message) {
  return new SurveyMaterializationAdapterError(code, message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
