import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresOutboxRepository,
  PostgresTwinUnitOfWork,
} from "@brash-twin/persistence/outbox";

test("PostgreSQL outbox adapter appends and claims events with parameterized lease SQL", async () => {
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("INSERT INTO twin_outbox_events")) {
        return { rows: [outboxRow({
          event_id: parameters[0],
          aggregate_type: parameters[1],
          aggregate_id: parameters[2],
          event_type: parameters[3],
          schema_version: parameters[4],
          payload: parameters[5],
          occurred_at: parameters[6],
          available_at: parameters[7],
        })] };
      }
      return { rows: [outboxRow({
        lease_owner: parameters[0],
        lease_expires_at: parameters[3],
        delivery_attempts: 1,
      })] };
    },
  };
  const repository = new PostgresOutboxRepository(database);
  const created = await repository.append(eventRecord());
  const claimed = await repository.claim({
    workerId: "dispatcher-1",
    batchSize: 5,
    leaseSeconds: 20,
    now: "2026-08-13T18:00:05.000Z",
  });

  assert.equal(created.eventId, "event-1");
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6::jsonb, \$7, \$8\)/);
  assert.equal(calls[0].sql.includes("event-1"), false);
  assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[1].sql, /delivery_attempts = event\.delivery_attempts \+ 1/);
  assert.deepEqual(calls[1].parameters, [
    "dispatcher-1",
    5,
    "2026-08-13T18:00:05.000Z",
    "2026-08-13T18:00:25.000Z",
  ]);
  assert.equal(claimed[0].leaseOwner, "dispatcher-1");
  assert.equal(claimed[0].deliveryAttempts, 1);
});

test("PostgreSQL unit of work gives catalog and outbox repositories one transaction query port", async () => {
  const transactionQueries = [];
  const database = {
    async transaction(operation) {
      const transaction = {
        async query(sql, parameters) {
          transactionQueries.push({ sql, parameters });
          if (sql.includes("INSERT INTO twin_map_drafts")) return { rows: [draftRow()] };
          if (sql.includes("INSERT INTO twin_outbox_events")) return { rows: [outboxRow()] };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
      return operation(transaction);
    },
  };
  const unitOfWork = new PostgresTwinUnitOfWork(database);
  const result = await unitOfWork.execute(async ({ catalogRepository, outboxRepository }) => {
    const draft = await catalogRepository.createMapDraft(draftRecord());
    const event = await outboxRepository.append(eventRecord());
    return { draft, event };
  });

  assert.equal(result.draft.draftId, "draft-1");
  assert.equal(result.event.eventId, "event-1");
  assert.equal(transactionQueries.length, 2);
  assert.match(transactionQueries[0].sql, /INSERT INTO twin_map_drafts/);
  assert.match(transactionQueries[1].sql, /INSERT INTO twin_outbox_events/);
});

function eventRecord() {
  return {
    eventId: "event-1",
    aggregateType: "MapDraft",
    aggregateId: "draft-1",
    eventType: "MapDraftCreated.v1",
    schemaVersion: 1,
    payload: { draftId: "draft-1" },
    occurredAt: "2026-08-13T18:00:00.000Z",
  };
}

function outboxRow(overrides = {}) {
  return {
    event_id: "event-1",
    aggregate_type: "MapDraft",
    aggregate_id: "draft-1",
    event_type: "MapDraftCreated.v1",
    schema_version: 1,
    payload: { draftId: "draft-1" },
    occurred_at: "2026-08-13T18:00:00.000Z",
    available_at: "2026-08-13T18:00:00.000Z",
    delivered_at: null,
    delivery_attempts: 0,
    last_error: null,
    lease_owner: null,
    lease_expires_at: null,
    ...overrides,
  };
}

function draftRecord() {
  return {
    draftId: "draft-1",
    familyId: "demo-plant",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    status: "DRAFT",
    validationReportSha256: null,
    rowVersion: 1,
    createdBy: "engineer-1",
    createdAt: "2026-08-13T18:00:00.000Z",
    updatedBy: "engineer-1",
    updatedAt: "2026-08-13T18:00:00.000Z",
  };
}

function draftRow() {
  return {
    draft_id: "draft-1",
    family_id: "demo-plant",
    revision: 1,
    canonical_frame_id: "demo-plant/floor-1",
    status: "DRAFT",
    validation_report_sha256: null,
    row_version: 1,
    created_by: "engineer-1",
    created_at: "2026-08-13T18:00:00.000Z",
    updated_by: "engineer-1",
    updated_at: "2026-08-13T18:00:00.000Z",
  };
}
