import { createHash, randomUUID } from "node:crypto";

const REPORT_VERSION = "brash.survey-quality-report/v1";
const REPORT_MEDIA_TYPE = "application/vnd.brash.survey-quality-report+json";
const ACCEPTANCE_VERSION = "brash.survey-quality-acceptance/v1";
const ACCEPTANCE_MEDIA_TYPE = "application/vnd.brash.survey-quality-acceptance+json";
const MAXIMUM_REPORT_BYTES = 1024 * 1024;
const DEFAULT_THRESHOLDS = Object.freeze({
  minimumCoverageRatio: 0.8,
  minimumTrajectoryPoseCount: 3,
  maximumTrajectoryStepMetres: 3,
  maximumNonIncreasingTimestamps: 0,
  minimumPointDensityPerSquareMetre: 0.25,
  maximumPreviewWarnings: 0,
});
const INTEGER_THRESHOLD_FIELDS = new Set([
  "minimumTrajectoryPoseCount",
  "maximumNonIncreasingTimestamps",
  "maximumPreviewWarnings",
]);

export class SurveyQualityReviewError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SurveyQualityReviewError";
    this.code = code;
  }
}

export class SurveyQualityReviewService {
  #catalog;
  #materializations;
  #draftArtifacts;
  #uploads;
  #multipartStore;
  #clock;
  #qualityReviewIdGenerator;
  #thresholds;

  constructor({
    catalog,
    materializations,
    draftArtifacts,
    uploads,
    multipartStore,
    clock = () => new Date(),
    qualityReviewIdGenerator = () => `survey-quality-${randomUUID()}`,
    thresholds = DEFAULT_THRESHOLDS,
  }) {
    if (!catalog || typeof catalog.getMapDraftContext !== "function") invalidConfiguration("Catalog lookup is required.");
    if (!materializations || typeof materializations.get !== "function" || typeof materializations.getPreview !== "function") {
      invalidConfiguration("Materialization and preview lookup are required.");
    }
    if (!draftArtifacts || typeof draftArtifacts.list !== "function" || typeof draftArtifacts.bind !== "function") {
      invalidConfiguration("Draft artifact provenance operations are required.");
    }
    if (!uploads || typeof uploads.initiate !== "function" || typeof uploads.get !== "function" || typeof uploads.complete !== "function") {
      invalidConfiguration("Upload lifecycle operations are required.");
    }
    if (!multipartStore || typeof multipartStore.get !== "function" || typeof multipartStore.putPart !== "function") {
      invalidConfiguration("Multipart object-store operations are required.");
    }
    if (typeof clock !== "function" || typeof qualityReviewIdGenerator !== "function") {
      invalidConfiguration("Clock and quality review ID generator must be functions.");
    }
    this.#catalog = catalog;
    this.#materializations = materializations;
    this.#draftArtifacts = draftArtifacts;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#qualityReviewIdGenerator = qualityReviewIdGenerator;
    this.#thresholds = normalizeThresholds(thresholds);
  }

