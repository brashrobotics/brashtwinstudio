import { createHash, randomUUID } from "node:crypto";

const OBSERVATIONS_VERSION = "brash.sensor-visibility-observations/v1";
const REPORT_VERSION = "brash.sensor-visibility-report/v1";
const REPORT_MEDIA_TYPE = "application/vnd.brash.sensor-visibility-report+json";
const MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;
const MAXIMUM_CELLS = 20_000;
const MINIMUM_PRODUCTION_CONFIDENCE = 0.8;
const REQUIRED_EVIDENCE_KINDS = Object.freeze(["CALIBRATION", "OCCLUSION_GEOMETRY", "SENSOR_POSES"]);

export class SensorVisibilityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SensorVisibilityError";
    this.code = code;
  }
}

export class SensorVisibilityService {
  #catalog;
  #registrations;
  #draftArtifacts;
  #uploads;
  #multipartStore;
  #clock;
  #reportIdGenerator;

  constructor({
    catalog,
    registrations,
    draftArtifacts,
    uploads,
    multipartStore,
    clock = () => new Date(),
    reportIdGenerator = () => `sensor-visibility-${randomUUID()}`,
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
    if (typeof clock !== "function" || typeof reportIdGenerator !== "function") {
      invalidConfiguration("Clock and visibility report ID generator must be functions.");
    }
    this.#catalog = catalog;
    this.#registrations = registrations;
    this.#draftArtifacts = draftArtifacts;
    this.#uploads = uploads;
    this.#multipartStore = multipartStore;
    this.#clock = clock;
    this.#reportIdGenerator = reportIdGenerator;
  }

  async create(draftId, input = {}) {
    identifier(draftId, "draftId");
    identifier(input.registrationId, "registrationId");
    identifier(input.observationBindingId, "observationBindingId");
    requiredText(input.operatorId, "operatorId");
    if (input.visibilityReportId !== undefined) identifier(input.visibilityReportId, "visibilityReportId");
    await this.#requireEditableDraft(draftId);

    const registration = (await this.#registrations.list(draftId)).find(
      (candidate) => candidate.report.registrationId === input.registrationId,
    );
    if (!registration
      || registration.report.quality.outcome !== "PASSED"
      || registration.acceptance?.report.decision !== "APPROVED") {
      throw new SensorVisibilityError(
        "SENSOR_VISIBILITY_REGISTRATION_REQUIRED",
        "Visibility transformation requires a quality-passed, independently approved registration from the same draft.",
      );
    }

    const bindings = await this.#draftArtifacts.list(draftId);
    const observationBinding = bindings.find((binding) => binding.bindingId === input.observationBindingId);
    if (!observationBinding || observationBinding.role !== "SENSOR_VISIBILITY_OBSERVATIONS") {
      throw new SensorVisibilityError(
        "SENSOR_VISIBILITY_OBSERVATIONS_NOT_FOUND",
        `Sensor visibility observation binding ${input.observationBindingId} was not found in map draft ${draftId}.`,
      );
    }
    const observations = await this.#readJson(observationBinding, OBSERVATIONS_VERSION);
    const normalized = validateObservations(observations, observationBinding, bindings);
    if (observations.sourceFrameId !== registration.report.sourcePreview.frameId
      || observationBinding.coordinateFrameId !== observations.sourceFrameId) {
      throw new SensorVisibilityError(
        "SENSOR_VISIBILITY_FRAME_MISMATCH",
        "Sensor visibility observations must be expressed in the approved registration source frame.",
      );
    }

    const visibilityReportId = input.visibilityReportId ?? this.#reportIdGenerator();
    identifier(visibilityReportId, "visibilityReportId");
    if ((await this.list(draftId)).some((record) => record.report.observations.bindingId === observationBinding.bindingId)) {
      throw new SensorVisibilityError(
        "SENSOR_VISIBILITY_CONFLICT",
        `Visibility observations ${observationBinding.bindingId} were already transformed.`,
      );
    }

    const qualificationIssues = [];
    if (!observations.coverageModel.calibrated) qualificationIssues.push("CALIBRATION_NOT_ASSERTED");
    if (!observations.coverageModel.poseSynchronized) qualificationIssues.push("POSES_NOT_SYNCHRONIZED");
    if (!observations.coverageModel.occlusionAware) qualificationIssues.push("OCCLUSION_NOT_MODELED");
    if (observations.coverageModel.minimumVisibilityConfidence < MINIMUM_PRODUCTION_CONFIDENCE) {
      qualificationIssues.push("CONFIDENCE_POLICY_TOO_LOW");
    }
    const qualifiedCells = normalized.cells.filter(
      (cell) => cell.visibilityConfidence >= observations.coverageModel.minimumVisibilityConfidence,
    );
    if (qualifiedCells.length === 0) qualificationIssues.push("NO_QUALIFIED_CELLS");
    const outcome = qualificationIssues.length === 0 ? "QUALIFIED" : "UNQUALIFIED";
    const transformSha256 = sha256(canonicalJson(registration.report.transform));
    const cells = normalized.cells.map((cell) => transformCell(cell, registration.report.transform));
    const report = Object.freeze({
      schemaVersion: REPORT_VERSION,
      visibilityReportId,
      draftId,
      registrationId: input.registrationId,
      registrationAcceptance: Object.freeze({
        bindingId: registration.acceptance.reportBindingId,
        sha256: registration.acceptance.reportSha256,
      }),
      observations: Object.freeze({
        bindingId: observationBinding.bindingId,
        sha256: observationBinding.artifactSha256,
        visibilitySetId: observations.visibilitySetId,
        semanticObservationSetId: observations.semanticObservationSetId,
        sourceFrameId: observations.sourceFrameId,
      }),
      canonicalFrameId: registration.report.canonicalFrameId,
      transformation: Object.freeze({
        name: "brash-sensor-visibility-transformer",
        version: "1.0.0",
        transformSha256,
      }),
      qualification: Object.freeze({
        outcome,
        calibrated: observations.coverageModel.calibrated,
        poseSynchronized: observations.coverageModel.poseSynchronized,
        occlusionAware: observations.coverageModel.occlusionAware,
        minimumVisibilityConfidence: observations.coverageModel.minimumVisibilityConfidence,
        requiredMinimumConfidence: MINIMUM_PRODUCTION_CONFIDENCE,
        issues: Object.freeze(qualificationIssues.sort()),
      }),
      evidence: Object.freeze(normalized.evidence.map((item) => Object.freeze({ ...item }))),
      coverage: Object.freeze({
        cellCount: cells.length,
        qualifiedCellCount: qualifiedCells.length,
        summedCellAreaSquareMeters: round(cells.reduce((sum, cell) => sum + cell.areaSquareMeters, 0)),
        cells: Object.freeze(cells),
      }),
      createdBy: input.operatorId,
      createdAt: now(this.#clock),
    });

    const stored = await storeJson({
      uploads: this.#uploads,
      multipartStore: this.#multipartStore,
      uploadId: `sensor-visibility-report-${visibilityReportId}`,
      report,
      mediaType: REPORT_MEDIA_TYPE,
      operatorId: input.operatorId,
      conflictCode: "SENSOR_VISIBILITY_CONFLICT",
    });
    let binding;
    try {
      binding = await this.#draftArtifacts.bind(draftId, {
        bindingId: `sensor-visibility-report-${visibilityReportId}`,
        uploadId: stored.uploadId,
        role: "SENSOR_VISIBILITY_REPORT",
        coordinateFrameId: report.canonicalFrameId,
        inputBindingIds: [observationBinding.bindingId, registration.acceptance.reportBindingId],
        producer: {
          name: report.transformation.name,
          version: report.transformation.version,
          parametersSha256: sha256(canonicalJson({
            transformSha256,
            requiredMinimumConfidence: MINIMUM_PRODUCTION_CONFIDENCE,
          })),
        },
        operatorId: input.operatorId,
      });
    } catch (error) {
      if (error?.code === "DRAFT_ARTIFACT_CONFLICT") {
        throw new SensorVisibilityError("SENSOR_VISIBILITY_CONFLICT", `Visibility report ${visibilityReportId} already exists.`, { cause: error });
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
    for (const binding of bindings.filter((candidate) => candidate.role === "SENSOR_VISIBILITY_REPORT"
      && candidate.producer?.name === "brash-sensor-visibility-transformer")) {
      const report = await this.#readJson(binding, REPORT_VERSION);
      validateReport(report, binding, context.draft);
      records.push(artifactRecord(binding, report));
    }
    return records.sort((left, right) => left.report.createdAt.localeCompare(right.report.createdAt));
  }

  async #requireEditableDraft(draftId) {
    const context = await this.#catalog.getMapDraftContext(draftId);
    if (context.draft.status !== "DRAFT") {
      throw new SensorVisibilityError(
        "SENSOR_VISIBILITY_DRAFT_LOCKED",
        `Map draft ${draftId} is ${context.draft.status}; visibility processing requires DRAFT.`,
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
      throw new SensorVisibilityError("SENSOR_VISIBILITY_JSON_INVALID", `Stored artifact ${binding.bindingId} is not valid JSON.`);
    }
    if (report?.schemaVersion !== schemaVersion) {
      throw new SensorVisibilityError("SENSOR_VISIBILITY_SCHEMA_INVALID", `Stored artifact ${binding.bindingId} has an unsupported schema.`);
    }
    return report;
  }
}

function validateObservations(report, binding, allBindings) {
  identifier(report.visibilitySetId, "visibilitySetId");
  identifier(report.semanticObservationSetId, "semanticObservationSetId");
  requiredText(report.sourceFrameId, "sourceFrameId");
  if (!report.model || report.model.name !== binding.producer?.name
    || report.model.version !== binding.producer?.version
    || report.model.parametersSha256 !== binding.producer?.parametersSha256) {
    throw new SensorVisibilityError(
      "SENSOR_VISIBILITY_PRODUCER_MISMATCH",
      "Visibility model identity does not match artifact provenance.",
    );
  }
  const coverageModel = report.coverageModel;
  if (!coverageModel || coverageModel.method !== "CALIBRATED_SENSOR_VISIBILITY_GRID"
    || typeof coverageModel.calibrated !== "boolean"
    || typeof coverageModel.poseSynchronized !== "boolean"
    || typeof coverageModel.occlusionAware !== "boolean"
    || !Number.isFinite(coverageModel.minimumVisibilityConfidence)
    || coverageModel.minimumVisibilityConfidence < 0
    || coverageModel.minimumVisibilityConfidence > 1) invalidObservations("coverageModel is invalid.");

  if (!Array.isArray(report.evidence) || report.evidence.length !== REQUIRED_EVIDENCE_KINDS.length) {
    invalidObservations(`evidence must contain exactly ${REQUIRED_EVIDENCE_KINDS.join(", ")}.`);
  }
  const inputs = new Map(binding.inputBindings.map((input) => [input.bindingId, input.artifactSha256]));
  const stored = new Map(allBindings.map((item) => [item.bindingId, item.artifactSha256]));
  const evidenceKinds = new Set();
  const evidenceBindings = new Set();
  const evidence = report.evidence.map((item, index) => {
    if (!REQUIRED_EVIDENCE_KINDS.includes(item?.kind) || evidenceKinds.has(item.kind)) {
      invalidObservations(`evidence[${index}].kind is duplicated or unsupported.`);
    }
    identifier(item.bindingId, `evidence[${index}].bindingId`);
    if (evidenceBindings.has(item.bindingId)
      || inputs.get(item.bindingId) !== item.artifactSha256
      || stored.get(item.bindingId) !== item.artifactSha256) {
      invalidObservations(`evidence[${index}] is duplicated or outside sealed provenance.`);
    }
    evidenceKinds.add(item.kind);
    evidenceBindings.add(item.bindingId);
    return Object.freeze({ kind: item.kind, bindingId: item.bindingId, artifactSha256: item.artifactSha256 });
  }).sort((left, right) => left.kind.localeCompare(right.kind));
  if (binding.inputBindings.length !== evidence.length
    || REQUIRED_EVIDENCE_KINDS.some((kind) => !evidenceKinds.has(kind))) {
    invalidObservations("Visibility evidence and artifact inputs must form the same complete set.");
  }

  if (!Array.isArray(report.cells) || report.cells.length < 1 || report.cells.length > MAXIMUM_CELLS) {
    invalidObservations(`cells must contain between 1 and ${MAXIMUM_CELLS} items.`);
  }
  const cellIds = new Set();
  const cells = report.cells.map((cell, index) => {
    identifier(cell?.cellId, `cells[${index}].cellId`);
    if (cellIds.has(cell.cellId)) invalidObservations("Cell IDs must be unique.");
    cellIds.add(cell.cellId);
    const minimum = vector3(cell.minimum, `cells[${index}].minimum`);
    const maximum = vector3(cell.maximum, `cells[${index}].maximum`);
    if (minimum.some((coordinate, axis) => coordinate >= maximum[axis])) {
      invalidObservations(`cells[${index}] must have positive bounds on every axis.`);
    }
    if (!Number.isFinite(cell.visibilityConfidence) || cell.visibilityConfidence < 0 || cell.visibilityConfidence > 1) {
      invalidObservations(`cells[${index}].visibilityConfidence must be between zero and one.`);
    }
    if (!Number.isSafeInteger(cell.sampleCount) || cell.sampleCount < 1 || cell.sampleCount > 10_000_000) {
      invalidObservations(`cells[${index}].sampleCount must be a positive bounded integer.`);
    }
    return Object.freeze({
      cellId: cell.cellId,
      minimum: Object.freeze(minimum),
      maximum: Object.freeze(maximum),
      visibilityConfidence: round(cell.visibilityConfidence),
      sampleCount: cell.sampleCount,
    });
  }).sort((left, right) => left.cellId.localeCompare(right.cellId));
  return Object.freeze({ cells: Object.freeze(cells), evidence: Object.freeze(evidence) });
}

function validateReport(report, binding, draft) {
  const inputs = new Map(binding.inputBindings.map((input) => [input.bindingId, input.artifactSha256]));
  const cells = report.coverage?.cells;
  const minimumConfidence = report.qualification?.minimumVisibilityConfidence;
  const expectedIssues = [];
  if (report.qualification?.calibrated !== true) expectedIssues.push("CALIBRATION_NOT_ASSERTED");
  if (report.qualification?.poseSynchronized !== true) expectedIssues.push("POSES_NOT_SYNCHRONIZED");
  if (report.qualification?.occlusionAware !== true) expectedIssues.push("OCCLUSION_NOT_MODELED");
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < MINIMUM_PRODUCTION_CONFIDENCE) {
    expectedIssues.push("CONFIDENCE_POLICY_TOO_LOW");
  }
  const qualifiedCellCount = Array.isArray(cells) && Number.isFinite(minimumConfidence)
    ? cells.filter((cell) => cell?.visibilityConfidence >= minimumConfidence).length
    : 0;
  if (qualifiedCellCount === 0) expectedIssues.push("NO_QUALIFIED_CELLS");
  const expectedOutcome = expectedIssues.length === 0 ? "QUALIFIED" : "UNQUALIFIED";
  const evidenceKinds = Array.isArray(report.evidence)
    ? [...report.evidence].map((item) => item?.kind).sort()
    : [];
  if (report.draftId !== draft.draftId || report.canonicalFrameId !== draft.canonicalFrameId
    || binding.coordinateFrameId !== report.canonicalFrameId || binding.inputBindings.length !== 2
    || inputs.get(report.observations?.bindingId) !== report.observations?.sha256
    || typeof report.observations?.semanticObservationSetId !== "string"
    || inputs.get(report.registrationAcceptance?.bindingId) !== report.registrationAcceptance?.sha256
    || !Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1
    || report.qualification?.requiredMinimumConfidence !== MINIMUM_PRODUCTION_CONFIDENCE
    || report.qualification?.outcome !== expectedOutcome
    || JSON.stringify([...(report.qualification?.issues ?? [])].sort()) !== JSON.stringify(expectedIssues.sort())
    || JSON.stringify(evidenceKinds) !== JSON.stringify(REQUIRED_EVIDENCE_KINDS)
    || !validStoredCells(cells)
    || report.coverage.cellCount !== cells.length
    || report.coverage.qualifiedCellCount !== qualifiedCellCount
    || report.coverage.summedCellAreaSquareMeters !== round(cells.reduce(
      (sum, cell) => sum + cell.areaSquareMeters,
      0,
    ))) integrityFailure(binding.bindingId);
}

function validStoredCells(cells) {
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > MAXIMUM_CELLS) return false;
  const ids = new Set();
  return cells.every((cell) => {
    if (!cell || typeof cell.cellId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cell.cellId)
      || ids.has(cell.cellId) || !Array.isArray(cell.footprint) || cell.footprint.length !== 4
      || cell.footprint.some((point) => !Array.isArray(point) || point.length !== 2
        || point.some((coordinate) => !Number.isFinite(coordinate)))
      || !Number.isFinite(cell.minimumZ) || !Number.isFinite(cell.maximumZ) || cell.minimumZ >= cell.maximumZ
      || !Number.isFinite(cell.visibilityConfidence) || cell.visibilityConfidence < 0 || cell.visibilityConfidence > 1
      || !Number.isSafeInteger(cell.sampleCount) || cell.sampleCount < 1
      || !Number.isFinite(cell.areaSquareMeters) || cell.areaSquareMeters <= 0) return false;
    ids.add(cell.cellId);
    return true;
  });
}

