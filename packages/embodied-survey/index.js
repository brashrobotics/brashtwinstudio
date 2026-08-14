import { createHash } from "node:crypto";

export const EMBODIED_SURVEY_SCHEMA_VERSION = "brash.embodied-survey-package/v1";
export const EMBODIED_SURVEY_INGEST_REPORT_VERSION = "brash.embodied-survey-ingest-report/v1";

export const EMBODIED_SURVEY_ARTIFACT_ROLES = Object.freeze([
  "COORDINATE_FRAMES",
  "CALIBRATION",
  "TRAJECTORY",
  "POINT_CLOUD_MAP",
  "OCCUPANCY_GRID",
  "ELEVATION_MAP",
  "RECONSTRUCTED_MESH",
  "CAMERA_INDEX",
  "IMAGE_ARCHIVE",
  "QUALITY_REPORT",
  "RAW_SENSOR_RECORDING",
]);

export const DEFAULT_EMBODIED_SURVEY_INGEST_POLICY = Object.freeze({
  allowPartial: false,
  allowFailedQuality: false,
  requireSynchronizedClock: true,
  maximumClockOffsetMilliseconds: 50,
  maximumDeclaredBytes: Number.MAX_SAFE_INTEGER,
  maximumArtifacts: 256,
  maximumIssues: 256,
});

const REQUIRED_ROLES = Object.freeze([
  "COORDINATE_FRAMES",
  "CALIBRATION",
  "TRAJECTORY",
  "QUALITY_REPORT",
]);

const RECONSTRUCTION_ROLES = new Set([
  "POINT_CLOUD_MAP",
  "OCCUPANCY_GRID",
  "ELEVATION_MAP",
  "RECONSTRUCTED_MESH",
]);

const SPATIAL_ROLES = new Set([
  "TRAJECTORY",
  ...RECONSTRUCTION_ROLES,
  "CAMERA_INDEX",
  "IMAGE_ARCHIVE",
]);

const ROLE_SET = new Set(EMBODIED_SURVEY_ARTIFACT_ROLES);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;.*)?$/i;

