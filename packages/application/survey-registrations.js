import { createHash, randomUUID } from "node:crypto";

const REPORT_SCHEMA_VERSION = "brash.survey-registration-report/v1";
const REPORT_MEDIA_TYPE = "application/vnd.brash.survey-registration-report+json";
const SOLVER_NAME = "brash.similarity-2d";
const SOLVER_VERSION = "1.0.0";
const MAXIMUM_REPORT_BYTES = 1024 * 1024;

export class SurveyRegistrationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SurveyRegistrationError";
    this.code = code;
  }
}

export class SurveyRegistrationService {
  #catalog;
  #materializations;
  #draftArtifacts;
  #uploads;
  #multipartStore;
  #clock;
  #registrationIdGenerator;

  constructor({
    catalog,
    materializations,
    draftArtifacts,
    uploads,
    multipartStore,
    clock = () => new Date(),
    registrationIdGenerator = () => `registration-${randomUUID()}`,
  }) {
    if (!catalog || typeof catalog.getMapDraftContext !== "function") invalidConfiguration("Catalog lookup is required.");
    if (!materializations || typeof materializations.get !== "function") invalidConfiguration("Materialization lookup is required.");
    if (!draftArtifacts || typeof draftArtifacts.bind !== "function" || typeof draftArtifacts.list !== "function") {
      invalidConfiguration("Draft artifact provenance operations are required.");
    }
    if (!uploads || typeof uploads.initiate !== "function" || typeof uploads.get !== "function" || typeof uploads.complete !== "function") {
      invalidConfiguration("Upload lifecycle operations are required.");
    }
    if (!multipartStore || typeof multipartStore.get !== "function" || typeof multipartStore.putPart !== "function") {
      invalidConfiguration("Artifact-store reads and writes are required.");
    }
    if (typeof clock !== "function" || typeof registrationIdGenerator !== "function") {
      invalidConfiguration("Clock and registration ID generator must be functions.");
    }
    this.#catalog = catalog;
    this.#materializations = materializations;
    this.#draftArtifacts = draftArtifacts;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#registrationIdGenerator = registrationIdGenerator;
  }

