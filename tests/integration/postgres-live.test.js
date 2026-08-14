import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OutboxDispatcher, TwinCatalogService } from "@brash-twin/application";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { UploadService } from "@brash-twin/application/uploads";
import { ValidationJobService } from "@brash-twin/application/validation-jobs";
import { PublicationService } from "@brash-twin/application/publications";
import { ImmutableReleaseStore, LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { PostgresMigrationRunner } from "@brash-twin/migrations";
import { PostgresTwinCatalogRepository } from "@brash-twin/persistence";
import { PostgresDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";
import {
  PostgresOutboxRepository,
  PostgresTwinUnitOfWork,
} from "@brash-twin/persistence/outbox";
import { PostgresUploadRepository } from "@brash-twin/persistence/uploads";
import { PostgresValidationJobRepository } from "@brash-twin/persistence/validation-jobs";
import { PostgresPublicationRepository } from "@brash-twin/persistence/publications";
import {
  createPostgresPool,
  createPostgresQueryPort,
  loadPostgresConfig,
} from "@brash-twin/persistence/postgres";
import { createTwinApiSystem } from "../../services/twin-api/bootstrap.js";

const databaseUrl = process.env.TWIN_TEST_DATABASE_URL;
const migrationDirectory = fileURLToPath(new URL("../../storage/migrations", import.meta.url));
const bundleFixture = fileURLToPath(new URL("../fixtures/bundles/demo-plant@1", import.meta.url));

test("real PostgreSQL persists the catalog and survives repository recreation", {
  skip: databaseUrl ? false : "Set TWIN_TEST_DATABASE_URL to run the live PostgreSQL integration test.",
  timeout: 30_000,
}, async () => {
  const schema = `twin_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createPostgresPool(loadPostgresConfig({
    TWIN_DATABASE_URL: databaseUrl,
    TWIN_DATABASE_APPLICATION_NAME: "brash-twin-test-admin",
    TWIN_DATABASE_POOL_MAX: "2",
  }));
  const admin = createPostgresQueryPort(adminPool);
  await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);

  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const pool = createPostgresPool(loadPostgresConfig({
    TWIN_DATABASE_URL: scopedUrl.toString(),
    TWIN_DATABASE_APPLICATION_NAME: "brash-twin-live-integration",
    TWIN_DATABASE_POOL_MAX: "3",
  }));
  const database = createPostgresQueryPort(pool);

  try {
    const firstRunner = new PostgresMigrationRunner({ database, migrationDirectory });
    const secondRunner = new PostgresMigrationRunner({ database, migrationDirectory });
    const beforeMigration = await firstRunner.status();
    assert.equal(beforeMigration.currentVersion, 0);
    assert.equal(beforeMigration.pendingCount, 12);
    const concurrentResults = await Promise.all([firstRunner.migrate(), secondRunner.migrate()]);
    assert.deepEqual(
      concurrentResults.map((result) => result.appliedNow.length).sort((left, right) => left - right),
      [0, 12],
    );
    const migrationStatus = await firstRunner.status();
    assert.equal(migrationStatus.pendingCount, 0);
    assert.deepEqual(
      migrationStatus.entries.map((entry) => entry.state),
      [
        "APPLIED", "APPLIED", "APPLIED", "APPLIED", "APPLIED", "APPLIED",
        "APPLIED", "APPLIED", "APPLIED", "APPLIED", "APPLIED", "APPLIED",
      ],
    );

    const apiReleaseStore = await mkdtemp(join(tmpdir(), "brash-postgres-api-store-"));
    const apiObjectStore = await mkdtemp(join(tmpdir(), "brash-postgres-api-objects-"));
    const system = createTwinApiSystem({
      environment: {
        TWIN_APP_ENV: "test",
        TWIN_PERSISTENCE_MODE: "postgres",
        TWIN_DATABASE_URL: scopedUrl.toString(),
        TWIN_DATABASE_APPLICATION_NAME: "brash-twin-api-live-integration",
        TWIN_RELEASE_STORE_PATH: apiReleaseStore,
        TWIN_OBJECT_STORE_PATH: apiObjectStore,
      },
    });
    try {
      const readiness = await system.api.handle({ method: "GET", url: "/health/ready" });
      assert.equal(readiness.status, 200);
      assert.equal(readiness.body.persistence.mode, "postgres");
      assert.deepEqual(readiness.body.persistence.migrations, {
        ready: true,
        currentVersion: 12,
        latestVersion: 12,
        pendingCount: 0,
      });
    } finally {
      await system.close();
    }

    const health = await database.health();
    assert.equal(health.ready, true);

    const catalogRepository = new PostgresTwinCatalogRepository(database);
    const outboxRepository = new PostgresOutboxRepository(database);
    const unitOfWork = new PostgresTwinUnitOfWork(database);
    let eventSequence = 0;
    const firstService = new TwinCatalogService({
      repository: catalogRepository,
      unitOfWork,
      clock: () => new Date("2026-08-13T15:00:00.000Z"),
      eventIdGenerator: () => `live-event-${++eventSequence}`,
    });
    await firstService.createSite({
      siteId: "live-site",
      displayName: "Live Integration Site",
      timezone: "Europe/Istanbul",
      operatorId: "integration-test",
    });
    await firstService.createBuilding("live-site", {
      buildingId: "main-building",
      displayName: "Main Building",
      operatorId: "integration-test",
    });
    await firstService.createFloor("live-site", "main-building", {
      floorId: "floor-1",
      displayName: "Floor 1",
      operatorId: "integration-test",
    });
    await firstService.createMapFamily({
      familyId: "live-plant",
      floorId: "floor-1",
      displayName: "Live Plant",
      operatorId: "integration-test",
    });
    await firstService.createMapDraft({
      draftId: "live-draft-1",
      familyId: "live-plant",
      revision: 1,
      canonicalFrameId: "live-plant/floor-1",
      operatorId: "integration-test",
    });
    await firstService.submitMapDraftForReview("live-draft-1", "reviewer-1");

    const pendingOutbox = await database.query(
      "SELECT event_id, event_type, delivery_attempts FROM twin_outbox_events ORDER BY event_id",
    );
    assert.deepEqual(pendingOutbox.rows, [
      { event_id: "live-event-1", event_type: "MapDraftCreated.v1", delivery_attempts: 0 },
      { event_id: "live-event-2", event_type: "MapDraftReviewSubmitted.v1", delivery_attempts: 0 },
    ]);
    const publishedEvents = [];
    const dispatcher = new OutboxDispatcher({
      outboxRepository,
      clock: () => new Date("2026-08-13T15:00:30.000Z"),
      publisher: async (event) => publishedEvents.push(event.eventType),
    });
    const dispatchResult = await dispatcher.dispatchBatch({ workerId: "live-dispatcher", batchSize: 10 });
    assert.equal(dispatchResult.claimed, 2);
    assert.deepEqual(publishedEvents, ["MapDraftCreated.v1", "MapDraftReviewSubmitted.v1"]);
    assert.equal((await database.query(
      "SELECT count(*)::integer AS count FROM twin_outbox_events WHERE delivered_at IS NOT NULL",
    )).rows[0].count, 2);

    const liveUploadRoot = await mkdtemp(join(tmpdir(), "brash-postgres-upload-store-"));
    const uploadClock = () => new Date("2026-08-13T15:01:00.000Z");
    const multipartStore = new LocalMultipartArtifactStore(liveUploadRoot, { clock: uploadClock });
    const uploadService = new UploadService({
      repository: new PostgresUploadRepository(database),
      multipartStore,
      clock: uploadClock,
      partSizeBytes: 5,
      maximumParts: 10_000,
    });
    const uploadContent = Buffer.from("live PostgreSQL IFC bytes");
    const uploadSha256 = createHash("sha256").update(uploadContent).digest("hex");
    await uploadService.initiate({
      uploadId: "live-upload-1",
      expectedSha256: uploadSha256,
      expectedBytes: uploadContent.byteLength,
      mediaType: "application/octet-stream",
      originalName: "live.ifc",
      operatorId: "integration-test",
    });
    for (let offset = 0, partNumber = 1; offset < uploadContent.length; offset += 5, partNumber += 1) {
      await multipartStore.putPart("live-upload-1", partNumber, uploadContent.subarray(offset, offset + 5));
    }
    const completedUpload = await uploadService.complete("live-upload-1", { operatorId: "integration-test" });
    assert.equal(completedUpload.status, "COMPLETED");
    assert.equal(completedUpload.artifactSha256, uploadSha256);
    assert.deepEqual((await database.query(
      "SELECT status, artifact_sha256 FROM twin_upload_sessions WHERE upload_id = $1",
      ["live-upload-1"],
    )).rows, [{ status: "COMPLETED", artifact_sha256: uploadSha256 }]);
    assert.equal((await database.query(
      "SELECT count(*)::integer AS count FROM twin_artifacts WHERE sha256 = $1",
      [uploadSha256],
    )).rows[0].count, 1);

    await firstService.createMapDraft({
      draftId: "live-draft-2",
      familyId: "live-plant",
      revision: 2,
      canonicalFrameId: "live-plant/floor-1",
      operatorId: "integration-test",
    });
    await assert.rejects(
      () => database.query(
        `INSERT INTO twin_draft_artifacts
         (binding_id, draft_id, upload_id, artifact_sha256, role, artifact_kind,
          input_count, coordinate_frame_id, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          "invalid-spatial-binding",
          "live-draft-2",
          "live-upload-1",
          uploadSha256,
          "BIM_SOURCE",
          "SOURCE",
          0,
          null,
          "integration-test",
          "2026-08-13T15:02:00.000Z",
        ],
      ),
      (error) => error?.code === "23514",
    );
    const draftArtifactService = new DraftArtifactService({
      repository: new PostgresDraftArtifactRepository(database),
      catalog: firstService,
      uploads: uploadService,
      clock: () => new Date("2026-08-13T15:02:00.000Z"),
      bindingIdGenerator: () => "live-source-binding-1",
    });
    const sourceBinding = await draftArtifactService.bind("live-draft-2", {
      uploadId: "live-upload-1",
      role: "BIM_SOURCE",
      coordinateFrameId: "live-plant/floor-1",
      operatorId: "integration-test",
    });
    assert.equal(sourceBinding.artifactSha256, uploadSha256);
    const reportContent = Buffer.from('{"status":"imported"}');
    const reportSha256 = createHash("sha256").update(reportContent).digest("hex");
    await uploadService.initiate({
      uploadId: "live-upload-report-1",
      expectedSha256: reportSha256,
      expectedBytes: reportContent.byteLength,
      mediaType: "application/json",
      originalName: "import-report.json",
      operatorId: "integration-test",
    });
    for (let offset = 0, partNumber = 1; offset < reportContent.length; offset += 5, partNumber += 1) {
      await multipartStore.putPart(
        "live-upload-report-1",
        partNumber,
        reportContent.subarray(offset, offset + 5),
      );
    }
    await uploadService.complete("live-upload-report-1", { operatorId: "integration-test" });
    const derivedBinding = await draftArtifactService.bind("live-draft-2", {
      bindingId: "live-import-report-1",
      uploadId: "live-upload-report-1",
      role: "IMPORT_REPORT",
      inputBindingIds: ["live-source-binding-1"],
      producer: {
        name: "brash-ifc-importer",
        version: "0.1.0",
        parametersSha256: "c".repeat(64),
      },
      operatorId: "integration-test",
    });
    assert.deepEqual(derivedBinding.inputBindings, [{
      bindingId: "live-source-binding-1",
      artifactSha256: uploadSha256,
    }]);
    assert.deepEqual((await draftArtifactService.list("live-draft-2")).map((binding) => binding.bindingId), [
      "live-import-report-1",
      "live-source-binding-1",
    ]);
    await assert.rejects(
      () => database.query(
        "UPDATE twin_draft_artifacts SET role = 'FLOORPLAN_SOURCE' WHERE binding_id = $1",
        ["live-source-binding-1"],
      ),
      (error) => error?.code === "55000",
    );

    await firstService.submitMapDraftForReview("live-draft-2", "reviewer-1");
    const validationJobs = new ValidationJobService({
      repository: new PostgresValidationJobRepository(database),
      catalog: firstService,
      draftArtifacts: draftArtifactService,
      uploads: uploadService,
      multipartStore,
      clock: () => new Date("2026-08-13T15:03:00.000Z"),
    });
    const createdValidationJob = await validationJobs.create("live-draft-2", {
      jobId: "live-validation-job-1",
      operatorId: "reviewer-1",
    });
    assert.equal(createdValidationJob.status, "PENDING");
    const completedValidationJob = await validationJobs.run("live-validation-job-1", {
      operatorId: "reviewer-1",
    });
    assert.equal(completedValidationJob.status, "SUCCEEDED");
    assert.equal(completedValidationJob.output.outcome, "PASSED");
    assert.equal((await firstService.getMapDraft("live-draft-2")).status, "VALIDATED");
    const validationRun = (await database.query(
      `SELECT outcome, report_binding_id, report_sha256, error_count
       FROM twin_validation_runs WHERE job_id = $1`,
      ["live-validation-job-1"],
    )).rows[0];
    assert.deepEqual(validationRun, {
      outcome: "PASSED",
      report_binding_id: "validation-report-live-validation-job-1",
      report_sha256: completedValidationJob.output.reportSha256,
      error_count: 0,
    });
    assert.equal((await database.query(
      `SELECT count(*)::integer AS count
       FROM twin_draft_artifacts
       WHERE draft_id = $1 AND role = 'VALIDATION_REPORT'`,
      ["live-draft-2"],
    )).rows[0].count, 1);
    await assert.rejects(
      () => database.query(
        "DELETE FROM twin_validation_runs WHERE job_id = $1",
        ["live-validation-job-1"],
      ),
      (error) => error?.code === "55000",
    );

    const publicationBundleDirectory = await createPublicationBundle(
      bundleFixture,
      completedValidationJob.output.reportSha256,
    );
    const publicationManifest = JSON.parse(await readFile(
      join(publicationBundleDirectory, "manifest.json"),
      "utf8",
    ));
    for (const artifact of publicationManifest.artifacts) {
      await database.query(
        `INSERT INTO twin_artifacts
         (sha256, bytes, object_key, media_type, original_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (sha256) DO NOTHING`,
        [
          artifact.sha256,
          artifact.bytes,
          `test-publication/${artifact.sha256}`,
          artifact.mediaType,
          artifact.path,
          "2026-08-13T15:04:00.000Z",
        ],
      );
    }
    const publicationReleaseStore = new ImmutableReleaseStore(
      await mkdtemp(join(tmpdir(), "brash-postgres-publication-store-")),
    );
    const publications = new PublicationService({
      repository: new PostgresPublicationRepository(database),
      catalog: firstService,
      releaseStore: publicationReleaseStore,
      clock: () => new Date("2026-08-13T15:04:00.000Z"),
      eventIdGenerator: () => "live-release-event-1",
    });
    assert.equal((await publications.request("live-draft-2", {
      publicationId: "live-publication-1",
      sourceBundleDirectory: publicationBundleDirectory,
      requestedBy: "publisher-1",
    })).status, "PENDING_APPROVAL");
    assert.equal((await publications.approve("live-publication-1", {
      approvedBy: "approver-2",
    })).status, "APPROVED");
    assert.deepEqual(
      (await publications.get("live-publication-1")).bundle,
      await publicationReleaseStore.stagePublication("live-publication-1", publicationBundleDirectory),
    );
    const publicationResult = await publications.execute("live-publication-1", {
      workerId: "publication-worker-1",
    });
    assert.equal(publicationResult.publication.status, "COMPLETED");
    assert.equal(publicationResult.release.releaseId, "live-plant@2");
    assert.equal((await firstService.getMapDraft("live-draft-2")).status, "PUBLISHED");
    assert.equal(await publicationReleaseStore.has("live-plant@2"), true);
    assert.deepEqual((await database.query(
      `SELECT request.status, approval.approved_by
       FROM twin_publication_requests AS request
       JOIN twin_publication_approvals AS approval USING (publication_id)
       WHERE request.publication_id = $1`,
      ["live-publication-1"],
    )).rows, [{ status: "COMPLETED", approved_by: "approver-2" }]);
    assert.equal((await database.query(
      "SELECT count(*)::integer AS count FROM twin_release_artifacts WHERE release_id = $1",
      ["live-plant@2"],
    )).rows[0].count, publicationManifest.artifacts.length);
    assert.deepEqual((await database.query(
      "SELECT event_type FROM twin_outbox_events WHERE event_id = $1",
      ["live-release-event-1"],
    )).rows, [{ event_type: "MapReleasePublished.v1" }]);
    await assert.rejects(
      () => database.query(
        "DELETE FROM twin_publication_approvals WHERE publication_id = $1",
        ["live-publication-1"],
      ),
      (error) => error?.code === "55000",
    );

    const recreatedService = new TwinCatalogService({
      repository: new PostgresTwinCatalogRepository(database),
      unitOfWork: new PostgresTwinUnitOfWork(database),
      clock: () => new Date("2026-08-13T15:01:00.000Z"),
    });
    const restored = await recreatedService.getMapDraft("live-draft-1");
    assert.equal(restored.status, "IN_REVIEW");
    assert.equal(restored.rowVersion, 2);

    const rows = await database.query("SELECT site_id, timezone FROM twin_sites WHERE site_id = $1", ["live-site"]);
    assert.deepEqual(rows.rows, [{ site_id: "live-site", timezone: "Europe/Istanbul" }]);
  } finally {
    await database.close();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
    await admin.close();
  }
});

