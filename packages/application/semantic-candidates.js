import { createHash, randomUUID } from "node:crypto";

const OBSERVATIONS_VERSION = "brash.semantic-observations/v1";
const REPORT_VERSION = "brash.asset-candidate-report/v1";
const REPORT_MEDIA_TYPE = "application/vnd.brash.asset-candidate-report+json";
const REVIEW_VERSION = "brash.asset-candidate-review/v1";
const REVIEW_MEDIA_TYPE = "application/vnd.brash.asset-candidate-review+json";
const MAXIMUM_JSON_BYTES = 2 * 1024 * 1024;
const MAXIMUM_OBSERVATIONS = 500;

export class SemanticCandidateError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SemanticCandidateError";
    this.code = code;
  }
}

export class SemanticCandidateService {
  #catalog;
  #registrations;
  #draftArtifacts;
  #uploads;
  #multipartStore;
  #clock;
  #candidateSetIdGenerator;

  constructor({
    catalog,
    registrations,
    draftArtifacts,
    uploads,
    multipartStore,
    clock = () => new Date(),
    candidateSetIdGenerator = () => `asset-candidates-${randomUUID()}`,
  }) {
    if (!catalog || typeof catalog.getMapDraftContext !== "function") invalidConfiguration("Catalog lookup is required.");
    if (!registrations || typeof registrations.list !== "function") invalidConfiguration("Registration lookup is required.");
    if (!draftArtifacts || typeof draftArtifacts.list !== "function" || typeof draftArtifacts.bind !== "function") {
      invalidConfiguration("Draft artifact provenance operations are required.");
    }
    if (!uploads || typeof uploads.initiate !== "function" || typeof uploads.get !== "function" || typeof uploads.complete !== "function") {
      invalidConfiguration("Upload lifecycle operations are required.");
    }
    if (!multipartStore || typeof multipartStore.get !== "function" || typeof multipartStore.putPart !== "function") {
      invalidConfiguration("Object-store read and write operations are required.");
    }
    if (typeof clock !== "function" || typeof candidateSetIdGenerator !== "function") {
      invalidConfiguration("Clock and candidate set ID generator must be functions.");
    }
    this.#catalog = catalog;
    this.#registrations = registrations;
    this.#draftArtifacts = draftArtifacts;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#candidateSetIdGenerator = candidateSetIdGenerator;
  }

