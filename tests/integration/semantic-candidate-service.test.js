import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { SemanticCandidateError, SemanticCandidateService } from "@brash-twin/application/semantic-candidates";
import { UploadService } from "@brash-twin/application/uploads";
import { LocalMultipartArtifactStore } from "@brash-twin/artifact-store";
import { InMemoryDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";

test("semantic observations become canonical candidates and immutable operator decisions", async () => {
  const system = await semanticSystem(true);
  const candidateSet = await system.semanticCandidates.create("draft-1", {
    candidateSetId: "candidate-set-1",
    registrationId: "registration-1",
    observationBindingId: "semantic-observations-1",
    operatorId: "semantic-operator",
  });

  assert.equal(candidateSet.report.schemaVersion, "brash.asset-candidate-report/v1");
  assert.equal(candidateSet.report.candidates.length, 2);
  assert.deepEqual(
    candidateSet.report.candidates.find((candidate) => candidate.sourceObservationId === "panel-1").canonicalPosition,
    [8, 21, 1],
  );
  assert.equal(candidateSet.review, null);
  const reportBinding = (await system.draftArtifacts.list("draft-1")).find(
    (binding) => binding.bindingId === candidateSet.reportBindingId,
  );
  assert.equal(reportBinding.role, "ASSET_CANDIDATE_REPORT");
  assert.deepEqual(reportBinding.inputBindings.map((input) => input.bindingId), [
    "semantic-observations-1",
    "registration-acceptance-1",
  ]);

  const review = await system.semanticCandidates.review("draft-1", "candidate-set-1", {
    reviewerId: "factory-operator",
    decisions: candidateSet.report.candidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      decision: index === 0 ? "ACCEPTED" : "REJECTED",
      ...(index === 0 ? {
        displayName: "Main Electrical Panel",
        assetType: "electrical-panel",
        properties: { voltage: 400, critical: true },
      } : {}),
    })),
  });
  assert.equal(review.report.schemaVersion, "brash.asset-candidate-review/v1");
  assert.deepEqual(review.report.summary, { acceptedCount: 1, rejectedCount: 1 });
  assert.equal(review.report.decisions[0].displayName, "Main Electrical Panel");
  assert.deepEqual((await system.semanticCandidates.list("draft-1"))[0].review, review);
});

test("semantic extraction refuses unapproved registration evidence", async () => {
  const system = await semanticSystem(false);
  await assert.rejects(
    () => system.semanticCandidates.create("draft-1", {
      candidateSetId: "candidate-set-1",
      registrationId: "registration-1",
      observationBindingId: "semantic-observations-1",
      operatorId: "semantic-operator",
    }),
    (error) => error instanceof SemanticCandidateError
      && error.code === "SEMANTIC_CANDIDATE_REGISTRATION_REQUIRED",
  );
});

