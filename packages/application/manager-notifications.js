import { createHash, randomUUID } from "node:crypto";

const EVENT_TYPE = "TwinAssetChangesApplied.v1";
const EVENT_PAYLOAD_VERSION = "brash.twin-asset-changes-applied-event/v1";
const MESSAGE_VERSION = "brash.manager-notification-message/v1";
const SCOPES = new Set(["SITE", "FLOOR"]);
const CHANNELS = new Set(["EMAIL", "WEBHOOK"]);
const MAXIMUM_CHANGES = 5_000;
const MAXIMUM_DELIVERY_ATTEMPTS = 5;

export class ManagerNotificationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ManagerNotificationError";
    this.code = code;
  }
}

export class ManagerNotificationService {
  #repository;
  #catalog;
  #clock;
  #routeIdGenerator;
  #requeueIdGenerator;

  constructor({
    repository,
    catalog,
    clock = () => new Date(),
    routeIdGenerator = () => `manager-route-${randomUUID()}`,
    requeueIdGenerator = () => `notification-requeue-${randomUUID()}`,
  }) {
    requireRepository(repository);
    if (!catalog
      || typeof catalog.listSites !== "function"
      || typeof catalog.listFloors !== "function"
      || typeof catalog.getMapDraftContext !== "function") {
      invalidConfiguration("Catalog site, floor, and draft context lookups are required.");
    }
    if (typeof clock !== "function" || typeof routeIdGenerator !== "function" || typeof requeueIdGenerator !== "function") {
      invalidConfiguration("Clock and ID generators must be functions.");
    }
    this.#repository = repository;
    this.#catalog = catalog;
    this.#clock = clock;
    this.#routeIdGenerator = routeIdGenerator;
    this.#requeueIdGenerator = requeueIdGenerator;
  }

  async createRoute(input = {}) {
    const scopeType = enumValue(input.scopeType, SCOPES, "scopeType");
    identifier(input.siteId, "siteId");
    const floorId = scopeType === "FLOOR" ? input.floorId : null;
    if (scopeType === "FLOOR") identifier(floorId, "floorId");
    if (scopeType === "SITE" && input.floorId !== undefined && input.floorId !== null) {
      invalidInput("floorId must be omitted for a SITE route.");
    }
    const channel = enumValue(input.channel, CHANNELS, "channel");
    const destination = normalizeDestination(channel, input.destination);
    const displayLabel = boundedText(input.displayLabel, "displayLabel", 120);
    const createdBy = boundedText(input.operatorId, "operatorId", 200);
    const routeId = input.routeId ?? this.#routeIdGenerator();
    identifier(routeId, "routeId");

    const site = (await this.#catalog.listSites()).find((candidate) => candidate.siteId === input.siteId);
    if (!site) throw new ManagerNotificationError("MANAGER_NOTIFICATION_SCOPE_NOT_FOUND", `Site ${input.siteId} was not found.`);
    if (floorId) {
      const floor = (await this.#catalog.listFloors(input.siteId)).find((candidate) => candidate.floorId === floorId);
      if (!floor) {
        throw new ManagerNotificationError(
          "MANAGER_NOTIFICATION_SCOPE_NOT_FOUND",
          `Floor ${floorId} was not found under site ${input.siteId}.`,
        );
      }
    }
    try {
      const route = await this.#repository.createRoute({
        routeId,
        scopeType,
        siteId: input.siteId,
        floorId,
        channel,
        destination,
        destinationSha256: sha256(destination),
        displayLabel,
        createdBy,
        createdAt: this.#now(),
      });
      return publicRoute(route);
    } catch (error) {
      throw translatePersistence(error, "MANAGER_NOTIFICATION_ROUTE_CONFLICT");
    }
  }