  async create(draftId, input = {}) {
    identifier(draftId, "draftId");
    identifier(input.registrationId, "registrationId");
    identifier(input.observationBindingId, "observationBindingId");
    requiredText(input.operatorId, "operatorId");
    if (input.candidateSetId !== undefined) identifier(input.candidateSetId, "candidateSetId");
    await this.#requireEditableDraft(draftId);

    const registration = (await this.#registrations.list(draftId)).find(
      (candidate) => candidate.report.registrationId === input.registrationId,
    );
    if (!registration
      || registration.report.quality.outcome !== "PASSED"
      || registration.acceptance?.report.decision !== "APPROVED") {
      throw new SemanticCandidateError(
        "SEMANTIC_CANDIDATE_REGISTRATION_REQUIRED",
        "Semantic extraction requires a quality-passed, independently approved registration from the same draft.",
      );
    }
    const bindings = await this.#draftArtifacts.list(draftId);
    const observationBinding = bindings.find((binding) => binding.bindingId === input.observationBindingId);
    if (!observationBinding || observationBinding.role !== "SEMANTIC_OBSERVATIONS") {
      throw new SemanticCandidateError(
        "SEMANTIC_OBSERVATIONS_NOT_FOUND",
        `Semantic observation binding ${input.observationBindingId} was not found in map draft ${draftId}.`,
      );
    }
    const observations = await this.#readJson(observationBinding, OBSERVATIONS_VERSION);
    validateObservations(observations, observationBinding, bindings);
    if (observations.sourceFrameId !== registration.report.sourcePreview.frameId
      || observationBinding.coordinateFrameId !== observations.sourceFrameId) {
      throw new SemanticCandidateError(
        "SEMANTIC_OBSERVATIONS_FRAME_MISMATCH",
        "Semantic observations must be expressed in the approved registration source frame.",
      );
    }
    const candidateSetId = input.candidateSetId ?? this.#candidateSetIdGenerator();
    identifier(candidateSetId, "candidateSetId");
    const candidates = observations.observations.map((observation) => Object.freeze({
      candidateId: `${candidateSetId}-${observation.observationId}`,
      sourceObservationId: observation.observationId,
      suggestedClass: observation.classId,
      confidence: round(observation.confidence),
      canonicalPosition: Object.freeze(transformPosition(observation.position, registration.report.transform)),
      dimensions: Object.freeze(observation.dimensions.map(round)),
      evidence: Object.freeze(observation.evidence.map((item) => Object.freeze({ ...item }))),
    })).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    const configuration = Object.freeze({
      algorithm: "one-observation-one-candidate",
      transformSha256: sha256(canonicalJson(registration.report.transform)),
      observationModelParametersSha256: observations.model.parametersSha256,
    });
    const report = Object.freeze({
      schemaVersion: REPORT_VERSION,
      candidateSetId,
      draftId,
      registrationId: input.registrationId,
      registrationAcceptance: Object.freeze({
        bindingId: registration.acceptance.reportBindingId,
        sha256: registration.acceptance.reportSha256,
      }),
      observations: Object.freeze({
        bindingId: observationBinding.bindingId,
        sha256: observationBinding.artifactSha256,
        observationSetId: observations.observationSetId,
        sourceFrameId: observations.sourceFrameId,
      }),
      canonicalFrameId: registration.report.canonicalFrameId,
      extraction: Object.freeze({
        name: "brash-semantic-candidate-extractor",
        version: "1.0.0",
        configurationSha256: sha256(canonicalJson(configuration)),
      }),
      candidates: Object.freeze(candidates),
      createdBy: input.operatorId,
      createdAt: now(this.#clock),
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `asset-candidate-report-${candidateSetId}`,
      report,
      mediaType: REPORT_MEDIA_TYPE,
      operatorId: input.operatorId,
      conflictCode: "SEMANTIC_CANDIDATE_CONFLICT",
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `asset-candidate-report-${candidateSetId}`,
        uploadId: stored.uploadId,
        role: "ASSET_CANDIDATE_REPORT",
        coordinateFrameId: report.canonicalFrameId,
        inputBindingIds: [observationBinding.bindingId, registration.acceptance.reportBindingId],
        producer: {
          name: report.extraction.name,
          version: report.extraction.version,
          parametersSha256: report.extraction.configurationSha256,
        },
        operatorId: input.operatorId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new SemanticCandidateError("SEMANTIC_CANDIDATE_CONFLICT", `Candidate set ${candidateSetId} already exists.`, { cause: error });
      }
      throw error;
    }
    return candidateRecord(binding, report, null);
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraftContext(draftId);
    const bindings = await this.#draftArtifacts.list(draftId);
    const reviews = new Map();
    for (const binding of bindings.filter((candidate) => candidate.role === "ASSET_CANDIDATE_REVIEW"
      && candidate.producer?.name === "brash-asset-candidate-review")) {
      const report = await this.#readJson(binding, REVIEW_VERSION);
      const input = binding.inputBindings[0];
      if (binding.inputBindings.length !== 1
        || report.draftId !== draftId
        || report.candidateReport.bindingId !== input?.bindingId
        || report.candidateReport.sha256 !== input?.artifactSha256) integrityFailure(binding.bindingId);
      reviews.set(input.bindingId, artifactRecord(binding, report));
    }
    const records = [];
    for (const binding of bindings.filter((candidate) => candidate.role === "ASSET_CANDIDATE_REPORT"
      && candidate.producer?.name === "brash-semantic-candidate-extractor")) {
      const report = await this.#readJson(binding, REPORT_VERSION);
      const inputs = new Map(binding.inputBindings.map((item) => [item.bindingId, item.artifactSha256]));
      if (binding.inputBindings.length !== 2
        || report.draftId !== draftId
        || inputs.get(report.observations.bindingId) !== report.observations.sha256
        || inputs.get(report.registrationAcceptance.bindingId) !== report.registrationAcceptance.sha256) {
        integrityFailure(binding.bindingId);
      }
      records.push(candidateRecord(binding, report, reviews.get(binding.bindingId) ?? null));
    }
    return records.sort((left, right) => left.report.createdAt.localeCompare(right.report.createdAt));
  }

  async review(draftId, candidateSetId, input = {}) {
    identifier(draftId, "draftId");
    identifier(candidateSetId, "candidateSetId");
    requiredText(input.reviewerId, "reviewerId");
    await this.#requireEditableDraft(draftId);
    const candidateSet = (await this.list(draftId)).find(
      (candidate) => candidate.report.candidateSetId === candidateSetId,
    );
    if (!candidateSet) throw new SemanticCandidateError("SEMANTIC_CANDIDATE_NOT_FOUND", `Candidate set ${candidateSetId} was not found.`);
    if (candidateSet.review) throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_CONFLICT", `Candidate set ${candidateSetId} was already reviewed.`);
    if (candidateSet.report.createdBy === input.reviewerId) {
      throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEWER_CONFLICT", "Candidate reviewer must be different from the extraction operator.");
    }
    const decisions = normalizeDecisions(input.decisions, candidateSet.report.candidates);
    const report = Object.freeze({
      schemaVersion: REVIEW_VERSION,
      candidateSetId,
      draftId,
      candidateReport: Object.freeze({ bindingId: candidateSet.reportBindingId, sha256: candidateSet.reportSha256 }),
      decisions,
      summary: Object.freeze({
        acceptedCount: decisions.filter((decision) => decision.decision === "ACCEPTED").length,
        rejectedCount: decisions.filter((decision) => decision.decision === "REJECTED").length,
      }),
      reviewerId: input.reviewerId,
      note: optionalNote(input.note),
      reviewedAt: now(this.#clock),
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `asset-candidate-review-${candidateSetId}`,
      report,
      mediaType: REVIEW_MEDIA_TYPE,
      operatorId: input.reviewerId,
      conflictCode: "SEMANTIC_CANDIDATE_REVIEW_CONFLICT",
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `asset-candidate-review-${candidateSetId}`,
        uploadId: stored.uploadId,
        role: "ASSET_CANDIDATE_REVIEW",
        inputBindingIds: [candidateSet.reportBindingId],
        producer: {
          name: "brash-asset-candidate-review",
          version: "1.0.0",
          parametersSha256: sha256(canonicalJson({ candidateReportSha256: candidateSet.reportSha256 })),
        },
        operatorId: input.reviewerId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_CONFLICT", `Candidate set ${candidateSetId} was already reviewed.`, { cause: error });
      }
      throw error;
    }
    return artifactRecord(binding, report);
  }

  async #requireEditableDraft(draftId) {
    const context = await this.#catalog.getMapDraftContext(draftId);
    if (context.draft.status !== "DRAFT") {
      throw new SemanticCandidateError(
        "SEMANTIC_CANDIDATE_DRAFT_LOCKED",
        `Map draft ${draftId} is ${context.draft.status}; semantic candidate work requires DRAFT.`,
      );
    }
  }

  async #readJson(binding, schemaVersion) {
    const content = await this.#multipartStore.get(binding.artifactSha256);
    if (!Buffer.isBuffer(content)
      || content.byteLength > MAXIMUM_JSON_BYTES
      || sha256(content) !== binding.artifactSha256) integrityFailure(binding.bindingId);
    let report;
    try { report = JSON.parse(content.toString("utf8")); } catch {
      throw new SemanticCandidateError("SEMANTIC_CANDIDATE_JSON_INVALID", `Stored artifact ${binding.bindingId} is not valid JSON.`);
    }
    if (report?.schemaVersion !== schemaVersion) {
      throw new SemanticCandidateError("SEMANTIC_CANDIDATE_SCHEMA_INVALID", `Stored artifact ${binding.bindingId} has an unsupported schema.`);
    }
    return report;
  }
}

