import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ArtifactStoreError,
  ContentAddressedArtifactStore,
  ImmutableReleaseStore,
  LocalMultipartArtifactStore,
} from "@brash-twin/artifact-store";
import { BundleValidationError } from "@brash-twin/validation";

const fixture = fileURLToPath(new URL("../fixtures/bundles/demo-plant@1", import.meta.url));

test("content-addressed store deduplicates and verifies bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-artifacts-"));
  const store = new ContentAddressedArtifactStore(root);
  const content = Buffer.from("same point-cloud tile");

  const first = await store.put(content, { mediaType: "application/octet-stream", originalName: "tile.bin" });
  const second = await store.put(content);

  assert.equal(first.sha256, second.sha256);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(await store.has(first.sha256), true);
  assert.deepEqual(await store.get(first.sha256), content);
  assert.deepEqual(await store.verify(first.sha256), {
    sha256: first.sha256,
    bytes: content.byteLength,
    valid: true,
  });
});

test("release store publishes once and exposes a sorted immutable catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-releases-"));
  const store = new ImmutableReleaseStore(root);

  const publication = await store.publish(fixture);
  assert.equal(publication.mapReleaseId, "demo-plant@1");
  assert.equal(await store.has("demo-plant@1"), true);
  assert.equal((await store.getManifest("demo-plant@1")).bundleId, "bundle-demo-plant-1");
  assert.deepEqual((await store.list()).map((release) => release.mapReleaseId), ["demo-plant@1"]);

  await assert.rejects(
    () => store.publish(fixture),
    (error) => error instanceof ArtifactStoreError && error.code === "RELEASE_ALREADY_EXISTS",
  );
});

test("release store seals publication input and resumes after the release is already stored", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-publication-store-"));
  const store = new ImmutableReleaseStore(root);
  const descriptor = await store.stagePublication("publication-1", fixture);

  assert.equal(descriptor.mapReleaseId, "demo-plant@1");
  assert.match(descriptor.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal((await store.stagePublication("publication-1", fixture)).manifestSha256, descriptor.manifestSha256);
  assert.equal((await store.ensurePublicationStored("publication-1", descriptor)).bundleId, "bundle-demo-plant-1");

  await store.discardPublicationInput("publication-1");
  assert.equal((await store.ensurePublicationStored("publication-1", descriptor)).mapReleaseId, "demo-plant@1");
});

test("release store refuses a bundle changed after publication manifest was signed", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-releases-invalid-"));
  const source = await mkdtemp(join(tmpdir(), "brash-source-invalid-"));
  const store = new ImmutableReleaseStore(root);
  const topology = JSON.parse(await readFile(new URL("../fixtures/bundles/demo-plant@1/topology.json", import.meta.url), "utf8"));
  topology.nodes[0].position.x = 999;

  const { cp } = await import("node:fs/promises");
  await cp(fixture, source, { recursive: true });
  await writeFile(join(source, "topology.json"), `${JSON.stringify(topology, null, 2)}\n`);

  await assert.rejects(
    () => store.publish(source),
    (error) => error instanceof BundleValidationError
      && error.report.errors.some((issue) => issue.code === "ARTIFACT_CHECKSUM_MISMATCH"),
  );
  assert.deepEqual(await store.list(), []);
});

test("local multipart store assembles contiguous parts and keeps an idempotent completion receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-multipart-"));
  const now = new Date("2026-08-13T18:00:00.000Z");
  const store = new LocalMultipartArtifactStore(root, { clock: () => now });
  const content = Buffer.from("abcdefghij");
  const sha256 = createHash("sha256").update(content).digest("hex");
  await store.createUpload({
    uploadId: "upload-1",
    expectedSha256: sha256,
    expectedBytes: content.byteLength,
    partSizeBytes: 4,
    maximumParts: 10,
    expiresAt: "2026-08-13T19:00:00.000Z",
  });

  await store.putPart("upload-1", 1, content.subarray(0, 4));
  await store.putPart("upload-1", 2, content.subarray(4, 8));
  await store.putPart("upload-1", 3, content.subarray(8));
  const duplicate = await store.putPart("upload-1", 3, content.subarray(8));
  assert.equal(duplicate.created, false);

  const completed = await store.completeUpload("upload-1");
  assert.deepEqual(completed, {
    status: "COMPLETED",
    uploadId: "upload-1",
    sha256,
    bytes: content.byteLength,
    objectKey: `objects/sha256/${sha256.slice(0, 2)}/${sha256}`,
  });
  assert.deepEqual(await store.completeUpload("upload-1"), completed);
  assert.deepEqual(await store.get(sha256), content);
});

test("local multipart store quarantines checksum mismatches instead of publishing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "brash-multipart-quarantine-"));
  const store = new LocalMultipartArtifactStore(root, {
    clock: () => new Date("2026-08-13T18:00:00.000Z"),
  });
  const content = Buffer.from("unexpected bytes");
  const actualSha256 = createHash("sha256").update(content).digest("hex");
  await store.createUpload({
    uploadId: "upload-bad-1",
    expectedSha256: "a".repeat(64),
    expectedBytes: content.byteLength,
    partSizeBytes: 64,
    maximumParts: 2,
    expiresAt: "2026-08-13T19:00:00.000Z",
  });
  await store.putPart("upload-bad-1", 1, content);

  const result = await store.completeUpload("upload-bad-1");
  assert.equal(result.status, "QUARANTINED");
  assert.equal(result.reasonCode, "CHECKSUM_MISMATCH");
  assert.equal(result.sha256, actualSha256);
  assert.match(result.quarantineKey, /^quarantine\/upload-bad-1\/[a-f0-9]{64}\.bin$/);
  await assert.rejects(() => store.get(actualSha256), (error) => error.code === "ENOENT");
  assert.deepEqual(await store.completeUpload("upload-bad-1"), result);
});