  async listRoutes({ siteId, floorId } = {}) {
    if (siteId !== undefined) identifier(siteId, "siteId");
    if (floorId !== undefined) identifier(floorId, "floorId");
    return (await this.#repository.listRoutes({ siteId, floorId })).map(publicRoute);
  }

  async consume(event) {
    if (event?.eventType !== EVENT_TYPE) return Object.freeze({ ignored: true, eventType: event?.eventType ?? null });
    const normalized = normalizeAppliedChangesEvent(event);
    const context = await this.#catalog.getMapDraftContext(normalized.payload.draftId);
    if (context.floor.floorId !== context.family.floorId || context.draft.draftId !== normalized.payload.draftId) {
      integrityFailure("The applied-change event does not resolve to one stable draft context.");
    }
    const routes = await this.#repository.listRoutes({
      siteId: context.floor.siteId,
      floorId: context.floor.floorId,
    });
    const notificationId = notificationIdFor(normalized.eventId);
    const message = buildMessage(notificationId, context.floor, normalized);
    const createdAt = normalized.occurredAt;
    const notification = Object.freeze({
      notificationId,
      sourceEventId: normalized.eventId,
      sourceEventSha256: sha256(canonicalJson(normalized)),
      draftId: normalized.payload.draftId,
      siteId: context.floor.siteId,
      floorId: context.floor.floorId,
      notificationRequired: normalized.payload.notificationRequired,
      message,
      createdAt,
    });
    const deliveries = notification.notificationRequired
      ? routes.map((route) => deliveryFor(notification, route, "manager-notification-router", createdAt))
      : [];
    try {
      const stored = await this.#repository.createNotification(notification, deliveries);
      return Object.freeze({ ignored: false, notification: publicNotification(stored) });
    } catch (error) {
      throw translatePersistence(error, "MANAGER_NOTIFICATION_CONFLICT");
    }
  }

  consumeOutboxRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) invalidEvent("Outbox record must be an object.");
    return this.consume({
      eventId: record.eventId,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      schemaVersion: record.schemaVersion,
      payload: record.payload,
      occurredAt: record.occurredAt,
    });
  }

  async routeNotification(notificationId, input = {}) {
    identifier(notificationId, "notificationId");
    const operatorId = boundedText(input.operatorId, "operatorId", 200);
    const notification = await this.#repository.getNotification(notificationId);
    if (!notification) {
      throw new ManagerNotificationError("MANAGER_NOTIFICATION_NOT_FOUND", `Manager notification ${notificationId} was not found.`);
    }
    if (!notification.notificationRequired) {
      throw new ManagerNotificationError(
        "MANAGER_NOTIFICATION_ROUTING_NOT_REQUIRED",
        `Manager notification ${notificationId} does not contain a critical change.`,
      );
    }
    const routes = await this.#repository.listRoutes({ siteId: notification.siteId, floorId: notification.floorId });
    if (routes.length === 0) {
      throw new ManagerNotificationError(
        "MANAGER_NOTIFICATION_ROUTE_REQUIRED",
        "No site or floor manager route is configured for this notification.",
      );
    }
    const createdAt = this.#now();
    const deliveries = routes.map((route) => deliveryFor(notification, route, operatorId, createdAt));
    try {
      return publicNotification(await this.#repository.addDeliveries(notificationId, deliveries));
    } catch (error) {
      throw translatePersistence(error, "MANAGER_NOTIFICATION_DELIVERY_CONFLICT");
    }
  }

  async listForDraft(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraftContext(draftId);
    return (await this.#repository.listNotifications(draftId)).map(publicNotification);
  }

  async retryDelivery(deliveryId, input = {}) {
    identifier(deliveryId, "deliveryId");
    const operatorId = boundedText(input.operatorId, "operatorId", 200);
    const requeueId = input.requeueId ?? this.#requeueIdGenerator();
    identifier(requeueId, "requeueId");
    try {
      const notification = await this.#repository.requeueDelivery(deliveryId, {
        requeueId,
        requestedBy: operatorId,
        requestedAt: this.#now(),
      });
      if (!notification) {
        throw new ManagerNotificationError("MANAGER_NOTIFICATION_DELIVERY_NOT_FOUND", `Delivery ${deliveryId} was not found.`);
      }
      return publicNotification(notification);
    } catch (error) {
      if (error instanceof ManagerNotificationError) throw error;
      throw translatePersistence(error, "MANAGER_NOTIFICATION_REQUEUE_INVALID");
    }
  }

  #now() {
    const value = new Date(this.#clock());
    if (!Number.isFinite(value.getTime())) invalidConfiguration("Clock returned an invalid date.");
    return value.toISOString();
  }
}

export class ManagerNotificationDispatcher {
  #repository;
  #provider;
  #clock;
  #baseRetryDelayMilliseconds;
  #maximumRetryDelayMilliseconds;
  #maximumDeliveryAttempts;

