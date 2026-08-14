import { createHash, randomUUID } from "node:crypto";
import {
  MAP_DRAFT_STATUS,
  SURVEY_INTAKE_STATUS,
  TwinDomainError,
  UPLOAD_STATUS,
  completeSurveyIntakeRecord,
  createSurveyIntakeRecord,
} from "@brash-twin/domain";
import { validateEmbodiedSurveyPackage } from "@brash-twin/embodied-survey";
import { PersistenceError } from "@brash-twin/persistence";
import { UploadError } from "./uploads.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SurveyIntakeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SurveyIntakeError";
    this.code = code;
  }
}

export class SurveyIntakeService {
  #repository;
  #catalog;
  #uploads;
  #multipartStore;
  #clock;
  #intakeIdGenerator;
  #maximumManifestBytes;
  #policy;

  constructor({
    repository,
    catalog,
    uploads,
    multipartStore,
    clock = () => new Date(),
    intakeIdGenerator = randomUUID,
    maximumManifestBytes = 1024 * 1024,
    policy = {},
  }) {
    if (!repository
      || typeof repository.create !== "function"
      || typeof repository.get !== "function"
      || typeof repository.list !== "function"
      || typeof repository.complete !== "function") {
      throw new SurveyIntakeError("SURVEY_INTAKE_REPOSITORY_INVALID", "Survey intake repository operations are required.");
    }
    if (!catalog || typeof catalog.getMapDraftContext !== "function") {
      throw new SurveyIntakeError("SURVEY_INTAKE_CATALOG_INVALID", "Map draft context lookup is required.");
    }
    if (!uploads || typeof uploads.get !== "function") {
      throw new SurveyIntakeError("SURVEY_INTAKE_UPLOADS_INVALID", "Completed upload lookup is required.");
    }
    if (!multipartStore || typeof multipartStore.get !== "function") {
      throw new SurveyIntakeError("SURVEY_INTAKE_STORE_INVALID", "Manifest object-store lookup is required.");
    }
    if (typeof intakeIdGenerator !== "function") {
      throw new SurveyIntakeError("SURVEY_INTAKE_ID_GENERATOR_INVALID", "intakeIdGenerator must be a function.");
    }
    if (!Number.isSafeInteger(maximumManifestBytes) || maximumManifestBytes < 1 || maximumManifestBytes > 16 * 1024 * 1024) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_MANIFEST_LIMIT_INVALID",
        "maximumManifestBytes must be between 1 byte and 16 MiB.",
      );
    }
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      throw new SurveyIntakeError("SURVEY_INTAKE_POLICY_INVALID", "Survey intake policy must be an object.");
    }
    this.#repository = repository;
    this.#catalog = catalog;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#intakeIdGenerator = intakeIdGenerator;
    this.#maximumManifestBytes = maximumManifestBytes;
    this.#policy = Object.freeze({ ...policy });
  }

  async create(draftId, input) {
    identifier(draftId, "draftId");
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new SurveyIntakeError("SURVEY_INTAKE_INPUT_REQUIRED", "Survey intake input is required.");
    }
    requiredText(input.operatorId, "operatorId");
    const context = await this.#editableContext(draftId);
    identifier(input.manifestUploadId, "manifestUploadId");
    const mappings = normalizeArtifactUploads(input.artifactUploads);
    const manifestUpload = await this.#completedUpload(input.manifestUploadId, "manifestUploadId");
    if (!isJsonMediaType(manifestUpload.mediaType)) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_MANIFEST_MEDIA_TYPE_INVALID",
        "Manifest upload media type must be application/json or an application/*+json type.",
      );
    }
    const manifestBytes = completedBytes(manifestUpload);
    if (manifestBytes > this.#maximumManifestBytes) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_MANIFEST_TOO_LARGE",
        `Manifest upload exceeds the ${this.#maximumManifestBytes}-byte limit.`,
      );
    }
    const artifactUploads = await Promise.all(mappings.map(async (mapping) => {
      const upload = await this.#completedUpload(mapping.uploadId, `artifactUploads.${mapping.artifactId}`);
      return Object.freeze({
        artifactId: mapping.artifactId,
        uploadId: upload.uploadId,
        artifactSha256: upload.artifactSha256,
        bytes: completedBytes(upload),
        mediaType: upload.mediaType,
      });
    }));
    if (artifactUploads.some((mapping) => mapping.uploadId === manifestUpload.uploadId)) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_UPLOAD_MAPPING_INVALID",
        "The manifest upload cannot also be mapped as a survey artifact.",
      );
    }
    let record;
    try {
      record = createSurveyIntakeRecord({
        intakeId: input.intakeId ?? this.#intakeIdGenerator(),
        draftId: context.draft.draftId,
        manifestUploadId: manifestUpload.uploadId,
        manifestArtifactSha256: manifestUpload.artifactSha256,
        artifactUploads,
        operatorId: input.operatorId,
        occurredAt: this.#clock(),
      });
    } catch (error) {
      throw translateDomainError(error);
    }
    try {
      return await this.#repository.create(record);
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }

  async verify(intakeId, { operatorId } = {}) {
    identifier(intakeId, "intakeId");
    requiredText(operatorId, "operatorId");
    const current = await this.#get(intakeId);
    if (current.status !== SURVEY_INTAKE_STATUS.open) return current;
    const context = await this.#editableContext(current.draftId);
    const content = await this.#multipartStore.get(current.manifestArtifactSha256);
    let manifest = null;
    let report;
    const transferIssues = [];
    if (!Buffer.isBuffer(content) || content.byteLength > this.#maximumManifestBytes) {
      report = validateEmbodiedSurveyPackage(null, this.#policy);
      transferIssues.push(issue(
        "MANIFEST_CONTENT_INVALID",
        "manifestUploadId",
        `Stored manifest must be a byte buffer no larger than ${this.#maximumManifestBytes} bytes.`,
      ));
    } else {
      const observedManifestSha256 = createHash("sha256").update(content).digest("hex");
      if (observedManifestSha256 !== current.manifestArtifactSha256) {
        transferIssues.push(issue(
          "MANIFEST_CHECKSUM_MISMATCH",
          "manifestUploadId",
          "Stored manifest bytes no longer match the sealed upload SHA-256 identity.",
        ));
      }
      try {
        manifest = JSON.parse(content.toString("utf8"));
      } catch {
        transferIssues.push(issue("MANIFEST_JSON_INVALID", "manifestUploadId", "Stored manifest is not valid JSON."));
      }
      report = validateEmbodiedSurveyPackage(manifest, this.#policy);
    }
    if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
      if (manifest.siteId !== context.floor.siteId) {
        transferIssues.push(issue(
          "TARGET_SITE_MISMATCH",
          "siteId",
          `Manifest site ${String(manifest.siteId)} does not match target site ${context.floor.siteId}.`,
        ));
      }
      if (manifest.floorId !== context.floor.floorId) {
        transferIssues.push(issue(
          "TARGET_FLOOR_MISMATCH",
          "floorId",
          `Manifest floor ${String(manifest.floorId)} does not match target floor ${context.floor.floorId}.`,
        ));
      }
      verifyUploadMappings(manifest, current.artifactUploads, transferIssues);
    }
    report = mergeReportIssues(report, transferIssues);
    let completed;
    try {
      completed = completeSurveyIntakeRecord(current, {
        manifest,
        report,
        operatorId,
        occurredAt: this.#clock(),
      });
    } catch (error) {
      throw translateDomainError(error);
    }
    try {
      return await this.#repository.complete(completed, current.rowVersion);
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }

  async get(intakeId) {
    identifier(intakeId, "intakeId");
    return this.#get(intakeId);
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraftContext(draftId);
    return this.#repository.list(draftId);
  }

  async #get(intakeId) {
    const record = await this.#repository.get(intakeId);
    if (!record) throw new SurveyIntakeError("SURVEY_INTAKE_NOT_FOUND", `Survey intake ${intakeId} was not found.`);
    return record;
  }

  async #editableContext(draftId) {
    const context = await this.#catalog.getMapDraftContext(draftId);
    if (context.draft.status !== MAP_DRAFT_STATUS.draft) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_DRAFT_LOCKED",
        `Map draft ${draftId} is ${context.draft.status}; survey intake requires DRAFT.`,
      );
    }
    return context;
  }

  async #completedUpload(uploadId, location) {
    let upload;
    try {
      upload = await this.#uploads.get(uploadId);
    } catch (error) {
      if (error instanceof UploadError && error.code === "UPLOAD_NOT_FOUND") {
        throw new SurveyIntakeError(
          "SURVEY_INTAKE_UPLOAD_NOT_FOUND",
          `Upload ${uploadId} referenced by ${location} was not found.`,
          { cause: error },
        );
      }
      throw error;
    }
    if (upload.status !== UPLOAD_STATUS.completed || upload.artifactSha256 === null) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_UPLOAD_INCOMPLETE",
        `Upload ${uploadId} referenced by ${location} must complete integrity verification first.`,
      );
    }
    completedBytes(upload);
    return upload;
  }
}

