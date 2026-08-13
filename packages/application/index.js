import { randomUUID } from "node:crypto";
import {
  MAP_DRAFT_ACTION,
  TwinDomainError,
  createMapDraftLifecycleEvent,
  createMapDraftRecord,
  transitionMapDraft,
} from "@brash-twin/domain";
import { PersistenceError } from "@brash-twin/persistence";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CatalogError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "CatalogError";
    this.code = code;
  }
}

export class TwinCatalogService {
  #repository;
  #unitOfWork;
  #clock;
  #eventIdGenerator;

  constructor({
    repository,
    unitOfWork,
    clock = () => new Date(),
    eventIdGenerator = randomUUID,
  }) {
    if (!repository) throw new CatalogError("REPOSITORY_REQUIRED", "Catalog repository is required.");
    if (!unitOfWork || typeof unitOfWork.execute !== "function") {
      throw new CatalogError("UNIT_OF_WORK_REQUIRED", "A transactional catalog unit-of-work is required.");
    }
    if (typeof eventIdGenerator !== "function") {
      throw new CatalogError("EVENT_ID_GENERATOR_INVALID", "eventIdGenerator must be a function.");
    }
    this.#repository = repository;
    this.#unitOfWork = unitOfWork;
    this.#clock = clock;
    this.#eventIdGenerator = eventIdGenerator;
  }

  async createSite(input) {
    identifier(input.siteId, "siteId");
    requiredText(input.displayName, "displayName");
    timeZone(input.timezone);
    requiredText(input.operatorId, "operatorId");
    return this.#persist(() => this.#repository.createSite({
      siteId: input.siteId,
      displayName: input.displayName.trim(),
      timezone: input.timezone,
      createdBy: input.operatorId,
      createdAt: this.#now(),
    }));
  }

  listSites() {
    return this.#repository.listSites();
  }

  async createBuilding(siteId, input) {
    identifier(siteId, "siteId");
    identifier(input.buildingId, "buildingId");
    requiredText(input.displayName, "displayName");
    requiredText(input.operatorId, "operatorId");
    return this.#persist(() => this.#repository.createBuilding({
      siteId,
      buildingId: input.buildingId,
      displayName: input.displayName.trim(),
      createdBy: input.operatorId,
      createdAt: this.#now(),
    }));
  }

  listBuildings(siteId) {
    identifier(siteId, "siteId");
    return this.#repository.listBuildings(siteId);
  }

  async createFloor(siteId, buildingId, input) {
    identifier(siteId, "siteId");
    identifier(buildingId, "buildingId");
    identifier(input.floorId, "floorId");
    requiredText(input.displayName, "displayName");
    requiredText(input.operatorId, "operatorId");
    const elevationMeters = input.elevationMeters ?? 0;
    if (!Number.isFinite(elevationMeters)) throw new CatalogError("ELEVATION_INVALID", "elevationMeters must be finite.");
    return this.#persist(() => this.#repository.createFloor({
      floorId: input.floorId,
      siteId,
      buildingId,
      displayName: input.displayName.trim(),
      elevationMeters,
      createdBy: input.operatorId,
      createdAt: this.#now(),
    }));
  }

  listFloors(siteId) {
    if (siteId !== undefined) identifier(siteId, "siteId");
    return this.#repository.listFloors(siteId);
  }

  async createMapFamily(input) {
    identifier(input.familyId, "familyId");
    identifier(input.floorId, "floorId");
    requiredText(input.displayName, "displayName");
    requiredText(input.operatorId, "operatorId");
    return this.#persist(() => this.#repository.createMapFamily({
      familyId: input.familyId,
      floorId: input.floorId,
      displayName: input.displayName.trim(),
      createdBy: input.operatorId,
      createdAt: this.#now(),
    }));
  }

  listMapFamilies(floorId) {
    if (floorId !== undefined) identifier(floorId, "floorId");
    return this.#repository.listMapFamilies(floorId);
  }

  async createMapDraft(input) {
    identifier(input.draftId, "draftId");
    identifier(input.familyId, "familyId");
    requiredText(input.canonicalFrameId, "canonicalFrameId");
    requiredText(input.operatorId, "operatorId");
    let record;
    try {
      record = createMapDraftRecord({ ...input, occurredAt: this.#clock() });
    } catch (error) {
      throw translateDomainError(error);
    }
    return this.#persist(() => this.#unitOfWork.execute(async ({ catalogRepository, outboxRepository }) => {
      const created = await catalogRepository.createMapDraft(record);
      await outboxRepository.append(createMapDraftLifecycleEvent({
        eventId: this.#eventIdGenerator(),
        record: created,
        operatorId: input.operatorId,
        occurredAt: created.updatedAt,
      }));
      return created;
    }));
  }

  async getMapDraft(draftId) {
    identifier(draftId, "draftId");
    const record = await this.#repository.getMapDraft(draftId);
    if (!record) throw new CatalogError("MAP_DRAFT_NOT_FOUND", `Map draft ${draftId} was not found.`);
    return record;
  }

  listMapDrafts(familyId) {
    if (familyId !== undefined) identifier(familyId, "familyId");
    return this.#repository.listMapDrafts(familyId);
  }

  submitMapDraftForReview(draftId, operatorId) {
    return this.#transitionDraft(draftId, { action: MAP_DRAFT_ACTION.submitReview, operatorId });
  }

  returnMapDraftToDraft(draftId, operatorId) {
    return this.#transitionDraft(draftId, { action: MAP_DRAFT_ACTION.returnToDraft, operatorId });
  }

  validateMapDraft(draftId, validationReportSha256, operatorId) {
    return this.#transitionDraft(draftId, {
      action: MAP_DRAFT_ACTION.markValidated,
      validationReportSha256,
      operatorId,
    });
  }

  async #transitionDraft(draftId, action) {
    identifier(draftId, "draftId");
    return this.#persist(() => this.#unitOfWork.execute(async ({ catalogRepository, outboxRepository }) => {
      const current = await catalogRepository.getMapDraft(draftId);
      if (!current) throw new CatalogError("MAP_DRAFT_NOT_FOUND", `Map draft ${draftId} was not found.`);
      let next;
      try {
        next = transitionMapDraft(current, { ...action, occurredAt: this.#clock() });
      } catch (error) {
        throw translateDomainError(error);
      }
      const saved = await catalogRepository.saveMapDraft(next, current.rowVersion);
      await outboxRepository.append(createMapDraftLifecycleEvent({
        eventId: this.#eventIdGenerator(),
        record: saved,
        previousStatus: current.status,
        action: action.action,
        operatorId: action.operatorId,
        occurredAt: saved.updatedAt,
      }));
      return saved;
    }));
  }

  async #persist(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PersistenceError) {
        const code = ({
          ALREADY_EXISTS: "CATALOG_CONFLICT",
          REFERENCE_NOT_FOUND: "CATALOG_PARENT_NOT_FOUND",
          NOT_FOUND: "CATALOG_NOT_FOUND",
          CONCURRENCY_CONFLICT: "CATALOG_CONCURRENCY_CONFLICT",
        })[error.code] ?? "CATALOG_PERSISTENCE_ERROR";
        throw new CatalogError(code, error.message, { cause: error });
      }
      throw error;
    }
  }

  #now() {
    const value = new Date(this.#clock());
    if (!Number.isFinite(value.getTime())) throw new CatalogError("CLOCK_INVALID", "Clock returned an invalid date.");
    return value.toISOString();
  }
}

