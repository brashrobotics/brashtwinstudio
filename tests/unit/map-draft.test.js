import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_DRAFT_ACTION,
  MAP_DRAFT_EVENT_TYPE,
  MAP_DRAFT_STATUS,
  MapDraft,
  TwinDomainError,
  createMapDraftLifecycleEvent,
  createMapDraftRecord,
  transitionMapDraft,
} from "@brash-twin/domain";

test("validated draft publishes an immutable release", () => {
  const draft = new MapDraft({
    draftId: "draft-1",
    familyId: "demo-plant",
    revision: 1,
    canonicalFrameId: "demo-plant/floor-1",
    createdBy: "map-engineer",
    createdAt: "2026-08-13T12:00:00.000Z",
  });
  draft.submitForReview();
  draft.markValidated("sha256:validation-report");
  const release = draft.publish({
    releaseId: "demo-plant@1",
    publishedBy: "map-approver",
    publishedAt: "2026-08-13T13:00:00.000Z",
  });

  assert.equal(draft.status, MAP_DRAFT_STATUS.published);
  assert.equal(release.status, "PUBLISHED");
  assert.ok(Object.isFrozen(release));
  assert.throws(() => draft.returnToDraft(), TwinDomainError);
});

test("draft cannot publish without validation", () => {
  const draft = new MapDraft({
    draftId: "draft-2",
    familyId: "demo-plant",
    revision: 2,
    canonicalFrameId: "demo-plant/floor-1",
    createdBy: "map-engineer",
  });
  draft.submitForReview();
  assert.throws(
    () => draft.publish({ releaseId: "demo-plant@2", publishedBy: "map-approver" }),
    (error) => error instanceof TwinDomainError && error.code === "MAP_DRAFT_TRANSITION_INVALID",
  );
});

test("persistable draft transitions increment row version and retain audit identity", () => {
  const created = createMapDraftRecord({
    draftId: "draft-api-1",
    familyId: "demo-plant",
    revision: 3,
    canonicalFrameId: "demo-plant/floor-1",
    operatorId: "engineer-1",
    occurredAt: "2026-08-13T10:00:00.000Z",
  });
  const review = transitionMapDraft(created, {
    action: MAP_DRAFT_ACTION.submitReview,
    operatorId: "engineer-2",
    occurredAt: "2026-08-13T10:05:00.000Z",
  });
  const validated = transitionMapDraft(review, {
    action: MAP_DRAFT_ACTION.markValidated,
    validationReportSha256: "a".repeat(64),
    operatorId: "approver-1",
    occurredAt: "2026-08-13T10:06:00.000Z",
  });

  assert.equal(created.rowVersion, 1);
  assert.equal(validated.rowVersion, 3);
  assert.equal(validated.status, MAP_DRAFT_STATUS.validated);
  assert.equal(validated.createdBy, "engineer-1");
  assert.equal(validated.updatedBy, "approver-1");
  assert.equal(validated.validationReportSha256, "a".repeat(64));
});

test("draft lifecycle event captures the transition and audit identity", () => {
  const created = createMapDraftRecord({
    draftId: "draft-event-1",
    familyId: "demo-plant",
    revision: 4,
    canonicalFrameId: "demo-plant/floor-1",
    operatorId: "engineer-1",
    occurredAt: "2026-08-13T11:00:00.000Z",
  });
  const review = transitionMapDraft(created, {
    action: MAP_DRAFT_ACTION.submitReview,
    operatorId: "reviewer-1",
    occurredAt: "2026-08-13T11:05:00.000Z",
  });
  const event = createMapDraftLifecycleEvent({
    eventId: "event-draft-review-1",
    record: review,
    previousStatus: created.status,
    action: MAP_DRAFT_ACTION.submitReview,
    operatorId: "reviewer-1",
  });

  assert.equal(event.eventType, MAP_DRAFT_EVENT_TYPE.reviewSubmitted);
  assert.equal(event.aggregateId, "draft-event-1");
  assert.equal(event.payload.previousStatus, MAP_DRAFT_STATUS.draft);
  assert.equal(event.payload.status, MAP_DRAFT_STATUS.inReview);
  assert.equal(event.payload.rowVersion, 2);
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event.payload));
});
