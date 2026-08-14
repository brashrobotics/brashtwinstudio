import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const EXTERNAL_DATASET_SCHEMA_VERSION = "brash.external-dataset/v1";
export const EXTERNAL_DATASET_SELECTION_SCHEMA_VERSION = "brash.external-dataset-selection/v1";
export const DATASET_INSPECTION_SCHEMA_VERSION = "brash.dataset-inspection/v1";

export class DatasetValidationError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "DatasetValidationError";
    this.report = report;
  }
}

export async function loadDatasetDescriptor(descriptorPath) {
  const descriptor = JSON.parse(await readFile(resolve(descriptorPath), "utf8"));
  validateDatasetDescriptor(descriptor);
  return descriptor;
}

export async function loadDatasetSelection(selectionPath) {
  const selection = JSON.parse(await readFile(resolve(selectionPath), "utf8"));
  validateDatasetSelection(selection);
  return selection;
}

export function validateDatasetSelection(selection) {
  if (!isRecord(selection)) throw new TypeError("Dataset selection must be an object.");
  if (selection.schemaVersion !== EXTERNAL_DATASET_SELECTION_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported dataset selection ${selection.schemaVersion ?? "<missing>"}.`);
  }
  for (const field of ["datasetId", "title"]) requireString(selection[field], field);
  for (const field of ["landingPage", "repository", "revision", "license"]) {
    requireString(selection.source?.[field], `source.${field}`);
  }
  if (!Number.isFinite(selection.source?.durationSeconds) || selection.source.durationSeconds <= 0) {
    throw new TypeError("source.durationSeconds must be positive.");
  }
  if (!isRecord(selection.diskPolicy)) throw new TypeError("diskPolicy must be an object.");
  positiveSafeInteger(selection.diskPolicy.maximumDownloadBytes, "diskPolicy.maximumDownloadBytes");
  positiveSafeInteger(selection.diskPolicy.minimumFreeBytesAfterDownload, "diskPolicy.minimumFreeBytesAfterDownload");
  if (selection.diskPolicy.downloadByDefault !== false) {
    throw new TypeError("External dataset selections must keep downloadByDefault disabled.");
  }

  const baseFiles = validateSelectionGroup(selection.baseSelection, "baseSelection", false);
  const optionalFiles = validateSelectionGroup(selection.optionalEvidence, "optionalEvidence", true);
  const paths = new Set();
  for (const [group, files] of [["baseSelection", baseFiles], ["optionalEvidence", optionalFiles]]) {
    for (const [index, file] of files.entries()) {
      if (paths.has(file.path)) throw new TypeError(`${group}.files[${index}].path is duplicated.`);
      paths.add(file.path);
    }
  }
  const baseBytes = baseFiles.reduce((total, file) => total + file.bytes, 0);
  const optionalBytes = optionalFiles.reduce((total, file) => total + file.bytes, 0);
  if (selection.baseSelection.declaredBytes !== baseBytes) {
    throw new TypeError("baseSelection.declaredBytes does not equal the selected file total.");
  }
  if (selection.optionalEvidence.declaredBytesWithBase !== baseBytes + optionalBytes) {
    throw new TypeError("optionalEvidence.declaredBytesWithBase does not equal the base and optional file total.");
  }
  if (selection.optionalEvidence.declaredBytesWithBase > selection.diskPolicy.maximumDownloadBytes) {
    throw new TypeError("Dataset selection exceeds diskPolicy.maximumDownloadBytes.");
  }
  return selection;
}

export async function verifyDatasetSelection(selection, datasetDirectory, { includeOptional = false } = {}) {
  validateDatasetSelection(selection);
  if (typeof includeOptional !== "boolean") throw new TypeError("includeOptional must be boolean.");
  const root = resolve(datasetDirectory);
  const expectedFiles = includeOptional
    ? [...selection.baseSelection.files, ...selection.optionalEvidence.files]
    : selection.baseSelection.files;
  const errors = [];
  const files = [];
  for (const expected of expectedFiles) {
    const path = resolveDatasetPath(root, expected.path);
    if (!path) {
      errors.push(issue("DATASET_PATH_UNSAFE", expected.path, "Path escapes the dataset directory."));
      continue;
    }
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("Dataset artifact must be a regular non-symbolic-link file.");
      }
      const digest = await hashFile(path, "sha256");
      if (metadata.size !== expected.bytes) {
        errors.push(issue("DATASET_SIZE_MISMATCH", expected.path, `Expected ${expected.bytes}; found ${metadata.size}.`));
      }
      if (digest !== expected.sha256) {
        errors.push(issue("DATASET_CHECKSUM_MISMATCH", expected.path, "SHA-256 digest does not match the pinned selection."));
      }
      files.push(Object.freeze({
        path: expected.path,
        sourcePath: expected.sourcePath,
        role: expected.role,
        bytes: metadata.size,
        sha256: digest,
      }));
    } catch (error) {
      errors.push(issue("DATASET_FILE_UNREADABLE", expected.path, error.message));
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    datasetId: selection.datasetId,
    revision: selection.source.revision,
    includeOptional,
    declaredBytes: expectedFiles.reduce((total, file) => total + file.bytes, 0),
    errors: Object.freeze(errors),
    files: Object.freeze(files),
  });
}

export function validateDatasetDescriptor(descriptor) {
  if (!isRecord(descriptor)) throw new TypeError("Dataset descriptor must be an object.");
  if (descriptor.schemaVersion !== EXTERNAL_DATASET_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported dataset descriptor ${descriptor.schemaVersion ?? "<missing>"}.`);
  }
  for (const field of ["datasetId", "title"]) requireString(descriptor[field], field);
  requireString(descriptor.source?.landingPage, "source.landingPage");
  requireString(descriptor.rights?.license, "rights.license");
  requireString(descriptor.rights?.purpose, "rights.purpose");
  if (!Array.isArray(descriptor.files) || descriptor.files.length === 0) {
    throw new TypeError("Dataset descriptor must declare files.");
  }
  const paths = new Set();
  for (const [index, file] of descriptor.files.entries()) {
    const prefix = `files[${index}]`;
    requireString(file?.path, `${prefix}.path`);
    requireString(file?.role, `${prefix}.role`);
    if (!/^[a-f0-9]{128}$/.test(file?.sha512 ?? "")) {
      throw new TypeError(`${prefix}.sha512 must be a lowercase SHA-512 digest.`);
    }
    if (!Number.isInteger(file?.bytes) || file.bytes < 1) {
      throw new TypeError(`${prefix}.bytes must be a positive integer.`);
    }
    if (!safeRelativePath(file.path)) throw new TypeError(`${prefix}.path is unsafe.`);
    if (paths.has(file.path)) throw new TypeError(`${prefix}.path is duplicated.`);
    paths.add(file.path);
  }
  return descriptor;
}