function normalizeArtifactUploads(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new SurveyIntakeError(
      "SURVEY_INTAKE_UPLOAD_MAPPING_INVALID",
      "artifactUploads must contain between 1 and 256 mappings.",
    );
  }
  const artifactIds = new Set();
  const uploadIds = new Set();
  return value.map((mapping, index) => {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new SurveyIntakeError("SURVEY_INTAKE_UPLOAD_MAPPING_INVALID", `artifactUploads[${index}] must be an object.`);
    }
    const unsupported = Object.keys(mapping).filter((field) => !["artifactId", "uploadId"].includes(field));
    if (unsupported.length > 0) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_UPLOAD_MAPPING_INVALID",
        `artifactUploads[${index}] contains unsupported fields: ${unsupported.sort().join(", ")}.`,
      );
    }
    boundedText(mapping.artifactId, `artifactUploads[${index}].artifactId`, 1024);
    identifier(mapping.uploadId, `artifactUploads[${index}].uploadId`);
    if (artifactIds.has(mapping.artifactId) || uploadIds.has(mapping.uploadId)) {
      throw new SurveyIntakeError(
        "SURVEY_INTAKE_UPLOAD_MAPPING_INVALID",
        "Artifact IDs and upload IDs must be unique within an intake.",
      );
    }
    artifactIds.add(mapping.artifactId);
    uploadIds.add(mapping.uploadId);
    return Object.freeze({ artifactId: mapping.artifactId, uploadId: mapping.uploadId });
  });
}

