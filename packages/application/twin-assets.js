import { createHash, randomUUID } from "node:crypto";

const LEGACY_ASSET_SET_VERSION = "brash.draft-twin-assets/v1";
const ASSET_SET_VERSION = "brash.draft-twin-assets/v2";
const ASSET_SET_MEDIA_TYPE = "application/vnd.brash.draft-twin-assets.v2+json";
const LEGACY_CHANGE_REPORT_VERSION = "brash.asset-change-report/v1";
const CHANGE_REPORT_VERSION = "brash.asset-change-report/v2";
const CHANGE_REPORT_MEDIA_TYPE = "application/vnd.brash.asset-change-report+json";
const CHANGE_REVIEW_VERSION = "brash.asset-change-review/v1";
const CHANGE_REVIEW_MEDIA_TYPE = "application/vnd.brash.asset-change-review+json";
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
const MAXIMUM_ASSETS = 5_000;
const POSITION_TOLERANCE_METERS = 0.5;
const MINIMUM_CONFIDENCE = 0.75;
const REQUIRED_CONFIRMATIONS = 1;
const MAXIMUM_MATCH_DISTANCE_METERS = 5;

export class TwinAssetError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TwinAssetError";
    this.code = code;
  }
}

export class TwinAssetService {
  #catalog;
  #semanticCandidates;
  #sensorVisibility;
  #draftArtifacts;
  #uploads;
  #multipartStore;
  #clock;
  #assetSetIdGenerator;
  #changeSetIdGenerator;
  #reviewIdGenerator;
  #eventIdGenerator;

  constructor({
    catalog,
    semanticCandidates,
    sensorVisibility,
    draftArtifacts,
    uploads,
    multipartStore,
    clock = () => new Date(),
    assetSetIdGenerator = () => `asset-set-${randomUUID()}`,
    changeSetIdGenerator = () => `asset-changes-${randomUUID()}`,
    reviewIdGenerator = () => `asset-change-review-${randomUUID()}`,
    eventIdGenerator = () => `event-${randomUUID()}`,
  }) {
    if (!catalog || typeof catalog.getMapDraftContext !== "function") invalidConfiguration("Catalog lookup is required.");
    if (!semanticCandidates || typeof semanticCandidates.list !== "function") invalidConfiguration("Semantic candidate lookup is required.");
    if (!sensorVisibility || typeof sensorVisibility.list !== "function") invalidConfiguration("Sensor visibility lookup is required.");
    if (!draftArtifacts || typeof draftArtifacts.list !== "function" || typeof draftArtifacts.bind !== "function") {
      invalidConfiguration("Draft artifact provenance operations are required.");
    }
    if (!uploads || typeof uploads.initiate !== "function" || typeof uploads.get !== "function" || typeof uploads.complete !== "function") {
      invalidConfiguration("Upload lifecycle operations are required.");
    }
    if (!multipartStore || typeof multipartStore.get !== "function" || typeof multipartStore.putPart !== "function") {
      invalidConfiguration("Object-store read and write operations are required.");
    }
    if (typeof clock !== "function" || typeof assetSetIdGenerator !== "function" || typeof changeSetIdGenerator !== "function"
      || typeof reviewIdGenerator !== "function" || typeof eventIdGenerator !== "function") {
      invalidConfiguration("Clock and ID generators must be functions.");
    }
    this.#catalog = catalog;
    this.#semanticCandidates = semanticCandidates;
    this.#sensorVisibility = sensorVisibility;
    this.#draftArtifacts = draftArtifacts;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#assetSetIdGenerator = assetSetIdGenerator;
    this.#changeSetIdGenerator = changeSetIdGenerator;
    this.#reviewIdGenerator = reviewIdGenerator;
    this.#eventIdGenerator = eventIdGenerator;
  }