  constructor({
    repository,
    provider,
    clock = () => new Date(),
    baseRetryDelayMilliseconds = 5_000,
    maximumRetryDelayMilliseconds = 900_000,
    maximumDeliveryAttempts = MAXIMUM_DELIVERY_ATTEMPTS,
  }) {
    requireDeliveryRepository(repository);
    if (typeof provider !== "function") invalidConfiguration("Notification provider must be a function.");
    positiveInteger(baseRetryDelayMilliseconds, "baseRetryDelayMilliseconds", 1, 3_600_000);
    positiveInteger(maximumRetryDelayMilliseconds, "maximumRetryDelayMilliseconds", 1, 86_400_000);
    positiveInteger(maximumDeliveryAttempts, "maximumDeliveryAttempts", 1, 20);
    if (maximumRetryDelayMilliseconds < baseRetryDelayMilliseconds) {
      invalidConfiguration("Maximum retry delay cannot be smaller than the base delay.");
    }
    this.#repository = repository;
    this.#provider = provider;
    this.#clock = clock;
    this.#baseRetryDelayMilliseconds = baseRetryDelayMilliseconds;
    this.#maximumRetryDelayMilliseconds = maximumRetryDelayMilliseconds;
    this.#maximumDeliveryAttempts = maximumDeliveryAttempts;
  }

  async dispatchBatch({ workerId, batchSize = 25, leaseSeconds = 30 } = {}) {
    const normalizedWorkerId = boundedText(workerId, "workerId", 200);
    positiveInteger(batchSize, "batchSize", 1, 100);
    positiveInteger(leaseSeconds, "leaseSeconds", 1, 3_600);
    const claimed = await this.#repository.claimDeliveries({
      workerId: normalizedWorkerId,
      batchSize,
      leaseSeconds,
      now: this.#now(),
    });
    const delivered = [];
    const failed = [];
    for (const delivery of claimed) {
      try {
        const result = await this.#provider(Object.freeze({
          deliveryId: delivery.deliveryId,
          idempotencyKey: delivery.deliveryId,
          channel: delivery.channel,
          destination: delivery.destination,
          message: delivery.message,
        }));
        const providerMessageId = boundedText(result?.providerMessageId, "providerMessageId", 500);
        await this.#repository.markDeliveryDelivered(delivery.deliveryId, normalizedWorkerId, {
          providerMessageId,
          deliveredAt: this.#now(),
        });
        delivered.push(delivery.deliveryId);
      } catch (error) {
        const failureMessage = safeErrorMessage(error);
        const failedAt = this.#now();
        const deadLetter = delivery.deliveryAttempts >= this.#maximumDeliveryAttempts;
        const delay = Math.min(
          this.#maximumRetryDelayMilliseconds,
          this.#baseRetryDelayMilliseconds * (2 ** Math.min(Math.max(delivery.deliveryAttempts - 1, 0), 20)),
        );
        await this.#repository.markDeliveryFailed(delivery.deliveryId, normalizedWorkerId, {
          error: failureMessage,
          failedAt,
          deadLetter,
          availableAt: new Date(failedAt.getTime() + delay).toISOString(),
        });
        failed.push(Object.freeze({ deliveryId: delivery.deliveryId, deadLetter, error: failureMessage }));
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
    if (!Number.isFinite(value.getTime())) invalidConfiguration("Clock returned an invalid date.");
    return value;
  }
}

function normalizeAppliedChangesEvent(event) {
  exactKeys(event, ["eventId", "aggregateType", "aggregateId", "eventType", "schemaVersion", "payload", "occurredAt"], "event");
  requiredText(event.eventId, "eventId");
  if (event.aggregateType !== "MAP_DRAFT" || event.eventType !== EVENT_TYPE || event.schemaVersion !== 1) {
    invalidEvent("Event envelope identity is unsupported.");
  }
  identifier(event.aggregateId, "aggregateId");
  const occurredAt = isoDate(event.occurredAt, "occurredAt");
  const payload = event.payload;
  exactKeys(payload, [
    "schemaVersion", "draftId", "assetSetId", "assetRevision", "changeSetId", "reviewId",
    "notificationRequired", "confirmedChanges",
  ], "payload");
  if (payload.schemaVersion !== EVENT_PAYLOAD_VERSION) invalidEvent("Applied-change payload version is unsupported.");
  for (const field of ["draftId", "assetSetId", "changeSetId", "reviewId"]) identifier(payload[field], field);
  if (payload.draftId !== event.aggregateId) invalidEvent("Event aggregate and payload draft identities differ.");
  positiveInteger(payload.assetRevision, "assetRevision", 1, Number.MAX_SAFE_INTEGER);
  if (typeof payload.notificationRequired !== "boolean") invalidEvent("notificationRequired must be boolean.");
  if (!Array.isArray(payload.confirmedChanges) || payload.confirmedChanges.length > MAXIMUM_CHANGES) {
    invalidEvent(`confirmedChanges must contain at most ${MAXIMUM_CHANGES} items.`);
  }
  const ids = new Set();
  const confirmedChanges = payload.confirmedChanges.map((change, index) => {
    exactKeys(change, ["changeId", "changeType", "assetId", "semanticClass", "confidence", "severity"], `confirmedChanges[${index}]`);
    identifier(change.changeId, `confirmedChanges[${index}].changeId`);
    identifier(change.assetId, `confirmedChanges[${index}].assetId`);
    if (ids.has(change.changeId)) invalidEvent("Confirmed change IDs must be unique.");
    ids.add(change.changeId);
    if (!new Set(["MOVED", "MISSING", "APPEARED"]).has(change.changeType)
      || !new Set(["CRITICAL", "WARNING"]).has(change.severity)
      || (change.severity === "CRITICAL") !== new Set(["MOVED", "MISSING"]).has(change.changeType)) {
      invalidEvent(`confirmedChanges[${index}] has inconsistent type or severity.`);
    }
    const semanticClass = boundedText(change.semanticClass, `confirmedChanges[${index}].semanticClass`, 200);
    if (!Number.isFinite(change.confidence) || change.confidence < 0 || change.confidence > 1) {
      invalidEvent(`confirmedChanges[${index}].confidence must be between zero and one.`);
    }
    return Object.freeze({
      changeId: change.changeId,
      changeType: change.changeType,
      assetId: change.assetId,
      semanticClass,
      confidence: change.confidence,
      severity: change.severity,
    });
  }).sort((left, right) => left.changeId.localeCompare(right.changeId));
  const hasCritical = confirmedChanges.some((change) => change.severity === "CRITICAL");
  if (payload.notificationRequired !== hasCritical) {
    invalidEvent("notificationRequired must equal the presence of confirmed critical changes.");
  }
  return Object.freeze({
    eventId: event.eventId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    payload: Object.freeze({ ...payload, confirmedChanges: Object.freeze(confirmedChanges) }),
    occurredAt,
  });
}

