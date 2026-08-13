import assert from "node:assert/strict";
import test from "node:test";
import {
  TwinDomainError,
  UPLOAD_STATUS,
  cancelUploadSession,
  completeUploadSession,
  createUploadSessionRecord,
  quarantineUploadSession,
} from "@brash-twin/domain";

test("upload session completes only with the declared content identity", () => {
  const initiated = uploadRecord();
  const completed = completeUploadSession(initiated, {
    sha256: "a".repeat(64),
    bytes: 12,
    objectKey: `objects/sha256/aa/${"a".repeat(64)}`,
    operatorId: "engineer-1",
    occurredAt: "2026-08-13T18:10:00.000Z",
  });

  assert.equal(completed.status, UPLOAD_STATUS.completed);
  assert.equal(completed.artifactSha256, "a".repeat(64));
  assert.equal(completed.rowVersion, 2);
  assert.equal(completed.completedAt, "2026-08-13T18:10:00.000Z");
  assert.throws(
    () => cancelUploadSession(completed, { operatorId: "engineer-1" }),
    (error) => error instanceof TwinDomainError && error.code === "UPLOAD_TRANSITION_INVALID",
  );
});

test("upload integrity mismatch is represented as quarantine evidence", () => {
  const initiated = uploadRecord();
  assert.throws(
    () => completeUploadSession(initiated, {
      sha256: "b".repeat(64),
      bytes: 12,
      objectKey: `objects/sha256/bb/${"b".repeat(64)}`,
      operatorId: "engineer-1",
    }),
    (error) => error instanceof TwinDomainError && error.code === "UPLOAD_INTEGRITY_MISMATCH",
  );

  const quarantined = quarantineUploadSession(initiated, {
    observedSha256: "b".repeat(64),
    observedBytes: 12,
    quarantineKey: `quarantine/upload-1/${"b".repeat(64)}.bin`,
    reason: "CHECKSUM_MISMATCH",
    operatorId: "engineer-1",
    occurredAt: "2026-08-13T18:10:00.000Z",
  });
  assert.equal(quarantined.status, UPLOAD_STATUS.quarantined);
  assert.equal(quarantined.artifactSha256, null);
  assert.equal(quarantined.quarantineReason, "CHECKSUM_MISMATCH");
});

function uploadRecord() {
  return createUploadSessionRecord({
    uploadId: "upload-1",
    expectedSha256: "a".repeat(64),
    expectedBytes: 12,
    mediaType: "application/octet-stream",
    originalName: "factory.ifc",
    partSizeBytes: 8,
    maximumParts: 2,
    storageProvider: "local-filesystem",
    uploadKey: "staging/uploads/upload-1",
    operatorId: "engineer-1",
    expiresAt: "2026-08-13T19:00:00.000Z",
    occurredAt: "2026-08-13T18:00:00.000Z",
  });
}