function verifyUploadMappings(manifest, mappings, issues) {
  const manifestArtifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const byArtifactId = new Map(mappings.map((mapping) => [mapping.artifactId, mapping]));
  const declaredIds = new Set();
  for (const [index, artifact] of manifestArtifacts.entries()) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact) || typeof artifact.artifactId !== "string") continue;
    declaredIds.add(artifact.artifactId);
    const mapping = byArtifactId.get(artifact.artifactId);
    if (!mapping) {
      issues.push(issue(
        "UPLOAD_MAPPING_MISSING",
        `artifacts[${index}].artifactId`,
        `No completed upload is mapped to artifact ${artifact.artifactId}.`,
      ));
      continue;
    }
    if (mapping.artifactSha256 !== artifact.sha256) {
      issues.push(issue(
        "UPLOAD_CHECKSUM_MISMATCH",
        `artifacts[${index}].sha256`,
        `Mapped upload ${mapping.uploadId} does not match the declared SHA-256.`,
      ));
    }
    if (mapping.bytes !== artifact.bytes) {
      issues.push(issue(
        "UPLOAD_BYTES_MISMATCH",
        `artifacts[${index}].bytes`,
        `Mapped upload ${mapping.uploadId} does not match the declared byte length.`,
      ));
    }
    if (normalizeMediaType(mapping.mediaType) !== normalizeMediaType(artifact.mediaType)) {
      issues.push(issue(
        "UPLOAD_MEDIA_TYPE_MISMATCH",
        `artifacts[${index}].mediaType`,
        `Mapped upload ${mapping.uploadId} does not match the declared media type.`,
      ));
    }
  }
  for (const mapping of mappings) {
    if (!declaredIds.has(mapping.artifactId)) {
      issues.push(issue(
        "UPLOAD_MAPPING_EXTRA",
        "artifactUploads",
        `Upload mapping ${mapping.artifactId} is not declared by the manifest.`,
      ));
    }
  }
}