function quoteIdentifier(identifier) {
  if (!/^twin_test_[a-f0-9]{32}$/.test(identifier)) throw new Error("Unsafe test schema identifier.");
  return `"${identifier}"`;
}

async function createPublicationBundle(source, validationReportSha256) {
  const target = await mkdtemp(join(tmpdir(), "brash-postgres-publication-source-"));
  await cp(source, target, { recursive: true });
  const replacements = [
    ["demo-plant@1", "live-plant@2"],
    ["demo-plant/floor-1", "live-plant/floor-1"],
  ];
  for (const path of [
    "coordinate-frames.json",
    "topology.json",
    "assets.json",
    "zones.geojson",
    "scene/manifest.json",
  ]) {
    let content = await readFile(join(target, path), "utf8");
    for (const [from, to] of replacements) content = content.replaceAll(from, to);
    await writeFile(join(target, path), content);
  }
  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.bundleId = "bundle-live-plant-2";
  manifest.mapReleaseId = "live-plant@2";
  manifest.familyId = "live-plant";
  manifest.revision = 2;
  manifest.canonicalFrameId = "live-plant/floor-1";
  manifest.validationReportSha256 = validationReportSha256;
  for (const artifact of manifest.artifacts) {
    const content = await readFile(join(target, artifact.path));
    artifact.sha256 = createHash("sha256").update(content).digest("hex");
    artifact.bytes = content.byteLength;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}
