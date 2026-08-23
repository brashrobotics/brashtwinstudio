import assert from "node:assert/strict";
import test from "node:test";
import { PostgresManagerNotificationRepository } from "@brash-twin/persistence/manager-notifications";

test("PostgreSQL manager notifications insert routes and notification deliveries with parameterized transactions", async () => {
  const queries = [];
  const port = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes("INSERT INTO twin_manager_notification_routes")) return { rows: [routeRow()] };
      throw new Error(`Unexpected root query: ${sql}`);
    },
    transaction: async (operation) => operation({
      query: async (sql, parameters) => {
        queries.push({ sql, parameters });
        if (sql.includes("WHERE source_event_id")) return { rows: [] };
        if (sql.includes("INSERT INTO twin_manager_notifications")) return { rows: [] };
        if (sql.includes("INSERT INTO twin_manager_notification_deliveries")) return { rows: [] };
        if (sql.includes("FROM twin_manager_notification_deliveries") && sql.includes("ORDER BY delivery_id")) {
          return { rows: [deliveryRow()] };
        }
        if (sql.includes("FROM twin_manager_notification_attempts")) return { rows: [] };
        if (sql.includes("FROM twin_manager_notification_requeues")) return { rows: [] };
        throw new Error(`Unexpected transaction query: ${sql}`);
      },
    }),
  };
  const repository = new PostgresManagerNotificationRepository(port);
  const route = await repository.createRoute(routeRecord());
  assert.equal(route.destination, "manager@example.com");
  const notification = await repository.createNotification(notificationRecord(), [deliveryRecord()]);
  assert.equal(notification.deliveries.length, 1);
  assert.match(queries[0].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10\)/);
  assert.match(queries.find((query) => query.sql.includes("INSERT INTO twin_manager_notifications")).sql, /\$8::jsonb/);
  assert.match(queries.find((query) => query.sql.includes("INSERT INTO twin_manager_notification_deliveries")).sql, /ON CONFLICT \(notification_id, route_id\) DO NOTHING/);
});

test("PostgreSQL notification delivery claims use skip-locked leases and include the sealed message", async () => {
  const queries = [];
  const port = {
    transaction: async (operation) => operation(port),
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      if (sql.includes("WITH claimable AS")) return { rows: [deliveryRow({
        lease_owner: "worker-1",
        lease_expires_at: "2026-08-23T14:00:30.000Z",
        delivery_attempts: 1,
      })] };
      if (sql.includes("SELECT message FROM twin_manager_notifications")) {
        return { rows: [{ message: notificationRecord().message }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const repository = new PostgresManagerNotificationRepository(port);
  const claimed = await repository.claimDeliveries({
    workerId: "worker-1",
    now: new Date("2026-08-23T14:00:00.000Z"),
  });
  assert.equal(claimed[0].message.notificationId, "manager-notification-1");
  assert.match(queries[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(queries[0].sql, /delivery_attempts = delivery\.delivery_attempts \+ 1/);
});

function routeRecord() {
  return {
    routeId: "route-1", scopeType: "SITE", siteId: "site-1", floorId: null,
    channel: "EMAIL", destination: "manager@example.com", destinationSha256: "a".repeat(64),
    displayLabel: "Factory manager", createdBy: "admin-1", createdAt: "2026-08-23T14:00:00.000Z",
  };
}

function notificationRecord() {
  return {
    notificationId: "manager-notification-1",
    sourceEventId: "event-1",
    sourceEventSha256: "b".repeat(64),
    draftId: "draft-1",
    siteId: "site-1",
    floorId: "floor-1",
    notificationRequired: true,
    message: {
      schemaVersion: "brash.manager-notification-message/v1",
      notificationId: "manager-notification-1",
    },
    createdAt: "2026-08-23T14:00:00.000Z",
  };
}

function deliveryRecord() {
  return {
    deliveryId: "delivery-1", notificationId: "manager-notification-1", routeId: "route-1",
    channel: "EMAIL", destination: "manager@example.com", destinationSha256: "a".repeat(64),
    displayLabel: "Factory manager", status: "PENDING", availableAt: "2026-08-23T14:00:00.000Z",
    deliveryAttempts: 0, leaseOwner: null, leaseExpiresAt: null, deliveredAt: null,
    providerMessageId: null, lastError: null, createdBy: "router", createdAt: "2026-08-23T14:00:00.000Z",
  };
}

function routeRow(overrides = {}) {
  return {
    route_id: "route-1", scope_type: "SITE", site_id: "site-1", floor_id: null,
    channel: "EMAIL", destination: "manager@example.com", destination_sha256: "a".repeat(64),
    display_label: "Factory manager", created_by: "admin-1", created_at: "2026-08-23T14:00:00.000Z",
    ...overrides,
  };
}

function deliveryRow(overrides = {}) {
  return {
    delivery_id: "delivery-1", notification_id: "manager-notification-1", route_id: "route-1",
    channel: "EMAIL", destination: "manager@example.com", destination_sha256: "a".repeat(64),
    display_label: "Factory manager", status: "PENDING", available_at: "2026-08-23T14:00:00.000Z",
    delivery_attempts: 0, lease_owner: null, lease_expires_at: null, delivered_at: null,
    provider_message_id: null, last_error: null, created_by: "router", created_at: "2026-08-23T14:00:00.000Z",
    ...overrides,
  };
}