export function validateEmbodiedSurveyPackage(manifest, policyOverrides = {}) {
  const policy = normalizePolicy(policyOverrides);
  const issues = [];
  const addIssue = (code, severity, location, message) => {
    if (issues.length < policy.maximumIssues) issues.push({ code, severity, location, message });
  };

  if (!isRecord(manifest)) {
    addIssue("MANIFEST_INVALID", "ERROR", "", "Manifest must be an object.");
    return reportFor(manifest, policy, [], issues);
  }

  rejectUnknownKeys(manifest, [
    "schemaVersion", "packageId", "surveyId", "siteId", "floorId", "robotId",
    "completionStatus", "producer", "capture", "clock", "coordinateSystem",
    "quality", "artifacts",
  ], "", addIssue);

  if (manifest.schemaVersion !== EMBODIED_SURVEY_SCHEMA_VERSION) {
    addIssue("SCHEMA_VERSION_UNSUPPORTED", "ERROR", "schemaVersion", `Expected ${EMBODIED_SURVEY_SCHEMA_VERSION}.`);
  }
  for (const field of ["packageId", "surveyId", "siteId", "floorId", "robotId"]) {
    if (!nonEmptyString(manifest[field])) addIssue("FIELD_REQUIRED", "ERROR", field, "A non-empty string is required.");
  }

  if (!isRecord(manifest.producer)) {
    addIssue("PRODUCER_REQUIRED", "ERROR", "producer", "Producer identity is required.");
  } else {
    rejectUnknownKeys(manifest.producer, [
      "interface", "product", "version", "buildSha256", "configurationSha256", "algorithm",
    ], "producer", addIssue);
    if (manifest.producer.interface !== "brash-embodied-controller") {
      addIssue("PRODUCER_INTERFACE_UNSUPPORTED", "ERROR", "producer.interface", "Producer must implement the brash-embodied-controller interface.");
    }
    for (const field of ["product", "version"]) {
      if (!nonEmptyString(manifest.producer[field])) addIssue("PRODUCER_FIELD_REQUIRED", "ERROR", `producer.${field}`, "A non-empty string is required.");
    }
    for (const field of ["buildSha256", "configurationSha256"]) {
      if (!SHA256_PATTERN.test(manifest.producer[field] ?? "")) addIssue("PRODUCER_HASH_INVALID", "ERROR", `producer.${field}`, "A lowercase SHA-256 digest is required.");
    }
    if (manifest.producer.algorithm !== undefined) {
      if (isRecord(manifest.producer.algorithm)) {
        rejectUnknownKeys(manifest.producer.algorithm, ["name", "version"], "producer.algorithm", addIssue);
      }
      if (!isRecord(manifest.producer.algorithm)
        || !nonEmptyString(manifest.producer.algorithm.name)
        || !nonEmptyString(manifest.producer.algorithm.version)) {
        addIssue("ALGORITHM_IDENTITY_INVALID", "ERROR", "producer.algorithm", "Algorithm name and version are required when algorithm identity is present.");
      }
    }
  }

  const capture = validateTimeRange(manifest.capture, "capture", addIssue);
  validateClock(manifest.clock, policy, addIssue);
  validateCoordinateSystem(manifest.coordinateSystem, addIssue);
  validateCompletionAndQuality(manifest, policy, addIssue);

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!Array.isArray(manifest.artifacts)) {
    addIssue("ARTIFACTS_REQUIRED", "ERROR", "artifacts", "Artifacts must be an array.");
  } else if (artifacts.length === 0) {
    addIssue("ARTIFACTS_EMPTY", "ERROR", "artifacts", "At least one artifact is required.");
  }
  if (artifacts.length > policy.maximumArtifacts) {
    addIssue("ARTIFACT_COUNT_EXCEEDED", "ERROR", "artifacts", `Artifact count exceeds ${policy.maximumArtifacts}.`);
  }

  const artifactIds = new Set();
  const paths = new Set();
  const roles = new Map();
  let declaredBytes = 0;
  for (const [index, artifact] of artifacts.entries()) {
    const location = `artifacts[${index}]`;
    if (!isRecord(artifact)) {
      addIssue("ARTIFACT_INVALID", "ERROR", location, "Artifact must be an object.");
      continue;
    }
    rejectUnknownKeys(artifact, [
      "artifactId", "role", "path", "mediaType", "sha256", "bytes", "frameId",
      "sourceSensorIds", "timeRange",
    ], location, addIssue);
    if (!nonEmptyString(artifact.artifactId)) {
      addIssue("ARTIFACT_ID_REQUIRED", "ERROR", `${location}.artifactId`, "A non-empty artifact ID is required.");
    } else if (artifactIds.has(artifact.artifactId)) {
      addIssue("ARTIFACT_ID_DUPLICATED", "ERROR", `${location}.artifactId`, "Artifact ID is duplicated.");
    } else artifactIds.add(artifact.artifactId);

    if (!ROLE_SET.has(artifact.role)) {
      addIssue("ARTIFACT_ROLE_UNSUPPORTED", "ERROR", `${location}.role`, "Artifact role is not part of the v1 transfer contract.");
    } else roles.set(artifact.role, (roles.get(artifact.role) ?? 0) + 1);

    if (!safeRelativePath(artifact.path)) {
      addIssue("ARTIFACT_PATH_UNSAFE", "ERROR", `${location}.path`, "Artifact path must be a safe forward-slash relative path.");
    } else if (paths.has(artifact.path)) {
      addIssue("ARTIFACT_PATH_DUPLICATED", "ERROR", `${location}.path`, "Artifact path is duplicated.");
    } else paths.add(artifact.path);

    if (!MEDIA_TYPE_PATTERN.test(artifact.mediaType ?? "")) {
      addIssue("ARTIFACT_MEDIA_TYPE_INVALID", "ERROR", `${location}.mediaType`, "A valid media type is required.");
    }
    if (!SHA256_PATTERN.test(artifact.sha256 ?? "")) {
      addIssue("ARTIFACT_HASH_INVALID", "ERROR", `${location}.sha256`, "A lowercase SHA-256 digest is required.");
    }
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) {
      addIssue("ARTIFACT_BYTES_INVALID", "ERROR", `${location}.bytes`, "Declared bytes must be a positive safe integer.");
    } else if (Number.isSafeInteger(declaredBytes + artifact.bytes)) {
      declaredBytes += artifact.bytes;
    } else {
      addIssue("DECLARED_BYTES_OVERFLOW", "ERROR", `${location}.bytes`, "Declared byte total exceeds the safe integer range.");
    }
    if (SPATIAL_ROLES.has(artifact.role) && !nonEmptyString(artifact.frameId)) {
      addIssue("ARTIFACT_FRAME_REQUIRED", "ERROR", `${location}.frameId`, "Spatial artifacts must declare a source frame.");
    }
    if (artifact.timeRange !== undefined) {
      const artifactRange = validateTimeRange(artifact.timeRange, `${location}.timeRange`, addIssue);
      if (capture && artifactRange
        && (artifactRange.startedAt < capture.startedAt || artifactRange.completedAt > capture.completedAt)) {
        addIssue("ARTIFACT_TIME_OUTSIDE_CAPTURE", "ERROR", `${location}.timeRange`, "Artifact time range must be contained by the capture interval.");
      }
    }
    if (artifact.sourceSensorIds !== undefined
      && (!Array.isArray(artifact.sourceSensorIds)
        || artifact.sourceSensorIds.some((sensorId) => !nonEmptyString(sensorId))
        || new Set(artifact.sourceSensorIds).size !== artifact.sourceSensorIds.length)) {
      addIssue("SOURCE_SENSOR_IDS_INVALID", "ERROR", `${location}.sourceSensorIds`, "Source sensor IDs must be unique non-empty strings.");
    }
  }

  for (const requiredRole of REQUIRED_ROLES) {
    if ((roles.get(requiredRole) ?? 0) !== 1) {
      addIssue("REQUIRED_ROLE_COUNT_INVALID", "ERROR", "artifacts", `Exactly one ${requiredRole} artifact is required.`);
    }
  }
  if (![...RECONSTRUCTION_ROLES].some((role) => (roles.get(role) ?? 0) > 0)) {
    addIssue("RECONSTRUCTION_REQUIRED", "ERROR", "artifacts", "At least one metric reconstruction artifact is required.");
  }
  if (declaredBytes > policy.maximumDeclaredBytes) {
    addIssue("DECLARED_BYTES_POLICY_EXCEEDED", "ERROR", "artifacts", `Declared ${declaredBytes} bytes exceed the policy limit of ${policy.maximumDeclaredBytes}.`);
  }

  return reportFor(manifest, policy, artifacts, issues, declaredBytes, roles);
}

