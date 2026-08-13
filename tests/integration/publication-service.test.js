import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TwinCatalogService } from "@brash-twin/application";
import { PublicationError, PublicationService } from "@brash-twin/application/publications";
import { ImmutableReleaseStore } from "@brash-twin/artifact-store";
import { InMemoryTwinCatalogRepository } from "@brash-twin/persistence";
import {
  InMemoryOutboxRepository,
  InMemoryTwinUnitOfWork,
} from "@brash-twin/persistence/outbox";
import { InMemoryPublicationRepository } from "@brash-twin/persistence/publications";

const fixture = fileURLToPath(new URL("../fixtures/bundles/demo-plant@1", import.meta.url));

test("publication reconciles both store-marker and final DB commit interruptions", async () => {
  let now = new Date("2026-08-13T22:00:00.000Z");
  const catalogRepository = new InMemoryTwinCatalogRepository();
  const outboxRepository = new InMemoryOutboxRepository();
  const catalog = new TwinCatalogService({
    repository: catalogRepository,
    unitOfWork: new InMemoryTwinUnitOfWork({ catalogRepository, outboxRepository }),
    clock: () => now,
    eventIdGenerator: sequence("draft-event"),
  });
  await createValidatedDraft(catalog);
  const repository = new InMemoryPublicationRepository({ catalogRepository, outboxRepository });
  let failStoreMarker = true;
  let failFinalization = true;
  const faultInjectedRepository = bindRepository(repository);
  faultInjectedRepository.markStorePublished = async (...parameters) => {
    if (failStoreMarker) {
      failStoreMarker = false;
      throw new Error("simulated database outage before store marker");
    }
    return repository.markStorePublished(...parameters);
  };
  faultInjectedRepository.finalize = async (...parameters) => {
    if (failFinalization) {
      failFinalization = false;
      throw new Error("simulated database outage after release-store publication");
    }
    return repository.finalize(...parameters);
  };
  const releaseStore = new ImmutableReleaseStore(await mkdtemp(join(tmpdir(), "brash-publication-release-")));
  const service = new PublicationService({
    repository: faultInjectedRepository,
    catalog,
    releaseStore,
    clock: () => now,
    eventIdGenerator: () => "release-event-1",
  });
  const source = await publicationBundle("b".repeat(64));

  const requested = await service.request("draft-1", {
    publicationId: "publication-1",
    sourceBundleDirectory: source,
    requestedBy: "engineer-1",
  });
  assert.equal(requested.status, "PENDING_APPROVAL");
  await assert.rejects(
    () => service.approve("publication-1", { approvedBy: "engineer-1" }),
    (error) => error instanceof PublicationError && error.code === "PUBLICATION_TWO_PERSON_REQUIRED",
  );
  now = new Date("2026-08-13T22:01:00.000Z");
  assert.equal((await service.approve("publication-1", { approvedBy: "approver-1" })).status, "APPROVED");

  now = new Date("2026-08-13T22:02:00.000Z");
  await assert.rejects(
    () => service.execute("publication-1", { workerId: "publisher-1" }),
    /simulated database outage before store marker/,
  );
  assert.equal(await releaseStore.has("demo-plant@1"), true);
  assert.equal((await repository.get("publication-1")).status, "PUBLISHING");
  assert.equal((await catalog.getMapDraft("draft-1")).status, "VALIDATED");

  now = new Date("2026-08-13T22:02:06.000Z");
  const firstRecovery = await service.recover({ workerId: "reconciler-1" });
  assert.deepEqual(firstRecovery, {
    attempted: 1,
    results: [{ publicationId: "publication-1", status: "FAILED_ATTEMPT", errorCode: "PUBLICATION_FAILED" }],
  });
  assert.equal((await repository.get("publication-1")).status, "STORE_PUBLISHED");
  assert.equal((await catalog.getMapDraft("draft-1")).status, "VALIDATED");

  now = new Date("2026-08-13T22:02:17.000Z");
  const secondRecovery = await service.recover({ workerId: "reconciler-2" });
  assert.deepEqual(secondRecovery, {
    attempted: 1,
    results: [{ publicationId: "publication-1", status: "COMPLETED" }],
  });
  assert.equal((await catalog.getMapDraft("draft-1")).status, "PUBLISHED");
  assert.equal((await repository.getRelease("demo-plant@1")).publishedBy, "approver-1");
  assert.deepEqual(
    (await outboxRepository.list()).map((event) => event.eventType),
    ["MapDraftCreated.v1", "MapDraftReviewSubmitted.v1", "MapDraftValidated.v1", "MapReleasePublished.v1"],
  );
});

async function createValidatedDraft(catalog) {
  await catalog.createSite({ siteId: "site-1", displayName: "Site", timezone: "UTC", operatorId: "engineer-1" });
  await catalog.createBuilding("site-1", { buildingId: "building-1", displayName: "Building", operatorId: "engineer-1" });
  await catalog.createFloor("site-1", "building-1", { floorId: "floor-1", displayName: "Floor", operatorId: "engineer-1" });
  await catalog.createMapFamily({ familyId: "demo-plant", floorId: "floor-1", displayName: "Plant", operatorId: "engineer-1" });
  await catalog.createMapDraft({
    draftId: "draft-1",
    familyId: "demo-plant",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    operatorId: "engineer-1",
  });
  await catalog.submitMapDraftForReview("draft-1", "engineer-2");
  await catalog.validateMapDraft("draft-1", "b".repeat(64), "validator-1");
}

async function publicationBundle(validationReportSha256) {
  const source = await mkdtemp(join(tmpdir(), "brash-publication-source-"));
  await cp(fixture, source, { recursive: true });
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  manifest.validationReportSha256 = validationReportSha256;
  await writeFile(join(source, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return source;
}

function bindRepository(repository) {
  return Object.fromEntries([
    "create",
    "get",
    "list",
    "approve",
    "claim",
    "markStorePublished",
    "recordFailure",
    "finalize",
    "listRecoverable",
  ].map((operation) => [operation, repository[operation].bind(repository)]));
}

function sequence(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}
