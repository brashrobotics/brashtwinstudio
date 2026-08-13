import { randomUUID } from "node:crypto";
import { ArtifactStoreError } from "@brash-twin/artifact-store";
import {
  MAP_DRAFT_STATUS,
  PUBLICATION_STATUS,
  TwinDomainError,
  approvePublicationRequestRecord,
  createMapReleasePublishedEvent,
  createPublicationRequestRecord,
  publishMapDraftRecord,
} from "@brash-twin/domain";
import { PersistenceError } from "@brash-twin/persistence";

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PublicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PublicationError";
    this.code = code;
  }
}

export class PublicationService {
  #repository;
  #catalog;
  #releaseStore;
  #clock;
  #publicationIdGenerator;
  #eventIdGenerator;
  #leaseSeconds;

  constructor({
    repository,
    catalog,
    releaseStore,
    clock = () => new Date(),
    publicationIdGenerator = randomUUID,
    eventIdGenerator = randomUUID,
    leaseSeconds = 30,
  }) {
    for (const operation of [
      "create",
      "get",
      "list",
      "approve",
      "claim",
      "markStorePublished",
      "recordFailure",
      "finalize",
      "listRecoverable",
    ]) {
      if (!repository || typeof repository[operation] !== "function") {
        throw new PublicationError("PUBLICATION_REPOSITORY_INVALID", `Publication repository requires ${operation}().`);
      }
    }
    if (!catalog || typeof catalog.getMapDraft !== "function") {
      throw new PublicationError("PUBLICATION_CATALOG_INVALID", "Publication requires the draft catalog.");
    }
    if (!releaseStore
      || typeof releaseStore.stagePublication !== "function"
      || typeof releaseStore.ensurePublicationStored !== "function"
      || typeof releaseStore.discardPublicationInput !== "function") {
      throw new PublicationError("PUBLICATION_STORE_INVALID", "Publication requires a recoverable immutable release store.");
    }
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3_600) {
      throw new PublicationError("PUBLICATION_LEASE_INVALID", "leaseSeconds must be between 1 and 3600.");
    }
    this.#repository = repository;
    this.#catalog = catalog;
    this.#releaseStore = releaseStore;
    this.#clock = clock;
    this.#publicationIdGenerator = publicationIdGenerator;
    this.#eventIdGenerator = eventIdGenerator;
    this.#leaseSeconds = leaseSeconds;
  }

  async request(draftId, { publicationId = this.#publicationIdGenerator(), sourceBundleDirectory, requestedBy } = {}) {
    identifier(draftId, "draftId");
    identifier(publicationId, "publicationId");
    requiredText(sourceBundleDirectory, "sourceBundleDirectory");
    requiredText(requestedBy, "requestedBy");
    const draft = await this.#catalog.getMapDraft(draftId);
    if (draft.status !== MAP_DRAFT_STATUS.validated) {
      throw new PublicationError("PUBLICATION_DRAFT_NOT_VALIDATED", `Map draft ${draftId} must be VALIDATED.`);
    }
    try {
      const bundle = await this.#releaseStore.stagePublication(publicationId, sourceBundleDirectory);
      const record = createPublicationRequestRecord({
        publicationId,
        draft,
        bundle,
        requestedBy,
        occurredAt: this.#now(),
      });
      return await this.#repository.create(record);
    } catch (error) {
      throw translatePublicationError(error);
    }
  }

  async get(publicationId) {
    identifier(publicationId, "publicationId");
    const record = await this.#repository.get(publicationId);
    if (!record) throw new PublicationError("PUBLICATION_NOT_FOUND", `Publication ${publicationId} was not found.`);
    return record;
  }

  async list(draftId) {
    if (draftId !== undefined) identifier(draftId, "draftId");
    return this.#repository.list(draftId);
  }

  async approve(publicationId, { approvedBy } = {}) {
    requiredText(approvedBy, "approvedBy");
    const current = await this.get(publicationId);
    const draft = await this.#catalog.getMapDraft(current.draftId);
    requireSealedDraft(current, draft);
    try {
      return await this.#repository.approve(approvePublicationRequestRecord(current, {
        approvedBy,
        occurredAt: this.#now(),
      }));
    } catch (error) {
      throw translatePublicationError(error);
    }
  }

  async execute(publicationId, { workerId } = {}) {
    identifier(publicationId, "publicationId");
    requiredText(workerId, "workerId");
    const claimTime = this.#now();
    let claimed;
    try {
      claimed = await this.#repository.claim(publicationId, {
        workerId,
        now: claimTime,
        leaseSeconds: this.#leaseSeconds,
      });
      if (!claimed) {
        const current = await this.get(publicationId);
        if (current.status === PUBLICATION_STATUS.completed) return Object.freeze({ publication: current });
        throw new PublicationError(
          "PUBLICATION_NOT_EXECUTABLE",
          `Publication ${publicationId} is ${current.status} or currently leased.`,
        );
      }
      if (claimed.status === PUBLICATION_STATUS.publishing) {
        await this.#releaseStore.ensurePublicationStored(publicationId, claimed.bundle);
        claimed = await this.#repository.markStorePublished(publicationId, workerId, this.#now());
      }
      const draft = await this.#catalog.getMapDraft(claimed.draftId);
      requireSealedDraft(claimed, draft);
      const publishedAt = this.#now();
      const publishedDraft = publishMapDraftRecord(draft, {
        publishedBy: claimed.approvedBy,
        occurredAt: publishedAt,
      });
      const event = createMapReleasePublishedEvent({
        eventId: this.#eventIdGenerator(),
        publication: claimed,
        draft: publishedDraft,
        publishedAt,
      });
      const result = await this.#repository.finalize(publicationId, workerId, {
        publishedDraft,
        event,
        publishedAt,
      });
      await this.#releaseStore.discardPublicationInput(publicationId).catch(() => undefined);
      return Object.freeze(result);
    } catch (error) {
      if (claimed && [PUBLICATION_STATUS.publishing, PUBLICATION_STATUS.storePublished].includes(claimed.status)) {
        const failedAt = this.#now();
        const delaySeconds = Math.min(300, 5 * (2 ** Math.max(0, claimed.attemptCount - 1)));
        const nextAttemptAt = new Date(new Date(failedAt).getTime() + delaySeconds * 1_000).toISOString();
        await this.#repository.recordFailure(publicationId, workerId, {
          error,
          nextAttemptAt,
          occurredAt: failedAt,
        }).catch(() => undefined);
      }
      throw translatePublicationError(error);
    }
  }

  async recover({ workerId, batchSize = 25 } = {}) {
    requiredText(workerId, "workerId");
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new PublicationError("PUBLICATION_BATCH_INVALID", "batchSize must be between 1 and 100.");
    }
    const publicationIds = await this.#repository.listRecoverable({ now: this.#now(), batchSize });
    const results = [];
    for (const publicationId of publicationIds) {
      try {
        const result = await this.execute(publicationId, { workerId });
        results.push(Object.freeze({ publicationId, status: result.publication.status }));
      } catch (error) {
        results.push(Object.freeze({
          publicationId,
          status: "FAILED_ATTEMPT",
          errorCode: error?.code ?? "PUBLICATION_FAILED",
        }));
      }
    }
    return Object.freeze({ attempted: publicationIds.length, results: Object.freeze(results) });
  }

  #now() {
    const value = new Date(this.#clock());
    if (!Number.isFinite(value.getTime())) throw new PublicationError("PUBLICATION_CLOCK_INVALID", "Clock returned an invalid date.");
    return value.toISOString();
  }
}