function mergeReportIssues(report, transferIssues) {
  if (transferIssues.length === 0) return report;
  const retainedValidatorIssues = report.issues.slice(0, Math.max(0, 256 - transferIssues.length));
  const issues = [...retainedValidatorIssues, ...transferIssues.slice(0, 256)];
  const rejected = report.outcome === "REJECTED" || transferIssues.some((entry) => entry.severity === "ERROR");
  const warnings = report.outcome === "ACCEPTED_WITH_WARNINGS" || issues.some((entry) => entry.severity === "WARNING");
  return deepFreeze({
    ...report,
    outcome: rejected ? "REJECTED" : warnings ? "ACCEPTED_WITH_WARNINGS" : "ACCEPTED",
    issues,
  });
}

function issue(code, location, message) {
  return Object.freeze({ code, severity: "ERROR", location, message });
}

function completedBytes(upload) {
  const bytes = upload.observedBytes ?? upload.expectedBytes;
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new SurveyIntakeError(
      "SURVEY_INTAKE_UPLOAD_IDENTITY_INVALID",
      `Completed upload ${String(upload.uploadId)} does not expose a valid byte length.`,
    );
  }
  return bytes;
}

function isJsonMediaType(value) {
  const normalized = normalizeMediaType(value);
  return normalized === "application/json" || (normalized.startsWith("application/") && normalized.endsWith("+json"));
}

function normalizeMediaType(value) {
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
}

function translateDomainError(error) {
  if (error instanceof TwinDomainError) {
    return new SurveyIntakeError(error.code, error.message, { cause: error });
  }
  return error;
}

function translatePersistenceError(error) {
  if (!(error instanceof PersistenceError)) return error;
  const code = ({
    ALREADY_EXISTS: "SURVEY_INTAKE_CONFLICT",
    NOT_FOUND: "SURVEY_INTAKE_NOT_FOUND",
    REFERENCE_NOT_FOUND: "SURVEY_INTAKE_REFERENCE_NOT_FOUND",
    CONCURRENCY_CONFLICT: "SURVEY_INTAKE_CONCURRENCY_CONFLICT",
    IMMUTABLE_IDENTITY: "SURVEY_INTAKE_IMMUTABLE",
    PROVENANCE_CONSTRAINT_VIOLATION: "SURVEY_INTAKE_PROVENANCE_INVALID",
  })[error.code] ?? "SURVEY_INTAKE_PERSISTENCE_ERROR";
  return new SurveyIntakeError(code, error.message, { cause: error });
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new SurveyIntakeError("SURVEY_INTAKE_ID_INVALID", `${fieldName} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SurveyIntakeError("SURVEY_INTAKE_FIELD_REQUIRED", `${fieldName} is required.`);
  }
}

function boundedText(value, fieldName, maximumLength) {
  if (typeof value !== "string"
    || value.trim() === ""
    || value.length > maximumLength
    || /[\0-\x1f\x7f]/.test(value)) {
    throw new SurveyIntakeError(
      "SURVEY_INTAKE_UPLOAD_MAPPING_INVALID",
      `${fieldName} must be non-empty text without control characters.`,
    );
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
