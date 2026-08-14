import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SurveyIntakeError, SurveyIntakeService } from "@brash-twin/application/survey-intakes";
import { InMemorySurveyIntakeRepository } from "@brash-twin/persistence/survey-intakes";

const manifestPath = fileURLToPath(new URL("../fixtures/surveys/embodied-demo.v1.json", import.meta.url));

test("survey intake verifies only the small manifest and atomically accepts mapped upload identities", async () => {
  const manifest = await loadManifest();
  const system = serviceFor(manifest);
  const created = await system.service.create("draft-1", createInput(manifest));
  assert.equal(created.status, "OPEN");
  assert.equal(created.artifactUploads.length, manifest.artifacts.length);

  const verified = await system.service.verify("intake-1", { operatorId: "reviewer-1" });
  assert.equal(verified.status, "ACCEPTED");
  assert.equal(verified.report.outcome, "ACCEPTED");
  assert.equal(verified.packageId, manifest.packageId);
  assert.deepEqual(system.storeReads, [created.manifestArtifactSha256]);
  assert.deepEqual((await system.service.list("draft-1")).map((intake) => intake.intakeId), ["intake-1"]);
  assert.deepEqual(await system.service.verify("intake-1", { operatorId: "reviewer-2" }), verified);
  assert.deepEqual(system.storeReads, [created.manifestArtifactSha256]);
});

test("survey intake preserves checksum, byte, media, missing, and extra mapping failures as rejection evidence", async () => {
  const manifest = await loadManifest();
  const mappings = createInput(manifest).artifactUploads;
  mappings.pop();
  mappings.push({ artifactId: "undeclared-1", uploadId: "upload-extra-1" });
  const system = serviceFor(manifest, {
    uploads: {
      "upload-frames-1": { artifactSha256: "f".repeat(64) },
      "upload-calibration-1": { observedBytes: 99 },
      "upload-trajectory-1": { mediaType: "application/octet-stream" },
      "upload-extra-1": {
        artifactSha256: "e".repeat(64),
        observedBytes: 8,
        mediaType: "application/octet-stream",
      },
    },
  });
  await system.service.create("draft-1", { ...createInput(manifest), artifactUploads: mappings });
  const rejected = await system.service.verify("intake-1", { operatorId: "reviewer-1" });
  assert.equal(rejected.status, "REJECTED");
  assert.deepEqual(new Set(rejected.report.issues.map((entry) => entry.code)), new Set([
    "UPLOAD_CHECKSUM_MISMATCH",
    "UPLOAD_BYTES_MISMATCH",
    "UPLOAD_MEDIA_TYPE_MISMATCH",
    "UPLOAD_MAPPING_MISSING",
    "UPLOAD_MAPPING_EXTRA",
  ]));
});

test("survey intake rejects cross-floor manifests and malformed JSON as immutable terminal results", async () => {
  const manifest = await loadManifest();
  manifest.floorId = "another-floor";
  const mismatch = serviceFor(manifest);
  await mismatch.service.create("draft-1", createInput(manifest));
  const rejected = await mismatch.service.verify("intake-1", { operatorId: "reviewer-1" });
  assert.equal(rejected.status, "REJECTED");
  assert.ok(rejected.report.issues.some((entry) => entry.code === "TARGET_FLOOR_MISMATCH"));

  const malformed = serviceFor(Buffer.from("{broken"), { artifactsFrom: await loadManifest() });
  await malformed.service.create("draft-1", createInput(await loadManifest()));
  const malformedResult = await malformed.service.verify("intake-1", { operatorId: "reviewer-1" });
  assert.equal(malformedResult.status, "REJECTED");
  assert.ok(malformedResult.report.issues.some((entry) => entry.code === "MANIFEST_JSON_INVALID"));

  const tamperedBytes = Buffer.from(JSON.stringify({ ...await loadManifest(), packageId: "tampered-package" }));
  const tampered = serviceFor(await loadManifest(), { storedManifestBytes: tamperedBytes });
  await tampered.service.create("draft-1", createInput(await loadManifest()));
  const tamperedResult = await tampered.service.verify("intake-1", { operatorId: "reviewer-1" });
  assert.equal(tamperedResult.status, "REJECTED");
  assert.ok(tamperedResult.report.issues.some((entry) => entry.code === "MANIFEST_CHECKSUM_MISMATCH"));
});

