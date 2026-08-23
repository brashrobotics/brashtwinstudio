#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { loadDatasetSelection, verifyDatasetSelection } from "@brash-twin/importers";

const executeFile = promisify(execFile);
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolDirectory, "../..");
const baseUrl = (process.env.TWIN_API_BASE_URL ?? "http://127.0.0.1:4380").replace(/\/$/, "");
const objectStorePath = resolve(process.env.TWIN_OBJECT_STORE_PATH ?? ".local/object-store");
const datasetDirectory = resolve(process.env.TWIN_GRANDTOUR_DIR ?? ".local/datasets/grandtour-eth2");
const selectionPath = resolve(process.env.TWIN_GRANDTOUR_SELECTION
  ?? "tests/fixtures/datasets/grandtour-eth2.selection.json");
const pythonExecutable = resolve(process.env.TWIN_GRANDTOUR_PYTHON ?? ".local/venv-ifc/bin/python");
const exporterPath = resolve(repositoryRoot, "workers/fusion-worker/grandtour_survey_exporter.py");
const store = new LocalMultipartArtifactStore(objectStorePath);
const operatorId = "grandtour-importer";

class ApiRequestError extends Error {
  constructor(method, path, code, detail) {
    super(`${method} ${path} failed: ${code} ${detail}`.trim());
    this.name = "ApiRequestError";
    this.code = code;
  }
}

