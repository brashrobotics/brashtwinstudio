import { randomUUID } from "node:crypto";
import {
  MAP_DRAFT_STATUS,
  TwinDomainError,
  UPLOAD_STATUS,
  createDraftArtifactBindingRecord,
} from "@brash-twin/domain";
import { PersistenceError } from "@brash-twin/persistence";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class DraftArtifactError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "DraftArtifactError";
    this.code = code;
  }
}

export class DraftArtifactService {
  #repository;
  #catalog;
  #uploads;
  #unitOfWork;
  #clock;
  #bindingIdGenerator;

  constructor({
    repository,
    catalog,
    uploads,
    unitOfWork = null,
    clock = () => new Date(),
    bindingIdGenerator = randomUUID,
  }) {
    if (!repository
      || typeof repository.create !== "function"
      || typeof repository.get !== "function"
      || typeof repository.list !== "function") {
      throw new DraftArtifactError(
        "DRAFT_ARTIFACT_REPOSITORY_INVALID",
        "Draft artifact repository operations are required.",
      );
    }
    if (!catalog || typeof catalog.getMapDraft !== "function") {
      throw new DraftArtifactError("DRAFT_ARTIFACT_CATALOG_INVALID", "Twin catalog lookup is required.");
    }
    if (!uploads || typeof uploads.get !== "function") {
      throw new DraftArtifactError("DRAFT_ARTIFACT_UPLOADS_INVALID", "Completed upload lookup is required.");
    }
    if (typeof bindingIdGenerator !== "function") {
      throw new DraftArtifactError("DRAFT_ARTIFACT_ID_GENERATOR_INVALID", "bindingIdGenerator must be a function.");
    }
    this.#repository = repository;
    this.#catalog = catalog;
    this.#uploads = uploads;
    if (unitOfWork !== null && typeof unitOfWork.execute !== "function") {
      throw new DraftArtifactError("DRAFT_ARTIFACT_UNIT_OF_WORK_INVALID", "unitOfWork must expose execute when provided.");
    }
    this.#unitOfWork = unitOfWork;
    this.#clock = clock;
    this.#bindingIdGenerator = bindingIdGenerator;
  }

  async bind(draftId, input) {
    return this.#bind(draftId, input, MAP_DRAFT_STATUS.draft);
  }

  async bindWithEvent(draftId, input, event) {
    if (!this.#unitOfWork) {
      throw new DraftArtifactError(
        "DRAFT_ARTIFACT_UNIT_OF_WORK_REQUIRED",
        "Atomic artifact and outbox persistence requires a unit of work.",
      );
    }
    const record = await this.#bindingRecord(draftId, input, MAP_DRAFT_STATUS.draft, this.#repository);
    try {
      return await this.#unitOfWork.execute(async ({ draftArtifactRepository, outboxRepository }) => {
        if (!draftArtifactRepository || typeof draftArtifactRepository.create !== "function"
          || !outboxRepository || typeof outboxRepository.append !== "function") {
          throw new DraftArtifactError(
            "DRAFT_ARTIFACT_UNIT_OF_WORK_INVALID",
            "The unit of work must provide draft artifact and outbox repositories.",
          );
        }
        const created = await draftArtifactRepository.create(record);
        await outboxRepository.append(event);
        return created;
      });
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }

  async bindValidationReport(draftId, input) {
    return this.#bind(
      draftId,
      { ...input, role: "VALIDATION_REPORT", coordinateFrameId: null },
      MAP_DRAFT_STATUS.inReview,
    );
  }

  async #bind(draftId, input, requiredDraftStatus) {
    const record = await this.#bindingRecord(draftId, input, requiredDraftStatus, this.#repository);
    try {
      return await this.#repository.create(record);
    } catch (error) {
      throw translatePersistenceError(error);
    }
  }

  async #bindingRecord(draftId, input, requiredDraftStatus, repository) {
    identifier(draftId, "draftId");
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new DraftArtifactError("DRAFT_ARTIFACT_INPUT_REQUIRED", "Draft artifact input is required.");
    }
    const draft = await this.#catalog.getMapDraft(draftId);
    if (draft.status !== requiredDraftStatus) {
      throw new DraftArtifactError(
        "DRAFT_ARTIFACT_DRAFT_LOCKED",
        `Map draft ${draftId} is ${draft.status}; this artifact requires ${requiredDraftStatus}.`,
      );
    }
    identifier(input.uploadId, "uploadId");
    const upload = await this.#uploads.get(input.uploadId);
    if (upload.status !== UPLOAD_STATUS.completed || upload.artifactSha256 === null) {
      throw new DraftArtifactError(
        "DRAFT_ARTIFACT_UPLOAD_INCOMPLETE",
        `Upload ${input.uploadId} must complete integrity verification before it can be bound.`,
      );
    }
    const inputBindingIds = normalizeInputBindingIds(input.inputBindingIds);
    const inputBindings = [];
    for (const bindingId of inputBindingIds) {
      const binding = await repository.get(bindingId);
      if (!binding || binding.draftId !== draftId) {
        throw new DraftArtifactError(
          "DRAFT_ARTIFACT_INPUT_NOT_FOUND",
          `Input binding ${bindingId} was not found in map draft ${draftId}.`,
        );
      }
      inputBindings.push({ bindingId, artifactSha256: binding.artifactSha256 });
    }
    let record;
    try {
      record = createDraftArtifactBindingRecord({
        bindingId: input.bindingId ?? this.#bindingIdGenerator(),
        draftId,
        uploadId: input.uploadId,
        artifactSha256: upload.artifactSha256,
        role: input.role,
        coordinateFrameId: input.coordinateFrameId ?? null,
        inputBindings,
        producer: input.producer ?? null,
        operatorId: input.operatorId,
        occurredAt: this.#clock(),
      });
    } catch (error) {
      throw translateDomainError(error);
    }
    return record;
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraft(draftId);
    return this.#repository.list(draftId);
  }
}

function normalizeInputBindingIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) {
    throw new DraftArtifactError(
      "DRAFT_ARTIFACT_INPUTS_INVALID",
      "inputBindingIds must be an array with at most 256 entries.",
    );
  }
  const identifiers = value.map((bindingId) => {
    identifier(bindingId, "inputBindingId");
    return bindingId;
  });
  if (new Set(identifiers).size !== identifiers.length) {
    throw new DraftArtifactError("DRAFT_ARTIFACT_INPUTS_INVALID", "inputBindingIds must be unique.");
  }
  return identifiers;
}

function translateDomainError(error) {
  if (error instanceof TwinDomainError) {
    return new DraftArtifactError(error.code, error.message, { cause: error });
  }
  return error;
}

function translatePersistenceError(error) {
  if (!(error instanceof PersistenceError)) return error;
  const code = ({
    ALREADY_EXISTS: "DRAFT_ARTIFACT_CONFLICT",
    OUTBOX_EVENT_EXISTS: "DRAFT_ARTIFACT_CONFLICT",
    REFERENCE_NOT_FOUND: "DRAFT_ARTIFACT_REFERENCE_NOT_FOUND",
    PROVENANCE_CONSTRAINT_VIOLATION: "DRAFT_ARTIFACT_PROVENANCE_INVALID",
  })[error.code] ?? "DRAFT_ARTIFACT_PERSISTENCE_ERROR";
  return new DraftArtifactError(code, error.message, { cause: error });
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new DraftArtifactError(
      "DRAFT_ARTIFACT_ID_INVALID",
      `${fieldName} must be a lowercase kebab-case identifier.`,
    );
  }
}
