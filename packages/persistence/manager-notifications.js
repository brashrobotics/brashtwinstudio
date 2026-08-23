import { PersistenceError } from "./index.js";

export class InMemoryManagerNotificationRepository {
  #routes = new Map();
  #notifications = new Map();
  #sourceEvents = new Map();
  #deliveries = new Map();
  #attempts = new Map();
  #requeues = new Map();

  async createRoute(record) {
    validateRoute(record);
    if (this.#routes.has(record.routeId) || [...this.#routes.values()].some((route) => routeIdentity(route) === routeIdentity(record))) {
      conflict("MANAGER_NOTIFICATION_ROUTE_CONFLICT", `Manager notification route ${record.routeId} already exists.`);
    }
    this.#routes.set(record.routeId, clone(record));
    return clone(record);
  }

  async listRoutes({ siteId, floorId } = {}) {
    return [...this.#routes.values()]
      .filter((route) => !siteId || route.siteId === siteId)
      .filter((route) => !floorId || route.scopeType === "SITE" || route.floorId === floorId)
      .sort((left, right) => left.scopeType.localeCompare(right.scopeType) || left.routeId.localeCompare(right.routeId))
      .map(clone);
  }

  async createNotification(record, deliveries = []) {
    validateNotification(record);
    const existingId = this.#sourceEvents.get(record.sourceEventId);
    if (existingId) {
      const existing = this.#notifications.get(existingId);
      if (existing.sourceEventSha256 !== record.sourceEventSha256) {
        conflict("MANAGER_NOTIFICATION_EVENT_CONFLICT", `Source event ${record.sourceEventId} changed after projection.`);
      }
      return this.#hydrate(existingId);
    }
    if (this.#notifications.has(record.notificationId)) {
      conflict("MANAGER_NOTIFICATION_CONFLICT", `Manager notification ${record.notificationId} already exists.`);
    }
    const snapshot = this.#snapshot();
    try {
      this.#notifications.set(record.notificationId, clone(record));
      this.#sourceEvents.set(record.sourceEventId, record.notificationId);
      this.#addDeliveries(record.notificationId, deliveries);
      return this.#hydrate(record.notificationId);
    } catch (error) {
      this.#restore(snapshot);
      throw error;
    }
  }

  async addDeliveries(notificationId, deliveries) {
    if (!this.#notifications.has(notificationId)) return null;
    const snapshot = this.#snapshot();
    try {
      this.#addDeliveries(notificationId, deliveries);
      return this.#hydrate(notificationId);
    } catch (error) {
      this.#restore(snapshot);
      throw error;
    }
  }

  async getNotification(notificationId) {
    return this.#notifications.has(notificationId) ? this.#hydrate(notificationId) : null;
  }

  async listNotifications(draftId) {
    return [...this.#notifications.values()]
      .filter((notification) => !draftId || notification.draftId === draftId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.notificationId.localeCompare(right.notificationId))
      .map((notification) => this.#hydrate(notification.notificationId));
  }

  async claimDeliveries({ workerId, batchSize = 25, leaseSeconds = 30, now = new Date() }) {
    requiredText(workerId, "workerId");
    boundedInteger(batchSize, "batchSize", 1, 100);
    boundedInteger(leaseSeconds, "leaseSeconds", 1, 3_600);
    const claimedAt = isoDate(now, "now");
    const claimedTime = new Date(claimedAt).getTime();
    const leaseExpiresAt = new Date(claimedTime + leaseSeconds * 1_000).toISOString();
    const candidates = [...this.#deliveries.values()]
      .filter((delivery) => delivery.status === "PENDING")
      .filter((delivery) => new Date(delivery.availableAt).getTime() <= claimedTime)
      .filter((delivery) => delivery.leaseExpiresAt === null
        || new Date(delivery.leaseExpiresAt).getTime() <= claimedTime)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.deliveryId.localeCompare(right.deliveryId))
      .slice(0, batchSize);
    return candidates.map((delivery) => {
      const claimed = {
        ...delivery,
        leaseOwner: workerId,
        leaseExpiresAt,
        deliveryAttempts: delivery.deliveryAttempts + 1,
      };
      this.#deliveries.set(delivery.deliveryId, clone(claimed));
      return clone({ ...claimed, message: this.#notifications.get(delivery.notificationId).message });
    });
  }

  async markDeliveryDelivered(deliveryId, workerId, { providerMessageId, deliveredAt }) {
    const current = this.#leasedDelivery(deliveryId, workerId);
    const timestamp = isoDate(deliveredAt, "deliveredAt");
    requiredText(providerMessageId, "providerMessageId");
    this.#appendAttempt(current, {
      deliveryId,
      attemptNumber: current.deliveryAttempts,
      outcome: "DELIVERED",
      providerMessageId,
      error: null,
      completedAt: timestamp,
    });
    this.#deliveries.set(deliveryId, clone({
      ...current,
      status: "DELIVERED",
      deliveredAt: timestamp,
      providerMessageId,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    }));
    return this.#hydrate(current.notificationId);
  }

  async markDeliveryFailed(deliveryId, workerId, { error, failedAt, deadLetter, availableAt }) {
    const current = this.#leasedDelivery(deliveryId, workerId);
    const timestamp = isoDate(failedAt, "failedAt");
    const message = errorMessage(error);
    this.#appendAttempt(current, {
      deliveryId,
      attemptNumber: current.deliveryAttempts,
      outcome: "FAILED",
      providerMessageId: null,
      error: message,
      completedAt: timestamp,
    });
    this.#deliveries.set(deliveryId, clone({
      ...current,
      status: deadLetter ? "DEAD_LETTER" : "PENDING",
      availableAt: isoDate(availableAt, "availableAt"),
      lastError: message,
      leaseOwner: null,
      leaseExpiresAt: null,
    }));
    return this.#hydrate(current.notificationId);
  }

  async requeueDelivery(deliveryId, action) {
    const current = this.#deliveries.get(deliveryId);
    if (!current) return null;
    if (current.status !== "DEAD_LETTER") {
      conflict("MANAGER_NOTIFICATION_REQUEUE_INVALID", `Delivery ${deliveryId} is not in dead-letter state.`);
    }
    validateRequeue(action, deliveryId);
    if (this.#requeues.has(action.requeueId)) {
      conflict("MANAGER_NOTIFICATION_REQUEUE_CONFLICT", `Requeue ${action.requeueId} already exists.`);
    }
    this.#requeues.set(action.requeueId, clone({ ...action, deliveryId }));
    this.#deliveries.set(deliveryId, clone({
      ...current,
      status: "PENDING",
      availableAt: action.requestedAt,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    }));
    return this.#hydrate(current.notificationId);
  }

  #addDeliveries(notificationId, deliveries) {
    for (const delivery of deliveries) {
      validateDelivery(delivery, notificationId);
      const existing = this.#deliveries.get(delivery.deliveryId);
      const routeExisting = [...this.#deliveries.values()].find(
        (candidate) => candidate.notificationId === notificationId && candidate.routeId === delivery.routeId,
      );
      if (existing || routeExisting) {
        const candidate = existing ?? routeExisting;
        if (candidate.deliveryId !== delivery.deliveryId
          || candidate.destinationSha256 !== delivery.destinationSha256
          || candidate.channel !== delivery.channel) {
          conflict("MANAGER_NOTIFICATION_DELIVERY_CONFLICT", `Delivery route ${delivery.routeId} changed after projection.`);
        }
        continue;
      }
      this.#deliveries.set(delivery.deliveryId, clone(delivery));
    }
  }

  #leasedDelivery(deliveryId, workerId) {
    requiredText(deliveryId, "deliveryId");
    requiredText(workerId, "workerId");
    const current = this.#deliveries.get(deliveryId);
    if (!current || current.status !== "PENDING" || current.leaseOwner !== workerId) {
      conflict("MANAGER_NOTIFICATION_LEASE_LOST", `Delivery ${deliveryId} is not leased by ${workerId}.`);
    }
    return current;
  }

  #appendAttempt(delivery, attempt) {
    const attempts = this.#attempts.get(delivery.deliveryId) ?? [];
    if (attempts.some((candidate) => candidate.attemptNumber === attempt.attemptNumber)) {
      conflict("MANAGER_NOTIFICATION_ATTEMPT_CONFLICT", `Attempt ${attempt.attemptNumber} already exists.`);
    }
    this.#attempts.set(delivery.deliveryId, [...attempts, clone(attempt)]);
  }

  #hydrate(notificationId) {
    const notification = this.#notifications.get(notificationId);
    const deliveries = [...this.#deliveries.values()]
      .filter((delivery) => delivery.notificationId === notificationId)
      .sort((left, right) => left.deliveryId.localeCompare(right.deliveryId))
      .map((delivery) => ({
        ...clone(delivery),
        attempts: clone(this.#attempts.get(delivery.deliveryId) ?? []),
        requeues: [...this.#requeues.values()]
          .filter((requeue) => requeue.deliveryId === delivery.deliveryId)
          .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
          .map(clone),
      }));
    return clone({ ...notification, deliveries });
  }

  #snapshot() {
    return {
      routes: cloneMap(this.#routes), notifications: cloneMap(this.#notifications), sourceEvents: cloneMap(this.#sourceEvents),
      deliveries: cloneMap(this.#deliveries), attempts: cloneMap(this.#attempts), requeues: cloneMap(this.#requeues),
    };
  }

  #restore(snapshot) {
    this.#routes = snapshot.routes;
    this.#notifications = snapshot.notifications;
    this.#sourceEvents = snapshot.sourceEvents;
    this.#deliveries = snapshot.deliveries;
    this.#attempts = snapshot.attempts;
    this.#requeues = snapshot.requeues;
  }
}

export class PostgresManagerNotificationRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function" || typeof database.transaction !== "function") {
      throw new PersistenceError(
        "DATABASE_TRANSACTION_REQUIRED",
        "Manager notification persistence requires query and transaction ports.",
      );
    }
    this.#database = database;
  }

  async createRoute(record) {
    validateRoute(record);
    try {
      const result = await this.#database.query(
        `INSERT INTO twin_manager_notification_routes
         (route_id, scope_type, site_id, floor_id, channel, destination,
          destination_sha256, display_label, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          record.routeId, record.scopeType, record.siteId, record.floorId, record.channel,
          record.destination, record.destinationSha256, record.displayLabel, record.createdBy, record.createdAt,
        ],
      );
      return routeFromRow(result.rows[0]);
    } catch (error) {
      if (error?.code === "23505") conflict("MANAGER_NOTIFICATION_ROUTE_CONFLICT", `Route ${record.routeId} already exists.`, error);
      throw error;
    }
  }

  async listRoutes({ siteId, floorId } = {}) {
    const clauses = [];
    const parameters = [];
    if (siteId) { parameters.push(siteId); clauses.push(`site_id = $${parameters.length}`); }
    if (floorId) {
      parameters.push(floorId);
      clauses.push(`(scope_type = 'SITE' OR floor_id = $${parameters.length})`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.#database.query(
      `SELECT * FROM twin_manager_notification_routes ${where} ORDER BY scope_type, route_id`,
      parameters,
    );
    return result.rows.map(routeFromRow);
  }

  createNotification(record, deliveries = []) {
    validateNotification(record);
    return this.#database.transaction(async (transaction) => {
      const existing = await transaction.query(
        "SELECT * FROM twin_manager_notifications WHERE source_event_id = $1",
        [record.sourceEventId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].source_event_sha256 !== record.sourceEventSha256) {
          conflict("MANAGER_NOTIFICATION_EVENT_CONFLICT", `Source event ${record.sourceEventId} changed after projection.`);
        }
        return hydrateNotification(transaction, notificationFromRow(existing.rows[0]));
      }
      await transaction.query(
        `INSERT INTO twin_manager_notifications
         (notification_id, source_event_id, source_event_sha256, draft_id, site_id,
          floor_id, notification_required, message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          record.notificationId, record.sourceEventId, record.sourceEventSha256, record.draftId,
          record.siteId, record.floorId, record.notificationRequired, JSON.stringify(record.message), record.createdAt,
        ],
      );
      await insertDeliveries(transaction, record.notificationId, deliveries);
      return hydrateNotification(transaction, record);
    });
  }

  addDeliveries(notificationId, deliveries) {
    return this.#database.transaction(async (transaction) => {
      const result = await transaction.query(
        "SELECT * FROM twin_manager_notifications WHERE notification_id = $1",
        [notificationId],
      );
      if (!result.rows[0]) return null;
      await insertDeliveries(transaction, notificationId, deliveries);
      return hydrateNotification(transaction, notificationFromRow(result.rows[0]));
    });
  }

  async getNotification(notificationId) {
    const result = await this.#database.query(
      "SELECT * FROM twin_manager_notifications WHERE notification_id = $1",
      [notificationId],
    );
    return result.rows[0] ? hydrateNotification(this.#database, notificationFromRow(result.rows[0])) : null;
  }

  async listNotifications(draftId) {
    const result = await this.#database.query(
      `SELECT * FROM twin_manager_notifications
       WHERE ($1::text IS NULL OR draft_id = $1)
       ORDER BY created_at, notification_id`,
      [draftId ?? null],
    );
    const records = [];
    for (const row of result.rows) records.push(await hydrateNotification(this.#database, notificationFromRow(row)));
    return records;
  }

  async claimDeliveries({ workerId, batchSize = 25, leaseSeconds = 30, now = new Date() }) {
    requiredText(workerId, "workerId");
    boundedInteger(batchSize, "batchSize", 1, 100);
    boundedInteger(leaseSeconds, "leaseSeconds", 1, 3_600);
    const claimedAt = isoDate(now, "now");
    const leaseExpiresAt = new Date(new Date(claimedAt).getTime() + leaseSeconds * 1_000).toISOString();
    const result = await this.#database.query(
      `WITH claimable AS (
         SELECT delivery_id
         FROM twin_manager_notification_deliveries
         WHERE status = 'PENDING'
           AND available_at <= $3
           AND (lease_expires_at IS NULL OR lease_expires_at <= $3)
         ORDER BY created_at, delivery_id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE twin_manager_notification_deliveries AS delivery
       SET lease_owner = $1,
           lease_expires_at = $4,
           delivery_attempts = delivery.delivery_attempts + 1
       FROM claimable
       WHERE delivery.delivery_id = claimable.delivery_id
       RETURNING delivery.*`,
      [workerId, batchSize, claimedAt, leaseExpiresAt],
    );
    const claimed = [];
    for (const row of result.rows) {
      const delivery = deliveryFromRow(row);
      const notification = await this.#database.query(
        "SELECT message FROM twin_manager_notifications WHERE notification_id = $1",
        [delivery.notificationId],
      );
      if (!notification.rows[0]) integrity("Claimed delivery has no manager notification.");
      claimed.push({ ...delivery, message: jsonValue(notification.rows[0].message) });
    }
    return claimed.sort((left, right) => left.createdAt.localeCompare(right.createdAt)
      || left.deliveryId.localeCompare(right.deliveryId));
  }

  markDeliveryDelivered(deliveryId, workerId, { providerMessageId, deliveredAt }) {
    return this.#database.transaction(async (transaction) => {
      const timestamp = isoDate(deliveredAt, "deliveredAt");
      const result = await transaction.query(
        `UPDATE twin_manager_notification_deliveries
         SET status = 'DELIVERED', delivered_at = $3, provider_message_id = $4,
             last_error = NULL, lease_owner = NULL, lease_expires_at = NULL
         WHERE delivery_id = $1 AND lease_owner = $2 AND status = 'PENDING'
         RETURNING *`,
        [deliveryId, workerId, timestamp, providerMessageId],
      );
      const delivery = leasedDelivery(result, deliveryId, workerId);
      await transaction.query(
        `INSERT INTO twin_manager_notification_attempts
         (delivery_id, attempt_number, outcome, provider_message_id, error, completed_at)
         VALUES ($1, $2, 'DELIVERED', $3, NULL, $4)`,
        [deliveryId, delivery.deliveryAttempts, providerMessageId, timestamp],
      );
      return hydrateByDelivery(transaction, delivery);
    });
  }

  markDeliveryFailed(deliveryId, workerId, { error, failedAt, deadLetter, availableAt }) {
    return this.#database.transaction(async (transaction) => {
      const timestamp = isoDate(failedAt, "failedAt");
      const message = errorMessage(error);
      const result = await transaction.query(
        `UPDATE twin_manager_notification_deliveries
         SET status = $3, available_at = $4, last_error = $5,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE delivery_id = $1 AND lease_owner = $2 AND status = 'PENDING'
         RETURNING *`,
        [deliveryId, workerId, deadLetter ? "DEAD_LETTER" : "PENDING", isoDate(availableAt, "availableAt"), message],
      );
      const delivery = leasedDelivery(result, deliveryId, workerId);
      await transaction.query(
        `INSERT INTO twin_manager_notification_attempts
         (delivery_id, attempt_number, outcome, provider_message_id, error, completed_at)
         VALUES ($1, $2, 'FAILED', NULL, $3, $4)`,
        [deliveryId, delivery.deliveryAttempts, message, timestamp],
      );
      return hydrateByDelivery(transaction, delivery);
    });
  }

  requeueDelivery(deliveryId, action) {
    return this.#database.transaction(async (transaction) => {
      validateRequeue(action, deliveryId);
      const selected = await transaction.query(
        "SELECT * FROM twin_manager_notification_deliveries WHERE delivery_id = $1 FOR UPDATE",
        [deliveryId],
      );
      if (!selected.rows[0]) return null;
      if (selected.rows[0].status !== "DEAD_LETTER") {
        conflict("MANAGER_NOTIFICATION_REQUEUE_INVALID", `Delivery ${deliveryId} is not in dead-letter state.`);
      }
      await transaction.query(
        `INSERT INTO twin_manager_notification_requeues
         (requeue_id, delivery_id, requested_by, requested_at)
         VALUES ($1, $2, $3, $4)`,
        [action.requeueId, deliveryId, action.requestedBy, action.requestedAt],
      );
      const result = await transaction.query(
        `UPDATE twin_manager_notification_deliveries
         SET status = 'PENDING', available_at = $2, last_error = NULL,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE delivery_id = $1
         RETURNING *`,
        [deliveryId, action.requestedAt],
      );
      return hydrateByDelivery(transaction, deliveryFromRow(result.rows[0]));
    });
  }
}