function validateObservations(report, binding, allBindings) {
  identifier(report.observationSetId, "observationSetId");
  requiredText(report.sourceFrameId, "sourceFrameId");
  if (!report.model || report.model.name !== binding.producer?.name
    || report.model.version !== binding.producer?.version
    || report.model.parametersSha256 !== binding.producer?.parametersSha256) {
    throw new SemanticCandidateError("SEMANTIC_OBSERVATIONS_PRODUCER_MISMATCH", "Observation model identity does not match artifact provenance.");
  }
  if (!Array.isArray(report.observations)
    || report.observations.length < 1
    || report.observations.length > MAXIMUM_OBSERVATIONS) {
    throw new SemanticCandidateError("SEMANTIC_OBSERVATIONS_INVALID", `observations must contain between 1 and ${MAXIMUM_OBSERVATIONS} items.`);
  }
  const inputIdentities = new Map(binding.inputBindings.map((input) => [input.bindingId, input.artifactSha256]));
  const storedIdentities = new Map(allBindings.map((item) => [item.bindingId, item.artifactSha256]));
  const identifiers = new Set();
  for (const [index, observation] of report.observations.entries()) {
    identifier(observation.observationId, `observations[${index}].observationId`);
    if (identifiers.has(observation.observationId)) invalidObservations("Observation IDs must be unique.");
    identifiers.add(observation.observationId);
    requiredText(observation.classId, `observations[${index}].classId`);
    if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) {
      invalidObservations(`observations[${index}].confidence must be between zero and one.`);
    }
    vector(observation.position, `observations[${index}].position`, false);
    vector(observation.dimensions, `observations[${index}].dimensions`, true);
    if (!Array.isArray(observation.evidence) || observation.evidence.length < 1 || observation.evidence.length > 20) {
      invalidObservations(`observations[${index}].evidence must contain between 1 and 20 items.`);
    }
    for (const evidence of observation.evidence) {
      identifier(evidence?.bindingId, `observations[${index}].evidence.bindingId`);
      if (typeof evidence?.artifactSha256 !== "string"
        || inputIdentities.get(evidence.bindingId) !== evidence.artifactSha256
        || storedIdentities.get(evidence.bindingId) !== evidence.artifactSha256) {
        invalidObservations(`observations[${index}] references evidence outside its sealed provenance.`);
      }
    }
  }
}

