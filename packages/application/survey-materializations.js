import { createHash, randomUUID } from "node:crypto";
import {
  MAP_DRAFT_STATUS,
  SURVEY_INTAKE_STATUS,
  TwinDomainError,
  createSurveyMaterializationJobRecord,
} from "@brash-twin/domain";
import { validateEmbodiedSurveyPackage } from "@brash-twin/embodied-survey";
import {
  SurveyMaterializationAdapterError,
  createSurveyMaterializationPreview,
  serializeSurveyMaterializationPreview,
} from "@brash-twin/embodied-survey/materialization";
import { PersistenceError } from "@brash-twin/persistence";

const PREVIEW_MEDIA_TYPE = "application/vnd.brash.survey-materialization-preview+json";

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
  #uploads;
  #draftArtifacts;
  #multipartStore;
  #clock;
  #jobIdGenerator;
  #maximumManifestBytes;
  #maximumPreviewBytes;
  #leaseSeconds;
  #retryBaseSeconds;
  #policy;

  constructor({
    repository,
    surveyIntakes,
    catalog,
    uploads,
    draftArtifacts,
    multipartStore,
    clock = () => new Date(),
    jobIdGenerator = () => `materialization-${randomUUID()}`,
    maximumManifestBytes = 1024 * 1024,
    maximumPreviewBytes = 4 * 1024 * 1024,
    leaseSeconds = 900,
    retryBaseSeconds = 5,
    policy = {},
  }) {
    if (!repository
      || typeof repository.create !== "function"
      || typeof repository.get !== "function"
      || typeof repository.list !== "function"
      || typeof repository.claim !== "function"
      || typeof repository.complete !== "function"
      || typeof repository.fail !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_REPOSITORY_INVALID",
        "Materialization repository lifecycle operations are required.",
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
    if (!uploads
      || typeof uploads.initiate !== "function"
      || typeof uploads.get !== "function"
      || typeof uploads.complete !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_UPLOADS_INVALID",
        "Upload lifecycle operations are required for preview artifacts.",
      );
    }
    if (!draftArtifacts
      || typeof draftArtifacts.bind !== "function"
      || typeof draftArtifacts.list !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_ARTIFACTS_INVALID",
        "Draft artifact provenance operations are required.",
      );
    }
    if (!multipartStore
      || typeof multipartStore.get !== "function"
      || typeof multipartStore.openReadStream !== "function"
      || typeof multipartStore.putPart !== "function") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_STORE_INVALID",
        "Multipart object-store reads, streams, and writes are required.",
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
    boundedInteger(maximumPreviewBytes, "maximumPreviewBytes", 1, 16 * 1024 * 1024);
    boundedInteger(leaseSeconds, "leaseSeconds", 30, 3_600);
    boundedInteger(retryBaseSeconds, "retryBaseSeconds", 1, 300);
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_CONFIGURATION_INVALID",
        "Survey validation policy must be an object.",
      );
    }
    this.#repository = repository;
    this.#surveyIntakes = surveyIntakes;
    this.#catalog = catalog;
    this.#uploads = uploads;
    this.#draftArtifacts = draftArtifacts;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#jobIdGenerator = jobIdGenerator;
    this.#maximumManifestBytes = maximumManifestBytes;
    this.#maximumPreviewBytes = maximumPreviewBytes;
    this.#leaseSeconds = leaseSeconds;
    this.#retryBaseSeconds = retryBaseSeconds;
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

  async run(jobId, { workerId, operatorId } = {}) {
    identifier(jobId, "jobId");
    identifier(workerId, "workerId");
    requiredText(operatorId, "operatorId");
    const current = await this.get(jobId);
    if (current.status === "SUCCEEDED") return current;
    if (current.status === "FAILED") {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_NOT_RUNNABLE",
        `Survey materialization ${jobId} exhausted its attempts.`,
      );
    }
    const claimedAt = this.#now();
    const leaseExpiresAt = new Date(
      Date.parse(claimedAt) + this.#leaseSeconds * 1_000,
    ).toISOString();
    let running;
    try {
      running = await this.#repository.claim(jobId, { workerId, claimedAt, leaseExpiresAt });
      const snapshotSha256 = createHash("sha256")
        .update(canonicalJson(running.snapshot))
        .digest("hex");
      if (snapshotSha256 !== running.snapshotSha256) {
        throw new SurveyMaterializationError(
          "SURVEY_MATERIALIZATION_SNAPSHOT_INTEGRITY_FAILED",
          "Materialization input snapshot no longer matches its sealed identity.",
        );
      }
      const preview = await createSurveyMaterializationPreview(running.snapshot, {
        openArtifactStream: (sha256) => this.#multipartStore.openReadStream(sha256),
        limits: { maximumPreviewBytes: this.#maximumPreviewBytes },
      });
      const content = serializeSurveyMaterializationPreview(preview);
      if (content.byteLength > this.#maximumPreviewBytes) {
        throw new SurveyMaterializationError(
          "SURVEY_MATERIALIZATION_PREVIEW_LIMIT_EXCEEDED",
          `Preview artifact exceeds ${this.#maximumPreviewBytes} bytes.`,
        );
      }
      const outputArtifactSha256 = createHash("sha256").update(content).digest("hex");
      const outputUploadId = `materialization-preview-${jobId}`;
      const upload = await this.#storePreview({
        uploadId: outputUploadId,
        sha256: outputArtifactSha256,
        content,
        operatorId,
        originalName: `${jobId}-preview.json`,
      });
      const output = Object.freeze({
        schemaVersion: preview.schemaVersion,
        mediaType: PREVIEW_MEDIA_TYPE,
        previewUploadId: outputUploadId,
        previewSha256: outputArtifactSha256,
        previewBytes: content.byteLength,
        sourceFrameId: preview.coordinateSystem.rootFrameId,
        summary: Object.freeze({
          trajectoryPoseCount: preview.trajectory.sampleCount,
          pointCloudVertexCount: preview.reconstruction.vertexCount,
          warningCount: preview.qualityWarnings.length,
        }),
      });
      if (upload.artifactSha256 !== outputArtifactSha256) {
        throw new SurveyMaterializationError(
          "SURVEY_MATERIALIZATION_PREVIEW_INTEGRITY_FAILED",
          "Completed preview upload no longer matches the generated content identity.",
        );
      }
      const sourceBindings = await this.#ensureSourceBindings(running, operatorId);
      const previewBinding = await this.#ensureBinding(running.draftId, {
        bindingId: previewBindingId(jobId),
        uploadId: outputUploadId,
        artifactSha256: outputArtifactSha256,
        role: "SURVEY_PREVIEW",
        coordinateFrameId: preview.coordinateSystem.rootFrameId,
        inputBindingIds: sourceBindings.map((binding) => binding.bindingId),
        producer: {
          name: "brash-survey-materializer",
          version: "1.0.0",
          parametersSha256: running.snapshotSha256,
        },
        operatorId,
      });
      const boundOutput = Object.freeze({
        ...output,
        previewBindingId: previewBinding.bindingId,
      });
      return await this.#repository.complete(jobId, {
        workerId,
        output: boundOutput,
        outputUploadId,
        outputArtifactSha256,
        completedAt: this.#now(),
      });
    } catch (error) {
      if (running) {
        const failedAt = this.#now();
        const delay = this.#retryBaseSeconds * (2 ** Math.max(0, running.attemptCount - 1));
        await this.#repository.fail(jobId, {
          workerId,
          failureReason: safeFailureReason(error),
          failedAt,
          nextAttemptAt: new Date(Date.parse(failedAt) + Math.min(delay, 300) * 1_000).toISOString(),
        }).catch(() => undefined);
      }
      throw translateMaterializationError(error);
    }
  }

  async getPreview(jobId) {
    const job = await this.get(jobId);
    if (job.status !== "SUCCEEDED" || !job.output) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_PREVIEW_NOT_READY",
        `Survey materialization ${jobId} is ${job.status}.`,
      );
    }
    const content = await this.#multipartStore.get(job.output.previewSha256);
    if (!Buffer.isBuffer(content)
      || content.byteLength !== job.output.previewBytes
      || content.byteLength > this.#maximumPreviewBytes
      || createHash("sha256").update(content).digest("hex") !== job.output.previewSha256) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_PREVIEW_INTEGRITY_FAILED",
        "Stored preview bytes no longer match the successful job output identity.",
      );
    }
    let preview;
    try {
      preview = JSON.parse(content.toString("utf8"));
    } catch {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_PREVIEW_INVALID",
        "Stored materialization preview is not valid JSON.",
      );
    }
    if (preview?.schemaVersion !== job.output.schemaVersion
      || preview?.source?.revision !== job.manifestSha256) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_PREVIEW_INTEGRITY_FAILED",
        "Stored preview lineage does not match the successful job.",
      );
    }
    return preview;
  }

  async #storePreview({ uploadId, sha256, content, operatorId, originalName }) {
    let session;
    let upload;
    try {
      const initiated = await this.#uploads.initiate({
        uploadId,
        expectedSha256: sha256,
        expectedBytes: content.byteLength,
        mediaType: PREVIEW_MEDIA_TYPE,
        originalName,
        operatorId,
      });
      session = initiated.session;
      upload = initiated.upload;
    } catch (error) {
      if (!["UPLOAD_CONFLICT", "UPLOAD_ALREADY_EXISTS", "UPLOAD_ALREADY_FINALIZED"].includes(error?.code)) {
        throw error;
      }
      session = await this.#uploads.get(uploadId);
    }
    if (session.expectedSha256 !== sha256 || session.expectedBytes !== content.byteLength) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_PREVIEW_CONFLICT",
        `Existing preview upload ${uploadId} has a different content identity.`,
      );
    }
    if (session.status === "COMPLETED") return session;
    if (!upload) {
      upload = { partSizeBytes: session.partSizeBytes };
    }
    await writeMultipartContent(this.#multipartStore, uploadId, content, upload.partSizeBytes);
    return this.#uploads.complete(uploadId, { operatorId });
  }

  async #ensureSourceBindings(job, operatorId) {
    const bindings = [];
    for (const artifact of job.snapshot.artifacts) {
      bindings.push(await this.#ensureBinding(job.draftId, {
        bindingId: sourceBindingId(job.draftId, artifact.sha256),
        uploadId: artifact.uploadId,
        artifactSha256: artifact.sha256,
        role: "SURVEY_SOURCE",
        coordinateFrameId: artifact.frameId,
        operatorId,
      }));
    }
    return bindings;
  }

  async #ensureBinding(draftId, input) {
    const existing = (await this.#draftArtifacts.list(draftId)).find(
      (binding) => binding.role === input.role
        && binding.artifactSha256 === input.artifactSha256,
    );
    if (existing) return existing;
    try {
      return await this.#draftArtifacts.bind(draftId, input);
    } catch (error) {
      if (error?.code !== "DRAFT_ARTIFACT_CONFLICT") throw error;
      const raced = (await this.#draftArtifacts.list(draftId)).find(
        (binding) => binding.role === input.role
          && binding.artifactSha256 === input.artifactSha256,
      );
      if (raced) return raced;
      throw error;
    }
  }

  #now() {
    const value = new Date(this.#clock());
    if (!Number.isFinite(value.getTime())) {
      throw new SurveyMaterializationError(
        "SURVEY_MATERIALIZATION_CLOCK_INVALID",
        "Clock returned an invalid date.",
      );
    }
    return value.toISOString();
  }
}

