import { createHash, randomUUID } from "node:crypto";
import { MAP_DRAFT_STATUS } from "@brash-twin/domain";
import { PersistenceError } from "@brash-twin/persistence";
import {
  DraftValidationError,
  DraftValidatorRegistry,
  createDraftValidationReport,
  serializeDraftValidationReport,
} from "@brash-twin/validation/draft";

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ValidationJobError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ValidationJobError";
    this.code = code;
  }
}

export class ValidationJobService {
  #repository;
  #catalog;
  #draftArtifacts;
  #uploads;
  #multipartStore;
  #registry;
  #clock;
  #jobIdGenerator;

  constructor({
    repository,
    catalog,
    draftArtifacts,
    uploads,
    multipartStore,
    registry = new DraftValidatorRegistry(),
    clock = () => new Date(),
    jobIdGenerator = randomUUID,
  }) {
    if (!repository
      || typeof repository.create !== "function"
      || typeof repository.get !== "function"
      || typeof repository.list !== "function"
      || typeof repository.start !== "function"
      || typeof repository.complete !== "function"
      || typeof repository.fail !== "function") {
      throw new ValidationJobError("VALIDATION_JOB_REPOSITORY_INVALID", "Validation job repository operations are required.");
    }
    if (!catalog
      || typeof catalog.getMapDraft !== "function"
      || typeof catalog.validateMapDraft !== "function") {
      throw new ValidationJobError("VALIDATION_JOB_CATALOG_INVALID", "Draft catalog operations are required.");
    }
    if (!draftArtifacts
      || typeof draftArtifacts.list !== "function"
      || typeof draftArtifacts.bindValidationReport !== "function") {
      throw new ValidationJobError("VALIDATION_JOB_ARTIFACTS_INVALID", "Draft artifact operations are required.");
    }
    if (!uploads || typeof uploads.initiate !== "function" || typeof uploads.complete !== "function") {
      throw new ValidationJobError("VALIDATION_JOB_UPLOADS_INVALID", "Upload operations are required.");
    }
    if (!multipartStore || typeof multipartStore.putPart !== "function") {
      throw new ValidationJobError("VALIDATION_JOB_STORE_INVALID", "An internal multipart artifact writer is required.");
    }
    if (!(registry instanceof DraftValidatorRegistry)) {
      throw new ValidationJobError("VALIDATION_JOB_REGISTRY_INVALID", "A DraftValidatorRegistry is required.");
    }
    if (typeof jobIdGenerator !== "function") {
      throw new ValidationJobError("VALIDATION_JOB_ID_GENERATOR_INVALID", "jobIdGenerator must be a function.");
    }
    this.#repository = repository;
    this.#catalog = catalog;
    this.#draftArtifacts = draftArtifacts;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#registry = registry;
    this.#clock = clock;
    this.#jobIdGenerator = jobIdGenerator;
  }