function normalizeDecisions(value, candidates) {
  if (!Array.isArray(value) || value.length !== candidates.length) {
    throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_INVALID", "Every candidate requires exactly one review decision.");
  }
  const expected = new Set(candidates.map((candidate) => candidate.candidateId));
  const seen = new Set();
  const decisions = value.map((item, index) => {
    identifier(item?.candidateId, `decisions[${index}].candidateId`);
    if (!expected.has(item.candidateId) || seen.has(item.candidateId)) {
      throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_INVALID", "Candidate decisions must be unique and belong to the reviewed report.");
    }
    seen.add(item.candidateId);
    if (!["ACCEPTED", "REJECTED"].includes(item.decision)) {
      throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_INVALID", "decision must be ACCEPTED or REJECTED.");
    }
    const accepted = item.decision === "ACCEPTED";
    if (accepted) {
      requiredText(item.displayName, `decisions[${index}].displayName`);
      requiredText(item.assetType, `decisions[${index}].assetType`);
    }
    return Object.freeze({
      candidateId: item.candidateId,
      decision: item.decision,
      displayName: accepted ? boundedText(item.displayName, "displayName", 200) : null,
      assetType: accepted ? boundedText(item.assetType, "assetType", 100) : null,
      properties: accepted ? normalizeProperties(item.properties) : Object.freeze({}),
    });
  }).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  return Object.freeze(decisions);
}