function buildMessage(notificationId, floor, event) {
  const changes = event.payload.confirmedChanges;
  const criticalCount = changes.filter((change) => change.severity === "CRITICAL").length;
  const warningCount = changes.length - criticalCount;
  return Object.freeze({
    schemaVersion: MESSAGE_VERSION,
    notificationId,
    siteId: floor.siteId,
    floorId: floor.floorId,
    draftId: event.payload.draftId,
    assetSetId: event.payload.assetSetId,
    assetRevision: event.payload.assetRevision,
    changeSetId: event.payload.changeSetId,
    reviewId: event.payload.reviewId,
    subject: `${criticalCount} critical factory Twin change${criticalCount === 1 ? "" : "s"} applied`,
    summary: Object.freeze({ criticalCount, warningCount, totalCount: changes.length }),
    changes,
    occurredAt: event.occurredAt,
  });
}

function deliveryFor(notification, route, createdBy, createdAt) {
  return Object.freeze({
    deliveryId: deliveryIdFor(notification.notificationId, route.routeId),
    notificationId: notification.notificationId,
    routeId: route.routeId,
    channel: route.channel,
    destination: route.destination,
    destinationSha256: route.destinationSha256,
    displayLabel: route.displayLabel,
    status: "PENDING",
    availableAt: createdAt,
    deliveryAttempts: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    deliveredAt: null,
    providerMessageId: null,
    lastError: null,
    createdBy,
    createdAt,
  });
}

function publicRoute(route) {
  return Object.freeze({
    routeId: route.routeId,
    scopeType: route.scopeType,
    siteId: route.siteId,
    floorId: route.floorId,
    channel: route.channel,
    destinationSha256: route.destinationSha256,
    destinationHint: destinationHint(route.channel, route.destination),
    displayLabel: route.displayLabel,
    createdBy: route.createdBy,
    createdAt: route.createdAt,
  });
}

function publicNotification(record) {
  const deliveries = (record.deliveries ?? []).map((delivery) => Object.freeze({
    deliveryId: delivery.deliveryId,
    routeId: delivery.routeId,
    channel: delivery.channel,
    destinationSha256: delivery.destinationSha256,
    destinationHint: destinationHint(delivery.channel, delivery.destination),
    displayLabel: delivery.displayLabel,
    status: delivery.status,
    availableAt: delivery.availableAt,
    deliveryAttempts: delivery.deliveryAttempts,
    deliveredAt: delivery.deliveredAt,
    providerMessageId: delivery.providerMessageId,
    lastError: delivery.lastError,
    attempts: Object.freeze((delivery.attempts ?? []).map((attempt) => Object.freeze({ ...attempt }))),
    requeues: Object.freeze((delivery.requeues ?? []).map((requeue) => Object.freeze({ ...requeue }))),
    createdBy: delivery.createdBy,
    createdAt: delivery.createdAt,
  }));
  return Object.freeze({
    notificationId: record.notificationId,
    sourceEventId: record.sourceEventId,
    sourceEventSha256: record.sourceEventSha256,
    draftId: record.draftId,
    siteId: record.siteId,
    floorId: record.floorId,
    notificationRequired: record.notificationRequired,
    status: notificationStatus(record.notificationRequired, deliveries),
    message: Object.freeze(structuredClone(record.message)),
    deliveries: Object.freeze(deliveries),
    createdAt: record.createdAt,
  });
}

