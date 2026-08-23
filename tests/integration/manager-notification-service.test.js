import assert from "node:assert/strict";
import test from "node:test";
import {
  ManagerNotificationDispatcher,
  ManagerNotificationError,
  ManagerNotificationService,
} from "@brash-twin/application/manager-notifications";
import { InMemoryManagerNotificationRepository } from "@brash-twin/persistence/manager-notifications";

test("applied critical changes route idempotently and retry to immutable delivery evidence", async () => {
  let currentTime = new Date("2026-08-23T14:00:00.000Z");
  const repository = new InMemoryManagerNotificationRepository();
  const service = notificationService(repository, () => currentTime, [
    "site-email-route",
    "floor-webhook-route",
  ]);
  await service.createRoute({
    routeId: "site-email-route",
    scopeType: "SITE",
    siteId: "site-1",
    channel: "EMAIL",
    destination: "Factory.Manager@example.com",
    displayLabel: "Factory manager",
    operatorId: "admin-1",
  });
  await service.createRoute({
    routeId: "floor-webhook-route",
    scopeType: "FLOOR",
    siteId: "site-1",
    floorId: "floor-1",
    channel: "WEBHOOK",
    destination: "https://alerts.example.com/brash",
    displayLabel: "Operations webhook",
    operatorId: "admin-1",
  });

  const first = await service.consume(appliedEvent());
  const repeated = await service.consume(appliedEvent());
  assert.equal(first.notification.notificationId, repeated.notification.notificationId);
  assert.equal(first.notification.status, "PENDING");
  assert.equal(first.notification.deliveries.length, 2);
  assert.equal(JSON.stringify(first).includes("factory.manager@example.com"), false);
  assert.deepEqual(first.notification.message.summary, { criticalCount: 1, warningCount: 1, totalCount: 2 });

  const calls = [];
  const failures = new Set(["EMAIL"]);
  const dispatcher = new ManagerNotificationDispatcher({
    repository,
    clock: () => currentTime,
    baseRetryDelayMilliseconds: 1_000,
    maximumRetryDelayMilliseconds: 4_000,
    provider: async (delivery) => {
      calls.push(delivery);
      if (failures.delete(delivery.channel)) throw new Error("temporary provider outage");
      return { providerMessageId: `provider-${delivery.deliveryId}` };
    },
  });
  const initial = await dispatcher.dispatchBatch({ workerId: "notification-worker" });
  assert.equal(initial.claimed, 2);
  assert.equal(initial.delivered.length, 1);
  assert.equal(initial.failed.length, 1);
  assert.equal(calls[0].idempotencyKey, calls[0].deliveryId);
  assert.equal(calls.some((call) => call.destination === "factory.manager@example.com"), true);

  currentTime = new Date("2026-08-23T14:00:01.000Z");
  const retried = await dispatcher.dispatchBatch({ workerId: "notification-worker" });
  assert.equal(retried.delivered.length, 1);
  const [notification] = await service.listForDraft("draft-1");
  assert.equal(notification.status, "DELIVERED");
  const email = notification.deliveries.find((delivery) => delivery.channel === "EMAIL");
  assert.equal(email.deliveryAttempts, 2);
  assert.deepEqual(email.attempts.map((attempt) => attempt.outcome), ["FAILED", "DELIVERED"]);
  assert.equal(email.destinationHint, "f***@example.com");
});

test("missing routes remain visible and can be routed after configuration", async () => {
  const repository = new InMemoryManagerNotificationRepository();
  const service = notificationService(repository, () => new Date("2026-08-23T15:00:00.000Z"), ["late-route"]);
  const consumed = await service.consume(appliedEvent());
  assert.equal(consumed.notification.status, "ROUTING_REQUIRED");

  await assert.rejects(
    () => service.routeNotification(consumed.notification.notificationId, { operatorId: "manager-1" }),
    (error) => error instanceof ManagerNotificationError && error.code === "MANAGER_NOTIFICATION_ROUTE_REQUIRED",
  );
  await service.createRoute({
    routeId: "late-route",
    scopeType: "FLOOR",
    siteId: "site-1",
    floorId: "floor-1",
    channel: "EMAIL",
    destination: "manager@example.com",
    displayLabel: "Shift manager",
    operatorId: "admin-1",
  });
  const routed = await service.routeNotification(consumed.notification.notificationId, { operatorId: "manager-1" });
  assert.equal(routed.status, "PENDING");
  assert.equal(routed.deliveries[0].createdBy, "manager-1");
});