  async promote(draftId, input = {}) {
    identifier(draftId, "draftId");
    identifier(input.candidateSetId, "candidateSetId");
    requiredText(input.operatorId, "operatorId");
    if (input.assetSetId !== undefined) identifier(input.assetSetId, "assetSetId");
    const context = await this.#requireEditableDraft(draftId);
    const candidateSet = (await this.#semanticCandidates.list(draftId)).find(
      (candidate) => candidate.report.candidateSetId === input.candidateSetId,
    );
    if (!candidateSet) throw new TwinAssetError("TWIN_ASSET_CANDIDATE_NOT_FOUND", `Candidate set ${input.candidateSetId} was not found.`);
    if (!candidateSet.review) {
      throw new TwinAssetError("TWIN_ASSET_REVIEW_REQUIRED", "Twin assets can only be promoted from an immutable candidate review.");
    }
    if ((await this.listChanges(draftId)).some(
      (record) => record.report.observations.candidateSetId === input.candidateSetId,
    )) {
      throw new TwinAssetError(
        "TWIN_ASSET_CHANGE_WORKFLOW_REQUIRED",
        "A candidate set already used for change detection must be applied through reviewed change decisions, not direct asset promotion.",
      );
    }
    const accepted = candidateSet.review.report.decisions.filter((decision) => decision.decision === "ACCEPTED");
    if (accepted.length === 0) throw new TwinAssetError("TWIN_ASSET_ACCEPTED_CANDIDATE_REQUIRED", "At least one accepted candidate is required.");

    const existing = await this.list(draftId);
    if (existing.some((record) => record.report.assets.some(
      (asset) => asset.source.candidateSetId === input.candidateSetId,
    ))) {
      throw new TwinAssetError("TWIN_ASSET_PROMOTION_CONFLICT", `Candidate set ${input.candidateSetId} was already promoted.`);
    }
    const predecessor = existing.at(-1) ?? null;
    const byCandidateId = new Map(candidateSet.report.candidates.map((candidate) => [candidate.candidateId, candidate]));
    const promotedAssets = accepted.map((decision) => {
      const candidate = byCandidateId.get(decision.candidateId);
      if (!candidate) integrityFailure(candidateSet.review.reportBindingId);
      return promoteCandidate(candidateSet.report.candidateSetId, candidate, decision, context.draft.canonicalFrameId);
    });
    const assets = [...(predecessor?.report.assets ?? []), ...promotedAssets]
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
    if (assets.length > MAXIMUM_ASSETS || new Set(assets.map((asset) => asset.assetId)).size !== assets.length) {
      throw new TwinAssetError("TWIN_ASSET_LIMIT_EXCEEDED", `A draft asset set may contain at most ${MAXIMUM_ASSETS} unique assets.`);
    }

    const assetSetId = input.assetSetId ?? this.#assetSetIdGenerator();
    identifier(assetSetId, "assetSetId");
    const report = Object.freeze({
      schemaVersion: ASSET_SET_VERSION,
      assetSetId,
      draftId,
      revision: (predecessor?.report.revision ?? 0) + 1,
      canonicalFrameId: context.draft.canonicalFrameId,
      predecessor: predecessor ? Object.freeze({
        assetSetId: predecessor.report.assetSetId,
        revision: predecessor.report.revision,
        bindingId: predecessor.reportBindingId,
        sha256: predecessor.reportSha256,
      }) : null,
      sourceCandidateSet: Object.freeze({
        candidateSetId: candidateSet.report.candidateSetId,
        report: Object.freeze({ bindingId: candidateSet.reportBindingId, sha256: candidateSet.reportSha256 }),
        review: Object.freeze({ bindingId: candidateSet.review.reportBindingId, sha256: candidateSet.review.reportSha256 }),
      }),
      sourceChangeSet: null,
      assets: Object.freeze(assets),
      promotedBy: input.operatorId,
      promotedAt: now(this.#clock),
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `twin-assets-${assetSetId}`,
      report,
      mediaType: ASSET_SET_MEDIA_TYPE,
      operatorId: input.operatorId,
      conflictCode: "TWIN_ASSET_PROMOTION_CONFLICT",
    });
    const inputBindingIds = [candidateSet.reportBindingId, candidateSet.review.reportBindingId];
    if (predecessor) inputBindingIds.push(predecessor.reportBindingId);
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: assetRevisionBindingId(draftId, predecessor),
        uploadId: stored.uploadId,
        role: "TWIN_ASSETS",
        coordinateFrameId: report.canonicalFrameId,
        inputBindingIds,
        producer: {
          name: "brash-twin-asset-promoter",
          version: "1.0.0",
          parametersSha256: sha256(canonicalJson({
            positionToleranceMeters: POSITION_TOLERANCE_METERS,
            minimumConfidence: MINIMUM_CONFIDENCE,
            requiredConfirmations: REQUIRED_CONFIRMATIONS,
          })),
        },
        operatorId: input.operatorId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new TwinAssetError("TWIN_ASSET_PROMOTION_CONFLICT", `Asset set ${assetSetId} already exists.`, { cause: error });
      }
      throw error;
    }
    return artifactRecord(binding, report);
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    const context = await this.#catalog.getMapDraftContext(draftId);
    const bindings = await this.#draftArtifacts.list(draftId);
    const records = [];
    for (const binding of bindings.filter((candidate) => candidate.role === "TWIN_ASSETS"
      && new Set(["brash-twin-asset-promoter", "brash-twin-asset-change-applier"]).has(candidate.producer?.name))) {
      const report = await this.#readJson(binding, [LEGACY_ASSET_SET_VERSION, ASSET_SET_VERSION]);
      validateAssetSet(report, binding, context.draft);
      records.push(artifactRecord(binding, report));
    }
    records.sort((left, right) => left.report.revision - right.report.revision);
    validateAssetChain(records);
    return records;
  }

  async detectChanges(draftId, input = {}) {
    identifier(draftId, "draftId");
    identifier(input.candidateSetId, "candidateSetId");
    identifier(input.visibilityReportId, "visibilityReportId");
    requiredText(input.operatorId, "operatorId");
    if (input.changeSetId !== undefined) identifier(input.changeSetId, "changeSetId");
    const context = await this.#requireEditableDraft(draftId);
    const assetHistory = await this.list(draftId);
    const baseline = assetHistory.at(-1);
    if (!baseline) throw new TwinAssetError("TWIN_ASSET_BASELINE_REQUIRED", "Change detection requires a promoted Twin asset baseline.");
    const candidateSet = (await this.#semanticCandidates.list(draftId)).find(
      (candidate) => candidate.report.candidateSetId === input.candidateSetId,
    );
    if (!candidateSet) throw new TwinAssetError("TWIN_ASSET_CANDIDATE_NOT_FOUND", `Candidate set ${input.candidateSetId} was not found.`);
    if (assetHistory.some((record) => record.report.assets.some(
      (asset) => asset.source.candidateSetId === input.candidateSetId,
    ))) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_INPUT_INVALID", "A candidate set already represented in Twin asset history cannot test a later baseline.");
    }
    const visibility = (await this.#sensorVisibility.list(draftId)).find(
      (record) => record.report.visibilityReportId === input.visibilityReportId,
    );
    if (!visibility) {
      throw new TwinAssetError(
        "TWIN_ASSET_VISIBILITY_REQUIRED",
        `Sealed sensor visibility report ${input.visibilityReportId} was not found.`,
      );
    }
    if (candidateSet.report.canonicalFrameId !== baseline.report.canonicalFrameId
      || candidateSet.report.canonicalFrameId !== context.draft.canonicalFrameId
      || visibility.report.canonicalFrameId !== context.draft.canonicalFrameId) {
      throw new TwinAssetError(
        "TWIN_ASSET_FRAME_MISMATCH",
        "Change observations, visibility evidence, and baseline assets must share the draft canonical frame.",
      );
    }
    if (visibility.report.registrationId !== candidateSet.report.registrationId
      || visibility.report.registrationAcceptance?.bindingId !== candidateSet.report.registrationAcceptance?.bindingId
      || visibility.report.registrationAcceptance?.sha256 !== candidateSet.report.registrationAcceptance?.sha256
      || visibility.report.observations.semanticObservationSetId
        !== candidateSet.report.observations?.observationSetId) {
      throw new TwinAssetError(
        "TWIN_ASSET_VISIBILITY_CONTEXT_MISMATCH",
        "Visibility evidence and semantic candidates must share the same approved registration and sealed observation set.",
      );
    }
    if ((await this.listChanges(draftId)).some(
      (record) => record.report.observations.candidateSetId === input.candidateSetId,
    )) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_CONFLICT", `Candidate set ${input.candidateSetId} was already compared.`);
    }
    const changeSetId = input.changeSetId ?? this.#changeSetIdGenerator();
    identifier(changeSetId, "changeSetId");
    const comparison = compareAssets(
      baseline.report.assets,
      candidateSet.report.candidates,
      visibility.report,
      changeSetId,
    );
    const report = Object.freeze({
      schemaVersion: CHANGE_REPORT_VERSION,
      changeSetId,
      draftId,
      canonicalFrameId: context.draft.canonicalFrameId,
      baseline: Object.freeze({
        assetSetId: baseline.report.assetSetId,
        revision: baseline.report.revision,
        bindingId: baseline.reportBindingId,
        sha256: baseline.reportSha256,
      }),
      observations: Object.freeze({
        candidateSetId: candidateSet.report.candidateSetId,
        bindingId: candidateSet.reportBindingId,
        sha256: candidateSet.reportSha256,
      }),
      visibility: Object.freeze({
        visibilityReportId: visibility.report.visibilityReportId,
        bindingId: visibility.reportBindingId,
        sha256: visibility.reportSha256,
      }),
      policy: Object.freeze({
        matchingAlgorithm: "CLASS_NEAREST_NEIGHBOR",
        maximumMatchDistanceMeters: MAXIMUM_MATCH_DISTANCE_METERS,
        coverageMode: "CALIBRATED_SENSOR_VISIBILITY",
        minimumVisibilityConfidence: visibility.report.qualification.minimumVisibilityConfidence,
      }),
      coverage: comparison.coverage,
      summary: comparison.summary,
      changes: comparison.changes,
      createdBy: input.operatorId,
      createdAt: now(this.#clock),
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `asset-change-report-${changeSetId}`,
      report,
      mediaType: CHANGE_REPORT_MEDIA_TYPE,
      operatorId: input.operatorId,
      conflictCode: "TWIN_ASSET_CHANGE_CONFLICT",
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `asset-change-report-${changeSetId}`,
        uploadId: stored.uploadId,
        role: "ASSET_CHANGE_REPORT",
        coordinateFrameId: report.canonicalFrameId,
        inputBindingIds: [baseline.reportBindingId, candidateSet.reportBindingId, visibility.reportBindingId],
        producer: {
          name: "brash-twin-asset-change-detector",
          version: "1.0.0",
          parametersSha256: sha256(canonicalJson(report.policy)),
        },
        operatorId: input.operatorId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new TwinAssetError("TWIN_ASSET_CHANGE_CONFLICT", `Change set ${changeSetId} already exists.`, { cause: error });
      }
      throw error;
    }
    return artifactRecord(binding, report);
  }

  async listChanges(draftId) {
    identifier(draftId, "draftId");
    const context = await this.#catalog.getMapDraftContext(draftId);
    const bindings = await this.#draftArtifacts.list(draftId);
    const reviews = new Map();
    for (const binding of bindings.filter((candidate) => candidate.role === "ASSET_CHANGE_REVIEW"
      && candidate.producer?.name === "brash-twin-asset-change-review")) {
      const report = await this.#readJson(binding, CHANGE_REVIEW_VERSION);
      validateChangeReview(report, binding, context.draft);
      if (reviews.has(report.changeSetId)) integrityFailure(binding.bindingId);
      reviews.set(report.changeSetId, artifactRecord(binding, report));
    }
    const records = [];
    for (const binding of bindings.filter((candidate) => candidate.role === "ASSET_CHANGE_REPORT"
      && candidate.producer?.name === "brash-twin-asset-change-detector")) {
      const report = await this.#readJson(binding, [LEGACY_CHANGE_REPORT_VERSION, CHANGE_REPORT_VERSION]);
      validateChangeReport(report, binding, context.draft);
      const review = reviews.get(report.changeSetId) ?? null;
      if (review && (review.report.changeReport.bindingId !== binding.bindingId
        || review.report.changeReport.sha256 !== binding.artifactSha256)) integrityFailure(review.reportBindingId);
      records.push(Object.freeze({ ...artifactRecord(binding, report), review }));
    }
    return records.sort((left, right) => left.report.createdAt.localeCompare(right.report.createdAt));
  }

  async reviewChanges(draftId, changeSetId, input = {}) {
    identifier(draftId, "draftId");
    identifier(changeSetId, "changeSetId");
    requiredText(input.reviewerId, "reviewerId");
    if (input.reviewId !== undefined) identifier(input.reviewId, "reviewId");
    await this.#requireEditableDraft(draftId);
    const changeSet = (await this.listChanges(draftId)).find((record) => record.report.changeSetId === changeSetId);
    if (!changeSet) throw new TwinAssetError("TWIN_ASSET_CHANGE_NOT_FOUND", `Change set ${changeSetId} was not found.`);
    if (changeSet.review) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_REVIEW_CONFLICT", `Change set ${changeSetId} already has an immutable review.`);
    }
    if (changeSet.report.createdBy === input.reviewerId) {
      throw new TwinAssetError(
        "TWIN_ASSET_CHANGE_REVIEWER_CONFLICT",
        "The operator who created a change report cannot independently review it.",
      );
    }
    const decisions = normalizeChangeDecisions(changeSet.report, input.decisions);
    const confirmedMissing = decisions.some((decision) => decision.decision === "CONFIRMED"
      && changeSet.report.changes.find((change) => change.changeId === decision.changeId)?.changeType === "MISSING");
    const coverageQualificationAcknowledged = input.coverageQualificationAcknowledged === true;
    if (confirmedMissing
      && changeSet.report.schemaVersion === LEGACY_CHANGE_REPORT_VERSION
      && !coverageQualificationAcknowledged) {
      throw new TwinAssetError(
        "TWIN_ASSET_CHANGE_COVERAGE_ACKNOWLEDGEMENT_REQUIRED",
        "Confirming a missing asset requires acknowledgement that OBSERVED_ENVELOPE coverage is approximate evidence.",
      );
    }
    const reviewId = input.reviewId ?? this.#reviewIdGenerator();
    identifier(reviewId, "reviewId");
    const byChangeId = new Map(changeSet.report.changes.map((change) => [change.changeId, change]));
    const report = Object.freeze({
      schemaVersion: CHANGE_REVIEW_VERSION,
      reviewId,
      changeSetId,
      draftId,
      changeReport: Object.freeze({ bindingId: changeSet.reportBindingId, sha256: changeSet.reportSha256 }),
      coverageQualificationAcknowledged,
      decisions: Object.freeze(decisions),
      summary: Object.freeze({
        confirmedCount: decisions.filter((decision) => decision.decision === "CONFIRMED").length,
        dismissedCount: decisions.filter((decision) => decision.decision === "DISMISSED").length,
        criticalCount: decisions.filter((decision) => decision.decision === "CONFIRMED"
          && isCriticalChange(byChangeId.get(decision.changeId))).length,
      }),
      reviewerId: input.reviewerId,
      note: optionalText(input.note, "note", 2_000),
      sealedAt: now(this.#clock),
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `asset-change-review-${changeSetId}`,
      report,
      mediaType: CHANGE_REVIEW_MEDIA_TYPE,
      operatorId: input.reviewerId,
      conflictCode: "TWIN_ASSET_CHANGE_REVIEW_CONFLICT",
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `asset-change-review-${changeSetId}`,
        uploadId: stored.uploadId,
        role: "ASSET_CHANGE_REVIEW",
        coordinateFrameId: null,
        inputBindingIds: [changeSet.reportBindingId],
        producer: {
          name: "brash-twin-asset-change-review",
          version: "1.0.0",
          parametersSha256: sha256(canonicalJson({ schemaVersion: CHANGE_REVIEW_VERSION })),
        },
        operatorId: input.reviewerId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new TwinAssetError("TWIN_ASSET_CHANGE_REVIEW_CONFLICT", `Change review ${reviewId} already exists.`, { cause: error });
      }
      throw error;
    }
    return artifactRecord(binding, report);
  }

  async applyChanges(draftId, changeSetId, input = {}) {
    identifier(draftId, "draftId");
    identifier(changeSetId, "changeSetId");
    requiredText(input.operatorId, "operatorId");
    if (input.assetSetId !== undefined) identifier(input.assetSetId, "assetSetId");
    const context = await this.#requireEditableDraft(draftId);
    if (typeof this.#draftArtifacts.bindWithEvent !== "function") {
      invalidConfiguration("Atomic artifact and outbox persistence is required to apply reviewed changes.");
    }
    const changeSet = (await this.listChanges(draftId)).find((record) => record.report.changeSetId === changeSetId);
    if (!changeSet) throw new TwinAssetError("TWIN_ASSET_CHANGE_NOT_FOUND", `Change set ${changeSetId} was not found.`);
    if (!changeSet.review) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_REVIEW_REQUIRED", "Detected changes require an immutable independent review before application.");
    }
    const confirmed = changeSet.review.report.decisions.filter((decision) => decision.decision === "CONFIRMED");
    if (confirmed.length === 0) {
      throw new TwinAssetError("TWIN_ASSET_CONFIRMED_CHANGE_REQUIRED", "At least one confirmed change is required to create an asset revision.");
    }
    const existing = await this.list(draftId);
    if (existing.some((record) => record.report.sourceChangeSet?.changeSetId === changeSetId)) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_APPLY_CONFLICT", `Change set ${changeSetId} was already applied.`);
    }
    const baseline = existing.at(-1);
    if (!baseline || baseline.reportBindingId !== changeSet.report.baseline.bindingId
      || baseline.reportSha256 !== changeSet.report.baseline.sha256) {
      throw new TwinAssetError(
        "TWIN_ASSET_CHANGE_BASELINE_STALE",
        "The Twin asset baseline changed after detection; run change detection again against the latest revision.",
      );
    }
    const candidateSet = (await this.#semanticCandidates.list(draftId)).find(
      (record) => record.report.candidateSetId === changeSet.report.observations.candidateSetId,
    );
    if (!candidateSet || candidateSet.reportBindingId !== changeSet.report.observations.bindingId
      || candidateSet.reportSha256 !== changeSet.report.observations.sha256) {
      integrityFailure(changeSet.reportBindingId);
    }
    const assets = applyConfirmedChanges({
      baseline: baseline.report.assets,
      changes: changeSet.report.changes,
      decisions: changeSet.review.report.decisions,
      candidates: candidateSet.report.candidates,
      candidateSetId: candidateSet.report.candidateSetId,
      frameId: context.draft.canonicalFrameId,
    });
    if (assets.length > MAXIMUM_ASSETS || new Set(assets.map((asset) => asset.assetId)).size !== assets.length) {
      throw new TwinAssetError("TWIN_ASSET_LIMIT_EXCEEDED", `A draft asset set may contain at most ${MAXIMUM_ASSETS} unique assets.`);
    }
    const assetSetId = input.assetSetId ?? this.#assetSetIdGenerator();
    identifier(assetSetId, "assetSetId");
    const promotedAt = now(this.#clock);
    const report = Object.freeze({
      schemaVersion: ASSET_SET_VERSION,
      assetSetId,
      draftId,
      revision: baseline.report.revision + 1,
      canonicalFrameId: context.draft.canonicalFrameId,
      predecessor: Object.freeze({
        assetSetId: baseline.report.assetSetId,
        revision: baseline.report.revision,
        bindingId: baseline.reportBindingId,
        sha256: baseline.reportSha256,
      }),
      sourceCandidateSet: null,
      sourceChangeSet: Object.freeze({
        changeSetId,
        report: Object.freeze({ bindingId: changeSet.reportBindingId, sha256: changeSet.reportSha256 }),
        review: Object.freeze({ bindingId: changeSet.review.reportBindingId, sha256: changeSet.review.reportSha256 }),
        observations: Object.freeze({ bindingId: candidateSet.reportBindingId, sha256: candidateSet.reportSha256 }),
      }),
      assets: Object.freeze(assets),
      promotedBy: input.operatorId,
      promotedAt,
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `twin-assets-${assetSetId}`,
      report,
      mediaType: ASSET_SET_MEDIA_TYPE,
      operatorId: input.operatorId,
      conflictCode: "TWIN_ASSET_CHANGE_APPLY_CONFLICT",
    });
    const event = changeAppliedEvent({
      eventId: this.#eventIdGenerator(),
      draftId,
      report,
      changeReport: changeSet.report,
      review: changeSet.review.report,
      occurredAt: promotedAt,
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bindWithEvent(draftId, {
        bindingId: assetRevisionBindingId(draftId, baseline),
        uploadId: stored.uploadId,
        role: "TWIN_ASSETS",
        coordinateFrameId: report.canonicalFrameId,
        inputBindingIds: [
          baseline.reportBindingId,
          changeSet.reportBindingId,
          changeSet.review.reportBindingId,
          candidateSet.reportBindingId,
        ],
        producer: {
          name: "brash-twin-asset-change-applier",
          version: "1.0.0",
          parametersSha256: sha256(canonicalJson({
            changeReportSha256: changeSet.reportSha256,
            changeReviewSha256: changeSet.review.reportSha256,
          })),
        },
        operatorId: input.operatorId,
      }, event);
    } catch (error) {
      if (new Set(["DRAFT_ARTIFACT_CONFLICT", "DRAFT_ARTIFACT_PERSISTENCE_ERROR"]).has(error?.code)) {
        throw new TwinAssetError("TWIN_ASSET_CHANGE_APPLY_CONFLICT", `Asset set ${assetSetId} could not be atomically applied.`, { cause: error });
      }
      throw error;
    }
    return artifactRecord(binding, report);
  }

  async #requireEditableDraft(draftId) {
    const context = await this.#catalog.getMapDraftContext(draftId);
    if (context.draft.status !== "DRAFT") {
      throw new TwinAssetError("TWIN_ASSET_DRAFT_LOCKED", `Map draft ${draftId} is ${context.draft.status}; Twin asset work requires DRAFT.`);
    }
    return context;
  }

  async #readJson(binding, schemaVersion) {
    const content = await this.#multipartStore.get(binding.artifactSha256);
    if (!Buffer.isBuffer(content) || content.byteLength > MAXIMUM_JSON_BYTES || sha256(content) !== binding.artifactSha256) {
      integrityFailure(binding.bindingId);
    }
    let report;
    try { report = JSON.parse(content.toString("utf8")); } catch {
      throw new TwinAssetError("TWIN_ASSET_JSON_INVALID", `Stored artifact ${binding.bindingId} is not valid JSON.`);
    }
    const supported = Array.isArray(schemaVersion) ? schemaVersion : [schemaVersion];
    if (!supported.includes(report?.schemaVersion)) {
      throw new TwinAssetError("TWIN_ASSET_SCHEMA_INVALID", `Stored artifact ${binding.bindingId} has an unsupported schema.`);
    }
    return report;
  }
}

