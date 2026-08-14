import { createHash, randomUUID } from "node:crypto";

const ASSET_SET_VERSION = "brash.draft-twin-assets/v1";
const ASSET_SET_MEDIA_TYPE = "application/vnd.brash.draft-twin-assets+json";
const CHANGE_REPORT_VERSION = "brash.asset-change-report/v1";
const CHANGE_REPORT_MEDIA_TYPE = "application/vnd.brash.asset-change-report+json";
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
const MAXIMUM_ASSETS = 5_000;
const POSITION_TOLERANCE_METERS = 0.5;
const MINIMUM_CONFIDENCE = 0.75;
const REQUIRED_CONFIRMATIONS = 1;
const MAXIMUM_MATCH_DISTANCE_METERS = 5;
const COVERAGE_PADDING_METERS = 1.5;

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
  #draftArtifacts;
  #uploads;
  #multipartStore;
  #clock;
  #assetSetIdGenerator;
  #changeSetIdGenerator;

  constructor({
    catalog,
    semanticCandidates,
    draftArtifacts,
    uploads,
    multipartStore,
    clock = () => new Date(),
    assetSetIdGenerator = () => `asset-set-${randomUUID()}`,
    changeSetIdGenerator = () => `asset-changes-${randomUUID()}`,
  }) {
    if (!catalog || typeof catalog.getMapDraftContext !== "function") invalidConfiguration("Catalog lookup is required.");
    if (!semanticCandidates || typeof semanticCandidates.list !== "function") invalidConfiguration("Semantic candidate lookup is required.");
    if (!draftArtifacts || typeof draftArtifacts.list !== "function" || typeof draftArtifacts.bind !== "function") {
      invalidConfiguration("Draft artifact provenance operations are required.");
    }
    if (!uploads || typeof uploads.initiate !== "function" || typeof uploads.get !== "function" || typeof uploads.complete !== "function") {
      invalidConfiguration("Upload lifecycle operations are required.");
    }
    if (!multipartStore || typeof multipartStore.get !== "function" || typeof multipartStore.putPart !== "function") {
      invalidConfiguration("Object-store read and write operations are required.");
    }
    if (typeof clock !== "function" || typeof assetSetIdGenerator !== "function" || typeof changeSetIdGenerator !== "function") {
      invalidConfiguration("Clock and ID generators must be functions.");
    }
    this.#catalog = catalog;
    this.#semanticCandidates = semanticCandidates;
    this.#draftArtifacts = draftArtifacts;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#assetSetIdGenerator = assetSetIdGenerator;
    this.#changeSetIdGenerator = changeSetIdGenerator;
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
        bindingId: `twin-assets-${assetSetId}`,
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
      && candidate.producer?.name === "brash-twin-asset-promoter")) {
      const report = await this.#readJson(binding, ASSET_SET_VERSION);
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
    requiredText(input.operatorId, "operatorId");
    if (input.changeSetId !== undefined) identifier(input.changeSetId, "changeSetId");
    const context = await this.#requireEditableDraft(draftId);
    const baseline = (await this.list(draftId)).at(-1);
    if (!baseline) throw new TwinAssetError("TWIN_ASSET_BASELINE_REQUIRED", "Change detection requires a promoted Twin asset baseline.");
    const candidateSet = (await this.#semanticCandidates.list(draftId)).find(
      (candidate) => candidate.report.candidateSetId === input.candidateSetId,
    );
    if (!candidateSet) throw new TwinAssetError("TWIN_ASSET_CANDIDATE_NOT_FOUND", `Candidate set ${input.candidateSetId} was not found.`);
    if (candidateSet.report.canonicalFrameId !== baseline.report.canonicalFrameId
      || candidateSet.report.canonicalFrameId !== context.draft.canonicalFrameId) {
      throw new TwinAssetError("TWIN_ASSET_FRAME_MISMATCH", "Change observations and baseline assets must share the draft canonical frame.");
    }
    if (baseline.report.assets.some((asset) => asset.source.candidateSetId === input.candidateSetId)) {
      throw new TwinAssetError("TWIN_ASSET_CHANGE_INPUT_INVALID", "A candidate set used to create the baseline cannot also test that baseline.");
    }
    const changeSetId = input.changeSetId ?? this.#changeSetIdGenerator();
    identifier(changeSetId, "changeSetId");
    const comparison = compareAssets(baseline.report.assets, candidateSet.report.candidates, changeSetId);
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
      policy: Object.freeze({
        matchingAlgorithm: "CLASS_NEAREST_NEIGHBOR",
        maximumMatchDistanceMeters: MAXIMUM_MATCH_DISTANCE_METERS,
        coverageMode: "OBSERVED_ENVELOPE",
        coveragePaddingMeters: COVERAGE_PADDING_METERS,
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
        inputBindingIds: [baseline.reportBindingId, candidateSet.reportBindingId],
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
    const records = [];
    for (const binding of bindings.filter((candidate) => candidate.role === "ASSET_CHANGE_REPORT"
      && candidate.producer?.name === "brash-twin-asset-change-detector")) {
      const report = await this.#readJson(binding, CHANGE_REPORT_VERSION);
      validateChangeReport(report, binding, context.draft);
      records.push(artifactRecord(binding, report));
    }
    return records.sort((left, right) => left.report.createdAt.localeCompare(right.report.createdAt));
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
    if (report?.schemaVersion !== schemaVersion) {
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

function compareAssets(assets, candidates, changeSetId) {
  const positions = candidates.map((candidate) => candidate.canonicalPosition);
  const minimum = [0, 1, 2].map((axis) => round(Math.min(...positions.map((position) => position[axis])) - COVERAGE_PADDING_METERS));
  const maximum = [0, 1, 2].map((axis) => round(Math.max(...positions.map((position) => position[axis])) + COVERAGE_PADDING_METERS));
  const coveredAssets = assets.filter((asset) => insideEnvelope(assetPosition(asset), minimum, maximum));
  const possiblePairs = [];
  for (const asset of coveredAssets) {
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
  const coverageConfidence = Math.max(...candidates.map((candidate) => candidate.confidence));
  for (const asset of coveredAssets.filter((candidate) => !matchedAssets.has(candidate.assetId))) {
    if (coverageConfidence >= asset.changePolicy.minimumConfidence) {
      changes.push(changeRecord(changeSetId, "MISSING", asset, null, null, coverageConfidence));
    }
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
    coverage: Object.freeze({ minimum: Object.freeze(minimum), maximum: Object.freeze(maximum), baselineAssetsEvaluated: coveredAssets.length }),
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

function changeRecord(changeSetId, type, asset, candidate, distance, confidence) {
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
    reviewStatus: "REVIEW_REQUIRED",
  });
}

function validateAssetSet(report, binding, draft) {
  if (report.draftId !== draft.draftId || report.canonicalFrameId !== draft.canonicalFrameId
    || binding.coordinateFrameId !== report.canonicalFrameId || !Number.isInteger(report.revision)
    || report.revision < 1 || !Array.isArray(report.assets) || report.assets.length > MAXIMUM_ASSETS) integrityFailure(binding.bindingId);
  const inputs = new Map(binding.inputBindings.map((input) => [input.bindingId, input.artifactSha256]));
  const expectedCount = report.predecessor ? 3 : 2;
  if (binding.inputBindings.length !== expectedCount
    || inputs.get(report.sourceCandidateSet?.report?.bindingId) !== report.sourceCandidateSet?.report?.sha256
    || inputs.get(report.sourceCandidateSet?.review?.bindingId) !== report.sourceCandidateSet?.review?.sha256
    || (report.predecessor && inputs.get(report.predecessor.bindingId) !== report.predecessor.sha256)) integrityFailure(binding.bindingId);
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
  if (report.draftId !== draft.draftId || report.canonicalFrameId !== draft.canonicalFrameId
    || binding.coordinateFrameId !== report.canonicalFrameId || binding.inputBindings.length !== 2
    || inputs.get(report.baseline?.bindingId) !== report.baseline?.sha256
    || inputs.get(report.observations?.bindingId) !== report.observations?.sha256
    || !Array.isArray(report.changes)) integrityFailure(binding.bindingId);
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

function insideEnvelope(position, minimum, maximum) {
  return position.every((coordinate, axis) => coordinate >= minimum[axis] && coordinate <= maximum[axis]);
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

function invalidConfiguration(message) {
  throw new TwinAssetError("TWIN_ASSET_CONFIGURATION_INVALID", message);
}

function integrityFailure(bindingId) {
  throw new TwinAssetError("TWIN_ASSET_INTEGRITY_FAILED", `Stored artifact ${bindingId} does not match its sealed provenance.`);
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