  async create(draftId, input = {}) {
    identifier(draftId, "draftId");
    identifier(input.materializationJobId, "materializationJobId");
    requiredText(input.operatorId, "operatorId");
    if (input.qualityReviewId !== undefined) identifier(input.qualityReviewId, "qualityReviewId");
    const context = await this.#catalog.getMapDraftContext(draftId);
    if (context.draft.status !== "DRAFT") {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_DRAFT_LOCKED", `Map draft ${draftId} is ${context.draft.status}; quality review requires DRAFT.`);
    }
    const materialization = await this.#materializations.get(input.materializationJobId);
    if (materialization.draftId !== draftId || materialization.status !== "SUCCEEDED" || !materialization.output?.previewBindingId) {
      throw new SurveyQualityReviewError(
        "SURVEY_QUALITY_PREVIEW_INELIGIBLE",
        "Quality review requires a successful provenance-bound preview from the same draft.",
      );
    }
    const previewBinding = (await this.#draftArtifacts.list(draftId)).find(
      (binding) => binding.bindingId === materialization.output.previewBindingId
        && binding.role === "SURVEY_PREVIEW"
        && binding.artifactSha256 === materialization.output.previewSha256,
    );
    if (!previewBinding) {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_PREVIEW_INELIGIBLE", "Materialization preview provenance could not be verified.");
    }
    const preview = await this.#materializations.getPreview(input.materializationJobId);
    const metricsAndGrid = measurePreview(preview, materialization.snapshot?.quality?.coverageRatio);
    const issues = evaluate(metricsAndGrid.metrics, this.#thresholds);
    const qualityReviewId = input.qualityReviewId ?? this.#qualityReviewIdGenerator();
    identifier(qualityReviewId, "qualityReviewId");
    const report = Object.freeze({
      schemaVersion: REPORT_VERSION,
      qualityReviewId,
      draftId,
      materializationJobId: input.materializationJobId,
      sourcePreview: Object.freeze({
        bindingId: previewBinding.bindingId,
        sha256: previewBinding.artifactSha256,
        frameId: preview.coordinateSystem.rootFrameId,
      }),
      outcome: issues.length === 0 ? "PASSED" : "FAILED",
      metrics: metricsAndGrid.metrics,
      policy: Object.freeze({
        thresholds: this.#thresholds,
        policySha256: sha256(canonicalJson(this.#thresholds)),
      }),
      issues: Object.freeze(issues),
      coverageGrid: metricsAndGrid.coverageGrid,
      createdBy: input.operatorId,
      createdAt: now(this.#clock),
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `survey-quality-report-${qualityReviewId}`,
      report,
      mediaType: REPORT_MEDIA_TYPE,
      operatorId: input.operatorId,
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `survey-quality-report-${qualityReviewId}`,
        uploadId: stored.uploadId,
        role: "SURVEY_QUALITY_REPORT",
        coordinateFrameId: preview.coordinateSystem.rootFrameId,
        inputBindingIds: [previewBinding.bindingId],
        producer: {
          name: "brash-survey-quality",
          version: "1.0.0",
          parametersSha256: report.policy.policySha256,
        },
        operatorId: input.operatorId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new SurveyQualityReviewError("SURVEY_QUALITY_CONFLICT", `Quality review ${qualityReviewId} already exists.`, { cause: error });
      }
      throw error;
    }
    return qualityRecord(binding, report, null);
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraftContext(draftId);
    const bindings = await this.#draftArtifacts.list(draftId);
    const reports = bindings.filter((binding) => binding.role === "SURVEY_QUALITY_REPORT"
      && binding.producer?.name === "brash-survey-quality");
    const acceptances = new Map();
    for (const binding of bindings.filter((candidate) => candidate.role === "SURVEY_QUALITY_ACCEPTANCE"
      && candidate.producer?.name === "brash-survey-quality-review")) {
      const report = await this.#read(binding, ACCEPTANCE_VERSION);
      const input = binding.inputBindings[0];
      if (binding.inputBindings.length !== 1
        || report.draftId !== draftId
        || report.qualityReport.bindingId !== input?.bindingId
        || report.qualityReport.sha256 !== input?.artifactSha256) {
        integrityFailure(binding.bindingId);
      }
      acceptances.set(input.bindingId, artifactRecord(binding, report));
    }
    const records = [];
    for (const binding of reports) {
      const report = await this.#read(binding, REPORT_VERSION);
      const input = binding.inputBindings[0];
      if (binding.inputBindings.length !== 1
        || report.draftId !== draftId
        || report.sourcePreview.bindingId !== input?.bindingId
        || report.sourcePreview.sha256 !== input?.artifactSha256) {
        integrityFailure(binding.bindingId);
      }
      records.push(qualityRecord(binding, report, acceptances.get(binding.bindingId) ?? null));
    }
    return records.sort((left, right) => left.report.createdAt.localeCompare(right.report.createdAt));
  }

  async review(draftId, qualityReviewId, input = {}) {
    identifier(draftId, "draftId");
    identifier(qualityReviewId, "qualityReviewId");
    requiredText(input.reviewerId, "reviewerId");
    if (!new Set(["APPROVED", "REJECTED"]).has(input.decision)) {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_REVIEW_INVALID", "decision must be APPROVED or REJECTED.");
    }
    if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 2_000)) {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_REVIEW_INVALID", "note must contain at most 2,000 characters.");
    }
    const context = await this.#catalog.getMapDraftContext(draftId);
    if (context.draft.status !== "DRAFT") {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_DRAFT_LOCKED", `Map draft ${draftId} is ${context.draft.status}; quality review requires DRAFT.`);
    }
    const quality = (await this.list(draftId)).find((candidate) => candidate.report.qualityReviewId === qualityReviewId);
    if (!quality) throw new SurveyQualityReviewError("SURVEY_QUALITY_NOT_FOUND", `Quality review ${qualityReviewId} was not found.`);
    if (quality.acceptance) throw new SurveyQualityReviewError("SURVEY_QUALITY_REVIEW_CONFLICT", `Quality review ${qualityReviewId} was already reviewed.`);
    if (quality.report.createdBy === input.reviewerId) {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_REVIEWER_CONFLICT", "Quality reviewer must be different from the report operator.");
    }
    if (input.decision === "APPROVED" && quality.report.outcome !== "PASSED") {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_FAILED", "A failed survey quality report cannot be approved.");
    }
    const report = Object.freeze({
      schemaVersion: ACCEPTANCE_VERSION,
      qualityReviewId,
      draftId,
      qualityReport: Object.freeze({ bindingId: quality.reportBindingId, sha256: quality.reportSha256 }),
      decision: input.decision,
      qualityOutcome: quality.report.outcome,
      reviewerId: input.reviewerId,
      note: input.note?.trim() || null,
      reviewedAt: now(this.#clock),
    });
    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `survey-quality-acceptance-${qualityReviewId}`,
      report,
      mediaType: ACCEPTANCE_MEDIA_TYPE,
      operatorId: input.reviewerId,
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `survey-quality-acceptance-${qualityReviewId}`,
        uploadId: stored.uploadId,
        role: "SURVEY_QUALITY_ACCEPTANCE",
        inputBindingIds: [quality.reportBindingId],
        producer: {
          name: "brash-survey-quality-review",
          version: "1.0.0",
          parametersSha256: sha256(canonicalJson({
            reportSha256: quality.reportSha256,
            policySha256: quality.report.policy.policySha256,
          })),
        },
        operatorId: input.reviewerId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new SurveyQualityReviewError("SURVEY_QUALITY_REVIEW_CONFLICT", `Quality review ${qualityReviewId} was already reviewed.`, { cause: error });
      }
      throw error;
    }
    return artifactRecord(binding, report);
  }

  async findApprovedForMaterialization(draftId, materializationJobId) {
    return (await this.list(draftId)).find((record) => record.report.materializationJobId === materializationJobId
      && record.report.outcome === "PASSED"
      && record.acceptance?.report.decision === "APPROVED") ?? null;
  }

  async #read(binding, version) {
    const content = await this.#multipartStore.get(binding.artifactSha256);
    if (!Buffer.isBuffer(content) || content.byteLength > MAXIMUM_REPORT_BYTES || sha256(content) !== binding.artifactSha256) {
      integrityFailure(binding.bindingId);
    }
    let report;
    try { report = JSON.parse(content.toString("utf8")); } catch {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_REPORT_INVALID", `Stored report ${binding.bindingId} is not JSON.`);
    }
    if (report?.schemaVersion !== version) {
      throw new SurveyQualityReviewError("SURVEY_QUALITY_REPORT_INVALID", `Stored report ${binding.bindingId} has an unsupported schema.`);
    }
    return report;
  }
}