export async function verifyDatasetDirectory(descriptor, datasetDirectory) {
  validateDatasetDescriptor(descriptor);
  const root = resolve(datasetDirectory);
  const errors = [];
  const files = [];

  for (const expected of descriptor.files) {
    const path = resolveDatasetPath(root, expected.path);
    if (!path) {
      errors.push(issue("DATASET_PATH_UNSAFE", expected.path, "Path escapes the dataset directory."));
      continue;
    }
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("Dataset artifact must be a regular non-symbolic-link file.");
      }
      const digest = await hashFile(path, "sha512");
      if (metadata.size !== expected.bytes) {
        errors.push(issue("DATASET_SIZE_MISMATCH", expected.path, `Expected ${expected.bytes}; found ${metadata.size}.`));
      }
      if (digest !== expected.sha512) {
        errors.push(issue("DATASET_CHECKSUM_MISMATCH", expected.path, "SHA-512 digest does not match the published manifest."));
      }
      files.push({
        path: expected.path,
        role: expected.role,
        bytes: metadata.size,
        sha512: digest,
      });
    } catch (error) {
      errors.push(issue("DATASET_FILE_UNREADABLE", expected.path, error.message));
    }
  }

  return {
    valid: errors.length === 0,
    datasetId: descriptor.datasetId,
    errors,
    files,
  };
}