async function insertDeliveries(database, notificationId, deliveries) {
  for (const delivery of deliveries) {
    validateDelivery(delivery, notificationId);
    await database.query(
      `INSERT INTO twin_manager_notification_deliveries
       (delivery_id, notification_id, route_id, channel, destination, destination_sha256,
        display_label, status, available_at, delivery_attempts, lease_owner,
        lease_expires_at, delivered_at, provider_message_id, last_error, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (notification_id, route_id) DO NOTHING`,
      [
        delivery.deliveryId, notificationId, delivery.routeId, delivery.channel, delivery.destination,
        delivery.destinationSha256, delivery.displayLabel, delivery.status, delivery.availableAt,
        delivery.deliveryAttempts, delivery.leaseOwner, delivery.leaseExpiresAt, delivery.deliveredAt,
        delivery.providerMessageId, delivery.lastError, delivery.createdBy, delivery.createdAt,
      ],
    );
  }
}

async function hydrateByDelivery(database, delivery) {
  const result = await database.query(
    "SELECT * FROM twin_manager_notifications WHERE notification_id = $1",
    [delivery.notificationId],
  );
  if (!result.rows[0]) integrity("Delivery has no manager notification.");
  return hydrateNotification(database, notificationFromRow(result.rows[0]));
}

async function hydrateNotification(database, notification) {
  const deliveriesResult = await database.query(
    `SELECT * FROM twin_manager_notification_deliveries
     WHERE notification_id = $1 ORDER BY delivery_id`,
    [notification.notificationId],
  );
  const deliveries = [];
  for (const row of deliveriesResult.rows) {
    const delivery = deliveryFromRow(row);
    const attempts = await database.query(
      `SELECT * FROM twin_manager_notification_attempts
       WHERE delivery_id = $1 ORDER BY attempt_number`,
      [delivery.deliveryId],
    );
    const requeues = await database.query(
      `SELECT * FROM twin_manager_notification_requeues
       WHERE delivery_id = $1 ORDER BY requested_at, requeue_id`,
      [delivery.deliveryId],
    );
    deliveries.push({
      ...delivery,
      attempts: attempts.rows.map(attemptFromRow),
      requeues: requeues.rows.map(requeueFromRow),
    });
  }
  return { ...notification, deliveries };
}