function measurePreview(preview, declaredCoverageRatio) {
  const projection = preview.reconstruction.planProjection;
  const bounds = projection
    ? {
      minimum: [projection.bounds.minimum[0], projection.bounds.minimum[1], projection.heightRangeMetres.minimum],
      maximum: [projection.bounds.maximum[0], projection.bounds.maximum[1], projection.heightRangeMetres.maximum],
    }
    : preview.reconstruction.bounds;
  const width = Math.max(0, bounds.maximum[0] - bounds.minimum[0]);
  const height = Math.max(0, bounds.maximum[1] - bounds.minimum[1]);
  const footprint = round(width * height);
  const coverageGrid = buildCoverageGrid(preview, bounds);
  const densityPointCount = projection?.projectedPointCount ?? preview.reconstruction.vertexCount;
  const metrics = Object.freeze({
    declaredCoverageRatio: Number.isFinite(declaredCoverageRatio) ? round(declaredCoverageRatio) : null,
    sampledOccupancyRatio: round(coverageGrid.cells.length / (coverageGrid.columns * coverageGrid.rows)),
    trajectoryPoseCount: preview.trajectory.sampleCount,
    trajectoryDurationSeconds: round(preview.trajectory.timestamp.durationSeconds),
    trajectoryMedianRateHz: round(preview.trajectory.sampling.medianRateHz),
    trajectoryMaximumStepMetres: round(preview.trajectory.maximumStepMetres),
    trajectoryNonIncreasingTimestampCount: preview.trajectory.timestamp.nonIncreasingCount,
    reconstructionVertexCount: preview.reconstruction.vertexCount,
    reconstructionFootprintSquareMetres: footprint,
    pointDensityPerSquareMetre: footprint > 0 ? round(densityPointCount / footprint) : 0,
    previewWarningCount: preview.qualityWarnings.length,
    frameConsistent: preview.trajectory.frameId === preview.coordinateSystem.rootFrameId
      && preview.reconstruction.frameId === preview.coordinateSystem.rootFrameId,
  });
  return { metrics, coverageGrid };
}