export async function inspectExternalDataset(descriptor, datasetDirectory) {
  const verification = await verifyDatasetDirectory(descriptor, datasetDirectory);
  if (!verification.valid) throw new DatasetValidationError("External dataset verification failed.", verification);

  const root = resolve(datasetDirectory);
  const bimFiles = descriptor.files.filter((file) => file.role === "BIM_REFERENCE");
  const trajectoryFiles = descriptor.files.filter((file) => file.role === "REFERENCE_TRAJECTORY");
  if (bimFiles.length !== 1) throw new TypeError("Dataset must declare exactly one BIM_REFERENCE file.");
  if (trajectoryFiles.length === 0) throw new TypeError("Dataset must declare at least one REFERENCE_TRAJECTORY file.");

  const bim = await inspectIfcStepFile(resolveDatasetPath(root, bimFiles[0].path));
  const trajectories = [];
  for (const file of trajectoryFiles) {
    trajectories.push({
      sessionId: file.sessionId ?? file.path,
      path: file.path,
      ...await inspectTumTrajectory(resolveDatasetPath(root, file.path)),
    });
  }

  return {
    schemaVersion: DATASET_INSPECTION_SCHEMA_VERSION,
    datasetId: descriptor.datasetId,
    title: descriptor.title,
    source: descriptor.source,
    rights: descriptor.rights,
    verification,
    bim,
    trajectories,
    summary: {
      trajectorySessionCount: trajectories.length,
      trajectorySampleCount: trajectories.reduce((sum, value) => sum + value.sampleCount, 0),
      trajectoryPathLengthMetres: round(
        trajectories.reduce((sum, value) => sum + value.pathLengthMetres, 0),
      ),
      trajectoryBounds: combineBounds(trajectories.map((value) => value.positionBounds)),
    },
  };
}