function notificationStatus(required, deliveries) {
  if (!required) return "NOT_REQUIRED";
  if (deliveries.length === 0) return "ROUTING_REQUIRED";
  const delivered = deliveries.filter((item) => item.status === "DELIVERED").length;
  const dead = deliveries.filter((item) => item.status === "DEAD_LETTER").length;
  if (delivered === deliveries.length) return "DELIVERED";
  if (dead === deliveries.length) return "FAILED";
  if (delivered > 0 || dead > 0) return "PARTIALLY_DELIVERED";
  return "PENDING";
}

function normalizeDestination(channel, value) {
  const destination = boundedText(value, "destination", 2_000);
  if (channel === "EMAIL") {
    const normalized = destination.toLowerCase();
    if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      invalidInput("EMAIL destination must be a valid bounded address.");
    }
    return normalized;
  }
  let url;
  try { url = new URL(destination); } catch { invalidInput("WEBHOOK destination must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    invalidInput("WEBHOOK destination must use HTTPS without credentials or a fragment.");
  }
  return url.toString();
}

function destinationHint(channel, destination) {
  if (channel === "EMAIL") {
    const [local, domain] = destination.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  try {
    const url = new URL(destination);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "redacted-webhook";
  }
}

function notificationIdFor(eventId) {
  return `manager-notification-${sha256(eventId).slice(0, 20)}`;
}

function deliveryIdFor(notificationId, routeId) {
  return `notification-delivery-${sha256(`${notificationId}:${routeId}`).slice(0, 20)}`;
}

function requireRepository(repository) {
  if (!repository
    || typeof repository.createRoute !== "function"
    || typeof repository.listRoutes !== "function"
    || typeof repository.createNotification !== "function"
    || typeof repository.getNotification !== "function"
    || typeof repository.listNotifications !== "function"
    || typeof repository.addDeliveries !== "function"
    || typeof repository.requeueDelivery !== "function") {
    invalidConfiguration("Manager notification repository operations are required.");
  }
}

function requireDeliveryRepository(repository) {
  if (!repository
    || typeof repository.claimDeliveries !== "function"
    || typeof repository.markDeliveryDelivered !== "function"
    || typeof repository.markDeliveryFailed !== "function") {
    invalidConfiguration("Manager notification delivery repository operations are required.");
  }
}

function translatePersistence(error, fallbackCode) {
  if (error?.code?.startsWith("MANAGER_NOTIFICATION_")) {
    return new ManagerNotificationError(error.code, error.message, { cause: error });
  }
  return new ManagerNotificationError(fallbackCode, error?.message ?? "Manager notification persistence failed.", { cause: error });
}

function exactKeys(value, expected, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidEvent(`${field} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) invalidEvent(`${field} contains missing or unsupported fields.`);
}

function enumValue(value, choices, field) {
  if (!choices.has(value)) invalidInput(`${field} is unsupported.`);
  return value;
}

function identifier(value, field) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new ManagerNotificationError("MANAGER_NOTIFICATION_IDENTIFIER_INVALID", `${field} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") invalidEvent(`${field} is required.`);
  return value.trim();
}

function boundedText(value, field, maximumLength) {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > maximumLength) {
    invalidInput(`${field} must contain between 1 and ${maximumLength} characters.`);
  }
  return value.trim();
}

function positiveInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalidInput(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function isoDate(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalidEvent(`${field} must be a valid date.`);
  return date.toISOString();
}

function invalidEvent(message) {
  throw new ManagerNotificationError("MANAGER_NOTIFICATION_EVENT_INVALID", message);
}

function invalidInput(message) {
  throw new ManagerNotificationError("MANAGER_NOTIFICATION_INPUT_INVALID", message);
}

function invalidConfiguration(message) {
  throw new ManagerNotificationError("MANAGER_NOTIFICATION_CONFIGURATION_INVALID", message);
}

function integrityFailure(message) {
  throw new ManagerNotificationError("MANAGER_NOTIFICATION_INTEGRITY_FAILED", message);
}

function safeErrorMessage(error) {
  return (error instanceof Error ? error.message : String(error ?? "Unknown notification provider error"))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/((?:api[-_ ]?key|token|authorization|secret|password)\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .slice(0, 2_000);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