await main().catch((error) => {
  if (error instanceof ApiRequestError && ["UPLOAD_ALREADY_FINALIZED", "UPLOAD_ALREADY_EXISTS"].includes(error.code)) {
    console.error(`${error.message}\nThe seed and API must use the same TWIN_OBJECT_STORE_PATH and persistent catalog.`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});

async function main() {
  await request("GET", "/health/ready");
  const selection = await loadDatasetSelection(selectionPath);
  const verification = await verifyDatasetSelection(selection, datasetDirectory);
  if (!verification.valid) {
    throw new Error(`GrandTour selection verification failed:\n${JSON.stringify(verification.errors, null, 2)}`);
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "brash-grandtour-seed-"));
  try {
    const exported = await exportSurvey(join(temporaryRoot, "export"));
    await createCatalog();

    const artifactUploads = [];
    for (const artifact of exported.artifacts) {
      const uploadId = `eth2-${artifact.artifactId}`;
      await uploadFile(uploadId, artifact);
      artifactUploads.push({ artifactId: artifact.artifactId, uploadId });
    }

    const manifestContent = Buffer.from(`${JSON.stringify(buildManifest(exported))}\n`);
    await uploadBuffer("eth2-survey-manifest", manifestContent, "application/json", "manifest.json");

    const existingIntake = await getIfPresent(
      "/api/v1/survey-intakes/grandtour-eth2-intake",
      "SURVEY_INTAKE_NOT_FOUND",
    );
    if (!existingIntake) {
      await request("POST", "/api/v1/map-drafts/grandtour-eth2-draft/survey-intakes", {
        intakeId: "grandtour-eth2-intake",
        manifestUploadId: "eth2-survey-manifest",
        artifactUploads,
        operatorId,
      });
    }
    const verificationResult = await request(
      "POST",
      "/api/v1/survey-intakes/grandtour-eth2-intake/verify",
      { operatorId },
    );
    if (verificationResult.intake.status !== "ACCEPTED") {
      throw new Error(`GrandTour survey intake was ${verificationResult.intake.status}.`);
    }

    const existingMaterialization = await getIfPresent(
      "/api/v1/survey-materializations/grandtour-eth2-materialization",
      "SURVEY_MATERIALIZATION_NOT_FOUND",
    );
    if (!existingMaterialization) {
      await request("POST", "/api/v1/survey-intakes/grandtour-eth2-intake/materializations", {
        jobId: "grandtour-eth2-materialization",
        operatorId,
      });
    }
    const materialization = await request(
      "POST",
      "/api/v1/survey-materializations/grandtour-eth2-materialization/run",
      { workerId: "grandtour-materializer", operatorId },
    );
    const qualityReviews = await request(
      "GET",
      "/api/v1/map-drafts/grandtour-eth2-draft/survey-quality-reviews",
    );
    if (!qualityReviews.qualityReviews.some(
      ({ report }) => report.qualityReviewId === "grandtour-eth2-quality",
    )) {
      await request("POST", "/api/v1/map-drafts/grandtour-eth2-draft/survey-quality-reviews", {
        qualityReviewId: "grandtour-eth2-quality",
        materializationJobId: "grandtour-eth2-materialization",
        operatorId,
      });
    }

    console.log(JSON.stringify({
      datasetId: exported.datasetId,
      revision: exported.revision,
      siteId: "grandtour-eth-site",
      floorId: "eth-mainbuilding-floor",
      familyId: "grandtour-mission-2-map",
      draftId: "grandtour-eth2-draft",
      materializationJobId: materialization.job.jobId,
      previewBindingId: materialization.job.output.previewBindingId,
      qualityReviewId: "grandtour-eth2-quality",
      sensorVisibilityEligible: false,
      sensorVisibilityReason: "The pinned subset has no calibrated sensor model or synchronized raw sensor observations, so it cannot produce calibrated MISSING evidence.",
      summary: exported.summary,
      studioUrl: "http://127.0.0.1:4390/",
    }, null, 2));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function exportSurvey(outputDirectory) {
  const { stdout } = await executeFile(pythonExecutable, [
    exporterPath,
    selectionPath,
    datasetDirectory,
    outputDirectory,
  ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function createCatalog() {
  await createOrReuse("/api/v1/sites", {
    siteId: "grandtour-eth-site",
    displayName: "GrandTour ETH Mainbuilding",
    timezone: "Europe/Zurich",
    operatorId,
  });
  await createOrReuse("/api/v1/sites/grandtour-eth-site/buildings", {
    buildingId: "eth-mainbuilding",
    displayName: "ETH Mainbuilding",
    operatorId,
  });
  await createOrReuse("/api/v1/sites/grandtour-eth-site/buildings/eth-mainbuilding/floors", {
    floorId: "eth-mainbuilding-floor",
    displayName: "ETH Mainbuilding Survey Level",
    elevationMeters: 0,
    operatorId,
  });
  await createOrReuse("/api/v1/map-families", {
    familyId: "grandtour-mission-2-map",
    floorId: "eth-mainbuilding-floor",
    displayName: "GrandTour Mission 2 Survey",
    operatorId,
  });
  await createOrReuse("/api/v1/map-drafts", {
    draftId: "grandtour-eth2-draft",
    familyId: "grandtour-mission-2-map",
    revision: 1,
    canonicalFrameId: "eth-mainbuilding-world",
    operatorId,
  });
}

function buildManifest(exported) {
  return {
    schemaVersion: "brash.embodied-survey-package/v1",
    packageId: "grandtour-eth2-package",
    surveyId: "grandtour-eth2-mission",
    siteId: "grandtour-eth-site",
    floorId: "eth-mainbuilding-floor",
    robotId: "grandtour-anymal-d",
    completionStatus: "COMPLETE",
    producer: {
      interface: "brash-embodied-controller",
      product: "brash-grandtour-transfer-adapter",
      version: "1.0.0",
      buildSha256: sha256(Buffer.from(exported.schemaVersion)),
      configurationSha256: sha256(Buffer.from(exported.revision)),
      algorithm: { name: "grandtour-dlio-transfer", version: "1.0.0" },
    },
    capture: exported.capture,
    clock: {
      timeBase: "UTC",
      source: "grandtour-processed-dlio-timebase",
      synchronized: true,
      maximumOffsetMilliseconds: 0,
    },
    coordinateSystem: {
      rootFrameId: exported.frameId,
      robotBaseFrameId: exported.frameId,
      lengthUnit: "METRE",
      handedness: "RIGHT_HANDED",
      upAxis: "Z",
    },
    quality: exported.quality,
    artifacts: exported.artifacts.map(({ localPath, ...artifact }) => ({
      ...artifact,
      ...(artifact.role === "TRAJECTORY" ? { timeRange: exported.capture } : {}),
    })),
  };
}

async function uploadFile(uploadId, artifact) {
  const existing = await getIfPresent(`/api/v1/uploads/${uploadId}`, "UPLOAD_NOT_FOUND");
  if (existing) {
    assertCompletedUpload(existing.session, artifact);
    return;
  }
  const initiated = await request("POST", "/api/v1/uploads", {
    uploadId,
    expectedSha256: artifact.sha256,
    expectedBytes: artifact.bytes,
    mediaType: artifact.mediaType,
    originalName: basename(artifact.path),
    operatorId,
  });
  const handle = await open(artifact.localPath, "r");
  try {
    let offset = 0;
    let partNumber = 1;
    while (offset < artifact.bytes) {
      const size = Math.min(initiated.upload.partSizeBytes, artifact.bytes - offset);
      const buffer = Buffer.allocUnsafe(size);
      const { bytesRead } = await handle.read(buffer, 0, size, offset);
      if (bytesRead !== size) throw new Error(`Unexpected end of ${artifact.localPath}.`);
      await store.putPart(uploadId, partNumber, buffer);
      offset += bytesRead;
      partNumber += 1;
    }
  } finally {
    await handle.close();
  }
  await request("POST", `/api/v1/uploads/${uploadId}/complete`, { operatorId });
}

async function uploadBuffer(uploadId, content, mediaType, originalName) {
  const artifact = { sha256: sha256(content), bytes: content.byteLength, mediaType };
  const existing = await getIfPresent(`/api/v1/uploads/${uploadId}`, "UPLOAD_NOT_FOUND");
  if (existing) {
    assertCompletedUpload(existing.session, artifact);
    return;
  }
  const initiated = await request("POST", "/api/v1/uploads", {
    uploadId,
    expectedSha256: artifact.sha256,
    expectedBytes: artifact.bytes,
    mediaType,
    originalName,
    operatorId,
  });
  for (let offset = 0, partNumber = 1;
    offset < content.byteLength;
    offset += initiated.upload.partSizeBytes, partNumber += 1) {
    await store.putPart(uploadId, partNumber, content.subarray(offset, offset + initiated.upload.partSizeBytes));
  }
  await request("POST", `/api/v1/uploads/${uploadId}/complete`, { operatorId });
}

function assertCompletedUpload(session, artifact) {
  if (session.status !== "COMPLETED"
    || session.expectedSha256 !== artifact.sha256
    || session.expectedBytes !== artifact.bytes
    || session.mediaType !== artifact.mediaType) {
    throw new Error(`Existing upload ${session.uploadId} does not match the pinned GrandTour artifact.`);
  }
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(method, path, payload.error?.code ?? String(response.status), payload.error?.message ?? "");
  }
  return payload;
}

async function createOrReuse(path, body) {
  try {
    return await request("POST", path, body);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.code !== "CATALOG_CONFLICT") throw error;
    return null;
  }
}

async function getIfPresent(path, notFoundCode) {
  try {
    return await request("GET", path);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.code !== notFoundCode) throw error;
    return null;
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
