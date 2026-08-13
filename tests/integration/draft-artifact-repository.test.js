import assert from "node:assert/strict";
import test from "node:test";
import { createDraftArtifactBindingRecord } from "@brash-twin/domain";
import { PersistenceError } from "@brash-twin/persistence";
import {
  InMemoryDraftArtifactRepository,
  PostgresDraftArtifactRepository,
} from "@brash-twin/persistence/draft-artifacts";

test("in-memory draft artifact repository enforces immutable input identity", async () => {
  const repository = new InMemoryDraftArtifactRepository();
  await repository.create(sourceRecord());
  await assert.rejects(
    () => repository.create(derivedRecord({
      inputBindings: [{ bindingId: "source-1", artifactSha256: "f".repeat(64) }],
    })),
    (error) => error instanceof PersistenceError && error.code === "REFERENCE_NOT_FOUND",
  );
});

test("PostgreSQL draft artifact repository writes binding and lineage in one parameterized transaction", async () => {
  const calls = [];
  const database = {
    query: async () => ({ rows: [] }),
    async transaction(operation) {
      return operation({
        async query(sql, parameters) {
          calls.push({ sql, parameters });
          return { rows: [] };
        },
      });
    },
  };
  const repository = new PostgresDraftArtifactRepository(database);
  const record = derivedRecord();
  const created = await repository.create(record);

  assert.equal(created.bindingId, "derived-1");
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INSERT INTO twin_draft_artifacts/);
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3/);
  assert.equal(calls[0].sql.includes("derived-1"), false);
  assert.deepEqual(calls[1].parameters, ["draft-1", "derived-1", "source-1", "a".repeat(64)]);
});

function sourceRecord() {
  return createDraftArtifactBindingRecord({
    bindingId: "source-1",
    draftId: "draft-1",
    uploadId: "upload-1",
    artifactSha256: "a".repeat(64),
    role: "BIM_SOURCE",
    coordinateFrameId: "plant/floor-1",
    operatorId: "engineer-1",
    occurredAt: "2026-08-13T18:00:00.000Z",
  });
}

function derivedRecord(overrides = {}) {
  return createDraftArtifactBindingRecord({
    bindingId: "derived-1",
    draftId: "draft-1",
    uploadId: "upload-2",
    artifactSha256: "b".repeat(64),
    role: "IMPORT_REPORT",
    inputBindings: [{ bindingId: "source-1", artifactSha256: "a".repeat(64) }],
    producer: { name: "ifc-importer", version: "0.1.0", parametersSha256: "c".repeat(64) },
    operatorId: "pipeline-1",
    occurredAt: "2026-08-13T18:01:00.000Z",
    ...overrides,
  });
}
