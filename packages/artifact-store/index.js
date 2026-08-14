import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { BundleValidationError, validateBundleDirectory } from "@brash-twin/validation";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]*$/;

export class ArtifactStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArtifactStoreError";
    this.code = code;
  }
}

export class ContentAddressedArtifactStore {
  #rootDirectory;

  constructor(rootDirectory) {
    this.#rootDirectory = resolveRequiredPath(rootDirectory, "Artifact store root");
  }

  async put(content, metadata = {}) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const key = contentKey(sha256);
    const target = join(this.#rootDirectory, ...key.split("/"));
    await mkdir(dirname(target), { recursive: true });

    let created = false;
    try {
      await assertRegularFile(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, buffer, { flag: "wx" });
        await rename(temporary, target);
        created = true;
      } finally {
        await unlink(temporary).catch((unlinkError) => {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        });
      }
    }

    await this.verify(sha256);
    return Object.freeze({
      sha256,
      bytes: buffer.byteLength,
      key,
      mediaType: metadata.mediaType ?? "application/octet-stream",
      originalName: metadata.originalName ?? null,
      created,
    });
  }

  async get(sha256) {
    validateSha256(sha256);
    const path = join(this.#rootDirectory, ...contentKey(sha256).split("/"));
    await assertRegularFile(path);
    return readFile(path);
  }

  async openReadStream(sha256) {
    validateSha256(sha256);
    const path = join(this.#rootDirectory, ...contentKey(sha256).split("/"));
    await assertRegularFile(path);
    return createReadStream(path);
  }

  async has(sha256) {
    try {
      validateSha256(sha256);
      await assertRegularFile(join(this.#rootDirectory, ...contentKey(sha256).split("/")));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async verify(sha256) {
    const content = await this.get(sha256);
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== sha256) {
      throw new ArtifactStoreError("ARTIFACT_INTEGRITY_FAILED", `Stored artifact ${sha256} failed integrity verification.`);
    }
    return { sha256, bytes: content.byteLength, valid: true };
  }
}

export class LocalMultipartArtifactStore {
  #rootDirectory;
  #clock;

  constructor(rootDirectory, { clock = () => new Date() } = {}) {
    this.#rootDirectory = resolveRequiredPath(rootDirectory, "Multipart artifact store root");
    if (typeof clock !== "function") throw new ArtifactStoreError("STORE_CLOCK_INVALID", "Store clock must be a function.");
    this.#clock = clock;
  }

  async createUpload({ uploadId, expectedSha256, expectedBytes, partSizeBytes, maximumParts, expiresAt }) {
    validateUploadId(uploadId);
    validateSha256(expectedSha256);
    positiveSafeInteger(expectedBytes, "expectedBytes");
    positiveSafeInteger(partSizeBytes, "partSizeBytes");
    positiveSafeInteger(maximumParts, "maximumParts");
    const expiry = validIsoDate(expiresAt, "expiresAt");
    if (await exists(this.#receiptPath(uploadId))) {
      throw new ArtifactStoreError("UPLOAD_ALREADY_FINALIZED", `Upload ${uploadId} was already finalized.`);
    }
    const uploadKey = posix.join("staging", "uploads", uploadId);
    const uploadDirectory = join(this.#rootDirectory, ...uploadKey.split("/"));
    await mkdir(dirname(uploadDirectory), { recursive: true });
    let directoryCreated = false;
    try {
      await mkdir(uploadDirectory);
      directoryCreated = true;
      await writeFile(join(uploadDirectory, "manifest.json"), `${JSON.stringify({
        uploadId,
        expectedSha256,
        expectedBytes,
        partSizeBytes,
        maximumParts,
        expiresAt: expiry,
      })}\n`, { flag: "wx" });
    } catch (error) {
      if (directoryCreated) await rm(uploadDirectory, { recursive: true, force: true });
      if (error.code === "EEXIST") {
        throw new ArtifactStoreError("UPLOAD_ALREADY_EXISTS", `Upload ${uploadId} already exists in object storage.`);
      }
      throw error;
    }
    return Object.freeze({
      uploadId,
      provider: "local-filesystem",
      uploadKey,
      partSizeBytes,
      maximumParts,
      expiresAt: expiry,
      partUrlTemplate: `local-multipart://${uploadId}/parts/{partNumber}`,
    });
  }

  async putPart(uploadId, partNumber, content) {
    validateUploadId(uploadId);
    positiveSafeInteger(partNumber, "partNumber");
    const uploadDirectory = this.#uploadDirectory(uploadId);
    const manifest = await this.#readManifest(uploadDirectory);
    if (new Date(manifest.expiresAt).getTime() <= this.#now().getTime()) {
      throw new ArtifactStoreError("UPLOAD_EXPIRED", `Upload ${uploadId} has expired.`);
    }
    if (partNumber > manifest.maximumParts) {
      throw new ArtifactStoreError("UPLOAD_PART_INVALID", `Part number exceeds the limit for upload ${uploadId}.`);
    }
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (buffer.byteLength < 1 || buffer.byteLength > manifest.partSizeBytes) {
      throw new ArtifactStoreError(
        "UPLOAD_PART_SIZE_INVALID",
        `Upload part must contain between 1 and ${manifest.partSizeBytes} bytes.`,
      );
    }
    const path = join(uploadDirectory, partFileName(partNumber));
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    try {
      await writeFile(path, buffer, { flag: "wx" });
      return Object.freeze({ partNumber, bytes: buffer.byteLength, sha256, created: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await inspectRegularFile(path);
      if (existing.bytes !== buffer.byteLength || existing.sha256 !== sha256) {
        throw new ArtifactStoreError("UPLOAD_PART_CONFLICT", `Part ${partNumber} of upload ${uploadId} already differs.`);
      }
      return Object.freeze({ partNumber, bytes: existing.bytes, sha256: existing.sha256, created: false });
    }
  }

  async listParts(uploadId) {
    validateUploadId(uploadId);
    const uploadDirectory = this.#uploadDirectory(uploadId);
    await this.#readManifest(uploadDirectory);
    const entries = await readdir(uploadDirectory, { withFileTypes: true });
    const parts = [];
    for (const entry of entries) {
      const match = entry.name.match(/^(\d{6})\.part$/);
      if (!match) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new ArtifactStoreError("STORE_ENTRY_NOT_REGULAR_FILE", `${entry.name} is not a regular upload part.`);
      }
      const partNumber = Number(match[1]);
      parts.push({ partNumber, ...await inspectRegularFile(join(uploadDirectory, entry.name)) });
    }
    return parts.sort((left, right) => left.partNumber - right.partNumber).map(Object.freeze);
  }

  async completeUpload(uploadId) {
    validateUploadId(uploadId);
    const receipt = await this.#readReceipt(uploadId);
    if (receipt) return Object.freeze(receipt);
    const uploadDirectory = this.#uploadDirectory(uploadId);
    const manifest = await this.#readManifest(uploadDirectory);
    if (new Date(manifest.expiresAt).getTime() <= this.#now().getTime()) {
      throw new ArtifactStoreError("UPLOAD_EXPIRED", `Upload ${uploadId} has expired.`);
    }
    const lockPath = join(uploadDirectory, ".complete.lock");
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new ArtifactStoreError("UPLOAD_COMPLETION_IN_PROGRESS", `Upload ${uploadId} is already being completed.`);
      }
      throw error;
    }

    const completionDirectory = join(this.#rootDirectory, "staging", "completed");
    const temporary = join(completionDirectory, `${uploadId}-${randomUUID()}.tmp`);
    try {
      await mkdir(completionDirectory, { recursive: true });
      const parts = await this.listParts(uploadId);
      if (parts.length === 0) throw new ArtifactStoreError("UPLOAD_PARTS_MISSING", `Upload ${uploadId} has no parts.`);
      for (let index = 0; index < parts.length; index += 1) {
        if (parts[index].partNumber !== index + 1) {
          throw new ArtifactStoreError("UPLOAD_PARTS_INCOMPLETE", `Upload ${uploadId} has a missing part.`);
        }
      }

      const output = await open(temporary, "wx");
      const digest = createHash("sha256");
      let bytes = 0;
      try {
        for (const part of parts) {
          const stream = createReadStream(join(uploadDirectory, partFileName(part.partNumber)));
          for await (const chunk of stream) {
            digest.update(chunk);
            bytes += chunk.byteLength;
            await output.write(chunk);
          }
        }
        await output.sync();
      } finally {
        await output.close();
      }
      const sha256 = digest.digest("hex");
      if (sha256 !== manifest.expectedSha256 || bytes !== manifest.expectedBytes) {
        const reasonCode = sha256 !== manifest.expectedSha256 && bytes !== manifest.expectedBytes
          ? "SIZE_AND_CHECKSUM_MISMATCH"
          : sha256 !== manifest.expectedSha256 ? "CHECKSUM_MISMATCH" : "SIZE_MISMATCH";
        const quarantineKey = posix.join("quarantine", uploadId, `${sha256}.bin`);
        const quarantinePath = join(this.#rootDirectory, ...quarantineKey.split("/"));
        await mkdir(dirname(quarantinePath), { recursive: true });
        await rename(temporary, quarantinePath);
        const result = Object.freeze({
          status: "QUARANTINED",
          uploadId,
          sha256,
          bytes,
          quarantineKey,
          reasonCode,
        });
        await this.#writeReceipt(uploadId, result);
        await rm(uploadDirectory, { recursive: true, force: true });
        return result;
      }

      const objectKey = contentKey(sha256);
      const target = join(this.#rootDirectory, ...objectKey.split("/"));
      await mkdir(dirname(target), { recursive: true });
      if (await exists(target)) {
        const stored = await inspectRegularFile(target);
        if (stored.sha256 !== sha256 || stored.bytes !== bytes) {
          throw new ArtifactStoreError("ARTIFACT_INTEGRITY_FAILED", `Stored artifact ${sha256} conflicts with the upload.`);
        }
        await unlink(temporary);
      } else {
        await rename(temporary, target);
      }
      const result = Object.freeze({ status: "COMPLETED", uploadId, sha256, bytes, objectKey });
      await this.#writeReceipt(uploadId, result);
      await rm(uploadDirectory, { recursive: true, force: true });
      return result;
    } finally {
      await lock.close();
      await unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  async abortUpload(uploadId) {
    validateUploadId(uploadId);
    if (await exists(this.#receiptPath(uploadId))) {
      throw new ArtifactStoreError("UPLOAD_ALREADY_FINALIZED", `Upload ${uploadId} was already finalized.`);
    }
    const uploadDirectory = this.#uploadDirectory(uploadId);
    if (await exists(join(uploadDirectory, ".complete.lock"))) {
      throw new ArtifactStoreError("UPLOAD_COMPLETION_IN_PROGRESS", `Upload ${uploadId} is being completed.`);
    }
    await rm(uploadDirectory, { recursive: true, force: true });
    return Object.freeze({ uploadId, aborted: true });
  }

  async get(sha256) {
    validateSha256(sha256);
    const path = join(this.#rootDirectory, ...contentKey(sha256).split("/"));
    await assertRegularFile(path);
    return readFile(path);
  }

  async openReadStream(sha256) {
    validateSha256(sha256);
    const path = join(this.#rootDirectory, ...contentKey(sha256).split("/"));
    await assertRegularFile(path);
    return createReadStream(path);
  }

  #uploadDirectory(uploadId) {
    return join(this.#rootDirectory, "staging", "uploads", uploadId);
  }

  #receiptPath(uploadId) {
    return join(this.#rootDirectory, "upload-receipts", `${uploadId}.json`);
  }

  async #readReceipt(uploadId) {
    const path = this.#receiptPath(uploadId);
    if (!await exists(path)) return null;
    await assertRegularFile(path);
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new ArtifactStoreError("UPLOAD_RECEIPT_INVALID", `Upload receipt is invalid: ${error.message}`);
    }
  }

  async #writeReceipt(uploadId, result) {
    const path = this.#receiptPath(uploadId);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, `${JSON.stringify(result)}\n`, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await this.#readReceipt(uploadId);
      if (JSON.stringify(existing) !== JSON.stringify(result)) {
        throw new ArtifactStoreError("UPLOAD_RECEIPT_CONFLICT", `Upload ${uploadId} has a conflicting completion receipt.`);
      }
    }
  }

  #now() {
    const value = new Date(this.#clock());
    if (!Number.isFinite(value.getTime())) throw new ArtifactStoreError("STORE_CLOCK_INVALID", "Store clock returned an invalid date.");
    return value;
  }

  async #readManifest(uploadDirectory) {
    const path = join(uploadDirectory, "manifest.json");
    await assertRegularFile(path);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new ArtifactStoreError("UPLOAD_MANIFEST_INVALID", `Upload manifest is invalid: ${error.message}`);
    }
    return manifest;
  }
}

export class ImmutableReleaseStore {
  #rootDirectory;

  constructor(rootDirectory) {
    this.#rootDirectory = resolveRequiredPath(rootDirectory, "Release store root");
  }

  async stagePublication(publicationId, sourceBundleDirectory) {
    validatePublicationId(publicationId);
    const source = resolveRequiredPath(sourceBundleDirectory, "Source bundle directory");
    const sourceDescriptor = await publicationDescriptor(source);
    const inputsDirectory = join(this.#rootDirectory, ".publication-inputs");
    const locksDirectory = join(this.#rootDirectory, ".publication-locks");
    const target = this.#publicationInputPath(publicationId);
    const temporary = `${target}-${randomUUID()}.tmp`;
    const lockPath = join(locksDirectory, `${publicationId}.lock`);
    await Promise.all([mkdir(inputsDirectory, { recursive: true }), mkdir(locksDirectory, { recursive: true })]);
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new ArtifactStoreError(
          "PUBLICATION_STAGING_IN_PROGRESS",
          `Publication input ${publicationId} is already being staged.`,
        );
      }
      throw error;
    }
    try {
      if (await exists(target)) {
        const existing = await publicationDescriptor(target);
        if (!samePublicationDescriptor(existing, sourceDescriptor)) {
          throw new ArtifactStoreError(
            "PUBLICATION_STAGING_CONFLICT",
            `Publication input ${publicationId} is already sealed with different content.`,
          );
        }
        return existing;
      }
      await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
      const stagedDescriptor = await publicationDescriptor(temporary);
      if (!samePublicationDescriptor(stagedDescriptor, sourceDescriptor)) {
        throw new ArtifactStoreError("PUBLICATION_STAGING_CHANGED", "Publication input changed while it was staged.");
      }
      await rename(temporary, target);
      return stagedDescriptor;
    } finally {
      await lock.close();
      await unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async ensurePublicationStored(publicationId, expectedDescriptor) {
    validatePublicationId(publicationId);
    validateReleaseId(expectedDescriptor?.mapReleaseId);
    if (await this.has(expectedDescriptor.mapReleaseId)) {
      const existing = await this.getPublicationDescriptor(expectedDescriptor.mapReleaseId);
      if (!samePublicationDescriptor(existing, expectedDescriptor)) {
        throw new ArtifactStoreError(
          "PUBLISHED_RELEASE_IDENTITY_CONFLICT",
          `Release ${expectedDescriptor.mapReleaseId} exists with different content.`,
        );
      }
      return existing;
    }
    const staged = await publicationDescriptor(this.#publicationInputPath(publicationId));
    if (!samePublicationDescriptor(staged, expectedDescriptor)) {
      throw new ArtifactStoreError(
        "PUBLICATION_STAGING_IDENTITY_CONFLICT",
        `Publication input ${publicationId} no longer matches its sealed database identity.`,
      );
    }
    await this.publish(this.#publicationInputPath(publicationId));
    const published = await this.getPublicationDescriptor(expectedDescriptor.mapReleaseId);
    if (!samePublicationDescriptor(published, expectedDescriptor)) {
      throw new ArtifactStoreError("PUBLISHED_RELEASE_IDENTITY_CONFLICT", "Published release identity changed.");
    }
    return published;
  }

  async getPublicationDescriptor(mapReleaseId) {
    validateReleaseId(mapReleaseId);
    return publicationDescriptor(join(this.#rootDirectory, "releases", mapReleaseId));
  }

  async discardPublicationInput(publicationId) {
    validatePublicationId(publicationId);
    await rm(this.#publicationInputPath(publicationId), { recursive: true, force: true });
  }

  async publish(sourceBundleDirectory) {
    const source = resolveRequiredPath(sourceBundleDirectory, "Source bundle directory");
    const sourceValidation = await validateBundleDirectory(source);
    if (!sourceValidation.valid) throw new BundleValidationError("Source bundle is invalid.", sourceValidation);

    const mapReleaseId = sourceValidation.summary.mapReleaseId;
    validateReleaseId(mapReleaseId);
    const releasesDirectory = join(this.#rootDirectory, "releases");
    const stagingDirectory = join(this.#rootDirectory, ".staging");
    const locksDirectory = join(this.#rootDirectory, ".locks");
    await Promise.all([
      mkdir(releasesDirectory, { recursive: true }),
      mkdir(stagingDirectory, { recursive: true }),
      mkdir(locksDirectory, { recursive: true }),
    ]);

    const target = join(releasesDirectory, mapReleaseId);
    const staging = join(stagingDirectory, `${mapReleaseId}-${randomUUID()}`);
    const lockPath = join(locksDirectory, `${mapReleaseId}.lock`);
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new ArtifactStoreError("RELEASE_PUBLICATION_IN_PROGRESS", `Publication for ${mapReleaseId} is already in progress.`);
      }
      throw error;
    }

    try {
      if (await exists(target)) {
        throw new ArtifactStoreError("RELEASE_ALREADY_EXISTS", `Release ${mapReleaseId} is immutable and already exists.`);
      }
      await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
      const stagedValidation = await validateBundleDirectory(staging);
      if (!stagedValidation.valid) throw new BundleValidationError("Staged bundle is invalid.", stagedValidation);
      await rename(staging, target);
      return Object.freeze({
        ...stagedValidation.summary,
        releasePath: target,
      });
    } finally {
      await lock.close();
      await unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rm(staging, { recursive: true, force: true });
    }
  }

  async list() {
    const releasesDirectory = join(this.#rootDirectory, "releases");
    let entries;
    try {
      entries = await readdir(releasesDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const manifests = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        manifests.push(await this.getManifest(entry.name));
      } catch (error) {
        throw new ArtifactStoreError("RELEASE_CATALOG_CORRUPT", `Cannot read release ${entry.name}: ${error.message}`);
      }
    }
    return manifests.sort((left, right) => left.familyId.localeCompare(right.familyId) || left.revision - right.revision);
  }

  async getManifest(mapReleaseId) {
    validateReleaseId(mapReleaseId);
    const manifestPath = join(this.#rootDirectory, "releases", mapReleaseId, "manifest.json");
    await assertRegularFile(manifestPath);
    return JSON.parse(await readFile(manifestPath, "utf8"));
  }

  async has(mapReleaseId) {
    validateReleaseId(mapReleaseId);
    return exists(join(this.#rootDirectory, "releases", mapReleaseId, "manifest.json"));
  }

  #publicationInputPath(publicationId) {
    return join(this.#rootDirectory, ".publication-inputs", publicationId);
  }
}

async function publicationDescriptor(bundleDirectory) {
  const validation = await validateBundleDirectory(bundleDirectory);
  if (!validation.valid) throw new BundleValidationError("Publication bundle is invalid.", validation);
  const manifestBytes = await readFile(join(bundleDirectory, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  return Object.freeze({
    bundleId: manifest.bundleId,
    mapReleaseId: manifest.mapReleaseId,
    familyId: manifest.familyId,
    revision: manifest.revision,
    canonicalFrameId: manifest.canonicalFrameId,
    validationReportSha256: manifest.validationReportSha256 ?? null,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    artifacts: Object.freeze(manifest.artifacts.map((artifact) => Object.freeze({
      role: artifact.role,
      artifactSha256: artifact.sha256,
      bundlePath: artifact.path,
      bytes: artifact.bytes,
      mediaType: artifact.mediaType,
    }))),
  });
}

function samePublicationDescriptor(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function contentKey(sha256) {
  validateSha256(sha256);
  return posix.join("objects", "sha256", sha256.slice(0, 2), sha256);
}

function validateSha256(sha256) {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new ArtifactStoreError("ARTIFACT_HASH_INVALID", "Artifact SHA-256 must be 64 lowercase hexadecimal characters.");
  }
}

function validateReleaseId(mapReleaseId) {
  if (!RELEASE_ID_PATTERN.test(mapReleaseId)) {
    throw new ArtifactStoreError("RELEASE_ID_INVALID", "Release ID must use lowercase kebab-case family@revision format.");
  }
}

function validatePublicationId(publicationId) {
  if (typeof publicationId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(publicationId)) {
    throw new ArtifactStoreError("PUBLICATION_ID_INVALID", "Publication ID must use lowercase kebab-case.");
  }
}

function validateUploadId(uploadId) {
  if (typeof uploadId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(uploadId)) {
    throw new ArtifactStoreError("UPLOAD_ID_INVALID", "Upload ID must use lowercase kebab-case.");
  }
}

function positiveSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ArtifactStoreError("UPLOAD_NUMBER_INVALID", `${fieldName} must be a positive safe integer.`);
  }
}

function validIsoDate(value, fieldName) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ArtifactStoreError("UPLOAD_DATE_INVALID", `${fieldName} must be a valid date.`);
  }
  return date.toISOString();
}

function partFileName(partNumber) {
  return `${String(partNumber).padStart(6, "0")}.part`;
}

async function inspectRegularFile(path) {
  const metadata = await assertRegularFile(path);
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return { bytes: metadata.size, sha256: digest.digest("hex") };
}

function resolveRequiredPath(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ArtifactStoreError("STORE_PATH_REQUIRED", `${label} is required.`);
  }
  return resolve(value);
}

async function assertRegularFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ArtifactStoreError("STORE_ENTRY_NOT_REGULAR_FILE", `${path} is not a regular file.`);
  }
  return metadata;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