function routeFromRow(row) {
  return {
    routeId: row.route_id,
    scopeType: row.scope_type,
    siteId: row.site_id,
    floorId: row.floor_id ?? null,
    channel: row.channel,
    destination: row.destination,
    destinationSha256: row.destination_sha256,
    displayLabel: row.display_label,
    createdBy: row.created_by,
    createdAt: isoDate(row.created_at, "createdAt"),
  };
}

function notificationFromRow(row) {
  return {
    notificationId: row.notification_id,
    sourceEventId: row.source_event_id,
    sourceEventSha256: row.source_event_sha256,
    draftId: row.draft_id,
    siteId: row.site_id,
    floorId: row.floor_id,
    notificationRequired: Boolean(row.notification_required),
    message: jsonValue(row.message),
    createdAt: isoDate(row.created_at, "createdAt"),
  };
}

function deliveryFromRow(row) {
  return {
    deliveryId: row.delivery_id,
    notificationId: row.notification_id,
    routeId: row.route_id,
    channel: row.channel,
    destination: row.destination,
    destinationSha256: row.destination_sha256,
    displayLabel: row.display_label,
    status: row.status,
    availableAt: isoDate(row.available_at, "availableAt"),
    deliveryAttempts: Number(row.delivery_attempts),
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    deliveredAt: nullableIso(row.delivered_at),
    providerMessageId: row.provider_message_id ?? null,
    lastError: row.last_error ?? null,
    createdBy: row.created_by,
    createdAt: isoDate(row.created_at, "createdAt"),
  };
}