export async function inspectIfcStepFile(filePath) {
  const entityCounts = new Map();
  const siUnits = new Map();
  let schema = null;
  let sourceFileName = null;
  let totalEntityCount = 0;
  let unitAssignmentRefs = [];
  const storeys = [];

  for await (const line of lines(filePath)) {
    const trimmed = line.trim();
    const schemaMatch = trimmed.match(/^FILE_SCHEMA\(\('([^']+)'\)\);$/);
    if (schemaMatch) schema = schemaMatch[1];
    const fileNameMatch = trimmed.match(/^FILE_NAME\('((?:[^']|'')*)'/);
    if (fileNameMatch) sourceFileName = decodeStepString(fileNameMatch[1]);

    const entityMatch = trimmed.match(/^#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*\(/);
    if (!entityMatch) continue;
    const [, entityId, entityType] = entityMatch;
    totalEntityCount += 1;
    entityCounts.set(entityType, (entityCounts.get(entityType) ?? 0) + 1);

    if (entityType === "IFCSIUNIT" && trimmed.includes(".LENGTHUNIT.")) {
      const unitMatch = trimmed.match(/\.LENGTHUNIT\.,(\$|\.[A-Z]+\.),\.METRE\./);
      if (unitMatch) {
        const prefix = unitMatch[1] === "$" ? null : unitMatch[1].slice(1, -1);
        siUnits.set(entityId, { name: "METRE", prefix, toMetres: metricPrefixFactor(prefix) });
      }
    }
    if (entityType === "IFCUNITASSIGNMENT") {
      unitAssignmentRefs = [...trimmed.matchAll(/#(\d+)/g)].map((match) => match[1]);
    }
    if (entityType === "IFCBUILDINGSTOREY") {
      const storeyMatch = trimmed.match(/^#\d+=IFCBUILDINGSTOREY\('(?:[^']|'')*',#[^,]+,'((?:[^']|'')*)'.*,([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)\);$/);
      if (storeyMatch) {
        storeys.push({ name: decodeStepString(storeyMatch[1]), sourceElevation: Number(storeyMatch[2]) });
      }
    }
  }

  if (!schema) throw new Error("IFC FILE_SCHEMA was not found.");
  if (totalEntityCount === 0) throw new Error("IFC DATA section contains no entities.");
  const assignedLengthUnits = unitAssignmentRefs.map((id) => siUnits.get(id)).filter(Boolean);
  if (assignedLengthUnits.length !== 1) {
    throw new Error(`Expected one assigned IFC length unit; found ${assignedLengthUnits.length}.`);
  }
  const lengthUnit = assignedLengthUnits[0];
  const sortedStoreys = storeys
    .map((storey) => ({
      ...storey,
      elevationMetres: round(storey.sourceElevation * lengthUnit.toMetres),
    }))
    .sort((left, right) => left.elevationMetres - right.elevationMetres);

  return {
    format: "IFC-SPF",
    schema,
    sourceFileName,
    totalEntityCount,
    lengthUnit,
    spatialStructure: {
      projects: entityCounts.get("IFCPROJECT") ?? 0,
      sites: entityCounts.get("IFCSITE") ?? 0,
      buildings: entityCounts.get("IFCBUILDING") ?? 0,
      storeys: sortedStoreys,
    },
    elementCounts: {
      walls: (entityCounts.get("IFCWALL") ?? 0) + (entityCounts.get("IFCWALLSTANDARDCASE") ?? 0),
      slabs: entityCounts.get("IFCSLAB") ?? 0,
      doors: entityCounts.get("IFCDOOR") ?? 0,
      windows: entityCounts.get("IFCWINDOW") ?? 0,
      spaces: entityCounts.get("IFCSPACE") ?? 0,
      buildingElementProxies: entityCounts.get("IFCBUILDINGELEMENTPROXY") ?? 0,
    },
  };
}

export async function inspectTumTrajectory(filePath) {
  let sampleCount = 0;
  let previousTimestamp = null;
  let previousPosition = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let pathLengthMetres = 0;
  let periodSum = 0;
  let minimumPeriod = Number.POSITIVE_INFINITY;
  let maximumPeriod = 0;
  let minimumQuaternionNorm = Number.POSITIVE_INFINITY;
  let maximumQuaternionNorm = 0;
  let maximumQuaternionNormError = 0;
  const bounds = emptyBounds();
  let lineNumber = 0;

  for await (const line of lines(filePath)) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length !== 8) throw new Error(`Invalid TUM row at line ${lineNumber}: expected 8 numeric fields.`);
    const values = tokens.map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`Invalid TUM number at line ${lineNumber}.`);
    const [timestamp, x, y, z, qx, qy, qz, qw] = values;
    if (previousTimestamp !== null && timestamp <= previousTimestamp) {
      throw new Error(`TUM timestamps must increase strictly; line ${lineNumber} is out of order.`);
    }
    const position = [x, y, z];
    includePosition(bounds, position);
    if (previousPosition) pathLengthMetres += distance(previousPosition, position);
    if (previousTimestamp !== null) {
      const period = timestamp - previousTimestamp;
      periodSum += period;
      minimumPeriod = Math.min(minimumPeriod, period);
      maximumPeriod = Math.max(maximumPeriod, period);
    }
    const quaternionNorm = Math.hypot(qx, qy, qz, qw);
    minimumQuaternionNorm = Math.min(minimumQuaternionNorm, quaternionNorm);
    maximumQuaternionNorm = Math.max(maximumQuaternionNorm, quaternionNorm);
    maximumQuaternionNormError = Math.max(maximumQuaternionNormError, Math.abs(1 - quaternionNorm));
    if (maximumQuaternionNormError > 0.01) {
      throw new Error(`Quaternion norm differs from one by more than 0.01 at line ${lineNumber}.`);
    }
    firstTimestamp ??= timestamp;
    lastTimestamp = timestamp;
    previousTimestamp = timestamp;
    previousPosition = position;
    sampleCount += 1;
  }

  if (sampleCount < 2) throw new Error("TUM trajectory must contain at least two poses.");
  return {
    format: "TUM_TRAJECTORY",
    sampleCount,
    timestamp: {
      startEpochSeconds: round(firstTimestamp),
      endEpochSeconds: round(lastTimestamp),
      durationSeconds: round(lastTimestamp - firstTimestamp),
    },
    sampling: {
      meanPeriodSeconds: round(periodSum / (sampleCount - 1)),
      minimumPeriodSeconds: round(minimumPeriod),
      maximumPeriodSeconds: round(maximumPeriod),
    },
    positionBounds: finalizedBounds(bounds),
    pathLengthMetres: round(pathLengthMetres),
    quaternionNorm: {
      minimum: round(minimumQuaternionNorm),
      maximum: round(maximumQuaternionNorm),
      maximumAbsoluteError: round(maximumQuaternionNormError),
    },
    qualityWarnings: maximumPeriod > 10
      ? [{
          code: "REFERENCE_TRAJECTORY_GAP",
          message: `Largest interval between reference poses is ${round(maximumPeriod)} seconds.`,
        }]
      : [],
  };
}

export function boundsOverlap(left, right) {
  if (!left || !right) return false;
  return left.minimum.every((value, index) => value <= right.maximum[index])
    && right.minimum.every((value, index) => value <= left.maximum[index]);
}

export function boundsContain(container, candidate) {
  if (!container || !candidate) return false;
  return container.minimum.every((value, index) => value <= candidate.minimum[index])
    && container.maximum.every((value, index) => value >= candidate.maximum[index]);
}

async function* lines(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of reader) yield line;
}

