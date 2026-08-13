import { randomUUID } from "node:crypto";
import { ArtifactStoreError } from "@brash-twin/artifact-store";
import {
  TwinDomainError,
  UPLOAD_STATUS,
  cancelUploadSession,
  completeUploadSession,
  createUploadSessionRecord,
  expireUploadSession,
  quarantineUploadSession,
} from "@brash-twin/domain";
import { PersistenceError } from "@brash-twin/persistence";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class UploadError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "UploadError";
    this.code = code;
  }
}

export class UploadService {
  #repository;
  #multipartStore;
  #clock;
  #uploadIdGenerator;
  #partSizeBytes;
  #maximumParts;
  #expirySeconds;

  constructor({
    repository,
    multipartStore,
    clock = () => new Date(),
    uploadIdGenerator = randomUUID,
    partSizeBytes = 8 * 1024 * 1024,
    maximumParts = 10_000,
    expirySeconds = 3_600,
  }) {
    if (!repository
      || typeof repository.create !== "function"
      || typeof repository.get !== "function"
      || typeof repository.complete !== "function"
      || typeof repository.save !== "function") {
      throw new UploadError("UPLOAD_REPOSITORY_INVALID", "Upload repository operations are required.");
    }
    if (!multipartStore
      || typeof multipartStore.createUpload !== "function"
      || typeof multipartStore.completeUpload !== "function"
      || typeof multipartStore.abortUpload !== "function") {
      throw new UploadError("MULTIPART_STORE_INVALID", "Multipart object-store operations are required.");
    }
    if (typeof uploadIdGenerator !== "function") {
      throw new UploadError("UPLOAD_ID_GENERATOR_INVALID", "uploadIdGenerator must be a function.");
    }
    boundedInteger(partSizeBytes, "partSizeBytes", 1, 5 * 1024 * 1024 * 1024);
    boundedInteger(maximumParts, "maximumParts", 1, 10_000);
    boundedInteger(expirySeconds, "expirySeconds", 60, 86_400);
    this.#repository = repository;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#uploadIdGenerator = uploadIdGenerator;
    this.#partSizeBytes = partSizeBytes;
    this.#maximumParts = maximumParts;
    this.#expirySeconds = expirySeconds;
  }

  async initiate(input) {
    if (!input || typeof input !== "object") throw new UploadError("UPLOAD_INPUT_REQUIRED", "Upload input is required.");
    const uploadId = input.uploadId ?? this.#uploadIdGenerator();
    identifier(uploadId, "uploadId");
    requiredText(input.operatorId, "operatorId");
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + this.#expirySeconds * 1_000);
    let upload;
    try {
      upload = await this.#multipartStore.createUpload({
        uploadId,
        expectedSha256: input.expectedSha256,
        expectedBytes: input.expectedBytes,
        partSizeBytes: this.#partSizeBytes,
        maximumParts: this.#maximumParts,
        expiresAt,
      });
      const session = createUploadSessionRecord({
        uploadId,
        expectedSha256: input.expectedSha256,
        expectedBytes: input.expectedBytes,
        mediaType: input.mediaType,
        originalName: input.originalName,
        partSizeBytes: upload.partSizeBytes,
        maximumParts: upload.maximumParts,
        storageProvider: upload.provider,
        uploadKey: upload.uploadKey,
        operatorId: input.operatorId,
        expiresAt: upload.expiresAt,
        occurredAt: now,
      });
      const created = await this.#repository.create(session);
      return Object.freeze({ session: created, upload });
    } catch (error) {
      if (upload) await this.#multipartStore.abortUpload(uploadId).catch(() => undefined);
      throw translateUploadError(error);
    }
  }

  async get(uploadId) {
    identifier(uploadId, "uploadId");
    const session = await this.#repository.get(uploadId);
    if (!session) throw new UploadError("UPLOAD_NOT_FOUND", `Upload session ${uploadId} was not found.`);
    return session;
  }

  async list(status) {
    if (typeof this.#repository.list !== "function") {
      throw new UploadError("UPLOAD_LIST_UNSUPPORTED", "Upload repository does not support listing.");
    }
    if (status !== undefined && !Object.values(UPLOAD_STATUS).includes(status)) {
      throw new UploadError("UPLOAD_STATUS_INVALID", `Unsupported upload status ${String(status)}.`);
    }
    return this.#repository.list(status);
  }

  async complete(uploadId, { operatorId, parts } = {}) {
    identifier(uploadId, "uploadId");
    requiredText(operatorId, "operatorId");
    validateCompletionParts(parts);
    const current = await this.get(uploadId);
    const now = this.#now();
    if (new Date(current.expiresAt).getTime() <= now.getTime()) {
      await this.#multipartStore.abortUpload(uploadId).catch(() => undefined);
      try {
        return await this.#repository.save(
          expireUploadSession(current, { operatorId, occurredAt: now }),
          current.rowVersion,
        );
      } catch (error) {
        throw translateUploadError(error);
      }
    }
    try {
      const result = await this.#multipartStore.completeUpload(uploadId, { parts });
      if (result.status === "QUARANTINED") {
        const quarantined = quarantineUploadSession(current, {
          observedSha256: result.sha256,
          observedBytes: result.bytes,
          quarantineKey: result.quarantineKey,
          reason: result.reasonCode,
          operatorId,
          occurredAt: now,
        });
        return await this.#repository.save(quarantined, current.rowVersion);
      }
      if (result.status !== "COMPLETED") {
        throw new UploadError("UPLOAD_RESULT_INVALID", `Unsupported multipart result ${String(result.status)}.`);
      }
      const completed = completeUploadSession(current, {
        sha256: result.sha256,
        bytes: result.bytes,
        objectKey: result.objectKey,
        operatorId,
        occurredAt: now,
      });
      return (await this.#repository.complete(completed, current.rowVersion, {
        sha256: result.sha256,
        bytes: result.bytes,
        objectKey: result.objectKey,
        mediaType: current.mediaType,
        originalName: current.originalName,
        createdAt: now.toISOString(),
      })).session;
    } catch (error) {
      throw translateUploadError(error);
    }
  }

  async cancel(uploadId, { operatorId } = {}) {
    identifier(uploadId, "uploadId");
    requiredText(operatorId, "operatorId");
    const current = await this.get(uploadId);
    try {
      await this.#multipartStore.abortUpload(uploadId);
      return await this.#repository.save(
        cancelUploadSession(current, { operatorId, occurredAt: this.#now() }),
        current.rowVersion,
      );
    } catch (error) {
      throw translateUploadError(error);
    }
  }

  #now() {
    const value = new Date(this.#clock());
    if (!Number.isFinite(value.getTime())) throw new UploadError("CLOCK_INVALID", "Clock returned an invalid date.");
    return value;
  }
}