function requireSealedDraft(publication, draft) {
  if (draft.status !== MAP_DRAFT_STATUS.validated
    || draft.rowVersion !== publication.draftRowVersion
    || draft.validationReportSha256 !== publication.validationReportSha256) {
    throw new PublicationError(
      "PUBLICATION_DRAFT_CHANGED",
      `Map draft ${publication.draftId} changed after publication ${publication.publicationId} was requested.`,
    );
  }
}

function translatePublicationError(error) {
  if (error instanceof PublicationError) return error;
  if (error instanceof TwinDomainError) return new PublicationError(error.code, error.message, { cause: error });
  if (error instanceof ArtifactStoreError) return new PublicationError(error.code, error.message, { cause: error });
  if (error instanceof PersistenceError) {
    const code = ({
      ALREADY_EXISTS: "PUBLICATION_CONFLICT",
      NOT_FOUND: "PUBLICATION_NOT_FOUND",
      CONCURRENCY_CONFLICT: "PUBLICATION_CONCURRENCY_CONFLICT",
      REFERENCE_NOT_FOUND: "PUBLICATION_REFERENCE_NOT_FOUND",
      TWO_PERSON_REQUIRED: "PUBLICATION_TWO_PERSON_REQUIRED",
      PUBLICATION_RULE_VIOLATION: "PUBLICATION_RULE_VIOLATION",
      IMMUTABLE_HISTORY: "PUBLICATION_HISTORY_IMMUTABLE",
    })[error.code] ?? "PUBLICATION_PERSISTENCE_ERROR";
    return new PublicationError(code, error.message, { cause: error });
  }
  return error;
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new PublicationError("PUBLICATION_ID_INVALID", `${fieldName} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PublicationError("PUBLICATION_FIELD_REQUIRED", `${fieldName} is required.`);
  }
}