function normalizeProperties(value) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 20) {
    throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_INVALID", "properties must be an object with at most 20 fields.");
  }
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (!/^[a-z][a-zA-Z0-9]{0,63}$/.test(key)) {
      throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_INVALID", `Property key ${key} is invalid.`);
    }
    const candidate = value[key];
    if (!(["string", "number", "boolean"].includes(typeof candidate))
      || (typeof candidate === "string" && candidate.length > 500)
      || (typeof candidate === "number" && !Number.isFinite(candidate))) {
      throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_INVALID", `Property ${key} must be a bounded scalar value.`);
    }
    normalized[key] = candidate;
  }
  return Object.freeze(normalized);
}

function transformPosition(position, transform) {
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  return [
    round(transform.scale * (cosine * position[0] - sine * position[1]) + transform.translation.x),
    round(transform.scale * (sine * position[0] + cosine * position[1]) + transform.translation.y),
    round(position[2]),
  ];
}

async function storeJson({ uploads, multipartStore, uploadId, report, mediaType, operatorId, conflictCode }) {
  const content = Buffer.from(canonicalJson(report));
  const expectedSha256 = sha256(content);
  let upload;
  try {
    upload = (await uploads.initiate({
      uploadId,
      expectedSha256,
      expectedBytes: content.byteLength,
      mediaType,
      originalName: `${uploadId}.json`,
      operatorId,
    })).upload;
  } catch (error) {
    if (!new Set(["UPLOAD_CONFLICT", "UPLOAD_ALREADY_EXISTS", "UPLOAD_ALREADY_FINALIZED"]).has(error?.code)) throw error;
    const existing = await uploads.get(uploadId);
    if (existing.status === "COMPLETED" && existing.artifactSha256 === expectedSha256) return existing;
    throw new SemanticCandidateError(conflictCode, `Report upload ${uploadId} already exists.`, { cause: error });
  }
  for (let offset = 0, part = 1; offset < content.byteLength; offset += upload.partSizeBytes, part += 1) {
    await multipartStore.putPart(uploadId, part, content.subarray(offset, offset + upload.partSizeBytes));
  }
  return uploads.complete(uploadId, { operatorId });
}

function candidateRecord(binding, report, review) {
  return Object.freeze({ ...artifactRecord(binding, report), review });
}

function artifactRecord(binding, report) {
  return Object.freeze({
    reportBindingId: binding.bindingId,
    reportUploadId: binding.uploadId,
    reportSha256: binding.artifactSha256,
    report: Object.freeze(structuredClone(report)),
  });
}

function vector(value, field, positive) {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((item) => !Number.isFinite(item) || (positive && item <= 0))) invalidObservations(`${field} must contain three ${positive ? "positive " : ""}finite numbers.`);
}

function optionalNote(value) {
  if (value === undefined || value === null || value === "") return null;
  return boundedText(value, "note", 2_000);
}

function boundedText(value, field, maximum) {
  requiredText(value, field);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new SemanticCandidateError("SEMANTIC_CANDIDATE_REVIEW_INVALID", `${field} must contain at most ${maximum} characters.`);
  return normalized;
}

function identifier(value, field) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new SemanticCandidateError("SEMANTIC_CANDIDATE_IDENTIFIER_INVALID", `${field} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SemanticCandidateError("SEMANTIC_CANDIDATE_INPUT_INVALID", `${field} is required.`);
  }
}

function invalidConfiguration(message) {
  throw new SemanticCandidateError("SEMANTIC_CANDIDATE_CONFIGURATION_INVALID", message);
}

function invalidObservations(message) {
  throw new SemanticCandidateError("SEMANTIC_OBSERVATIONS_INVALID", message);
}

function integrityFailure(bindingId) {
  throw new SemanticCandidateError("SEMANTIC_CANDIDATE_INTEGRITY_FAILED", `Stored artifact ${bindingId} does not match its sealed provenance.`);
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