  async create(draftId, input = {}) {
    identifier(draftId, "draftId");
    identifier(input.materializationJobId, "materializationJobId");
    requiredText(input.operatorId, "operatorId");
    if (input.registrationId !== undefined) identifier(input.registrationId, "registrationId");
    if (input.allowScale !== undefined && typeof input.allowScale !== "boolean") {
      throw new SurveyRegistrationError("SURVEY_REGISTRATION_INPUT_INVALID", "allowScale must be boolean.");
    }
    const context = await this.#catalog.getMapDraftContext(draftId);
    if (context.draft.status !== "DRAFT") {
      throw new SurveyRegistrationError(
        "SURVEY_REGISTRATION_DRAFT_LOCKED",
        `Map draft ${draftId} is ${context.draft.status}; registration requires DRAFT.`,
      );
    }
    const materialization = await this.#materializations.get(input.materializationJobId);
    if (materialization.draftId !== draftId
      || materialization.status !== "SUCCEEDED"
      || !materialization.output?.previewBindingId) {
      throw new SurveyRegistrationError(
        "SURVEY_REGISTRATION_PREVIEW_INELIGIBLE",
        "Registration requires a successful, provenance-bound preview from the same draft.",
      );
    }
    const registrationId = input.registrationId ?? this.#registrationIdGenerator();
    identifier(registrationId, "registrationId");
    const solved = solveSimilarity2D(input.controlPoints, input.allowScale ?? false);
    const configurationSha256 = sha256(canonicalJson({
      solver: SOLVER_NAME,
      version: SOLVER_VERSION,
      allowScale: input.allowScale ?? false,
      sourceFrameId: materialization.output.sourceFrameId,
      canonicalFrameId: context.draft.canonicalFrameId,
      controlPoints: solved.controlPoints,
    }));
    const report = Object.freeze({
      schemaVersion: REPORT_SCHEMA_VERSION,
      registrationId,
      draftId,
      materializationJobId: materialization.jobId,
      sourcePreview: Object.freeze({
        bindingId: materialization.output.previewBindingId,
        sha256: materialization.output.previewSha256,
        frameId: materialization.output.sourceFrameId,
      }),
      canonicalFrameId: context.draft.canonicalFrameId,
      solver: Object.freeze({
        name: SOLVER_NAME,
        version: SOLVER_VERSION,
        configurationSha256,
        allowScale: input.allowScale ?? false,
      }),
      transform: solved.transform,
      residuals: solved.residuals,
      metrics: solved.metrics,
      createdBy: input.operatorId,
      createdAt: now(this.#clock),
    });
    const content = Buffer.from(canonicalJson(report));
    if (content.byteLength > MAXIMUM_REPORT_BYTES) {
      throw new SurveyRegistrationError("SURVEY_REGISTRATION_REPORT_TOO_LARGE", "Registration report exceeds 1 MiB.");
    }
    const reportSha256 = sha256(content);
    const reportUploadId = `survey-registration-${registrationId}`;
    await storeReport({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: reportUploadId,
      content,
      expectedSha256: reportSha256,
      operatorId: input.operatorId,
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `survey-registration-report-${registrationId}`,
        uploadId: reportUploadId,
        role: "REGISTRATION_REPORT",
        coordinateFrameId: context.draft.canonicalFrameId,
        inputBindingIds: [materialization.output.previewBindingId],
        producer: {
          name: "brash-survey-registration",
          version: SOLVER_VERSION,
          parametersSha256: configurationSha256,
        },
        operatorId: input.operatorId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new SurveyRegistrationError("SURVEY_REGISTRATION_CONFLICT", `Registration ${registrationId} already exists.`, { cause: error });
      }
      throw error;
    }
    return record(binding, report);
  }

  async list(draftId) {
    identifier(draftId, "draftId");
    await this.#catalog.getMapDraftContext(draftId);
    const bindings = (await this.#draftArtifacts.list(draftId)).filter(
      (binding) => binding.role === "REGISTRATION_REPORT"
        && binding.producer?.name === "brash-survey-registration",
    );
    const registrations = [];
    for (const binding of bindings) {
      const content = await this.#multipartStore.get(binding.artifactSha256);
      if (!Buffer.isBuffer(content)
        || content.byteLength > MAXIMUM_REPORT_BYTES
        || sha256(content) !== binding.artifactSha256) {
        throw new SurveyRegistrationError(
          "SURVEY_REGISTRATION_INTEGRITY_FAILED",
          `Stored report ${binding.bindingId} no longer matches its artifact identity.`,
        );
      }
      let report;
      try {
        report = JSON.parse(content.toString("utf8"));
      } catch {
        throw new SurveyRegistrationError("SURVEY_REGISTRATION_REPORT_INVALID", `Stored report ${binding.bindingId} is not JSON.`);
      }
      if (report?.schemaVersion !== REPORT_SCHEMA_VERSION
        || report?.draftId !== draftId
        || report?.sourcePreview?.bindingId !== binding.inputBindings[0]?.bindingId) {
        throw new SurveyRegistrationError(
          "SURVEY_REGISTRATION_INTEGRITY_FAILED",
          `Stored report ${binding.bindingId} does not match its sealed provenance.`,
        );
      }
      registrations.push(record(binding, report));
    }
    return registrations.sort((left, right) => left.report.createdAt.localeCompare(right.report.createdAt));
  }
}

function solveSimilarity2D(value, allowScale) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 100) {
    throw new SurveyRegistrationError(
      "SURVEY_REGISTRATION_CONTROL_POINTS_INVALID",
      "controlPoints must contain between 2 and 100 pairs.",
    );
  }
  const identifiers = new Set();
  const controlPoints = value.map((pair, index) => {
    if (!pair || typeof pair !== "object" || Array.isArray(pair)) invalidControlPoint(index);
    identifier(pair.controlPointId, `controlPoints[${index}].controlPointId`);
    if (identifiers.has(pair.controlPointId)) invalidControlPoint(index, "IDs must be unique");
    identifiers.add(pair.controlPointId);
    return Object.freeze({
      controlPointId: pair.controlPointId,
      source: point(pair.source, `controlPoints[${index}].source`),
      target: point(pair.target, `controlPoints[${index}].target`),
    });
  }).sort((left, right) => left.controlPointId.localeCompare(right.controlPointId));
  const sourceCentroid = centroid(controlPoints.map((pair) => pair.source));
  const targetCentroid = centroid(controlPoints.map((pair) => pair.target));
  let dot = 0;
  let cross = 0;
  let sourceEnergy = 0;
  for (const pair of controlPoints) {
    const sx = pair.source.x - sourceCentroid.x;
    const sy = pair.source.y - sourceCentroid.y;
    const tx = pair.target.x - targetCentroid.x;
    const ty = pair.target.y - targetCentroid.y;
    dot += sx * tx + sy * ty;
    cross += sx * ty - sy * tx;
    sourceEnergy += sx * sx + sy * sy;
  }
  if (sourceEnergy < 1e-12 || Math.hypot(dot, cross) < 1e-12) {
    throw new SurveyRegistrationError(
      "SURVEY_REGISTRATION_GEOMETRY_DEGENERATE",
      "Control points do not define a stable 2D transform.",
    );
  }
  const rotationRadians = Math.atan2(cross, dot);
  const scale = allowScale ? Math.hypot(dot, cross) / sourceEnergy : 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100) {
    throw new SurveyRegistrationError("SURVEY_REGISTRATION_SCALE_INVALID", "Solved scale is outside the supported range.");
  }
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  const transform = Object.freeze({
    scale: round(scale),
    rotationRadians: round(rotationRadians),
    translation: Object.freeze({
      x: round(targetCentroid.x - scale * (cosine * sourceCentroid.x - sine * sourceCentroid.y)),
      y: round(targetCentroid.y - scale * (sine * sourceCentroid.x + cosine * sourceCentroid.y)),
    }),
  });
  const residuals = Object.freeze(controlPoints.map((pair) => {
    const transformed = applyTransform(transform, pair.source);
    const dxMetres = transformed.x - pair.target.x;
    const dyMetres = transformed.y - pair.target.y;
    return Object.freeze({
      ...pair,
      transformed,
      dxMetres: round(dxMetres),
      dyMetres: round(dyMetres),
      errorMetres: round(Math.hypot(dxMetres, dyMetres)),
    });
  }));
  const squaredError = residuals.reduce((sum, residual) => sum + residual.errorMetres ** 2, 0);
  return Object.freeze({
    controlPoints: Object.freeze(controlPoints),
    transform,
    residuals,
    metrics: Object.freeze({
      controlPointCount: residuals.length,
      rmseMetres: round(Math.sqrt(squaredError / residuals.length)),
      maximumErrorMetres: round(Math.max(...residuals.map((residual) => residual.errorMetres))),
      meanErrorMetres: round(residuals.reduce((sum, residual) => sum + residual.errorMetres, 0) / residuals.length),
      scaleDeviation: round(Math.abs(1 - transform.scale)),
    }),
  });
}