test("dead-letter evidence requires an audited manual requeue and event payloads stay redacted", async () => {
  let currentTime = new Date("2026-08-23T16:00:00.000Z");
  const repository = new InMemoryManagerNotificationRepository();
  const service = notificationService(repository, () => currentTime, ["route-1"]);
  await service.createRoute({
    routeId: "route-1",
    scopeType: "SITE",
    siteId: "site-1",
    channel: "WEBHOOK",
    destination: "https://manager.example.com/events",
    displayLabel: "Manager events",
    operatorId: "admin-1",
  });
  const consumed = await service.consume(appliedEvent());
  const deliveryId = consumed.notification.deliveries[0].deliveryId;
  let shouldFail = true;
  const dispatcher = new ManagerNotificationDispatcher({
    repository,
    clock: () => currentTime,
    maximumDeliveryAttempts: 1,
    provider: async () => {
      if (shouldFail) {
        throw new Error("https://manager.example.com/events rejected manager@example.com token=private-value");
      }
      return { providerMessageId: "accepted-after-requeue" };
    },
  });
  await dispatcher.dispatchBatch({ workerId: "worker-1" });
  const failed = (await service.listForDraft("draft-1"))[0];
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.deliveries[0].lastError.includes("manager.example.com"), false);
  assert.equal(failed.deliveries[0].lastError.includes("manager@example.com"), false);
  assert.equal(failed.deliveries[0].lastError.includes("private-value"), false);
  const requeued = await service.retryDelivery(deliveryId, {
    requeueId: "manual-requeue-1",
    operatorId: "manager-1",
  });
  assert.equal(requeued.deliveries[0].requeues[0].requestedBy, "manager-1");
  shouldFail = false;
  currentTime = new Date("2026-08-23T16:00:01.000Z");
  await dispatcher.dispatchBatch({ workerId: "worker-1" });
  assert.equal((await service.listForDraft("draft-1"))[0].status, "DELIVERED");

  await assert.rejects(
    () => service.consume({ ...appliedEvent(), payload: { ...appliedEvent().payload, secretCoordinates: [1, 2, 3] } }),
    (error) => error instanceof ManagerNotificationError && error.code === "MANAGER_NOTIFICATION_EVENT_INVALID",
  );
});

function notificationService(repository, clock) {
  return new ManagerNotificationService({
    repository,
    clock,
    catalog: {
      listSites: async () => [{ siteId: "site-1" }],
      listFloors: async () => [{ floorId: "floor-1", siteId: "site-1" }],
      getMapDraftContext: async () => ({
        draft: { draftId: "draft-1" },
        family: { familyId: "family-1", floorId: "floor-1" },
        floor: { floorId: "floor-1", siteId: "site-1" },
      }),
    },
  });
}

function appliedEvent() {
  return {
    eventId: "asset-changes-applied-event-1",
    aggregateType: "MAP_DRAFT",
    aggregateId: "draft-1",
    eventType: "TwinAssetChangesApplied.v1",
    schemaVersion: 1,
    payload: {
      schemaVersion: "brash.twin-asset-changes-applied-event/v1",
      draftId: "draft-1",
      assetSetId: "asset-set-2",
      assetRevision: 2,
      changeSetId: "change-set-1",
      reviewId: "change-review-1",
      notificationRequired: true,
      confirmedChanges: [
        {
          changeId: "change-moved-panel",
          changeType: "MOVED",
          assetId: "asset-panel",
          semanticClass: "electrical-panel",
          confidence: 0.96,
          severity: "CRITICAL",
        },
        {
          changeId: "change-appeared-barrier",
          changeType: "APPEARED",
          assetId: "asset-barrier",
          semanticClass: "safety-barrier",
          confidence: 0.91,
          severity: "WARNING",
        },
      ],
    },
    occurredAt: "2026-08-23T14:00:00.000Z",
  };
}
