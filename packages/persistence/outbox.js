import {
  InMemoryTwinCatalogRepository,
  PersistenceError,
  PostgresTwinCatalogRepository,
} from "./index.js";
import {
  PostgresDraftArtifactRepository,
} from "./draft-artifacts.js";

export class InMemoryOutboxRepository {
  #events = new Map();

  async append(event) {
    const record = newOutboxRecord(event);
    if (this.#events.has(record.eventId)) {
      throw new PersistenceError("OUTBOX_EVENT_EXISTS", `Outbox event ${record.eventId} already exists.`);
    }
    this.#events.set(record.eventId, clone(record));
    return clone(record);
  }

  async claim({ workerId, batchSize = 25, leaseSeconds = 30, now = new Date() }) {
    requiredText(workerId, "workerId");
    boundedInteger(batchSize, "batchSize", 1, 100);
    boundedInteger(leaseSeconds, "leaseSeconds", 1, 3_600);
    const claimedAt = isoDate(now, "now");
    const claimedTime = new Date(claimedAt).getTime();
    const leaseExpiresAt = new Date(claimedTime + leaseSeconds * 1_000).toISOString();
    const candidates = [...this.#events.values()]
      .filter((event) => event.deliveredAt === null)
      .filter((event) => new Date(event.availableAt).getTime() <= claimedTime)
      .filter((event) => event.leaseExpiresAt === null || new Date(event.leaseExpiresAt).getTime() <= claimedTime)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId))
      .slice(0, batchSize);

    return candidates.map((event) => {
      const claimed = {
        ...event,
        leaseOwner: workerId,
        leaseExpiresAt,
        deliveryAttempts: event.deliveryAttempts + 1,
      };
      this.#events.set(event.eventId, clone(claimed));
      return clone(claimed);
    });
  }

  async markDelivered(eventId, workerId, deliveredAt = new Date()) {
    const current = this.#leasedEvent(eventId, workerId);
    const delivered = {
      ...current,
      deliveredAt: isoDate(deliveredAt, "deliveredAt"),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    };
    this.#events.set(eventId, clone(delivered));
    return clone(delivered);
  }

  async markFailed(eventId, workerId, { error, availableAt }) {
    const current = this.#leasedEvent(eventId, workerId);
    const failed = {
      ...current,
      availableAt: isoDate(availableAt, "availableAt"),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: errorMessage(error),
    };
    this.#events.set(eventId, clone(failed));
    return clone(failed);
  }

  async get(eventId) {
    return this.#events.has(eventId) ? clone(this.#events.get(eventId)) : null;
  }

  async list() {
    return [...this.#events.values()]
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId))
      .map(clone);
  }

  snapshotForUnitOfWork() {
    return new Map([...this.#events.entries()].map(([key, value]) => [key, clone(value)]));
  }

  restoreUnitOfWorkSnapshot(snapshot) {
    if (!(snapshot instanceof Map)) {
      throw new PersistenceError("SNAPSHOT_INVALID", "The outbox unit-of-work snapshot must be a map.");
    }
    this.#events = new Map([...snapshot.entries()].map(([key, value]) => [key, clone(value)]));
  }

  #leasedEvent(eventId, workerId) {
    requiredText(eventId, "eventId");
    requiredText(workerId, "workerId");
    const current = this.#events.get(eventId);
    if (!current || current.deliveredAt !== null || current.leaseOwner !== workerId) {
      throw new PersistenceError("OUTBOX_LEASE_LOST", `Outbox event ${eventId} is not leased by ${workerId}.`);
    }
    return current;
  }
}

