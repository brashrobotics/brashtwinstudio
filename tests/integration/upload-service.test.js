import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UploadService } from "@brash-twin/application/uploads";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";

test("upload service persists a verified content-addressed artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-upload-service-"));
  const now = new Date("2026-08-13T18:00:00.000Z");
  const repository = new InMemoryUploadRepository();
  const multipartStore = new LocalMultipartArtifactStore(root, { clock: () => now });
  const service = new UploadService({
    repository,
    multipartStore,
    clock: () => now,
    partSizeBytes: 5,
    maximumParts: 10,
  });
  const content = Buffer.from("verified IFC bytes");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const initiated = await service.initiate({
    uploadId: "verified-upload-1",
    expectedSha256: sha256,
    expectedBytes: content.byteLength,
    mediaType: "application/octet-stream",
    originalName: "plant.ifc",
    operatorId: "engineer-1",
  });
  assert.equal(initiated.session.status, "INITIATED");

  for (let offset = 0, partNumber = 1; offset < content.length; offset += 5, partNumber += 1) {
    await multipartStore.putPart("verified-upload-1", partNumber, content.subarray(offset, offset + 5));
  }
  const completed = await service.complete("verified-upload-1", { operatorId: "engineer-1" });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.artifactSha256, sha256);
  assert.equal((await repository.getArtifact(sha256)).objectKey, completed.uploadKey);
  assert.deepEqual(await multipartStore.get(sha256), content);
});

test("upload service records checksum mismatch as quarantined without creating artifact metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-upload-service-quarantine-"));
  const now = new Date("2026-08-13T18:00:00.000Z");
  const repository = new InMemoryUploadRepository();
  const multipartStore = new LocalMultipartArtifactStore(root, { clock: () => now });
  const service = new UploadService({
    repository,
    multipartStore,
    clock: () => now,
    partSizeBytes: 64,
    maximumParts: 2,
  });
  const content = Buffer.from("wrong scan bytes");
  const actualSha256 = createHash("sha256").update(content).digest("hex");
  await service.initiate({
    uploadId: "quarantine-upload-1",
    expectedSha256: "a".repeat(64),
    expectedBytes: content.byteLength,
    mediaType: "application/octet-stream",
    originalName: "scan.laz",
    operatorId: "engineer-1",
  });
  await multipartStore.putPart("quarantine-upload-1", 1, content);

  const quarantined = await service.complete("quarantine-upload-1", { operatorId: "reviewer-1" });
  assert.equal(quarantined.status, "QUARANTINED");
  assert.equal(quarantined.observedSha256, actualSha256);
  assert.equal(quarantined.quarantineReason, "CHECKSUM_MISMATCH");
  assert.equal(await repository.getArtifact(actualSha256), null);
});

test("expired upload is aborted and persisted as terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-upload-service-expired-"));
  let now = new Date("2026-08-13T18:00:00.000Z");
  const repository = new InMemoryUploadRepository();
  const multipartStore = new LocalMultipartArtifactStore(root, { clock: () => now });
  const service = new UploadService({
    repository,
    multipartStore,
    clock: () => now,
    expirySeconds: 60,
  });
  await service.initiate({
    uploadId: "expired-upload-1",
    expectedSha256: "a".repeat(64),
    expectedBytes: 10,
    mediaType: "application/octet-stream",
    originalName: "expired.bin",
    operatorId: "engineer-1",
  });
  now = new Date("2026-08-13T18:01:00.000Z");

  const expired = await service.complete("expired-upload-1", { operatorId: "engineer-1" });
  assert.equal(expired.status, "EXPIRED");
  await assert.rejects(
    () => multipartStore.putPart("expired-upload-1", 1, Buffer.from("x")),
    (error) => error.code === "ENOENT",
  );
});