function validateClock(clock, policy, addIssue) {
  if (!isRecord(clock)) {
    addIssue("CLOCK_REQUIRED", "ERROR", "clock", "Clock metadata is required.");
    return;
  }
  rejectUnknownKeys(clock, ["timeBase", "source", "synchronized", "maximumOffsetMilliseconds"], "clock", addIssue);
  if (!new Set(["UTC", "TAI", "MONOTONIC"]).has(clock.timeBase)) addIssue("CLOCK_TIME_BASE_INVALID", "ERROR", "clock.timeBase", "Clock time base is invalid.");
  if (!nonEmptyString(clock.source)) addIssue("CLOCK_SOURCE_REQUIRED", "ERROR", "clock.source", "Clock source is required.");
  if (typeof clock.synchronized !== "boolean") addIssue("CLOCK_SYNC_FLAG_REQUIRED", "ERROR", "clock.synchronized", "Clock synchronization flag is required.");
  if (!Number.isFinite(clock.maximumOffsetMilliseconds) || clock.maximumOffsetMilliseconds < 0) {
    addIssue("CLOCK_OFFSET_INVALID", "ERROR", "clock.maximumOffsetMilliseconds", "Clock offset must be a non-negative finite number.");
  } else if (clock.maximumOffsetMilliseconds > policy.maximumClockOffsetMilliseconds) {
    addIssue("CLOCK_OFFSET_POLICY_EXCEEDED", "ERROR", "clock.maximumOffsetMilliseconds", `Clock offset exceeds ${policy.maximumClockOffsetMilliseconds} ms.`);
  }
  if (policy.requireSynchronizedClock && clock.synchronized !== true) {
    addIssue("CLOCK_NOT_SYNCHRONIZED", "ERROR", "clock.synchronized", "A synchronized survey clock is required by policy.");
  }
}

