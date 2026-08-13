import assert from "node:assert/strict";
import test from "node:test";
import { OutboxDispatcher, TwinCatalogService } from "@brash-twin/application";
import { MAP_DRAFT_EVENT_TYPE } from "@brash-twin/domain";
import { InMemoryTwinCatalogRepository } from "@brash-twin/persistence";
import {
  InMemoryOutboxRepository,
  InMemoryTwinUnitOfWork,
} from "@brash-twin/persistence/outbox";

test("draft lifecycle writes ordered outbox events in the catalog unit of work", async () => {
  const repository = new InMemoryTwinCatalogRepository();
  await seedHierarchy(repository);
  const outboxRepository = new InMemoryOutboxRepository();
  const unitOfWork = new InMemoryTwinUnitOfWork({ catalogRepository: repository, outboxRepository });
  let eventSequence = 0;
  const service = new TwinCatalogService({
    repository,
    unitOfWork,
    clock: () => new Date("2026-08-13T18:00:00.000Z"),
    eventIdGenerator: () => `event-${++eventSequence}`,
  });

  await service.createMapDraft({
    draftId: "draft-1",
    familyId: "demo-plant",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    operatorId: "engineer-1",
  });
  await service.submitMapDraftForReview("draft-1", "reviewer-1");
  await service.validateMapDraft("draft-1", "a".repeat(64), "approver-1");

  const events = await outboxRepository.list();
  assert.deepEqual(events.map((event) => event.eventType), [
    MAP_DRAFT_EVENT_TYPE.created,
    MAP_DRAFT_EVENT_TYPE.reviewSubmitted,
    MAP_DRAFT_EVENT_TYPE.validated,
  ]);
  assert.deepEqual(events.map((event) => event.payload.rowVersion), [1, 2, 3]);
  assert.equal(events[1].payload.previousStatus, "DRAFT");
  assert.equal(events[2].payload.validationReportSha256, "a".repeat(64));
  assert.ok(events.every((event) => event.aggregateId === "draft-1" && event.deliveryAttempts === 0));
});

test("in-memory unit of work rolls back a draft when outbox append fails", async () => {
  const repository = new InMemoryTwinCatalogRepository();
  await seedHierarchy(repository);
  const outboxRepository = new FailingOutboxRepository();
  const unitOfWork = new InMemoryTwinUnitOfWork({ catalogRepository: repository, outboxRepository });
  const service = new TwinCatalogService({ repository, unitOfWork });

  await assert.rejects(() => service.createMapDraft({
    draftId: "rolled-back-draft",
    familyId: "demo-plant",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    operatorId: "engineer-1",
  }), /simulated outbox failure/);

  assert.equal(await repository.getMapDraft("rolled-back-draft"), null);
  assert.deepEqual(await outboxRepository.list(), []);
});

test("outbox dispatcher delivers successes and retries failures after exponential backoff", async () => {
  const outboxRepository = new InMemoryOutboxRepository();
  await outboxRepository.append(outboxEvent("event-fail", "2026-08-13T18:00:00.000Z"));
  await outboxRepository.append(outboxEvent("event-good", "2026-08-13T18:00:01.000Z"));
  let now = new Date("2026-08-13T18:00:02.000Z");
  const deliveryCounts = new Map();
  const dispatcher = new OutboxDispatcher({
    outboxRepository,
    clock: () => now,
    baseRetryDelayMilliseconds: 1_000,
    maximumRetryDelayMilliseconds: 8_000,
    publisher: async (event) => {
      const count = (deliveryCounts.get(event.eventId) ?? 0) + 1;
      deliveryCounts.set(event.eventId, count);
      if (event.eventId === "event-fail" && count === 1) throw new Error("temporary broker outage");
    },
  });

  const first = await dispatcher.dispatchBatch({ workerId: "dispatcher-1", batchSize: 10, leaseSeconds: 15 });
  assert.equal(first.claimed, 2);
  assert.deepEqual(first.delivered, ["event-good"]);
  assert.deepEqual(first.failed, [{ eventId: "event-fail", error: "temporary broker outage" }]);
  assert.equal((await outboxRepository.get("event-fail")).availableAt, "2026-08-13T18:00:03.000Z");
  assert.equal((await outboxRepository.get("event-good")).deliveredAt, "2026-08-13T18:00:02.000Z");

  assert.equal((await dispatcher.dispatchBatch({ workerId: "dispatcher-1" })).claimed, 0);
  now = new Date("2026-08-13T18:00:03.000Z");
  const retry = await dispatcher.dispatchBatch({ workerId: "dispatcher-1" });
  assert.deepEqual(retry.delivered, ["event-fail"]);
  assert.equal((await outboxRepository.get("event-fail")).deliveryAttempts, 2);
});

class FailingOutboxRepository extends InMemoryOutboxRepository {
  async append() {
    throw new Error("simulated outbox failure");
  }
}

async function seedHierarchy(repository) {
  const common = { createdBy: "engineer-1", createdAt: "2026-08-13T17:00:00.000Z" };
  await repository.createSite({
    siteId: "demo-site",
    displayName: "Demo Site",
    timezone: "Europe/Istanbul",
    ...common,
  });
  await repository.createBuilding({
    siteId: "demo-site",
    buildingId: "main-building",
    displayName: "Main Building",
    ...common,
  });
  await repository.createFloor({
    floorId: "floor-1",
    siteId: "demo-site",
    buildingId: "main-building",
    displayName: "Floor 1",
    elevationMeters: 0,
    ...common,
  });
  await repository.createMapFamily({
    familyId: "demo-plant",
    floorId: "floor-1",
    displayName: "Demo Plant",
    ...common,
  });
}

function outboxEvent(eventId, occurredAt) {
  return {
    eventId,
    aggregateType: "MapDraft",
    aggregateId: "draft-1",
    eventType: MAP_DRAFT_EVENT_TYPE.created,
    schemaVersion: 1,
    payload: { draftId: "draft-1" },
    occurredAt,
  };
}