function promoteCandidate(candidateSetId, candidate, decision, frameId) {
  const [x, y, z] = candidate.canonicalPosition;
  const [width, depth, height] = candidate.dimensions;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const halfHeight = height / 2;
  return Object.freeze({
    assetId: `asset-${sha256(candidate.candidateId).slice(0, 20)}`,
    displayName: decision.displayName,
    semanticClass: decision.assetType,
    mobilityClass: "STATIC",
    frameId,
    pose: Object.freeze({
      position: Object.freeze({ x, y, z }),
      orientation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
    }),
    footprint: Object.freeze([
      Object.freeze({ x: round(x - halfWidth), y: round(y - halfDepth) }),
      Object.freeze({ x: round(x + halfWidth), y: round(y - halfDepth) }),
      Object.freeze({ x: round(x + halfWidth), y: round(y + halfDepth) }),
      Object.freeze({ x: round(x - halfWidth), y: round(y + halfDepth) }),
    ]),
    bounds3d: Object.freeze({
      minimum: Object.freeze({ x: round(x - halfWidth), y: round(y - halfDepth), z: round(z - halfHeight) }),
      maximum: Object.freeze({ x: round(x + halfWidth), y: round(y + halfDepth), z: round(z + halfHeight) }),
    }),
    properties: Object.freeze({ ...decision.properties }),
    topologyBindings: Object.freeze([]),
    changePolicy: Object.freeze({
      positionToleranceMeters: POSITION_TOLERANCE_METERS,
      minimumConfidence: MINIMUM_CONFIDENCE,
      requiredConfirmations: REQUIRED_CONFIRMATIONS,
    }),
    source: Object.freeze({
      candidateSetId,
      candidateId: candidate.candidateId,
      sourceObservationId: candidate.sourceObservationId,
      suggestedClass: candidate.suggestedClass,
    }),
  });
}