function resolveDatasetPath(root, filePath) {
  if (!safeRelativePath(filePath)) return null;
  const resolved = resolve(root, filePath);
  const pathFromRoot = relative(root, resolved);
  if (pathFromRoot === "" || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") return null;
  return resolved;
}

function safeRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !isAbsolute(value)
    && value.split(/[\\/]/).every((part) => part !== "" && part !== "." && part !== "..");
}

function hashFile(path, algorithm) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function metricPrefixFactor(prefix) {
  const factors = { null: 1, MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 };
  const factor = factors[String(prefix)];
  if (!factor) throw new Error(`Unsupported IFC metric prefix ${prefix}.`);
  return factor;
}

function combineBounds(boundsList) {
  const combined = emptyBounds();
  for (const bounds of boundsList) {
    includePosition(combined, bounds.minimum);
    includePosition(combined, bounds.maximum);
  }
  return finalizedBounds(combined);
}

function emptyBounds() {
  return {
    minimum: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    maximum: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
}

function includePosition(bounds, position) {
  for (let index = 0; index < 3; index += 1) {
    bounds.minimum[index] = Math.min(bounds.minimum[index], position[index]);
    bounds.maximum[index] = Math.max(bounds.maximum[index], position[index]);
  }
}

function finalizedBounds(bounds) {
  return {
    minimum: bounds.minimum.map(round),
    maximum: bounds.maximum.map(round),
  };
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function decodeStepString(value) {
  return value.replaceAll("''", "'");
}

function round(value) {
  return Number(value.toFixed(9));
}

function issue(code, path, message) {
  return { code, path, message };
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string.`);
}

function validateSelectionGroup(group, path, declaredBytesIncludesBase) {
  if (!isRecord(group) || !Array.isArray(group.files) || group.files.length === 0) {
    throw new TypeError(`${path}.files must be a non-empty array.`);
  }
  const declaredField = declaredBytesIncludesBase ? "declaredBytesWithBase" : "declaredBytes";
  positiveSafeInteger(group[declaredField], `${path}.${declaredField}`);
  for (const [index, file] of group.files.entries()) {
    const prefix = `${path}.files[${index}]`;
    for (const field of ["path", "sourcePath", "role"]) requireString(file?.[field], `${prefix}.${field}`);
    if (!safeRelativePath(file.path) || !safeRelativePath(file.sourcePath)) {
      throw new TypeError(`${prefix}.path and sourcePath must be safe relative paths.`);
    }
    positiveSafeInteger(file.bytes, `${prefix}.bytes`);
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
      throw new TypeError(`${prefix}.sha256 must be a lowercase SHA-256 digest.`);
    }
  }
  return group.files;
}

function positiveSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer.`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