export class PostgresOutboxRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function") {
      throw new PersistenceError("DATABASE_REQUIRED", "A database query port is required.");
    }
    this.#database = database;
  }

  async append(event) {
    const record = newOutboxRecord(event);
    try {
      const result = await this.#database.query(
        `INSERT INTO twin_outbox_events
         (event_id, aggregate_type, aggregate_id, event_type, schema_version, payload, occurred_at, available_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         RETURNING *`,
        [
          record.eventId,
          record.aggregateType,
          record.aggregateId,
          record.eventType,
          record.schemaVersion,
          JSON.stringify(record.payload),
          record.occurredAt,
          record.availableAt,
        ],
      );
      return outboxFromRow(result.rows[0]);
    } catch (error) {
      if (error?.code === "23505") {
        throw new PersistenceError("OUTBOX_EVENT_EXISTS", `Outbox event ${record.eventId} already exists.`, { cause: error });
      }
      throw error;
    }
  }

  async claim({ workerId, batchSize = 25, leaseSeconds = 30, now = new Date() }) {
    requiredText(workerId, "workerId");
    boundedInteger(batchSize, "batchSize", 1, 100);
    boundedInteger(leaseSeconds, "leaseSeconds", 1, 3_600);
    const claimedAt = isoDate(now, "now");
    const leaseExpiresAt = new Date(new Date(claimedAt).getTime() + leaseSeconds * 1_000).toISOString();
    const result = await this.#database.query(
      `WITH claimable AS (
         SELECT event_id
         FROM twin_outbox_events
         WHERE delivered_at IS NULL
           AND available_at <= $3
           AND (lease_expires_at IS NULL OR lease_expires_at <= $3)
         ORDER BY occurred_at, event_id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE twin_outbox_events AS event
       SET lease_owner = $1,
           lease_expires_at = $4,
           delivery_attempts = event.delivery_attempts + 1
       FROM claimable
       WHERE event.event_id = claimable.event_id
       RETURNING event.*`,
      [workerId, batchSize, claimedAt, leaseExpiresAt],
    );
    return result.rows.map(outboxFromRow)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  }

  async markDelivered(eventId, workerId, deliveredAt = new Date()) {
    requiredText(eventId, "eventId");
    requiredText(workerId, "workerId");
    const result = await this.#database.query(
      `UPDATE twin_outbox_events
       SET delivered_at = $3, lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
       WHERE event_id = $1 AND lease_owner = $2 AND delivered_at IS NULL
       RETURNING *`,
      [eventId, workerId, isoDate(deliveredAt, "deliveredAt")],
    );
    return leasedResult(result, eventId, workerId);
  }

  async markFailed(eventId, workerId, { error, availableAt }) {
    requiredText(eventId, "eventId");
    requiredText(workerId, "workerId");
    const result = await this.#database.query(
      `UPDATE twin_outbox_events
       SET available_at = $3, last_error = $4, lease_owner = NULL, lease_expires_at = NULL
       WHERE event_id = $1 AND lease_owner = $2 AND delivered_at IS NULL
       RETURNING *`,
      [eventId, workerId, isoDate(availableAt, "availableAt"), errorMessage(error)],
    );
    return leasedResult(result, eventId, workerId);
  }

  async get(eventId) {
    requiredText(eventId, "eventId");
    const result = await this.#database.query("SELECT * FROM twin_outbox_events WHERE event_id = $1", [eventId]);
    return result.rows[0] ? outboxFromRow(result.rows[0]) : null;
  }
}

export class InMemoryTwinUnitOfWork {
  #catalogRepository;
  #outboxRepository;
  #draftArtifactRepository;
  #tail = Promise.resolve();

  constructor({ catalogRepository, outboxRepository, draftArtifactRepository = null }) {
    requireSnapshotRepository(catalogRepository, "catalogRepository");
    requireSnapshotRepository(outboxRepository, "outboxRepository");
    this.#catalogRepository = catalogRepository;
    this.#outboxRepository = outboxRepository;
    if (draftArtifactRepository !== null) {
      requireSnapshotRepository(draftArtifactRepository, "draftArtifactRepository");
    }
    this.#draftArtifactRepository = draftArtifactRepository;
  }