function applyConfirmedChanges({ baseline, changes, decisions, candidates, candidateSetId, frameId }) {
  const assets = new Map(baseline.map((asset) => [asset.assetId, asset]));
  const byChangeId = new Map(changes.map((change) => [change.changeId, change]));
  const byCandidateId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const decision of decisions.filter((candidate) => candidate.decision === "CONFIRMED")) {
    const change = byChangeId.get(decision.changeId);
    if (!change) workflowIntegrityFailure(`Reviewed change ${decision.changeId} is missing from its sealed report.`);
    if (change.changeType === "MISSING") {
      if (!change.assetId || !assets.delete(change.assetId)) workflowIntegrityFailure(`Missing asset ${change.assetId} is not in the baseline.`);
      continue;
    }
    const candidate = byCandidateId.get(change.candidateId);
    if (!candidate) workflowIntegrityFailure(`Candidate ${change.candidateId} is unavailable for ${change.changeType}.`);
    if (change.changeType === "MOVED") {
      const asset = assets.get(change.assetId);
      if (!asset) workflowIntegrityFailure(`Moved asset ${change.assetId} is not in the baseline.`);
      assets.set(asset.assetId, relocateAsset(asset, candidateSetId, candidate));
      continue;
    }
    const appeared = promoteCandidate(candidateSetId, candidate, {
      displayName: decision.displayName,
      assetType: decision.assetType,
      properties: decision.properties,
    }, frameId);
    if (assets.has(appeared.assetId)) workflowIntegrityFailure(`Appeared asset ${appeared.assetId} already exists.`);
    assets.set(appeared.assetId, appeared);
  }
  return [...assets.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function relocateAsset(asset, candidateSetId, candidate) {
  const previous = assetPosition(asset);
  const next = candidate.canonicalPosition;
  const delta = next.map((coordinate, axis) => coordinate - previous[axis]);
  const translatePoint = (point) => Object.freeze({ x: round(point.x + delta[0]), y: round(point.y + delta[1]) });
  const translateVector = (point) => Object.freeze({
    x: round(point.x + delta[0]),
    y: round(point.y + delta[1]),
    z: round(point.z + delta[2]),
  });
  return Object.freeze({
    ...asset,
    pose: Object.freeze({
      position: Object.freeze({ x: next[0], y: next[1], z: next[2] }),
      orientation: asset.pose.orientation,
    }),
    footprint: Object.freeze(asset.footprint.map(translatePoint)),
    bounds3d: Object.freeze({
      minimum: translateVector(asset.bounds3d.minimum),
      maximum: translateVector(asset.bounds3d.maximum),
    }),
    source: Object.freeze({
      candidateSetId,
      candidateId: candidate.candidateId,
      sourceObservationId: candidate.sourceObservationId,
      suggestedClass: candidate.suggestedClass,
    }),
  });
}

function normalizeChangeDecisions(changeReport, value) {
  if (!Array.isArray(value) || value.length !== changeReport.changes.length) {
    throw new TwinAssetError(
      "TWIN_ASSET_CHANGE_DECISIONS_INVALID",
      "Every detected change must have exactly one CONFIRMED or DISMISSED decision.",
    );
  }
  const byId = new Map(changeReport.changes.map((change) => [change.changeId, change]));
  const seen = new Set();
  const decisions = value.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_DECISIONS_INVALID", `decisions[${index}] must be an object.`);
    }
    identifier(input.changeId, `decisions[${index}].changeId`);
    if (seen.has(input.changeId) || !byId.has(input.changeId)) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_DECISIONS_INVALID", `Decision ${input.changeId} is duplicated or unknown.`);
    }
    seen.add(input.changeId);
    if (!new Set(["CONFIRMED", "DISMISSED"]).has(input.decision)) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_DECISIONS_INVALID", `Decision ${input.changeId} must be CONFIRMED or DISMISSED.`);
    }
    const change = byId.get(input.changeId);
    let displayName = null;
    let assetType = null;
    let properties = Object.freeze({});
    if (input.decision === "CONFIRMED" && change.changeType === "APPEARED") {
      requiredText(input.displayName, `decisions[${index}].displayName`);
      requiredText(input.assetType, `decisions[${index}].assetType`);
      if (input.displayName.trim().length > 200 || input.assetType.trim().length > 100) {
        throw new TwinAssetError("TWIN_ASSET_CHANGE_DECISIONS_INVALID", "Appeared asset names or types exceed their bounded length.");
      }
      displayName = input.displayName.trim();
      assetType = input.assetType.trim();
      properties = normalizeProperties(input.properties, `decisions[${index}].properties`);
    }
    return Object.freeze({
      changeId: input.changeId,
      decision: input.decision,
      displayName,
      assetType,
      properties,
      note: optionalText(input.note, `decisions[${index}].note`, 1_000),
    });
  });
  if (seen.size !== byId.size) {
    throw new TwinAssetError("TWIN_ASSET_CHANGE_DECISIONS_INVALID", "Every detected change must be reviewed exactly once.");
  }
  return decisions.sort((left, right) => left.changeId.localeCompare(right.changeId));
}

