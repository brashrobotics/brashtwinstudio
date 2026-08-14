import { createHash, randomUUID } from "node:crypto";
import {
  MAP_DRAFT_STATUS,
  SURVEY_INTAKE_STATUS,
  TwinDomainError,
  createSurveyMaterializationJobRecord,
} from "@brash-twin/domain";
import { validateEmbodiedSurveyPackage } from "@brash-twin/embodied-survey";
import { PersistenceError } from "@brash-twin/persistence";

export class SurveyMaterializationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SurveyMaterializationError";
    this.code = code;
  }
}

export class SurveyMaterializationService {
  #repository;
  #surveyIntakes;
  #catalog;
  #multipartStore;
  #clock;
  #jobIdGenerator;
  #maximumManifestBytes;
  #policy;

  constructor({
    repository,
    surveyIntakes,
    catalog,
    multipartStore,
    clock = () => new Date(),
    jobIdGenerator = () => `materialization-${randomUUID()}`,
    maximumManifestBytes = 1024 * 1024,
    policy = {},
  }) {
    if (!repository
      || typeof repository.create !== "function"
      || typeof repository.get !== "function"
      || typeof repository.list !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_REPOSITORY_INVALID",
        "Materialization repository create/get/list operations are required.",
      );
    }
    if (!surveyIntakes || typeof surveyIntakes.get !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_INTAKE_SERVICE_INVALID",
        "Survey intake lookup is required.",
      );
    }
    if (!catalog || typeof catalog.getMapDraftContext !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_CATALOG_INVALID",
        "Map draft context lookup is required.",
      );
    }
    if (!multipartStore || typeof multipartStore.get !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_STORE_INVALID",
        "Multipart object-store manifest reads are required.",
      );
    }
    if (typeof clock !== "function" || typeof jobIdGenerator !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_CONFIGURATION_INVALID",
        "Clock and job ID generator must be functions.",
      );
    }
    if (!Number.isSafeInteger(maximumManifestBytes)
      || maximumManifestBytes < 1
      || maximumManifestBytes > 16 * 1024 * 1024) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_CONFIGURATION_INVALID",
        "maximumManifestBytes must be between 1 byte and 16 MiB.",
      );
    }
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_CONFIGURATION_INVALID",
        "Survey validation policy must be an object.",
      );
    }
    this.#repository = repository;
    this.#surveyIntakes = surveyIntakes;
    this.#catalog = catalog;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#jobIdGenerator = jobIdGenerator;
    this.#maximumManifestBytes = maximumManifestBytes;
    this.#policy = Object.freeze({ ...policy });
  }

  async create(intakeId, { operatorId, jobId } = {}) {
    identifier(intakeId, "intakeId");
    requiredText(operatorId, "operatorId");
    if (jobId !== undefined) identifier(jobId, "jobId");
    const intake = await this.#surveyIntakes.get(intakeId);
    if (intake.status !== SURVEY_INTAKE_STATUS.accepted) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_INTAKE_INELIGIBLE",
        `Survey intake ${intakeId} is ${intake.status}; materialization requires ACCEPTED.`,
      );
    }
    const context = await this.#catalog.getMapDraftContext(intake.draftId);
    if (context.draft.status !== MAP_DRAFT_STATUS.draft) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_DRAFT_LOCKED",
        `Map draft ${intake.draftId} is ${context.draft.status}; materialization requires DRAFT.`,
      );
    }
    const content = await this.#multipartStore.get(intake.manifestArtifactSha256);
    if (!Buffer.isBuffer(content) || content.byteLength > this.#maximumManifestBytes) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_MANIFEST_INVALID",
        `Stored manifest must be a byte buffer no larger than ${this.#maximumManifestBytes} bytes.`,
      );
    }
    const rawSha256 = createHash("sha256").update(content).digest("hex");
    if (rawSha256 !== intake.manifestArtifactSha256) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_MANIFEST_INTEGRITY_FAILED",
        "Stored manifest bytes no longer match the sealed upload identity.",
      );
    }
    let manifest;
    try {
      manifest = JSON.parse(content.toString("utf8"));
    } catch {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_MANIFEST_INVALID",
        "Stored accepted manifest is no longer valid JSON.",
      );
    }
    const report = validateEmbodiedSurveyPackage(manifest, this.#policy);
    if (report.outcome === "REJECTED"
      || report.manifestSha256 !== intake.manifestSha256
      || report.validator.policySha256 !== intake.report?.validator?.policySha256) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_MANIFEST_IDENTITY_MISMATCH",
        "Stored manifest or validation policy no longer matches accepted intake evidence.",
      );
    }
    const snapshot = buildSnapshot(intake, manifest);
    const snapshotSha256 = createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
    let record;
    try {
      record = createSurveyMaterializationJobRecord({
        jobId: jobId ?? this.#jobIdGenerator(),
        intake,
        snapshot,
        snapshotSha256,
        operatorId,
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

  async get(jobId) {
    identifier(jobId, "jobId");
    const record = await this.#repository.get(jobId);
    if (!record) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_NOT_FOUND",
        `Survey materialization job ${jobId} was not found.`,
      );
    }
    return record;
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraftContext(draftId);
    return this.#repository.list(draftId);
  }
}