  async create(draftId, { jobId = this.#jobIdGenerator(), operatorId } = {}) {
    identifier(draftId, "draftId");
    identifier(jobId, "jobId");
    requiredText(operatorId, "operatorId");
    const draft = await this.#catalog.getMapDraft(draftId);
    if (draft.status !== MAP_DRAFT_STATUS.inReview) {
      throw new ValidationJobError(
        "VALIDATION_DRAFT_NOT_IN_REVIEW",
        `Map draft ${draftId} must be IN_REVIEW before validation starts.`,
      );
    }
    const artifacts = await validationInputs(this.#draftArtifacts, this.#multipartStore, draftId);
    if (artifacts.length === 0) {
      throw new ValidationJobError("VALIDATION_INPUTS_REQUIRED", `Map draft ${draftId} has no artifacts to validate.`);
    }
    const now = this.#now();
    const record = Object.freeze({
      jobId,
      draftId,
      jobType: "RELEASE_VALIDATION",
      status: "PENDING",
      input: Object.freeze({
        draftRowVersion: draft.rowVersion,
        bindings: Object.freeze(artifactIdentities(artifacts)),
      }),
      output: null,
      attemptCount: 0,
      maximumAttempts: 1,
      nextAttemptAt: now,
      createdBy: operatorId,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      failureReason: null,
    });
    try {
      return await this.#repository.create(record);
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }

  async get(jobId) {
    identifier(jobId, "jobId");
    const job = await this.#repository.get(jobId);
    if (!job) throw new ValidationJobError("VALIDATION_JOB_NOT_FOUND", `Validation job ${jobId} was not found.`);
    return job;
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraft(draftId);
    return this.#repository.list(draftId);
  }

  async run(jobId, { operatorId } = {}) {
    requiredText(operatorId, "operatorId");
    const current = await this.get(jobId);
    if (current.status === "SUCCEEDED") return current;
    if (current.status !== "PENDING") {
      throw new ValidationJobError("VALIDATION_JOB_NOT_RUNNABLE", `Validation job ${jobId} is ${current.status}.`);
    }
    const startedAt = this.#now();
    let running;
    try {
      running = await this.#repository.start(Object.freeze({
        ...current,
        status: "RUNNING",
        attemptCount: current.attemptCount + 1,
        startedAt,
      }));
      const draft = await this.#catalog.getMapDraft(current.draftId);
      if (draft.status !== MAP_DRAFT_STATUS.inReview) {
        throw new ValidationJobError(
          "VALIDATION_DRAFT_NOT_IN_REVIEW",
          `Map draft ${draft.draftId} changed to ${draft.status} before validation ran.`,
        );
      }
      const artifacts = await validationInputs(this.#draftArtifacts, this.#multipartStore, draft.draftId);
      if (!sameIdentities(current.input.bindings, artifactIdentities(artifacts))
        || current.input.draftRowVersion !== draft.rowVersion) {
        throw new ValidationJobError(
          "VALIDATION_SNAPSHOT_CHANGED",
          `Map draft ${draft.draftId} changed after validation job ${jobId} was created.`,
        );
      }
      const completedAt = this.#now();
      const report = createDraftValidationReport({
        reportId: `report-${jobId}`,
        jobId,
        draft,
        artifacts,
        registry: this.#registry,
        startedAt,
        completedAt,
      });
      const content = serializeDraftValidationReport(report);
      const reportSha256 = createHash("sha256").update(content).digest("hex");
      const uploadId = `validation-upload-${jobId}`;
      const initiatedUpload = await this.#uploads.initiate({
        uploadId,
        expectedSha256: reportSha256,
        expectedBytes: content.byteLength,
        mediaType: "application/json",
        originalName: `${draft.draftId}-validation-report.json`,
        operatorId,
      });
      await writeMultipartContent(
        this.#multipartStore,
        uploadId,
        content,
        initiatedUpload.upload.partSizeBytes,
      );
      const completedUpload = await this.#uploads.complete(uploadId, { operatorId });
      if (completedUpload.artifactSha256 !== reportSha256) {
        throw new ValidationJobError("VALIDATION_REPORT_INTEGRITY_FAILED", "Validation report upload identity changed.");
      }
      const reportBinding = await this.#draftArtifacts.bindValidationReport(draft.draftId, {
        bindingId: `validation-report-${jobId}`,
        uploadId,
        inputBindingIds: artifacts.map((artifact) => artifact.bindingId),
        producer: {
          name: this.#registry.descriptor.name,
          version: this.#registry.descriptor.version,
          parametersSha256: this.#registry.descriptor.configurationSha256,
        },
        operatorId,
      });
      const output = Object.freeze({
        reportBindingId: reportBinding.bindingId,
        reportSha256,
        outcome: report.outcome,
        summary: report.summary,
      });
      if (report.outcome === "PASSED") {
        await this.#catalog.validateMapDraft(draft.draftId, reportSha256, operatorId);
      }
      const completedJob = Object.freeze({
        ...running,
        status: "SUCCEEDED",
        output,
        completedAt,
        failureReason: null,
      });
      return (await this.#repository.complete(completedJob, Object.freeze({
        jobId,
        draftId: draft.draftId,
        reportBindingId: reportBinding.bindingId,
        reportSha256,
        outcome: report.outcome,
        validator: report.validator,
        summary: report.summary,
        startedAt,
        completedAt,
        createdBy: operatorId,
      }))).job;
    } catch (error) {
      if (running) {
        const failedAt = this.#now();
        await this.#repository.fail(Object.freeze({
          ...running,
          status: "FAILED",
          completedAt: failedAt,
          failureReason: safeFailureReason(error),
        })).catch(() => undefined);
      }
      throw translateValidationError(error);
    }
  }

  #now() {
    const date = new Date(this.#clock());
    if (!Number.isFinite(date.getTime())) throw new ValidationJobError("VALIDATION_JOB_CLOCK_INVALID", "Clock returned an invalid date.");
    return date.toISOString();
  }
}