function normalizeProperties(value, field) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 20) {
    throw new TwinAssetError("TWIN_ASSET_CHANGE_DECISIONS_INVALID", `${field} must contain at most 20 scalar properties.`);
  }
  const normalized = {};
  for (const [key, property] of Object.entries(value)) {
    if (key.trim() === "" || !new Set(["string", "number", "boolean"]).has(typeof property)
      || (typeof property === "number" && !Number.isFinite(property))) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_DECISIONS_INVALID", `${field}.${key} must be a finite scalar value.`);
    }
    normalized[key] = property;
  }
  return Object.freeze(normalized);
}

function changeAppliedEvent({ eventId, draftId, report, changeReport, review, occurredAt }) {
  requiredText(eventId, "eventId");
  const byChangeId = new Map(changeReport.changes.map((change) => [change.changeId, change]));
  const confirmedChanges = review.decisions
    .filter((decision) => decision.decision === "CONFIRMED")
    .map((decision) => {
      const change = byChangeId.get(decision.changeId);
      if (!change) workflowIntegrityFailure(`Reviewed change ${decision.changeId} is unavailable for event creation.`);
      const severity = isCriticalChange(change) ? "CRITICAL" : "WARNING";
      return Object.freeze({
        changeId: change.changeId,
        changeType: change.changeType,
        assetId: change.assetId ?? `asset-${sha256(change.candidateId).slice(0, 20)}`,
        semanticClass: decision.assetType ?? change.semanticClass,
        confidence: change.confidence,
        severity,
      });
    });
  return Object.freeze({
    eventId,
    aggregateType: "MAP_DRAFT",
    aggregateId: draftId,
    eventType: "TwinAssetChangesApplied.v1",
    schemaVersion: 1,
    payload: Object.freeze({
      schemaVersion: "brash.twin-asset-changes-applied-event/v1",
      draftId,
      assetSetId: report.assetSetId,
      assetRevision: report.revision,
      changeSetId: changeReport.changeSetId,
      reviewId: review.reviewId,
      notificationRequired: confirmedChanges.some((change) => change.severity === "CRITICAL"),
      confirmedChanges: Object.freeze(confirmedChanges),
    }),
    occurredAt,
  });
}