test("survey intake creation blocks incomplete uploads and non-editable drafts", async () => {
  const manifest = await loadManifest();
  const incomplete = serviceFor(manifest, { incompleteUploadId: "upload-frames-1" });
  await assert.rejects(
    () => incomplete.service.create("draft-1", createInput(manifest)),
    (error) => error instanceof SurveyIntakeError && error.code === "SURVEY_INTAKE_UPLOAD_INCOMPLETE",
  );
  const locked = serviceFor(manifest, { draftStatus: "IN_REVIEW" });
  await assert.rejects(
    () => locked.service.create("draft-1", createInput(manifest)),
    (error) => error instanceof SurveyIntakeError && error.code === "SURVEY_INTAKE_DRAFT_LOCKED",
  );
});

function serviceFor(manifestOrBytes, options = {}) {
  const artifactManifest = options.artifactsFrom ?? manifestOrBytes;
  const manifestBytes = Buffer.isBuffer(manifestOrBytes)
    ? manifestOrBytes
    : Buffer.from(JSON.stringify(manifestOrBytes));
  const manifestSha256 = sha256(manifestBytes);
  const records = new Map();
  records.set("manifest-upload-1", completedUpload({
    uploadId: "manifest-upload-1",
    artifactSha256: manifestSha256,
    observedBytes: manifestBytes.byteLength,
    mediaType: "application/json",
  }));
  for (const artifact of artifactManifest.artifacts) {
    const uploadId = `upload-${artifact.artifactId}`;
    records.set(uploadId, completedUpload({
      uploadId,
      artifactSha256: artifact.sha256,
      observedBytes: artifact.bytes,
      mediaType: artifact.mediaType,
      ...options.uploads?.[uploadId],
    }));
  }
  if (options.uploads?.["upload-extra-1"]) {
    records.set("upload-extra-1", completedUpload({
      uploadId: "upload-extra-1",
      ...options.uploads["upload-extra-1"],
    }));
  }
  if (options.incompleteUploadId) {
    records.set(options.incompleteUploadId, {
      ...records.get(options.incompleteUploadId),
      status: "UPLOADING",
      artifactSha256: null,
    });
  }
  const storeReads = [];
  const service = new SurveyIntakeService({
    repository: new InMemorySurveyIntakeRepository(),
    catalog: {
      async getMapDraftContext(draftId) {
        return {
          draft: { draftId, status: options.draftStatus ?? "DRAFT" },
          family: { familyId: "family-1", floorId: "production-floor" },
          floor: { floorId: "production-floor", siteId: "demo-site" },
        };
      },
    },
    uploads: {
      async get(uploadId) {
        if (!records.has(uploadId)) throw new Error(`Unexpected upload ${uploadId}`);
        return structuredClone(records.get(uploadId));
      },
    },
    multipartStore: {
      async get(contentSha256) {
        storeReads.push(contentSha256);
        assert.equal(contentSha256, manifestSha256);
        return options.storedManifestBytes ?? manifestBytes;
      },
    },
    clock: () => new Date("2026-08-14T12:00:00.000Z"),
    intakeIdGenerator: () => "generated-intake-1",
  });
  return { service, storeReads };
}

function createInput(manifest) {
  return {
    intakeId: "intake-1",
    manifestUploadId: "manifest-upload-1",
    artifactUploads: manifest.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      uploadId: `upload-${artifact.artifactId}`,
    })),
    operatorId: "operator-1",
  };
}

function completedUpload(overrides) {
  return {
    status: "COMPLETED",
    expectedBytes: overrides.observedBytes,
    ...overrides,
  };
}

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