function transformCell(cell, transform) {
  const corners = [
    [cell.minimum[0], cell.minimum[1]],
    [cell.maximum[0], cell.minimum[1]],
    [cell.maximum[0], cell.maximum[1]],
    [cell.minimum[0], cell.maximum[1]],
  ].map((point) => Object.freeze(transformPoint2D(point, transform)));
  return Object.freeze({
    cellId: cell.cellId,
    footprint: Object.freeze(corners),
    minimumZ: cell.minimum[2],
    maximumZ: cell.maximum[2],
    visibilityConfidence: cell.visibilityConfidence,
    sampleCount: cell.sampleCount,
    areaSquareMeters: round(
      (cell.maximum[0] - cell.minimum[0]) * (cell.maximum[1] - cell.minimum[1]) * (transform.scale ** 2),
    ),
  });
}

function transformPoint2D(point, transform) {
  const cosine = Math.cos(transform.rotationRadians);
  const sine = Math.sin(transform.rotationRadians);
  return [
    round(transform.scale * (cosine * point[0] - sine * point[1]) + transform.translation.x),
    round(transform.scale * (sine * point[0] + cosine * point[1]) + transform.translation.y),
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
    throw new SensorVisibilityError(conflictCode, `Report upload ${uploadId} already exists.`, { cause: error });
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

function vector3(value, field) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((coordinate) => !Number.isFinite(coordinate))) {
    invalidObservations(`${field} must be a finite three-dimensional vector.`);
  }
  return value.map(round);
}

function identifier(value, field) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new SensorVisibilityError("SENSOR_VISIBILITY_IDENTIFIER_INVALID", `${field} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SensorVisibilityError("SENSOR_VISIBILITY_INPUT_INVALID", `${field} is required.`);
  }
}

function invalidObservations(message) {
  throw new SensorVisibilityError("SENSOR_VISIBILITY_OBSERVATIONS_INVALID", message);
}

function invalidConfiguration(message) {
  throw new SensorVisibilityError("SENSOR_VISIBILITY_CONFIGURATION_INVALID", message);
}

function integrityFailure(bindingId) {
  throw new SensorVisibilityError(
    "SENSOR_VISIBILITY_INTEGRITY_FAILED",
    `Stored artifact ${bindingId} does not match its sealed provenance.`,
  );
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