function isCriticalChange(change) {
  return change?.changeType === "MOVED" || change?.changeType === "MISSING";
}

function compareAssets(assets, candidates, visibility, changeSetId) {
  const qualified = visibility.qualification.outcome === "QUALIFIED";
  const evidenceByAssetId = new Map(assets.map((asset) => [
    asset.assetId,
    qualified ? visibilityEvidenceAt(assetPosition(asset), visibility) : null,
  ]));
  const coveredAssets = assets.filter((asset) => evidenceByAssetId.get(asset.assetId) !== null);
  const possiblePairs = [];
  for (const asset of assets) {
    for (const candidate of candidates) {
      if (classKey(asset.source.suggestedClass) !== classKey(candidate.suggestedClass)) continue;
      const distance = euclidean(assetPosition(asset), candidate.canonicalPosition);
      if (distance <= MAXIMUM_MATCH_DISTANCE_METERS) possiblePairs.push({ asset, candidate, distance });
    }
  }
  possiblePairs.sort((left, right) => left.distance - right.distance
    || left.asset.assetId.localeCompare(right.asset.assetId)
    || left.candidate.candidateId.localeCompare(right.candidate.candidateId));
  const matchedAssets = new Set();
  const matchedCandidates = new Set();
  const changes = [];
  let unchangedCount = 0;
  let ignoredObservationCount = 0;
  for (const pair of possiblePairs) {
    if (matchedAssets.has(pair.asset.assetId) || matchedCandidates.has(pair.candidate.candidateId)) continue;
    matchedAssets.add(pair.asset.assetId);
    matchedCandidates.add(pair.candidate.candidateId);
    if (pair.candidate.confidence < pair.asset.changePolicy.minimumConfidence) {
      ignoredObservationCount += 1;
    } else if (pair.distance > pair.asset.changePolicy.positionToleranceMeters) {
      changes.push(changeRecord(changeSetId, "MOVED", pair.asset, pair.candidate, pair.distance, pair.candidate.confidence));
    } else {
      unchangedCount += 1;
    }
  }
  for (const asset of coveredAssets.filter((candidate) => !matchedAssets.has(candidate.assetId))) {
    const evidence = evidenceByAssetId.get(asset.assetId);
    changes.push(changeRecord(changeSetId, "MISSING", asset, null, null, evidence.confidence, evidence));
  }
  for (const candidate of candidates.filter((observation) => !matchedCandidates.has(observation.candidateId))) {
    if (candidate.confidence >= MINIMUM_CONFIDENCE) {
      changes.push(changeRecord(changeSetId, "APPEARED", null, candidate, null, candidate.confidence));
    } else {
      ignoredObservationCount += 1;
    }
  }
  changes.sort((left, right) => left.changeId.localeCompare(right.changeId));
  return Object.freeze({
    coverage: Object.freeze({
      qualificationOutcome: visibility.qualification.outcome,
      cellCount: visibility.coverage.cellCount,
      baselineAssetsEvaluated: coveredAssets.length,
      baselineAssetsOutsideVisibility: assets.length - coveredAssets.length,
    }),
    summary: Object.freeze({
      movedCount: changes.filter((change) => change.changeType === "MOVED").length,
      missingCount: changes.filter((change) => change.changeType === "MISSING").length,
      appearedCount: changes.filter((change) => change.changeType === "APPEARED").length,
      unchangedCount,
      ignoredObservationCount,
    }),
    changes: Object.freeze(changes),
  });
}

