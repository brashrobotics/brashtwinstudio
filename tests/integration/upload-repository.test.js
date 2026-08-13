import assert from "node:assert/strict";
import test from "node:test";
import { PostgresUploadRepository } from "@brash-twin/persistence/uploads";

test("PostgreSQL upload repository creates sessions with parameterized SQL", async () => {
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [uploadRow()] };
    },
  };
  const repository = new PostgresUploadRepository(database);
  const created = await repository.create(uploadRecord());

  assert.equal(created.uploadId, "upload-1");
  assert.match(calls[0].sql, /INSERT INTO twin_upload_sessions/);
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3/);
  assert.equal(calls[0].sql.includes("upload-1"), false);
  assert.equal(calls[0].parameters.length, 21);
});

test("PostgreSQL upload completion stores artifact and terminal session in one transaction", async () => {
  const calls = [];
  const completedRecord = {
    ...uploadRecord(),
    status: "COMPLETED",
    observedSha256: "a".repeat(64),
    observedBytes: 12,
    artifactSha256: "a".repeat(64),
    uploadKey: `objects/sha256/aa/${"a".repeat(64)}`,
    rowVersion: 2,
    updatedAt: "2026-08-13T18:10:00.000Z",
    completedAt: "2026-08-13T18:10:00.000Z",
  };
  const artifact = {
    sha256: "a".repeat(64),
    bytes: 12,
    objectKey: completedRecord.uploadKey,
    mediaType: "application/octet-stream",
    originalName: "factory.ifc",
    createdAt: "2026-08-13T18:10:00.000Z",
  };
  const database = {
    query: async () => ({ rows: [] }),
    async transaction(operation) {
      return operation({
        async query(sql, parameters) {
          calls.push({ sql, parameters });
          if (sql.includes("INSERT INTO twin_artifacts")) return { rows: [] };
          if (sql.includes("SELECT * FROM twin_artifacts")) return { rows: [artifactRow(artifact)] };
          if (sql.includes("UPDATE twin_upload_sessions")) return { rows: [uploadRow(completedRecord)] };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      });
    },
  };
  const repository = new PostgresUploadRepository(database);
  const result = await repository.complete(completedRecord, 1, artifact);

  assert.equal(result.session.status, "COMPLETED");
  assert.equal(result.artifact.sha256, artifact.sha256);
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /ON CONFLICT \(sha256\) DO NOTHING/);
  assert.match(calls[2].sql, /row_version = \$22/);
  assert.equal(calls[2].parameters[21], 1);
});

function uploadRecord() {
  return {
    uploadId: "upload-1",
    status: "INITIATED",
    expectedSha256: "a".repeat(64),
    expectedBytes: 12,
    observedSha256: null,
    observedBytes: null,
    artifactSha256: null,
    mediaType: "application/octet-stream",
    originalName: "factory.ifc",
    partSizeBytes: 8,
    maximumParts: 2,
    storageProvider: "local-filesystem",
    uploadKey: "staging/uploads/upload-1",
    quarantineReason: null,
    expiresAt: "2026-08-13T19:00:00.000Z",
    rowVersion: 1,
    createdBy: "engineer-1",
    createdAt: "2026-08-13T18:00:00.000Z",
    updatedBy: "engineer-1",
    updatedAt: "2026-08-13T18:00:00.000Z",
    completedAt: null,
  };
}

function uploadRow(record = uploadRecord()) {
  return {
    upload_id: record.uploadId,
    status: record.status,
    expected_sha256: record.expectedSha256,
    expected_bytes: record.expectedBytes,
    observed_sha256: record.observedSha256,
    observed_bytes: record.observedBytes,
    artifact_sha256: record.artifactSha256,
    media_type: record.mediaType,
    original_name: record.originalName,
    part_size_bytes: record.partSizeBytes,
    maximum_parts: record.maximumParts,
    storage_provider: record.storageProvider,
    upload_key: record.uploadKey,
    quarantine_reason: record.quarantineReason,
    expires_at: record.expiresAt,
    row_version: record.rowVersion,
    created_by: record.createdBy,
    created_at: record.createdAt,
    updated_by: record.updatedBy,
    updated_at: record.updatedAt,
    completed_at: record.completedAt,
  };
}

function artifactRow(artifact) {
  return {
    sha256: artifact.sha256,
    bytes: artifact.bytes,
    object_key: artifact.objectKey,
    media_type: artifact.mediaType,
    original_name: artifact.originalName,
    created_at: artifact.createdAt,
  };
}