function sourceBindingId(draftId, sha256) {
  return `${draftId}-survey-source-${sha256.slice(0, 20)}`;
}

function previewBindingId(jobId) {
  return `survey-preview-${jobId}`;
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
    NOT_FOUND: "SURVEY_MATERIALIZATION_NOT_FOUND",
    REFERENCE_NOT_FOUND: "SURVEY_MATERIALIZATION_REFERENCE_NOT_FOUND",
    CONCURRENCY_CONFLICT: "SURVEY_MATERIALIZATION_CONCURRENCY_CONFLICT",
    PROVENANCE_CONSTRAINT_VIOLATION: "SURVEY_MATERIALIZATION_PROVENANCE_INVALID",
    IMMUTABLE_IDENTITY: "SURVEY_MATERIALIZATION_IMMUTABLE",
  })[error.code] ?? "SURVEY_MATERIALIZATION_PERSISTENCE_ERROR";
  return new SurveyMaterializationError(code, error.message, { cause: error });
}

function translateMaterializationError(error) {
  if (error instanceof SurveyMaterializationError) return error;
  if (error instanceof SurveyMaterializationAdapterError) {
    return new SurveyMaterializationError(error.code, error.message, { cause: error });
  }
  if (error instanceof PersistenceError) return translatePersistenceError(error);
  return error;
}

async function writeMultipartContent(multipartStore, uploadId, content, partSizeBytes) {
  for (let offset = 0, partNumber = 1;
    offset < content.byteLength;
    offset += partSizeBytes, partNumber += 1) {
    await multipartStore.putPart(
      uploadId,
      partNumber,
      content.subarray(offset, offset + partSizeBytes),
    );
  }
}

function safeFailureReason(error) {
  const value = error instanceof Error ? error.message : "Survey materialization failed.";
  return value.replaceAll(/[\r\n\t]/g, " ").slice(0, 500);
}

function boundedInteger(value, fieldName, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SurveyMaterializationError(
      "SURVEY_MATERIALIZATION_CONFIGURATION_INVALID",
      `${fieldName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}