function validateCoordinateSystem(coordinateSystem, addIssue) {
  if (!isRecord(coordinateSystem)) {
    addIssue("COORDINATE_SYSTEM_REQUIRED", "ERROR", "coordinateSystem", "Coordinate-system metadata is required.");
    return;
  }
  rejectUnknownKeys(coordinateSystem, ["rootFrameId", "robotBaseFrameId", "lengthUnit", "handedness", "upAxis"], "coordinateSystem", addIssue);
  for (const field of ["rootFrameId", "robotBaseFrameId"]) {
    if (!nonEmptyString(coordinateSystem[field])) addIssue("FRAME_ID_REQUIRED", "ERROR", `coordinateSystem.${field}`, "A non-empty frame ID is required.");
  }
  if (coordinateSystem.lengthUnit !== "METRE") addIssue("LENGTH_UNIT_UNSUPPORTED", "ERROR", "coordinateSystem.lengthUnit", "Twin Studio accepts metric survey coordinates only.");
  if (coordinateSystem.handedness !== "RIGHT_HANDED") addIssue("HANDEDNESS_UNSUPPORTED", "ERROR", "coordinateSystem.handedness", "Twin Studio accepts right-handed survey coordinates only.");
  if (coordinateSystem.upAxis !== "Z") addIssue("UP_AXIS_UNSUPPORTED", "ERROR", "coordinateSystem.upAxis", "Twin Studio accepts Z-up survey coordinates only.");
}

function validateCompletionAndQuality(manifest, policy, addIssue) {
  if (!new Set(["COMPLETE", "PARTIAL"]).has(manifest.completionStatus)) {
    addIssue("COMPLETION_STATUS_INVALID", "ERROR", "completionStatus", "Completion status must be COMPLETE or PARTIAL.");
  } else if (manifest.completionStatus === "PARTIAL") {
    addIssue("PARTIAL_SURVEY", policy.allowPartial ? "WARNING" : "ERROR", "completionStatus", "Survey package is partial.");
  }
  if (!isRecord(manifest.quality)) {
    addIssue("QUALITY_REQUIRED", "ERROR", "quality", "Quality summary is required.");
    return;
  }
  rejectUnknownKeys(manifest.quality, ["outcome", "trajectoryPoseCount", "coverageRatio", "positionRmseMetres"], "quality", addIssue);
  if (!new Set(["PASSED", "WARNING", "FAILED"]).has(manifest.quality.outcome)) {
    addIssue("QUALITY_OUTCOME_INVALID", "ERROR", "quality.outcome", "Quality outcome is invalid.");
  } else if (manifest.quality.outcome === "FAILED") {
    addIssue("QUALITY_FAILED", policy.allowFailedQuality ? "WARNING" : "ERROR", "quality.outcome", "Embodied Controller reported failed reconstruction quality.");
  } else if (manifest.quality.outcome === "WARNING") {
    addIssue("QUALITY_WARNING", "WARNING", "quality.outcome", "Embodied Controller reported reconstruction warnings.");
  }
  if (!Number.isSafeInteger(manifest.quality.trajectoryPoseCount) || manifest.quality.trajectoryPoseCount < 1) {
    addIssue("TRAJECTORY_POSE_COUNT_INVALID", "ERROR", "quality.trajectoryPoseCount", "Trajectory pose count must be a positive integer.");
  }
  if (manifest.quality.coverageRatio !== undefined
    && (!Number.isFinite(manifest.quality.coverageRatio) || manifest.quality.coverageRatio < 0 || manifest.quality.coverageRatio > 1)) {
    addIssue("COVERAGE_RATIO_INVALID", "ERROR", "quality.coverageRatio", "Coverage ratio must be between zero and one.");
  }
  if (manifest.quality.positionRmseMetres !== undefined
    && (!Number.isFinite(manifest.quality.positionRmseMetres) || manifest.quality.positionRmseMetres < 0)) {
    addIssue("POSITION_RMSE_INVALID", "ERROR", "quality.positionRmseMetres", "Position RMSE must be non-negative.");
  }
}