function attemptFromRow(row) {
  return {
    deliveryId: row.delivery_id,
    attemptNumber: Number(row.attempt_number),
    outcome: row.outcome,
    providerMessageId: row.provider_message_id ?? null,
    error: row.error ?? null,
    completedAt: isoDate(row.completed_at, "completedAt"),
  };
}

function requeueFromRow(row) {
  return {
    requeueId: row.requeue_id,
    deliveryId: row.delivery_id,
    requestedBy: row.requested_by,
    requestedAt: isoDate(row.requested_at, "requestedAt"),
  };
}

function leasedDelivery(result, deliveryId, workerId) {
  if (!result.rows[0]) conflict("MANAGER_NOTIFICATION_LEASE_LOST", `Delivery ${deliveryId} is not leased by ${workerId}.`);
  return deliveryFromRow(result.rows[0]);
}

function validateRoute(route) {
  if (!route || !new Set(["SITE", "FLOOR"]).has(route.scopeType)
    || !new Set(["EMAIL", "WEBHOOK"]).has(route.channel)
    || (route.scopeType === "SITE" && route.floorId !== null)
    || (route.scopeType === "FLOOR" && typeof route.floorId !== "string")) {
    throw new PersistenceError("MANAGER_NOTIFICATION_ROUTE_INVALID", "Manager notification route is invalid.");
  }
}