function buildSnapshot(intake, manifest) {
  const mappings = new Map(intake.artifactUploads.map((mapping) => [mapping.artifactId, mapping]));
  const artifacts = manifest.artifacts.map((artifact) => {
    const mapping = mappings.get(artifact.artifactId);
    if (!mapping
      || mapping.artifactSha256 !== artifact.sha256
      || mapping.bytes !== artifact.bytes
      || mapping.mediaType !== artifact.mediaType) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_ARTIFACT_IDENTITY_MISMATCH",
        `Artifact ${artifact.artifactId} no longer matches its accepted upload mapping.`,
      );
    }
    return {
      artifactId: artifact.artifactId,
      role: artifact.role,
      path: artifact.path,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      uploadId: mapping.uploadId,
      frameId: artifact.frameId ?? null,
      sourceSensorIds: [...(artifact.sourceSensorIds ?? [])].sort(),
      timeRange: artifact.timeRange ? { ...artifact.timeRange } : null,
    };
  }).sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  if (artifacts.length !== mappings.size) {
    throw new SurveyMaterializationError(
      "SURVEY_MATERIALIZATION_ARTIFACT_IDENTITY_MISMATCH",
      "Accepted upload mappings and manifest artifacts no longer form the same sealed set.",
    );
  }
  return {
    schemaVersion: "brash.survey-materialization-snapshot/v1",
    intakeId: intake.intakeId,
    draftId: intake.draftId,
    packageId: manifest.packageId,
    surveyId: manifest.surveyId,
    manifestSha256: intake.manifestSha256,
    producer: structuredClone(manifest.producer),
    capture: { ...manifest.capture },
    clock: { ...manifest.clock },
    coordinateSystem: { ...manifest.coordinateSystem },
    quality: { ...manifest.quality },
    artifacts,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new SurveyMaterializationError(
      "SURVEY_MATERIALIZATION_IDENTIFIER_INVALID",
      `${fieldName} must be a lowercase kebab-case identifier.`,
    );
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SurveyMaterializationError("SURVEY_MATERIALIZATION_FIELD_REQUIRED", `${fieldName} is required.`);
  }
}

function translateDomainError(error) {
  if (error instanceof TwinDomainError) {
    return new SurveyMaterializationError(error.code, error.message, { cause: error });
  }
  return error;
}

function translatePersistenceError(error) {
  if (!(error instanceof PersistenceError)) return error;
  const code = ({
    ALREADY_EXISTS: "SURVEY_MATERIALIZATION_CONFLICT",
    REFERENCE_NOT_FOUND: "SURVEY_MATERIALIZATION_REFERENCE_NOT_FOUND",
    PROVENANCE_CONSTRAINT_VIOLATION: "SURVEY_MATERIALIZATION_PROVENANCE_INVALID",
    IMMUTABLE_IDENTITY: "SURVEY_MATERIALIZATION_IMMUTABLE",
  })[error.code] ?? "SURVEY_MATERIALIZATION_PERSISTENCE_ERROR";
  return new SurveyMaterializationError(code, error.message, { cause: error });
}