function buildCoverageGrid(preview, bounds) {
  const columns = 12;
  const rows = 12;
  const minimum = bounds.minimum;
  const maximum = bounds.maximum;
  const width = Math.max(1e-9, maximum[0] - minimum[0]);
  const height = Math.max(1e-9, maximum[1] - minimum[1]);
  const counts = new Map();
  const points = preview.reconstruction.planProjection?.samples ?? preview.reconstruction.preview.points;
  for (const point of points) {
    const column = Math.min(columns - 1, Math.max(0, Math.floor(((point[0] - minimum[0]) / width) * columns)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((point[1] - minimum[1]) / height) * rows)));
    const key = `${row}:${column}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cells = [...counts.entries()].map(([key, sampleCount]) => {
    const [row, column] = key.split(":").map(Number);
    return Object.freeze({ column, row, sampleCount });
  }).sort((left, right) => left.row - right.row || left.column - right.column);
  return Object.freeze({
    frameId: preview.coordinateSystem.rootFrameId,
    columns,
    rows,
    bounds: Object.freeze({
      minimum: Object.freeze([round(minimum[0]), round(minimum[1])]),
      maximum: Object.freeze([round(maximum[0]), round(maximum[1])]),
    }),
    cells: Object.freeze(cells),
  });
}

function evaluate(metrics, thresholds) {
  const issues = [];
  compareMinimum(issues, "COVERAGE_BELOW_MINIMUM", "declaredCoverageRatio", metrics.declaredCoverageRatio, thresholds.minimumCoverageRatio);
  compareMinimum(issues, "TRAJECTORY_POSES_BELOW_MINIMUM", "trajectoryPoseCount", metrics.trajectoryPoseCount, thresholds.minimumTrajectoryPoseCount);
  compareMaximum(issues, "TRAJECTORY_STEP_EXCEEDED", "trajectoryMaximumStepMetres", metrics.trajectoryMaximumStepMetres, thresholds.maximumTrajectoryStepMetres);
  compareMaximum(issues, "TRAJECTORY_TIMESTAMPS_INVALID", "trajectoryNonIncreasingTimestampCount", metrics.trajectoryNonIncreasingTimestampCount, thresholds.maximumNonIncreasingTimestamps);
  compareMinimum(issues, "POINT_DENSITY_BELOW_MINIMUM", "pointDensityPerSquareMetre", metrics.pointDensityPerSquareMetre, thresholds.minimumPointDensityPerSquareMetre);
  compareMaximum(issues, "PREVIEW_WARNINGS_EXCEEDED", "previewWarningCount", metrics.previewWarningCount, thresholds.maximumPreviewWarnings);
  if (!metrics.frameConsistent) issues.push(Object.freeze({ code: "SURVEY_FRAME_MISMATCH", metric: "frameConsistent", observed: false, limit: true }));
  return issues;
}

function compareMinimum(issues, code, metric, observed, limit) {
  if (observed === null || observed < limit) issues.push(Object.freeze({ code, metric, observed, limit }));
}

function compareMaximum(issues, code, metric, observed, limit) {
  if (observed > limit) issues.push(Object.freeze({ code, metric, observed, limit }));
}

function normalizeThresholds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidConfiguration("Quality thresholds must be an object.");
  const normalized = {};
  for (const field of Object.keys(DEFAULT_THRESHOLDS)) {
    const candidate = value[field];
    if (!Number.isFinite(candidate) || candidate < 0 || (field === "minimumCoverageRatio" && candidate > 1)) {
      invalidConfiguration(`${field} must be a bounded non-negative number.`);
    }
    if (INTEGER_THRESHOLD_FIELDS.has(field) && !Number.isInteger(candidate)) invalidConfiguration(`${field} must be an integer.`);
    normalized[field] = round(candidate);
  }
  return Object.freeze(normalized);
}

async function storeJson({ uploads, multipartStore, uploadId, report, mediaType, operatorId }) {
  const content = Buffer.from(canonicalJson(report));
  const expectedSha256 = sha256(content);
  let upload;
  try {
    const initiated = await uploads.initiate({
      uploadId,
      expectedSha256,
      expectedBytes: content.byteLength,
      mediaType,
      originalName: `${uploadId}.json`,
      operatorId,
    });
    upload = initiated.upload;
  } catch (error) {
    if (!new Set(["UPLOAD_CONFLICT", "UPLOAD_ALREADY_EXISTS", "UPLOAD_ALREADY_FINALIZED"]).has(error?.code)) throw error;
    const existing = await uploads.get(uploadId);
    if (existing.status === "COMPLETED" && existing.artifactSha256 === expectedSha256) return existing;
    throw new SurveyQualityReviewError("SURVEY_QUALITY_CONFLICT", `Report upload ${uploadId} already exists.`, { cause: error });
  }
  for (let offset = 0, part = 1; offset < content.byteLength; offset += upload.partSizeBytes, part += 1) {
    await multipartStore.putPart(uploadId, part, content.subarray(offset, offset + upload.partSizeBytes));
  }
  return uploads.complete(uploadId, { operatorId });
}

function qualityRecord(binding, report, acceptance) {
  return Object.freeze({ ...artifactRecord(binding, report), acceptance });
}

function artifactRecord(binding, report) {
  return Object.freeze({
    reportBindingId: binding.bindingId,
    reportUploadId: binding.uploadId,
    reportSha256: binding.artifactSha256,
    report: Object.freeze(structuredClone(report)),
  });
}

function integrityFailure(bindingId) {
  throw new SurveyQualityReviewError("SURVEY_QUALITY_INTEGRITY_FAILED", `Stored report ${bindingId} does not match its sealed provenance.`);
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new SurveyQualityReviewError("SURVEY_QUALITY_IDENTIFIER_INVALID", `${fieldName} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SurveyQualityReviewError("SURVEY_QUALITY_INPUT_INVALID", `${fieldName} is required.`);
  }
}

function invalidConfiguration(message) {
  throw new SurveyQualityReviewError("SURVEY_QUALITY_CONFIGURATION_INVALID", message);
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
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function round(value) {
  return Math.round(value * 1e9) / 1e9;
}