async function validationInputs(draftArtifacts, multipartStore, draftId) {
  const artifacts = (await draftArtifacts.list(draftId)).filter(
    (artifact) => artifact.role !== "VALIDATION_REPORT",
  );
  return Promise.all(artifacts.map(async (artifact) => {
    if (artifact.role !== "REGISTRATION_ACCEPTANCE") return artifact;
    return Object.freeze({
      ...artifact,
      reviewDecision: await registrationDecision(multipartStore, artifact, draftId),
    });
  }));
}

async function registrationDecision(multipartStore, artifact, draftId) {
  try {
    const content = await multipartStore.get(artifact.artifactSha256);
    if (!Buffer.isBuffer(content)
      || content.byteLength > 1024 * 1024
      || createHash("sha256").update(content).digest("hex") !== artifact.artifactSha256) return "INVALID";
    const report = JSON.parse(content.toString("utf8"));
    const input = artifact.inputBindings.length === 1 ? artifact.inputBindings[0] : null;
    if (report?.schemaVersion !== "brash.survey-registration-acceptance/v1"
      || report?.draftId !== draftId
      || report?.registrationReport?.bindingId !== input?.bindingId
      || report?.registrationReport?.sha256 !== input?.artifactSha256
      || !["APPROVED", "REJECTED"].includes(report?.decision)) return "INVALID";
    return report.decision;
  } catch {
    return "INVALID";
  }
}

function artifactIdentities(artifacts) {
  return artifacts
    .map((artifact) => ({ bindingId: artifact.bindingId, artifactSha256: artifact.artifactSha256 }))
    .sort((left, right) => left.bindingId.localeCompare(right.bindingId));
}

function sameIdentities(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeMultipartContent(multipartStore, uploadId, content, partSizeBytes) {
  for (let offset = 0, partNumber = 1; offset < content.byteLength; offset += partSizeBytes, partNumber += 1) {
    await multipartStore.putPart(uploadId, partNumber, content.subarray(offset, offset + partSizeBytes));
  }
}

function translateValidationError(error) {
  if (error instanceof ValidationJobError) return error;
  if (error instanceof DraftValidationError) {
    return new ValidationJobError(error.code, error.message, { cause: error });
  }
  if (error instanceof PersistenceError) return translatePersistenceError(error);
  return error;
}

function translatePersistenceError(error) {
  if (!(error instanceof PersistenceError)) return error;
  const code = ({
    ALREADY_EXISTS: "VALIDATION_JOB_CONFLICT",
    NOT_FOUND: "VALIDATION_JOB_NOT_FOUND",
    REFERENCE_NOT_FOUND: "VALIDATION_JOB_REFERENCE_NOT_FOUND",
    CONCURRENCY_CONFLICT: "VALIDATION_JOB_CONCURRENCY_CONFLICT",
    VALIDATION_RUN_INVALID: "VALIDATION_RUN_INVALID",
  })[error.code] ?? "VALIDATION_JOB_PERSISTENCE_ERROR";
  return new ValidationJobError(code, error.message, { cause: error });
}

function safeFailureReason(error) {
  const value = error instanceof Error ? error.message : "Validation job failed.";
  return value.replaceAll(/[\r\n\t]/g, " ").slice(0, 500);
}

function identifier(value, field) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new ValidationJobError("VALIDATION_JOB_ID_INVALID", `${field} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationJobError("VALIDATION_JOB_FIELD_REQUIRED", `${field} is required.`);
  }
}
