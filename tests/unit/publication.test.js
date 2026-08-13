import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_RELEASE_EVENT_TYPE,
  TwinDomainError,
  approvePublicationRequestRecord,
  createMapReleasePublishedEvent,
  createPublicationRequestRecord,
  publishMapDraftRecord,
} from "@brash-twin/domain";

test("publication requires a distinct approver and emits sealed release evidence", () => {
  const draft = validatedDraft();
  const request = createPublicationRequestRecord({
    publicationId: "publication-1",
    draft,
    bundle: bundle(),
    requestedBy: "engineer-1",
    occurredAt: "2026-08-13T21:00:00.000Z",
  });

  assert.throws(
    () => approvePublicationRequestRecord(request, { approvedBy: "engineer-1" }),
    (error) => error instanceof TwinDomainError && error.code === "PUBLICATION_TWO_PERSON_REQUIRED",
  );
  const approved = approvePublicationRequestRecord(request, {
    approvedBy: "approver-1",
    occurredAt: "2026-08-13T21:01:00.000Z",
  });
  const stored = { ...approved, status: "STORE_PUBLISHED", storePublishedAt: "2026-08-13T21:02:00.000Z" };
  const publishedDraft = publishMapDraftRecord(draft, {
    publishedBy: "approver-1",
    occurredAt: "2026-08-13T21:03:00.000Z",
  });
  const event = createMapReleasePublishedEvent({
    eventId: "release-event-1",
    publication: stored,
    draft: publishedDraft,
  });

  assert.equal(publishedDraft.status, "PUBLISHED");
  assert.equal(publishedDraft.rowVersion, 4);
  assert.equal(event.eventType, MAP_RELEASE_EVENT_TYPE.published);
  assert.equal(event.payload.requestedBy, "engineer-1");
  assert.equal(event.payload.approvedBy, "approver-1");
});

test("publication rejects a bundle that points at different validation evidence", () => {
  assert.throws(
    () => createPublicationRequestRecord({
      publicationId: "publication-1",
      draft: validatedDraft(),
      bundle: { ...bundle(), validationReportSha256: "c".repeat(64) },
      requestedBy: "engineer-1",
    }),
    (error) => error instanceof TwinDomainError && error.code === "PUBLICATION_VALIDATION_REPORT_MISMATCH",
  );
});

function validatedDraft() {
  return {
    draftId: "draft-1",
    familyId: "demo-plant",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    status: "VALIDATED",
    validationReportSha256: "b".repeat(64),
    rowVersion: 3,
    createdBy: "engineer-1",
    createdAt: "2026-08-13T20:00:00.000Z",
    updatedBy: "validator-1",
    updatedAt: "2026-08-13T20:30:00.000Z",
  };
}

function bundle() {
  return {
    bundleId: "bundle-demo-plant-1",
    mapReleaseId: "demo-plant@1",
    familyId: "demo-plant",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    validationReportSha256: "b".repeat(64),
    manifestSha256: "a".repeat(64),
    artifacts: [{
      role: "COORDINATE_FRAMES",
      artifactSha256: "d".repeat(64),
      bundlePath: "coordinate-frames.json",
      bytes: 1,
      mediaType: "application/json",
    }],
  };
}