async function semanticSystem(approved) {
  const clock = () => new Date("2026-08-14T17:00:00.000Z");
  const store = new LocalMultipartArtifactStore(await mkdtemp(join(tmpdir(), "brash-semantic-")), { clock });
  const uploads = new UploadService({ repository: new InMemoryUploadRepository(), multipartStore: store, clock });
  const catalog = {
    getMapDraft: async (draftId) => ({ draftId, status: "DRAFT", canonicalFrameId: "plant-floor" }),
    getMapDraftContext: async (draftId) => ({ draft: { draftId, status: "DRAFT", canonicalFrameId: "plant-floor" } }),
  };
  const draftArtifacts = new DraftArtifactService({
    repository: new InMemoryDraftArtifactRepository(),
    catalog,
    uploads,
    clock,
  });
  const source = await upload(uploads, store, "survey-source-upload", Buffer.from("source"), "application/octet-stream");
  await draftArtifacts.bind("draft-1", {
    bindingId: "survey-source-1", uploadId: source.uploadId, role: "SURVEY_SOURCE",
    coordinateFrameId: "slam-map", operatorId: "mapping-operator",
  });
  const registrationReport = await derivedBinding({
    uploads, store, draftArtifacts, uploadId: "registration-report-upload", bindingId: "registration-report-1",
    role: "REGISTRATION_REPORT", content: Buffer.from("registration"), inputBindingIds: ["survey-source-1"],
    coordinateFrameId: null, producerName: "brash-survey-registration",
  });
  const registrationAcceptance = await derivedBinding({
    uploads, store, draftArtifacts, uploadId: "registration-acceptance-upload", bindingId: "registration-acceptance-1",
    role: "REGISTRATION_ACCEPTANCE", content: Buffer.from("acceptance"), inputBindingIds: [registrationReport.bindingId],
    coordinateFrameId: "plant-floor", producerName: "brash-survey-registration-review",
  });
  const model = { name: "fixture-detector", version: "1.0.0", parametersSha256: "f".repeat(64) };
  const observationsContent = Buffer.from(`${JSON.stringify({
    schemaVersion: "brash.semantic-observations/v1",
    observationSetId: "observation-set-1",
    sourceFrameId: "slam-map",
    model,
    observations: [
      observation("panel-1", "electrical-panel", [1, 2, 1], source),
      observation("conveyor-1", "conveyor", [3, 4, 0.8], source),
    ],
  }, null, 2)}\n`);
  const observationUpload = await upload(uploads, store, "semantic-observations-upload", observationsContent, "application/json");
  await draftArtifacts.bind("draft-1", {
    bindingId: "semantic-observations-1",
    uploadId: observationUpload.uploadId,
    role: "SEMANTIC_OBSERVATIONS",
    coordinateFrameId: "slam-map",
    inputBindingIds: ["survey-source-1"],
    producer: model,
    operatorId: "detector-worker",
  });
  const registration = {
    report: {
      registrationId: "registration-1",
      sourcePreview: { frameId: "slam-map" },
      canonicalFrameId: "plant-floor",
      transform: { scale: 1, rotationRadians: Math.PI / 2, translation: { x: 10, y: 20 } },
      quality: { outcome: "PASSED" },
    },
    acceptance: approved ? {
      reportBindingId: registrationAcceptance.bindingId,
      reportSha256: registrationAcceptance.artifactSha256,
      report: { decision: "APPROVED" },
    } : null,
  };
  const semanticCandidates = new SemanticCandidateService({
    catalog,
    registrations: { list: async () => [registration] },
    draftArtifacts,
    uploads,
    multipartStore: store,
    clock,
  });
  return { semanticCandidates, draftArtifacts };
}

function observation(observationId, classId, position, source) {
  return {
    observationId,
    classId,
    confidence: 0.9,
    position,
    dimensions: [1, 0.5, 2],
    evidence: [{ bindingId: "survey-source-1", artifactSha256: source.artifactSha256 }],
  };
}

async function derivedBinding({ uploads, store, draftArtifacts, uploadId, bindingId, role, content, inputBindingIds, coordinateFrameId, producerName }) {
  const uploaded = await upload(uploads, store, uploadId, content, "application/octet-stream");
  return draftArtifacts.bind("draft-1", {
    bindingId,
    uploadId: uploaded.uploadId,
    role,
    coordinateFrameId,
    inputBindingIds,
    producer: { name: producerName, version: "1", parametersSha256: "e".repeat(64) },
    operatorId: "worker-1",
  });
}

async function upload(uploads, store, uploadId, content, mediaType) {
  const expectedSha256 = createHash("sha256").update(content).digest("hex");
  await uploads.initiate({
    uploadId, expectedSha256, expectedBytes: content.byteLength, mediaType,
    originalName: `${uploadId}.bin`, operatorId: "operator-1",
  });
  await store.putPart(uploadId, 1, content);
  return uploads.complete(uploadId, { operatorId: "operator-1" });
}
