import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_ARTIFACT_KIND,
  DRAFT_ARTIFACT_ROLE,
  TwinDomainError,
  createDraftArtifactBindingRecord,
} from "@brash-twin/domain";

test("source artifact binding preserves verified content identity and coordinate frame", () => {
  const binding = createDraftArtifactBindingRecord({
    bindingId: "source-ifc-1",
    draftId: "draft-1",
    uploadId: "upload-1",
    artifactSha256: "a".repeat(64),
    role: DRAFT_ARTIFACT_ROLE.bimSource,
    coordinateFrameId: "plant/floor-1",
    operatorId: "engineer-1",
    occurredAt: "2026-08-13T18:00:00.000Z",
  });

  assert.equal(binding.kind, DRAFT_ARTIFACT_KIND.source);
  assert.equal(binding.artifactSha256, "a".repeat(64));
  assert.deepEqual(binding.inputBindings, []);
  assert.equal(binding.producer, null);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.inputBindings), true);
});

test("derived artifact binding requires immutable inputs and reproducible producer provenance", () => {
  const binding = createDraftArtifactBindingRecord({
    bindingId: "registered-cloud-1",
    draftId: "draft-1",
    uploadId: "upload-2",
    artifactSha256: "b".repeat(64),
    role: DRAFT_ARTIFACT_ROLE.registeredPointCloud,
    coordinateFrameId: "plant/floor-1",
    inputBindings: [{ bindingId: "source-ifc-1", artifactSha256: "a".repeat(64) }],
    producer: {
      name: "brash-registration",
      version: "0.1.0",
      parametersSha256: "c".repeat(64),
    },
    operatorId: "pipeline-1",
  });

  assert.equal(binding.kind, DRAFT_ARTIFACT_KIND.derived);
  assert.deepEqual(binding.inputBindings, [{
    bindingId: "source-ifc-1",
    artifactSha256: "a".repeat(64),
  }]);
  assert.equal(binding.producer.name, "brash-registration");
  assert.equal(Object.isFrozen(binding.inputBindings[0]), true);
  assert.equal(Object.isFrozen(binding.producer), true);
});

test("artifact provenance rejects incomplete or ambiguous lineage", () => {
  assert.throws(
    () => record({ role: DRAFT_ARTIFACT_ROLE.pointCloudSource, coordinateFrameId: null }),
    (error) => error instanceof TwinDomainError && error.code === "IDENTIFIER_REQUIRED",
  );
  assert.throws(
    () => record({
      role: DRAFT_ARTIFACT_ROLE.importReport,
      inputBindings: [],
      producer: { name: "importer", version: "1", parametersSha256: "c".repeat(64) },
    }),
    (error) => error instanceof TwinDomainError && error.code === "DRAFT_ARTIFACT_INPUTS_REQUIRED",
  );
  assert.throws(
    () => record({
      role: DRAFT_ARTIFACT_ROLE.bimSource,
      producer: { name: "importer", version: "1", parametersSha256: "c".repeat(64) },
    }),
    (error) => error instanceof TwinDomainError && error.code === "DRAFT_ARTIFACT_PROVENANCE_INVALID",
  );
  assert.throws(
    () => record({
      role: DRAFT_ARTIFACT_ROLE.importReport,
      inputBindings: [{ bindingId: "input-1", artifactSha256: "d".repeat(64) }],
      producer: {
        name: "importer",
        version: "1",
        parametersSha256: "c".repeat(64),
        mutableConfiguration: true,
      },
    }),
    (error) => error instanceof TwinDomainError && error.code === "DRAFT_ARTIFACT_PRODUCER_INVALID",
  );
});

function record(overrides) {
  return createDraftArtifactBindingRecord({
    bindingId: "binding-1",
    draftId: "draft-1",
    uploadId: "upload-1",
    artifactSha256: "a".repeat(64),
    role: DRAFT_ARTIFACT_ROLE.bimSource,
    coordinateFrameId: "plant/floor-1",
    operatorId: "engineer-1",
    ...overrides,
  });
}