function validateTimeRange(value, location, addIssue) {
  if (!isRecord(value)) {
    addIssue("TIME_RANGE_REQUIRED", "ERROR", location, "A time range is required.");
    return null;
  }
  rejectUnknownKeys(value, ["startedAt", "completedAt"], location, addIssue);
  const startedAt = parseInstant(value.startedAt);
  const completedAt = parseInstant(value.completedAt);
  if (startedAt === null) addIssue("START_TIME_INVALID", "ERROR", `${location}.startedAt`, "A valid ISO-8601 instant is required.");
  if (completedAt === null) addIssue("END_TIME_INVALID", "ERROR", `${location}.completedAt`, "A valid ISO-8601 instant is required.");
  if (startedAt !== null && completedAt !== null && completedAt <= startedAt) {
    addIssue("TIME_RANGE_INVALID", "ERROR", location, "Completion time must be later than start time.");
  }
  return startedAt !== null && completedAt !== null ? { startedAt, completedAt } : null;
}

function reportFor(manifest, policy, artifacts, issues, declaredBytes = 0, roles = new Map()) {
  const errors = issues.filter((issue) => issue.severity === "ERROR").length;
  const warnings = issues.length - errors;
  return deepFreeze({
    schemaVersion: EMBODIED_SURVEY_INGEST_REPORT_VERSION,
    packageId: nonEmptyString(manifest?.packageId) ? manifest.packageId : null,
    manifestSha256: sha256(stableStringify(manifest)),
    outcome: errors > 0 ? "REJECTED" : warnings > 0 ? "ACCEPTED_WITH_WARNINGS" : "ACCEPTED",
    artifactCount: artifacts.length,
    declaredBytes,
    roles: Object.fromEntries([...roles.entries()].sort(([left], [right]) => left.localeCompare(right))),
    validator: {
      name: "brash-embodied-survey-validator",
      version: "1.0.0",
      policySha256: sha256(stableStringify(policy)),
    },
    issues,
  });
}

function normalizePolicy(overrides) {
  if (!isRecord(overrides)) throw new TypeError("Ingest policy overrides must be an object.");
  const policy = { ...DEFAULT_EMBODIED_SURVEY_INGEST_POLICY, ...overrides };
  for (const field of ["maximumDeclaredBytes", "maximumArtifacts", "maximumIssues"]) {
    if (!Number.isSafeInteger(policy[field]) || policy[field] < 1) throw new TypeError(`${field} must be a positive safe integer.`);
  }
  if (!Number.isFinite(policy.maximumClockOffsetMilliseconds) || policy.maximumClockOffsetMilliseconds < 0) {
    throw new TypeError("maximumClockOffsetMilliseconds must be a non-negative finite number.");
  }
  for (const field of ["allowPartial", "allowFailedQuality", "requireSynchronizedClock"]) {
    if (typeof policy[field] !== "boolean") throw new TypeError(`${field} must be boolean.`);
  }
  return Object.freeze(policy);
}

function safeRelativePath(value) {
  if (!nonEmptyString(value) || value.length > 1024 || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith("/")) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function rejectUnknownKeys(value, allowedKeys, location, addIssue) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue("FIELD_UNSUPPORTED", "ERROR", location ? `${location}.${key}` : key, "Field is not supported by the v1 contract.");
    }
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseInstant(value) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
