import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryTwinCatalogRepository,
  PersistenceError,
  PostgresTwinCatalogRepository,
} from "@brash-twin/persistence";

test("in-memory catalog enforces parent references and optimistic concurrency", async () => {
  const repository = new InMemoryTwinCatalogRepository();
  await assert.rejects(
    () => repository.createMapFamily({ familyId: "plant-a", floorId: "missing-floor" }),
    (error) => error instanceof PersistenceError && error.code === "REFERENCE_NOT_FOUND",
  );

  await repository.createSite(siteRecord());
  await repository.createBuilding(buildingRecord());
  await repository.createFloor(floorRecord());
  await repository.createMapFamily(familyRecord());
  const created = await repository.createMapDraft(draftRecord());
  const updated = { ...created, status: "IN_REVIEW", rowVersion: 2 };
  await repository.saveMapDraft(updated, 1);

  await assert.rejects(
    () => repository.saveMapDraft({ ...updated, status: "VALIDATED", rowVersion: 3 }, 1),
    (error) => error instanceof PersistenceError && error.code === "CONCURRENCY_CONFLICT",
  );
});

test("PostgreSQL adapter uses parameterized SQL and maps rows", async () => {
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return {
        rows: [{
          site_id: parameters[0],
          display_name: parameters[1],
          timezone: parameters[2],
          created_by: parameters[3],
          created_at: parameters[4],
        }],
      };
    },
  };
  const repository = new PostgresTwinCatalogRepository(database);
  const maliciousLookingId = "safe-id";
  const created = await repository.createSite({ ...siteRecord(), siteId: maliciousLookingId });

  assert.equal(created.siteId, maliciousLookingId);
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5\)/);
  assert.equal(calls[0].sql.includes(maliciousLookingId), false);
  assert.equal(calls[0].parameters[0], maliciousLookingId);
});

test("PostgreSQL adapter reports stale draft writes as concurrency conflicts", async () => {
  const repository = new PostgresTwinCatalogRepository({ query: async () => ({ rows: [] }) });
  await assert.rejects(
    () => repository.saveMapDraft({ ...draftRecord(), rowVersion: 2 }, 1),
    (error) => error instanceof PersistenceError && error.code === "CONCURRENCY_CONFLICT",
  );
});

function siteRecord() {
  return {
    siteId: "demo-site",
    displayName: "Demo Site",
    timezone: "Europe/Istanbul",
    createdBy: "operator-1",
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function buildingRecord() {
  return {
    siteId: "demo-site",
    buildingId: "main-building",
    displayName: "Main Building",
    createdBy: "operator-1",
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function floorRecord() {
  return {
    floorId: "floor-1",
    siteId: "demo-site",
    buildingId: "main-building",
    displayName: "Floor 1",
    elevationMeters: 0,
    createdBy: "operator-1",
    createdAt: "2026-08-13T10:00:00.000Z",
  };
}

function familyRecord() {
  return {
    familyId: "demo-plant",
    floorId: "floor-1",
    displayName: "Demo Plant",
    createdBy: "operator-1",
    createdAt: "2026-08-13T10:00:00.000Z",
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
    createdBy: "operator-1",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedBy: "operator-1",
    updatedAt: "2026-08-13T10:00:00.000Z",
  };
}