function changeRecord(changeSetId, type, asset, candidate, distance, confidence, visibilityEvidence = null) {
  const subject = asset?.assetId ?? candidate.candidateId;
  return Object.freeze({
    changeId: `${changeSetId}-${type.toLowerCase()}-${subject}`,
    changeType: type,
    assetId: asset?.assetId ?? null,
    candidateId: candidate?.candidateId ?? null,
    semanticClass: asset?.semanticClass ?? candidate.suggestedClass,
    confidence: round(confidence),
    fromPosition: asset ? Object.freeze(assetPosition(asset)) : null,
    toPosition: candidate ? Object.freeze([...candidate.canonicalPosition]) : null,
    distanceMeters: distance === null ? null : round(distance),
    visibilityEvidence: visibilityEvidence ? Object.freeze({
      cellId: visibilityEvidence.cellId,
      confidence: round(visibilityEvidence.confidence),
    }) : null,
    reviewStatus: "REVIEW_REQUIRED",
  });
}

function validateAssetSet(report, binding, draft) {
  if (report.draftId !== draft.draftId || report.canonicalFrameId !== draft.canonicalFrameId
    || binding.coordinateFrameId !== report.canonicalFrameId || !Number.isInteger(report.revision)
    || report.revision < 1 || !Array.isArray(report.assets) || report.assets.length > MAXIMUM_ASSETS) integrityFailure(binding.bindingId);
  const inputs = new Map(binding.inputBindings.map((input) => [input.bindingId, input.artifactSha256]));
  if (report.schemaVersion === LEGACY_ASSET_SET_VERSION || report.sourceCandidateSet) {
    const expectedCount = report.predecessor ? 3 : 2;
    if (binding.inputBindings.length !== expectedCount
      || inputs.get(report.sourceCandidateSet?.report?.bindingId) !== report.sourceCandidateSet?.report?.sha256
      || inputs.get(report.sourceCandidateSet?.review?.bindingId) !== report.sourceCandidateSet?.review?.sha256
      || (report.predecessor && inputs.get(report.predecessor.bindingId) !== report.predecessor.sha256)
      || (report.schemaVersion === ASSET_SET_VERSION && report.sourceChangeSet !== null)) integrityFailure(binding.bindingId);
  } else if (report.schemaVersion === ASSET_SET_VERSION && report.sourceChangeSet) {
    if (!report.predecessor || binding.inputBindings.length !== 4
      || inputs.get(report.predecessor.bindingId) !== report.predecessor.sha256
      || inputs.get(report.sourceChangeSet.report?.bindingId) !== report.sourceChangeSet.report?.sha256
      || inputs.get(report.sourceChangeSet.review?.bindingId) !== report.sourceChangeSet.review?.sha256
      || inputs.get(report.sourceChangeSet.observations?.bindingId) !== report.sourceChangeSet.observations?.sha256
      || report.sourceCandidateSet !== null) integrityFailure(binding.bindingId);
  } else {
    integrityFailure(binding.bindingId);
  }
  const ids = new Set();
  for (const asset of report.assets) {
    identifier(asset?.assetId, "assetId");
    if (ids.has(asset.assetId) || asset.frameId !== report.canonicalFrameId || !asset.source) integrityFailure(binding.bindingId);
    ids.add(asset.assetId);
  }
}