function applyTransform(transform, value) {
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  return Object.freeze({
    x: round(transform.scale * (cosine * value.x - sine * value.y) + transform.translation.x),
    y: round(transform.scale * (sine * value.x + cosine * value.y) + transform.translation.y),
  });
}

async function storeReport({ uploads, multipartStore, uploadId, content, expectedSha256, operatorId }) {
  let upload;
  try {
    const initiated = await uploads.initiate({
      uploadId,
      expectedSha256,
      expectedBytes: content.byteLength,
      mediaType: REPORT_MEDIA_TYPE,
      originalName: `${uploadId}.json`,
      operatorId,
    });
    upload = initiated.upload;
  } catch (error) {
    if (!["UPLOAD_CONFLICT", "UPLOAD_ALREADY_EXISTS", "UPLOAD_ALREADY_FINALIZED"].includes(error?.code)) throw error;
    const existing = await uploads.get(uploadId);
    if (existing.status === "COMPLETED" && existing.artifactSha256 === expectedSha256) return existing;
    throw new SurveyRegistrationError("SURVEY_REGISTRATION_CONFLICT", `Report upload ${uploadId} already exists.`, { cause: error });
  }
  for (let offset = 0, part = 1; offset < content.byteLength; offset += upload.partSizeBytes, part += 1) {
    await multipartStore.putPart(uploadId, part, content.subarray(offset, offset + upload.partSizeBytes));
  }
  const completed = await uploads.complete(uploadId, { operatorId });
  if (completed.artifactSha256 !== expectedSha256) {
    throw new SurveyRegistrationError("SURVEY_REGISTRATION_INTEGRITY_FAILED", "Completed report upload changed identity.");
  }
  return completed;
}

function record(binding, report) {
  return Object.freeze({
    reportBindingId: binding.bindingId,
    reportUploadId: binding.uploadId,
    reportSha256: binding.artifactSha256,
    report: Object.freeze(structuredClone(report)),
  });
}

function centroid(points) {
  return points.reduce((sum, value) => ({ x: sum.x + value.x / points.length, y: sum.y + value.y / points.length }), { x: 0, y: 0 });
}

function point(value, fieldName) {
  if (!value || typeof value !== "object" || !Number.isFinite(value.x) || !Number.isFinite(value.y)
    || Math.abs(value.x) > 10_000_000 || Math.abs(value.y) > 10_000_000) {
    throw new SurveyRegistrationError("SURVEY_REGISTRATION_CONTROL_POINTS_INVALID", `${fieldName} must contain bounded finite x and y values.`);
  }
  return Object.freeze({ x: round(value.x), y: round(value.y) });
}

function invalidControlPoint(index, detail = "must be an object") {
  throw new SurveyRegistrationError("SURVEY_REGISTRATION_CONTROL_POINTS_INVALID", `controlPoints[${index}] ${detail}.`);
}

function identifier(value, fieldName) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new SurveyRegistrationError("SURVEY_REGISTRATION_IDENTIFIER_INVALID", `${fieldName} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SurveyRegistrationError("SURVEY_REGISTRATION_INPUT_INVALID", `${fieldName} is required.`);
  }
}

function invalidConfiguration(message) {
  throw new SurveyRegistrationError("SURVEY_REGISTRATION_CONFIGURATION_INVALID", message);
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
  return Number(value.toFixed(12));
}