export class OutboxDispatcher {
  #outboxRepository;
  #publisher;
  #clock;
  #baseRetryDelayMilliseconds;
  #maximumRetryDelayMilliseconds;

  constructor({
    outboxRepository,
    publisher,
    clock = () => new Date(),
    baseRetryDelayMilliseconds = 1_000,
    maximumRetryDelayMilliseconds = 300_000,
  }) {
    if (!outboxRepository
      || typeof outboxRepository.claim !== "function"
      || typeof outboxRepository.markDelivered !== "function"
      || typeof outboxRepository.markFailed !== "function") {
      throw new CatalogError("OUTBOX_REPOSITORY_INVALID", "Outbox repository delivery operations are required.");
    }
    if (typeof publisher !== "function") {
      throw new CatalogError("OUTBOX_PUBLISHER_INVALID", "Outbox publisher must be a function.");
    }
    positiveInteger(baseRetryDelayMilliseconds, "baseRetryDelayMilliseconds", 1, 3_600_000);
    positiveInteger(maximumRetryDelayMilliseconds, "maximumRetryDelayMilliseconds", 1, 86_400_000);
    if (maximumRetryDelayMilliseconds < baseRetryDelayMilliseconds) {
      throw new CatalogError("OUTBOX_RETRY_INVALID", "Maximum retry delay cannot be smaller than the base delay.");
    }
    this.#outboxRepository = outboxRepository;
    this.#publisher = publisher;
    this.#clock = clock;
    this.#baseRetryDelayMilliseconds = baseRetryDelayMilliseconds;
    this.#maximumRetryDelayMilliseconds = maximumRetryDelayMilliseconds;
  }

  async dispatchBatch({ workerId, batchSize = 25, leaseSeconds = 30 } = {}) {
    requiredText(workerId, "workerId");
    positiveInteger(batchSize, "batchSize", 1, 100);
    positiveInteger(leaseSeconds, "leaseSeconds", 1, 3_600);
    const claimed = await this.#outboxRepository.claim({
      workerId,
      batchSize,
      leaseSeconds,
      now: this.#now(),
    });
    const delivered = [];
    const failed = [];
    for (const event of claimed) {
      try {
        await this.#publisher(event);
        await this.#outboxRepository.markDelivered(event.eventId, workerId, this.#now());
        delivered.push(event.eventId);
      } catch (error) {
        const delay = Math.min(
          this.#maximumRetryDelayMilliseconds,
          this.#baseRetryDelayMilliseconds * (2 ** Math.min(Math.max(event.deliveryAttempts - 1, 0), 20)),
        );
        await this.#outboxRepository.markFailed(event.eventId, workerId, {
          error,
          availableAt: new Date(this.#now().getTime() + delay),
        });
        failed.push(Object.freeze({ eventId: event.eventId, error: safeErrorMessage(error) }));
      }
    }
    return Object.freeze({
      claimed: claimed.length,
      delivered: Object.freeze(delivered),
      failed: Object.freeze(failed),
    });
  }

  #now() {
    const value = new Date(this.#clock());
    if (!Number.isFinite(value.getTime())) throw new CatalogError("CLOCK_INVALID", "Clock returned an invalid date.");
    return value;
  }
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new CatalogError("IDENTIFIER_INVALID", `${fieldName} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogError("FIELD_REQUIRED", `${fieldName} is required.`);
  }
}

function positiveInteger(value, fieldName, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CatalogError("FIELD_INVALID", `${fieldName} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function timeZone(value) {
  requiredText(value, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new CatalogError("TIMEZONE_INVALID", `Unsupported IANA timezone ${value}.`);
  }
}

function translateDomainError(error) {
  if (error instanceof TwinDomainError) return new CatalogError(error.code, error.message, { cause: error });
  return error;
}

function safeErrorMessage(error) {
  return (error instanceof Error ? error.message : String(error ?? "Unknown delivery error")).slice(0, 2_000);
}