  async execute(operation) {
    if (typeof operation !== "function") throw new TypeError("Unit-of-work operation must be a function.");
    const previous = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const catalogSnapshot = this.#catalogRepository.snapshotForUnitOfWork();
    const outboxSnapshot = this.#outboxRepository.snapshotForUnitOfWork();
    const draftArtifactSnapshot = this.#draftArtifactRepository?.snapshotForUnitOfWork() ?? null;
    try {
      return await operation(Object.freeze({
        catalogRepository: this.#catalogRepository,
        outboxRepository: this.#outboxRepository,
        draftArtifactRepository: this.#draftArtifactRepository,
      }));
    } catch (error) {
      this.#catalogRepository.restoreUnitOfWorkSnapshot(catalogSnapshot);
      this.#outboxRepository.restoreUnitOfWorkSnapshot(outboxSnapshot);
      if (draftArtifactSnapshot !== null) {
        this.#draftArtifactRepository.restoreUnitOfWorkSnapshot(draftArtifactSnapshot);
      }
      throw error;
    } finally {
      release();
    }
  }
}

export class PostgresTwinUnitOfWork {
  #database;

  constructor(database) {
    if (!database || typeof database.transaction !== "function") {
      throw new PersistenceError("DATABASE_TRANSACTION_REQUIRED", "A database transaction port is required.");
    }
    this.#database = database;
  }

  execute(operation) {
    if (typeof operation !== "function") throw new TypeError("Unit-of-work operation must be a function.");
    return this.#database.transaction((transaction) => operation(Object.freeze({
      catalogRepository: new PostgresTwinCatalogRepository(transaction),
      outboxRepository: new PostgresOutboxRepository(transaction),
      draftArtifactRepository: new PostgresDraftArtifactRepository(transaction),
    })));
  }
}

function newOutboxRecord(event) {
  if (!event || typeof event !== "object") {
    throw new PersistenceError("OUTBOX_EVENT_REQUIRED", "An outbox event is required.");
  }
  requiredText(event.eventId, "eventId");
  requiredText(event.aggregateType, "aggregateType");
  requiredText(event.aggregateId, "aggregateId");
  requiredText(event.eventType, "eventType");
  boundedInteger(event.schemaVersion ?? 1, "schemaVersion", 1, 1_000);
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new PersistenceError("OUTBOX_PAYLOAD_INVALID", "Outbox payload must be an object.");
  }
  const occurredAt = isoDate(event.occurredAt, "occurredAt");
  return Object.freeze({
    eventId: event.eventId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion ?? 1,
    payload: clone(event.payload),
    occurredAt,
    availableAt: isoDate(event.availableAt ?? occurredAt, "availableAt"),
    deliveredAt: null,
    deliveryAttempts: 0,
    lastError: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  });
}

function outboxFromRow(row) {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return {
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: Number(row.schema_version),
    payload: clone(payload),
    occurredAt: isoDate(row.occurred_at, "occurredAt"),
    availableAt: isoDate(row.available_at, "availableAt"),
    deliveredAt: nullableIso(row.delivered_at),
    deliveryAttempts: Number(row.delivery_attempts),
    lastError: row.last_error ?? null,
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
  };
}

function leasedResult(result, eventId, workerId) {
  if (!result.rows[0]) {
    throw new PersistenceError("OUTBOX_LEASE_LOST", `Outbox event ${eventId} is not leased by ${workerId}.`);
  }
  return outboxFromRow(result.rows[0]);
}

function requireSnapshotRepository(repository, fieldName) {
  if (!repository
    || typeof repository.snapshotForUnitOfWork !== "function"
    || typeof repository.restoreUnitOfWorkSnapshot !== "function") {
    throw new PersistenceError("UNIT_OF_WORK_REPOSITORY_INVALID", `${fieldName} must support unit-of-work snapshots.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PersistenceError("OUTBOX_FIELD_REQUIRED", `${fieldName} is required.`);
  }
}

function boundedInteger(value, fieldName, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PersistenceError("OUTBOX_FIELD_INVALID", `${fieldName} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function isoDate(value, fieldName) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PersistenceError("OUTBOX_DATE_INVALID", `${fieldName} must be a valid date.`);
  }
  return date.toISOString();
}

function nullableIso(value) {
  return value === null || value === undefined ? null : isoDate(value, "database timestamp");
}

function errorMessage(value) {
  const message = value instanceof Error ? value.message : String(value ?? "Unknown delivery error");
  return message.slice(0, 2_000);
}

function clone(value) {
  return structuredClone(value);
}