function validateNotification(notification) {
  if (!notification || typeof notification.message !== "object" || typeof notification.notificationRequired !== "boolean") {
    throw new PersistenceError("MANAGER_NOTIFICATION_INVALID", "Manager notification record is invalid.");
  }
}

function validateDelivery(delivery, notificationId) {
  if (!delivery || delivery.notificationId !== notificationId || delivery.status !== "PENDING"
    || delivery.deliveryAttempts !== 0 || delivery.leaseOwner !== null || delivery.leaseExpiresAt !== null) {
    throw new PersistenceError("MANAGER_NOTIFICATION_DELIVERY_INVALID", "Manager notification delivery is invalid.");
  }
}

function validateRequeue(action, deliveryId) {
  if (!action || typeof action.requeueId !== "string" || typeof action.requestedBy !== "string") {
    throw new PersistenceError("MANAGER_NOTIFICATION_REQUEUE_INVALID", `Delivery ${deliveryId} requeue evidence is invalid.`);
  }
  isoDate(action.requestedAt, "requestedAt");
}

function routeIdentity(route) {
  return [route.scopeType, route.siteId, route.floorId ?? "", route.channel, route.destinationSha256].join(":");
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PersistenceError("MANAGER_NOTIFICATION_FIELD_REQUIRED", `${field} is required.`);
  }
}

function boundedInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new PersistenceError("MANAGER_NOTIFICATION_FIELD_INVALID", `${field} must be between ${minimum} and ${maximum}.`);
  }
}

function isoDate(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PersistenceError("MANAGER_NOTIFICATION_DATE_INVALID", `${field} must be a valid date.`);
  }
  return date.toISOString();
}

function nullableIso(value) {
  return value === null || value === undefined ? null : isoDate(value, "database timestamp");
}

function jsonValue(value) {
  return clone(typeof value === "string" ? JSON.parse(value) : value);
}

function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error ?? "Unknown notification error")).slice(0, 2_000);
}

function conflict(code, message, cause) {
  throw new PersistenceError(code, message, cause ? { cause } : undefined);
}

function integrity(message) {
  throw new PersistenceError("MANAGER_NOTIFICATION_INTEGRITY_FAILED", message);
}

function cloneMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [key, clone(value)]));
}

function clone(value) {
  return structuredClone(value);
}
