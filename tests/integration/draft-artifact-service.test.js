import assert from "node:assert/strict";
import test from "node:test";
import { DraftArtifactError, DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { InMemoryDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";

test("draft artifact service resolves input hashes server-side into an append-only derivation chain", async () => {
  const repository = new InMemoryDraftArtifactRepository();
  const service = serviceFor(repository);
  const source = await service.bind("draft-1", {
    bindingId: "source-ifc-1",
    uploadId: "upload-source",
    role: "BIM_SOURCE",
    coordinateFrameId: "plant/floor-1",
    operatorId: "engineer-1",
  });
  const derived = await service.bind("draft-1", {
    bindingId: "import-report-1",
    uploadId: "upload-derived",
    role: "IMPORT_REPORT",
    inputBindingIds: [source.bindingId],
    producer: {
      name: "ifc-importer",
      version: "0.1.0",
      parametersSha256: "c".repeat(64),
    },
    operatorId: "pipeline-1",
  });

  assert.deepEqual(derived.inputBindings, [{
    bindingId: "source-ifc-1",
    artifactSha256: "a".repeat(64),
  }]);
  assert.deepEqual((await service.list("draft-1")).map((binding) => binding.bindingId), [
    "import-report-1",
    "source-ifc-1",
  ]);
});

test("draft artifact service blocks incomplete uploads, locked drafts, and cross-draft inputs", async () => {
  const repository = new InMemoryDraftArtifactRepository();
  const service = serviceFor(repository);
  await assert.rejects(
    () => service.bind("draft-1", {
      uploadId: "upload-open",
      role: "BIM_SOURCE",
      coordinateFrameId: "plant/floor-1",
      operatorId: "engineer-1",
    }),
    (error) => error instanceof DraftArtifactError && error.code === "DRAFT_ARTIFACT_UPLOAD_INCOMPLETE",
  );

  const locked = serviceFor(repository, { status: "IN_REVIEW" });
  await assert.rejects(
    () => locked.bind("draft-1", {
      uploadId: "upload-source",
      role: "BIM_SOURCE",
      coordinateFrameId: "plant/floor-1",
      operatorId: "engineer-1",
    }),
    (error) => error instanceof DraftArtifactError && error.code === "DRAFT_ARTIFACT_DRAFT_LOCKED",
  );

  await assert.rejects(
    () => service.bind("draft-1", {
      uploadId: "upload-derived",
      role: "IMPORT_REPORT",
      inputBindingIds: ["missing-input"],
      producer: { name: "importer", version: "1", parametersSha256: "c".repeat(64) },
      operatorId: "pipeline-1",
    }),
    (error) => error instanceof DraftArtifactError && error.code === "DRAFT_ARTIFACT_INPUT_NOT_FOUND",
  );
});

function serviceFor(repository, draftOverrides = {}) {
  return new DraftArtifactService({
    repository,
    catalog: {
      async getMapDraft(draftId) {
        return { draftId, status: "DRAFT", ...draftOverrides };
      },
    },
    uploads: {
      async get(uploadId) {
        const records = {
          "upload-source": { uploadId, status: "COMPLETED", artifactSha256: "a".repeat(64) },
          "upload-derived": { uploadId, status: "COMPLETED", artifactSha256: "b".repeat(64) },
          "upload-open": { uploadId, status: "UPLOADING", artifactSha256: null },
        };
        return records[uploadId];
      },
    },
    clock: () => new Date("2026-08-13T18:00:00.000Z"),
    bindingIdGenerator: () => "generated-binding-1",
  });
}