function validateAssetChain(records) {
  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    const previous = records[index - 1] ?? null;
    if (current.report.revision !== index + 1
      || (previous === null && current.report.predecessor !== null)
      || (previous !== null && (current.report.predecessor?.bindingId !== previous.reportBindingId
        || current.report.predecessor?.sha256 !== previous.reportSha256
        || current.report.predecessor?.revision !== previous.report.revision))) integrityFailure(current.reportBindingId);
  }
}

function validateChangeReport(report, binding, draft) {
  const inputs = new Map(binding.inputBindings.map((input) => [input.bindingId, input.artifactSha256]));
  const visibilityValid = report.schemaVersion === LEGACY_CHANGE_REPORT_VERSION
    ? binding.inputBindings.length === 2 && report.visibility === undefined
    : binding.inputBindings.length === 3
      && inputs.get(report.visibility?.bindingId) === report.visibility?.sha256
      && report.policy?.coverageMode === "CALIBRATED_SENSOR_VISIBILITY";
  if (report.draftId !== draft.draftId || report.canonicalFrameId !== draft.canonicalFrameId
    || binding.coordinateFrameId !== report.canonicalFrameId || !visibilityValid
    || inputs.get(report.baseline?.bindingId) !== report.baseline?.sha256
    || inputs.get(report.observations?.bindingId) !== report.observations?.sha256
    || !Array.isArray(report.changes)) integrityFailure(binding.bindingId);
}

function validateChangeReview(report, binding, draft) {
  const inputs = new Map(binding.inputBindings.map((input) => [input.bindingId, input.artifactSha256]));
  if (report.draftId !== draft.draftId || binding.inputBindings.length !== 1
    || inputs.get(report.changeReport?.bindingId) !== report.changeReport?.sha256
    || !Array.isArray(report.decisions)
    || report.summary?.confirmedCount + report.summary?.dismissedCount !== report.decisions.length
    || report.summary?.criticalCount > report.summary?.confirmedCount) integrityFailure(binding.bindingId);
}

async function storeJson({ uploads, multipartStore, uploadId, report, mediaType, operatorId, conflictCode }) {
  const content = Buffer.from(canonicalJson(report));
  const expectedSha256 = sha256(content);
  let upload;
  try {
    upload = (await uploads.initiate({
      uploadId, expectedSha256, expectedBytes: content.byteLength, mediaType,
      originalName: `${uploadId}.json`, operatorId,
    })).upload;
  } catch (error) {
    if (!new Set(["UPLOAD_CONFLICT", "UPLOAD_ALREADY_EXISTS", "UPLOAD_ALREADY_FINALIZED"]).has(error?.code)) throw error;
    const existing = await uploads.get(uploadId);
    if (existing.status === "COMPLETED" && existing.artifactSha256 === expectedSha256) return existing;
    throw new TwinAssetError(conflictCode, `Report upload ${uploadId} already exists.`, { cause: error });
  }
  for (let offset = 0, part = 1; offset < content.byteLength; offset += upload.partSizeBytes, part += 1) {
    await multipartStore.putPart(uploadId, part, content.subarray(offset, offset + upload.partSizeBytes));
  }
  return uploads.complete(uploadId, { operatorId });
}

function artifactRecord(binding, report) {
  return Object.freeze({
    reportBindingId: binding.bindingId,
    reportUploadId: binding.uploadId,
    reportSha256: binding.artifactSha256,
    report: Object.freeze(structuredClone(report)),
  });
}

function assetPosition(asset) {
  return [asset.pose.position.x, asset.pose.position.y, asset.pose.position.z];
}

function assetRevisionBindingId(draftId, predecessor) {
  const slot = predecessor === null
    ? `root-${draftId}`
    : `successor-${predecessor.reportBindingId}`;
  return `twin-assets-${sha256(slot).slice(0, 20)}`;
}

function visibilityEvidenceAt(position, visibility) {
  const matches = visibility.coverage.cells.filter((cell) => (
    cell.visibilityConfidence >= visibility.qualification.minimumVisibilityConfidence
    && position[2] >= cell.minimumZ
    && position[2] <= cell.maximumZ
    && pointInsidePolygon(position, cell.footprint)
  )).sort((left, right) => right.visibilityConfidence - left.visibilityConfidence
    || left.cellId.localeCompare(right.cellId));
  const best = matches[0];
  return best ? Object.freeze({ cellId: best.cellId, confidence: best.visibilityConfidence }) : null;
}

function pointInsidePolygon(position, polygon) {
  const [x, y] = position;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [cx, cy] = polygon[current];
    const [px, py] = polygon[previous];
    if (pointOnSegment(x, y, px, py, cx, cy)) return true;
    if (((cy > y) !== (py > y))
      && x < ((px - cx) * (y - cy)) / (py - cy) + cx) inside = !inside;
  }
  return inside;
}

function pointOnSegment(x, y, x1, y1, x2, y2) {
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
  if (dot < -1e-9) return false;
  return dot <= ((x2 - x1) ** 2 + (y2 - y1) ** 2) + 1e-9;
}

function euclidean(left, right) {
  return Math.sqrt(left.reduce((sum, value, index) => sum + ((value - right[index]) ** 2), 0));
}

function classKey(value) {
  return String(value).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
}

function identifier(value, field) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TwinAssetError("TWIN_ASSET_IDENTIFIER_INVALID", `${field} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TwinAssetError("TWIN_ASSET_INPUT_INVALID", `${field} is required.`);
  }
}

function optionalText(value, field, maximumLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maximumLength) {
    throw new TwinAssetError("TWIN_ASSET_INPUT_INVALID", `${field} must be at most ${maximumLength} characters.`);
  }
  return value.trim();
}

function invalidConfiguration(message) {
  throw new TwinAssetError("TWIN_ASSET_CONFIGURATION_INVALID", message);
}

function integrityFailure(bindingId) {
  throw new TwinAssetError("TWIN_ASSET_INTEGRITY_FAILED", `Stored artifact ${bindingId} does not match its sealed provenance.`);
}

function workflowIntegrityFailure(message) {
  throw new TwinAssetError("TWIN_ASSET_INTEGRITY_FAILED", message);
}

function now(clock) {
  const value = new Date(clock());
  if (!Number.isFinite(value.getTime())) invalidConfiguration("Clock returned an invalid date.");
  return value.toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}