function validateCompletionParts(parts) {
  if (parts === undefined) return;
  if (!Array.isArray(parts) || parts.length > 10_000) {
    throw new UploadError("UPLOAD_PARTS_INVALID", "parts must be an array with at most 10000 entries.");
  }
  const seen = new Set();
  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      throw new UploadError("UPLOAD_PARTS_INVALID", "Each completion part must be an object.");
    }
    const fields = Object.keys(part);
    if (fields.some((field) => !["partNumber", "etag"].includes(field))) {
      throw new UploadError("UPLOAD_PARTS_INVALID", "Completion parts contain unsupported fields.");
    }
    boundedInteger(part.partNumber, "partNumber", 1, 10_000);
    requiredText(part.etag, "etag");
    if (seen.has(part.partNumber)) throw new UploadError("UPLOAD_PARTS_INVALID", "Part numbers must be unique.");
    seen.add(part.partNumber);
  }
}

function translateUploadError(error) {
  if (error instanceof UploadError) return error;
  if (error instanceof TwinDomainError) return new UploadError(error.code, error.message, { cause: error });
  if (error instanceof ArtifactStoreError) {
    const code = ({
      UPLOAD_PARTS_MISSING: "UPLOAD_NOT_READY",
      UPLOAD_PARTS_INCOMPLETE: "UPLOAD_NOT_READY",
    })[error.code] ?? error.code;
    return new UploadError(code, error.message, { cause: error });
  }
  if (error instanceof PersistenceError) {
    const code = ({
      ALREADY_EXISTS: "UPLOAD_CONFLICT",
      NOT_FOUND: "UPLOAD_NOT_FOUND",
      CONCURRENCY_CONFLICT: "UPLOAD_CONCURRENCY_CONFLICT",
      UPLOAD_TERMINAL: "UPLOAD_TRANSITION_INVALID",
    })[error.code] ?? "UPLOAD_PERSISTENCE_ERROR";
    return new UploadError(code, error.message, { cause: error });
  }
  return error;
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new UploadError("UPLOAD_ID_INVALID", `${fieldName} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new UploadError("UPLOAD_FIELD_REQUIRED", `${fieldName} is required.`);
  }
}

function boundedInteger(value, fieldName, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new UploadError("UPLOAD_NUMBER_INVALID", `${fieldName} must be an integer between ${minimum} and ${maximum}.`);
  }
}
