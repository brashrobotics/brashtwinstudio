export const MAP_DRAFT_STATUS = Object.freeze({
  draft: "DRAFT",
  inReview: "IN_REVIEW",
  validated: "VALIDATED",
  published: "PUBLISHED",
});

export const PUBLICATION_STATUS = Object.freeze({
  pendingApproval: "PENDING_APPROVAL",
  approved: "APPROVED",
  publishing: "PUBLISHING",
  storePublished: "STORE_PUBLISHED",
  completed: "COMPLETED",
});

export const UPLOAD_STATUS = Object.freeze({
  initiated: "INITIATED",
  uploading: "UPLOADING",
  completed: "COMPLETED",
  quarantined: "QUARANTINED",
  cancelled: "CANCELLED",
  expired: "EXPIRED",
});

export const SURVEY_INTAKE_STATUS = Object.freeze({
  open: "OPEN",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
});

export const SURVEY_MATERIALIZATION_STATUS = Object.freeze({
  pending: "PENDING",
  running: "RUNNING",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
});

export const DRAFT_ARTIFACT_KIND = Object.freeze({
  source: "SOURCE",
  derived: "DERIVED",
});

export const DRAFT_ARTIFACT_ROLE = Object.freeze({
  bimSource: "BIM_SOURCE",
  floorplanSource: "FLOORPLAN_SOURCE",
  pointCloudSource: "POINT_CLOUD_SOURCE",
  trajectorySource: "TRAJECTORY_SOURCE",
  cameraSource: "CAMERA_SOURCE",
  calibrationSource: "CALIBRATION_SOURCE",
  surveySource: "SURVEY_SOURCE",
  surveyPreview: "SURVEY_PREVIEW",
  surveyQualityReport: "SURVEY_QUALITY_REPORT",
  surveyQualityAcceptance: "SURVEY_QUALITY_ACCEPTANCE",
  semanticObservations: "SEMANTIC_OBSERVATIONS",
  sensorVisibilityObservations: "SENSOR_VISIBILITY_OBSERVATIONS",
  sensorVisibilityReport: "SENSOR_VISIBILITY_REPORT",
  assetCandidateReport: "ASSET_CANDIDATE_REPORT",
  assetCandidateReview: "ASSET_CANDIDATE_REVIEW",
  twinAssets: "TWIN_ASSETS",
  assetChangeReport: "ASSET_CHANGE_REPORT",
  assetChangeReview: "ASSET_CHANGE_REVIEW",
  registeredPointCloud: "REGISTERED_POINT_CLOUD",
  reconstructedMesh: "RECONSTRUCTED_MESH",
  occupancy: "OCCUPANCY",
  elevation: "ELEVATION",
  sceneTileset: "SCENE_TILESET",
  importReport: "IMPORT_REPORT",
  registrationReport: "REGISTRATION_REPORT",
  registrationAcceptance: "REGISTRATION_ACCEPTANCE",
  validationReport: "VALIDATION_REPORT",
});

const SOURCE_DRAFT_ARTIFACT_ROLES = new Set([
  DRAFT_ARTIFACT_ROLE.bimSource,
  DRAFT_ARTIFACT_ROLE.floorplanSource,
  DRAFT_ARTIFACT_ROLE.pointCloudSource,
  DRAFT_ARTIFACT_ROLE.trajectorySource,
  DRAFT_ARTIFACT_ROLE.cameraSource,
  DRAFT_ARTIFACT_ROLE.calibrationSource,
  DRAFT_ARTIFACT_ROLE.surveySource,
]);

const SPATIAL_DRAFT_ARTIFACT_ROLES = new Set([
  DRAFT_ARTIFACT_ROLE.bimSource,
  DRAFT_ARTIFACT_ROLE.floorplanSource,
  DRAFT_ARTIFACT_ROLE.pointCloudSource,
  DRAFT_ARTIFACT_ROLE.trajectorySource,
  DRAFT_ARTIFACT_ROLE.cameraSource,
  DRAFT_ARTIFACT_ROLE.surveyPreview,
  DRAFT_ARTIFACT_ROLE.surveyQualityReport,
  DRAFT_ARTIFACT_ROLE.semanticObservations,
  DRAFT_ARTIFACT_ROLE.sensorVisibilityObservations,
  DRAFT_ARTIFACT_ROLE.sensorVisibilityReport,
  DRAFT_ARTIFACT_ROLE.assetCandidateReport,
  DRAFT_ARTIFACT_ROLE.twinAssets,
  DRAFT_ARTIFACT_ROLE.assetChangeReport,
  DRAFT_ARTIFACT_ROLE.registeredPointCloud,
  DRAFT_ARTIFACT_ROLE.reconstructedMesh,
  DRAFT_ARTIFACT_ROLE.occupancy,
  DRAFT_ARTIFACT_ROLE.elevation,
  DRAFT_ARTIFACT_ROLE.sceneTileset,
  DRAFT_ARTIFACT_ROLE.registrationAcceptance,
]);

export class TwinDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TwinDomainError";
    this.code = code;
  }
}

export class MapDraft {
  #status;
  #validationReportHash;

  constructor({ draftId, familyId, revision, canonicalFrameId, createdBy, createdAt = new Date() }) {
    requiredIdentifier(draftId, "draftId");
    requiredIdentifier(familyId, "familyId");
    requiredIdentifier(canonicalFrameId, "canonicalFrameId");
    requiredIdentifier(createdBy, "createdBy");
    if (!Number.isInteger(revision) || revision < 1) {
      throw new TwinDomainError("MAP_REVISION_INVALID", "Map revision must be a positive integer.");
    }
    this.draftId = draftId;
    this.familyId = familyId;
    this.revision = revision;
    this.canonicalFrameId = canonicalFrameId;
    this.createdBy = createdBy;
    this.createdAt = new Date(createdAt);
    this.#status = MAP_DRAFT_STATUS.draft;
    this.#validationReportHash = null;
  }

  get status() {
    return this.#status;
  }

  submitForReview() {
    this.#requireStatus(MAP_DRAFT_STATUS.draft);
    this.#status = MAP_DRAFT_STATUS.inReview;
  }

  returnToDraft() {
    if (![MAP_DRAFT_STATUS.inReview, MAP_DRAFT_STATUS.validated].includes(this.#status)) {
      throw new TwinDomainError("MAP_DRAFT_TRANSITION_INVALID", `Cannot return ${this.#status} to draft.`);
    }
    this.#status = MAP_DRAFT_STATUS.draft;
    this.#validationReportHash = null;
  }

  markValidated(validationReportHash) {
    this.#requireStatus(MAP_DRAFT_STATUS.inReview);
    requiredIdentifier(validationReportHash, "validationReportHash");
    this.#validationReportHash = validationReportHash;
    this.#status = MAP_DRAFT_STATUS.validated;
  }

  publish({ releaseId, publishedBy, publishedAt = new Date() }) {
    this.#requireStatus(MAP_DRAFT_STATUS.validated);
    requiredIdentifier(releaseId, "releaseId");
    requiredIdentifier(publishedBy, "publishedBy");
    this.#status = MAP_DRAFT_STATUS.published;
    return Object.freeze({
      releaseId,
      familyId: this.familyId,
      revision: this.revision,
      canonicalFrameId: this.canonicalFrameId,
      validationReportHash: this.#validationReportHash,
      publishedBy,
      publishedAt: new Date(publishedAt).toISOString(),
      status: MAP_DRAFT_STATUS.published,
    });
  }

  #requireStatus(expected) {
    if (this.#status !== expected) {
      throw new TwinDomainError(
        "MAP_DRAFT_TRANSITION_INVALID",
        `Expected map draft status ${expected}, received ${this.#status}.`,
      );
    }
  }
}

export const MAP_DRAFT_ACTION = Object.freeze({
  submitReview: "SUBMIT_REVIEW",
  returnToDraft: "RETURN_TO_DRAFT",
  markValidated: "MARK_VALIDATED",
});

export const MAP_DRAFT_EVENT_TYPE = Object.freeze({
  created: "MapDraftCreated.v1",
  reviewSubmitted: "MapDraftReviewSubmitted.v1",
  returnedToDraft: "MapDraftReturnedToDraft.v1",
  validated: "MapDraftValidated.v1",
});

export const MAP_RELEASE_EVENT_TYPE = Object.freeze({
  published: "MapReleasePublished.v1",
});

export function createMapDraftRecord({
  draftId,
  familyId,
  revision,
  canonicalFrameId,
  operatorId,
  occurredAt = new Date(),
}) {
  requiredIdentifier(draftId, "draftId");
  requiredIdentifier(familyId, "familyId");
  requiredIdentifier(canonicalFrameId, "canonicalFrameId");
  requiredIdentifier(operatorId, "operatorId");
  if (!Number.isInteger(revision) || revision < 1) {
    throw new TwinDomainError("MAP_REVISION_INVALID", "Map revision must be a positive integer.");
  }
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    draftId,
    familyId,
    revision,
    canonicalFrameId,
    status: MAP_DRAFT_STATUS.draft,
    validationReportSha256: null,
    rowVersion: 1,
    createdBy: operatorId,
    createdAt: timestamp,
    updatedBy: operatorId,
    updatedAt: timestamp,
  });
}

export function transitionMapDraft(record, {
  action,
  operatorId,
  validationReportSha256,
  occurredAt = new Date(),
}) {
  if (!record || typeof record !== "object") {
    throw new TwinDomainError("MAP_DRAFT_REQUIRED", "Map draft record is required.");
  }
  requiredIdentifier(operatorId, "operatorId");
  let status;
  let reportHash = record.validationReportSha256 ?? null;
  if (action === MAP_DRAFT_ACTION.submitReview) {
    requireRecordStatus(record, MAP_DRAFT_STATUS.draft);
    status = MAP_DRAFT_STATUS.inReview;
    reportHash = null;
  } else if (action === MAP_DRAFT_ACTION.returnToDraft) {
    if (![MAP_DRAFT_STATUS.inReview, MAP_DRAFT_STATUS.validated].includes(record.status)) {
      throw new TwinDomainError("MAP_DRAFT_TRANSITION_INVALID", `Cannot return ${record.status} to draft.`);
    }
    status = MAP_DRAFT_STATUS.draft;
    reportHash = null;
  } else if (action === MAP_DRAFT_ACTION.markValidated) {
    requireRecordStatus(record, MAP_DRAFT_STATUS.inReview);
    if (typeof validationReportSha256 !== "string" || !/^[a-f0-9]{64}$/.test(validationReportSha256)) {
      throw new TwinDomainError(
        "VALIDATION_REPORT_HASH_INVALID",
        "validationReportSha256 must be 64 lowercase hexadecimal characters.",
      );
    }
    status = MAP_DRAFT_STATUS.validated;
    reportHash = validationReportSha256;
  } else {
    throw new TwinDomainError("MAP_DRAFT_ACTION_INVALID", `Unsupported map draft action ${String(action)}.`);
  }
  return Object.freeze({
    ...record,
    status,
    validationReportSha256: reportHash,
    rowVersion: record.rowVersion + 1,
    updatedBy: operatorId,
    updatedAt: isoDate(occurredAt, "occurredAt"),
  });
}

export function createPublicationRequestRecord({
  publicationId,
  draft,
  bundle,
  requestedBy,
  occurredAt = new Date(),
}) {
  requiredIdentifier(publicationId, "publicationId");
  requiredIdentifier(requestedBy, "requestedBy");
  if (!draft || typeof draft !== "object") {
    throw new TwinDomainError("MAP_DRAFT_REQUIRED", "Map draft record is required.");
  }
  requireRecordStatus(draft, MAP_DRAFT_STATUS.validated);
  if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.artifacts)) {
    throw new TwinDomainError("PUBLICATION_BUNDLE_REQUIRED", "A sealed publication bundle is required.");
  }
  const expectedReleaseId = `${draft.familyId}@${draft.revision}`;
  if (bundle.mapReleaseId !== expectedReleaseId
    || bundle.familyId !== draft.familyId
    || bundle.revision !== draft.revision
    || bundle.canonicalFrameId !== draft.canonicalFrameId) {
    throw new TwinDomainError(
      "PUBLICATION_BUNDLE_DRAFT_MISMATCH",
      `Publication bundle ${bundle.mapReleaseId ?? "<unknown>"} does not match draft ${draft.draftId}.`,
    );
  }
  publicationHash(bundle.manifestSha256, "bundle.manifestSha256");
  publicationHash(bundle.validationReportSha256, "bundle.validationReportSha256");
  if (bundle.validationReportSha256 !== draft.validationReportSha256) {
    throw new TwinDomainError(
      "PUBLICATION_VALIDATION_REPORT_MISMATCH",
      "Publication bundle does not reference the draft's sealed validation report.",
    );
  }
  if (bundle.artifacts.length === 0) {
    throw new TwinDomainError("PUBLICATION_ARTIFACTS_REQUIRED", "Publication bundle must contain artifacts.");
  }
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    publicationId,
    draftId: draft.draftId,
    draftRowVersion: draft.rowVersion,
    validationReportSha256: draft.validationReportSha256,
    releaseId: expectedReleaseId,
    bundle: structuredClone(bundle),
    status: PUBLICATION_STATUS.pendingApproval,
    requestedBy,
    requestedAt: timestamp,
    approvedBy: null,
    approvedAt: null,
    attemptCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: timestamp,
    storePublishedAt: null,
    completedAt: null,
    lastError: null,
    updatedAt: timestamp,
  });
}

export function approvePublicationRequestRecord(record, { approvedBy, occurredAt = new Date() }) {
  if (!record || record.status !== PUBLICATION_STATUS.pendingApproval) {
    throw new TwinDomainError("PUBLICATION_NOT_APPROVABLE", "Publication request is not pending approval.");
  }
  requiredIdentifier(approvedBy, "approvedBy");
  if (approvedBy === record.requestedBy) {
    throw new TwinDomainError(
      "PUBLICATION_TWO_PERSON_REQUIRED",
      "The publication approver must be different from the requester.",
    );
  }
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    ...record,
    status: PUBLICATION_STATUS.approved,
    approvedBy,
    approvedAt: timestamp,
    updatedAt: timestamp,
  });
}

export function publishMapDraftRecord(record, { publishedBy, occurredAt = new Date() }) {
  if (!record || typeof record !== "object") {
    throw new TwinDomainError("MAP_DRAFT_REQUIRED", "Map draft record is required.");
  }
  requireRecordStatus(record, MAP_DRAFT_STATUS.validated);
  requiredIdentifier(publishedBy, "publishedBy");
  return Object.freeze({
    ...record,
    status: MAP_DRAFT_STATUS.published,
    rowVersion: record.rowVersion + 1,
    updatedBy: publishedBy,
    updatedAt: isoDate(occurredAt, "occurredAt"),
  });
}

export function createMapReleasePublishedEvent({
  eventId,
  publication,
  draft,
  publishedAt = draft?.updatedAt,
}) {
  requiredIdentifier(eventId, "eventId");
  if (!publication || publication.status !== PUBLICATION_STATUS.storePublished) {
    throw new TwinDomainError(
      "PUBLICATION_STORE_EVIDENCE_REQUIRED",
      "Stored publication evidence is required before creating a published event.",
    );
  }
  if (!draft || draft.status !== MAP_DRAFT_STATUS.published) {
    throw new TwinDomainError("MAP_DRAFT_NOT_PUBLISHED", "Published map draft state is required.");
  }
  const timestamp = isoDate(publishedAt, "publishedAt");
  return Object.freeze({
    eventId,
    aggregateType: "MapRelease",
    aggregateId: publication.releaseId,
    eventType: MAP_RELEASE_EVENT_TYPE.published,
    schemaVersion: 1,
    occurredAt: timestamp,
    availableAt: timestamp,
    payload: Object.freeze({
      publicationId: publication.publicationId,
      releaseId: publication.releaseId,
      bundleId: publication.bundle.bundleId,
      familyId: draft.familyId,
      sourceDraftId: draft.draftId,
      revision: draft.revision,
      canonicalFrameId: draft.canonicalFrameId,
      manifestSha256: publication.bundle.manifestSha256,
      validationReportSha256: publication.validationReportSha256,
      requestedBy: publication.requestedBy,
      approvedBy: publication.approvedBy,
      publishedAt: timestamp,
    }),
  });
}

export function createMapDraftLifecycleEvent({
  eventId,
  record,
  previousStatus = null,
  action = null,
  operatorId,
  occurredAt = record?.updatedAt,
}) {
  requiredIdentifier(eventId, "eventId");
  if (!record || typeof record !== "object") {
    throw new TwinDomainError("MAP_DRAFT_REQUIRED", "Map draft record is required.");
  }
  requiredIdentifier(record.draftId, "draftId");
  requiredIdentifier(record.familyId, "familyId");
  requiredIdentifier(operatorId, "operatorId");
  const eventType = eventTypeFor(action);
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    eventId,
    aggregateType: "MapDraft",
    aggregateId: record.draftId,
    eventType,
    schemaVersion: 1,
    occurredAt: timestamp,
    availableAt: timestamp,
    payload: Object.freeze({
      draftId: record.draftId,
      familyId: record.familyId,
      revision: record.revision,
      canonicalFrameId: record.canonicalFrameId,
      action,
      previousStatus,
      status: record.status,
      rowVersion: record.rowVersion,
      operatorId,
      validationReportSha256: record.validationReportSha256 ?? null,
    }),
  });
}

export function createUploadSessionRecord({
  uploadId,
  expectedSha256,
  expectedBytes,
  mediaType,
  originalName,
  partSizeBytes,
  maximumParts,
  storageProvider,
  uploadKey,
  operatorId,
  expiresAt,
  occurredAt = new Date(),
}) {
  requiredIdentifier(uploadId, "uploadId");
  sha256(expectedSha256, "expectedSha256");
  positiveSafeInteger(expectedBytes, "expectedBytes");
  mediaTypeValue(mediaType);
  originalFileName(originalName);
  positiveSafeInteger(partSizeBytes, "partSizeBytes");
  positiveSafeInteger(maximumParts, "maximumParts");
  requiredIdentifier(storageProvider, "storageProvider");
  requiredIdentifier(uploadKey, "uploadKey");
  requiredIdentifier(operatorId, "operatorId");
  const timestamp = isoDate(occurredAt, "occurredAt");
  const expiry = isoDate(expiresAt, "expiresAt");
  if (new Date(expiry).getTime() <= new Date(timestamp).getTime()) {
    throw new TwinDomainError("UPLOAD_EXPIRY_INVALID", "Upload expiry must be later than its creation time.");
  }
  if (expectedBytes > partSizeBytes * maximumParts) {
    throw new TwinDomainError("UPLOAD_CAPACITY_INVALID", "Expected bytes exceed the multipart upload capacity.");
  }
  return Object.freeze({
    uploadId,
    status: UPLOAD_STATUS.initiated,
    expectedSha256,
    expectedBytes,
    observedSha256: null,
    observedBytes: null,
    artifactSha256: null,
    mediaType,
    originalName,
    partSizeBytes,
    maximumParts,
    storageProvider,
    uploadKey,
    quarantineReason: null,
    expiresAt: expiry,
    rowVersion: 1,
    createdBy: operatorId,
    createdAt: timestamp,
    updatedBy: operatorId,
    updatedAt: timestamp,
    completedAt: null,
  });
}

export function completeUploadSession(record, {
  sha256: observedSha256,
  bytes: observedBytes,
  objectKey,
  operatorId,
  occurredAt = new Date(),
}) {
  requireOpenUpload(record);
  sha256(observedSha256, "observedSha256");
  positiveSafeInteger(observedBytes, "observedBytes");
  requiredIdentifier(objectKey, "objectKey");
  requiredIdentifier(operatorId, "operatorId");
  if (record.expectedSha256 !== observedSha256 || record.expectedBytes !== observedBytes) {
    throw new TwinDomainError("UPLOAD_INTEGRITY_MISMATCH", "Observed upload integrity does not match the intent.");
  }
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    ...record,
    status: UPLOAD_STATUS.completed,
    observedSha256,
    observedBytes,
    artifactSha256: observedSha256,
    uploadKey: objectKey,
    quarantineReason: null,
    rowVersion: record.rowVersion + 1,
    updatedBy: operatorId,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
}

export function quarantineUploadSession(record, {
  observedSha256,
  observedBytes,
  quarantineKey,
  reason,
  operatorId,
  occurredAt = new Date(),
}) {
  requireOpenUpload(record);
  sha256(observedSha256, "observedSha256");
  nonNegativeSafeInteger(observedBytes, "observedBytes");
  requiredIdentifier(quarantineKey, "quarantineKey");
  requiredIdentifier(reason, "reason");
  requiredIdentifier(operatorId, "operatorId");
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    ...record,
    status: UPLOAD_STATUS.quarantined,
    observedSha256,
    observedBytes,
    artifactSha256: null,
    uploadKey: quarantineKey,
    quarantineReason: reason,
    rowVersion: record.rowVersion + 1,
    updatedBy: operatorId,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
}

export function cancelUploadSession(record, { operatorId, occurredAt = new Date() }) {
  requireOpenUpload(record);
  requiredIdentifier(operatorId, "operatorId");
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    ...record,
    status: UPLOAD_STATUS.cancelled,
    rowVersion: record.rowVersion + 1,
    updatedBy: operatorId,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
}

export function expireUploadSession(record, { operatorId, occurredAt = new Date() }) {
  requireOpenUpload(record);
  requiredIdentifier(operatorId, "operatorId");
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    ...record,
    status: UPLOAD_STATUS.expired,
    rowVersion: record.rowVersion + 1,
    updatedBy: operatorId,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
}

export function createDraftArtifactBindingRecord({
  bindingId,
  draftId,
  uploadId,
  artifactSha256,
  role,
  coordinateFrameId = null,
  inputBindings = [],
  producer = null,
  operatorId,
  occurredAt = new Date(),
}) {
  kebabIdentifier(bindingId, "bindingId");
  kebabIdentifier(draftId, "draftId");
  kebabIdentifier(uploadId, "uploadId");
  sha256(artifactSha256, "artifactSha256");
  requiredIdentifier(operatorId, "operatorId");
  if (!Object.values(DRAFT_ARTIFACT_ROLE).includes(role)) {
    throw new TwinDomainError("DRAFT_ARTIFACT_ROLE_INVALID", `Unsupported draft artifact role ${String(role)}.`);
  }
  const kind = SOURCE_DRAFT_ARTIFACT_ROLES.has(role)
    ? DRAFT_ARTIFACT_KIND.source
    : DRAFT_ARTIFACT_KIND.derived;
  if (SPATIAL_DRAFT_ARTIFACT_ROLES.has(role)) {
    requiredIdentifier(coordinateFrameId, "coordinateFrameId");
  } else if (coordinateFrameId !== null) {
    requiredIdentifier(coordinateFrameId, "coordinateFrameId");
  }
  if (!Array.isArray(inputBindings)) {
    throw new TwinDomainError("DRAFT_ARTIFACT_INPUTS_INVALID", "inputBindings must be an array.");
  }
  const normalizedInputs = inputBindings.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TwinDomainError("DRAFT_ARTIFACT_INPUTS_INVALID", `inputBindings[${index}] must be an object.`);
    }
    kebabIdentifier(input.bindingId, `inputBindings[${index}].bindingId`);
    sha256(input.artifactSha256, `inputBindings[${index}].artifactSha256`);
    if (input.bindingId === bindingId) {
      throw new TwinDomainError("DRAFT_ARTIFACT_INPUT_SELF_REFERENCE", "An artifact cannot derive from itself.");
    }
    return Object.freeze({ bindingId: input.bindingId, artifactSha256: input.artifactSha256 });
  });
  if (new Set(normalizedInputs.map((input) => input.bindingId)).size !== normalizedInputs.length) {
    throw new TwinDomainError("DRAFT_ARTIFACT_INPUTS_INVALID", "Input binding identities must be unique.");
  }
  let normalizedProducer = null;
  if (kind === DRAFT_ARTIFACT_KIND.source) {
    if (normalizedInputs.length > 0 || producer !== null) {
      throw new TwinDomainError(
        "DRAFT_ARTIFACT_PROVENANCE_INVALID",
        "Source artifacts cannot declare derived inputs or a producer.",
      );
    }
  } else {
    if (normalizedInputs.length === 0) {
      throw new TwinDomainError("DRAFT_ARTIFACT_INPUTS_REQUIRED", "Derived artifacts require at least one immutable input.");
    }
    if (!producer || typeof producer !== "object" || Array.isArray(producer)) {
      throw new TwinDomainError("DRAFT_ARTIFACT_PRODUCER_REQUIRED", "Derived artifacts require producer provenance.");
    }
    const unsupportedProducerFields = Object.keys(producer)
      .filter((field) => !["name", "version", "parametersSha256"].includes(field));
    if (unsupportedProducerFields.length > 0) {
      throw new TwinDomainError(
        "DRAFT_ARTIFACT_PRODUCER_INVALID",
        `Unsupported producer fields: ${unsupportedProducerFields.sort().join(", ")}.`,
      );
    }
    requiredIdentifier(producer.name, "producer.name");
    requiredIdentifier(producer.version, "producer.version");
    sha256(producer.parametersSha256, "producer.parametersSha256");
    normalizedProducer = Object.freeze({
      name: producer.name,
      version: producer.version,
      parametersSha256: producer.parametersSha256,
    });
  }
  return Object.freeze({
    bindingId,
    draftId,
    uploadId,
    artifactSha256,
    role,
    kind,
    coordinateFrameId,
    inputBindings: Object.freeze(normalizedInputs),
    producer: normalizedProducer,
    createdBy: operatorId,
    createdAt: isoDate(occurredAt, "occurredAt"),
  });
}

export function createSurveyIntakeRecord({
  intakeId,
  draftId,
  manifestUploadId,
  manifestArtifactSha256,
  artifactUploads,
  operatorId,
  occurredAt = new Date(),
}) {
  kebabIdentifier(intakeId, "intakeId");
  kebabIdentifier(draftId, "draftId");
  kebabIdentifier(manifestUploadId, "manifestUploadId");
  sha256(manifestArtifactSha256, "manifestArtifactSha256");
  requiredIdentifier(operatorId, "operatorId");
  if (!Array.isArray(artifactUploads) || artifactUploads.length < 1 || artifactUploads.length > 256) {
    throw new TwinDomainError(
      "SURVEY_INTAKE_ARTIFACTS_INVALID",
      "artifactUploads must contain between 1 and 256 completed upload mappings.",
    );
  }
  const artifactIds = new Set();
  const uploadIds = new Set([manifestUploadId]);
  const normalizedUploads = artifactUploads.map((mapping, index) => {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      throw new TwinDomainError("SURVEY_INTAKE_ARTIFACTS_INVALID", `artifactUploads[${index}] must be an object.`);
    }
    boundedText(mapping.artifactId, `artifactUploads[${index}].artifactId`, 1024);
    kebabIdentifier(mapping.uploadId, `artifactUploads[${index}].uploadId`);
    sha256(mapping.artifactSha256, `artifactUploads[${index}].artifactSha256`);
    if (!Number.isSafeInteger(mapping.bytes) || mapping.bytes < 1) {
      throw new TwinDomainError("SURVEY_INTAKE_ARTIFACTS_INVALID", `artifactUploads[${index}].bytes must be positive.`);
    }
    boundedText(mapping.mediaType, `artifactUploads[${index}].mediaType`, 255);
    if (artifactIds.has(mapping.artifactId)) {
      throw new TwinDomainError("SURVEY_INTAKE_ARTIFACTS_INVALID", "Artifact IDs must be unique within an intake.");
    }
    if (uploadIds.has(mapping.uploadId)) {
      throw new TwinDomainError(
        "SURVEY_INTAKE_ARTIFACTS_INVALID",
        "Manifest and artifact upload IDs must be unique within an intake.",
      );
    }
    artifactIds.add(mapping.artifactId);
    uploadIds.add(mapping.uploadId);
    return Object.freeze({
      artifactId: mapping.artifactId,
      uploadId: mapping.uploadId,
      artifactSha256: mapping.artifactSha256,
      bytes: mapping.bytes,
      mediaType: mapping.mediaType,
    });
  });
  normalizedUploads.sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    intakeId,
    draftId,
    manifestUploadId,
    manifestArtifactSha256,
    status: SURVEY_INTAKE_STATUS.open,
    artifactUploads: Object.freeze(normalizedUploads),
    manifestSchemaVersion: null,
    manifestSha256: null,
    packageId: null,
    surveyId: null,
    sourceSiteId: null,
    sourceFloorId: null,
    report: null,
    rowVersion: 1,
    createdBy: operatorId,
    createdAt: timestamp,
    verifiedBy: null,
    verifiedAt: null,
  });
}

export function completeSurveyIntakeRecord(record, {
  manifest,
  report,
  operatorId,
  occurredAt = new Date(),
}) {
  if (!record || typeof record !== "object" || record.status !== SURVEY_INTAKE_STATUS.open) {
    throw new TwinDomainError("SURVEY_INTAKE_TRANSITION_INVALID", "Only an open survey intake can be verified.");
  }
  requiredIdentifier(operatorId, "operatorId");
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TwinDomainError("SURVEY_INTAKE_REPORT_INVALID", "A survey ingest report is required.");
  }
  sha256(report.manifestSha256, "report.manifestSha256");
  if (!["ACCEPTED", "ACCEPTED_WITH_WARNINGS", "REJECTED"].includes(report.outcome)) {
    throw new TwinDomainError("SURVEY_INTAKE_REPORT_INVALID", "Survey ingest report outcome is invalid.");
  }
  const manifestRecord = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : null;
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    ...record,
    status: report.outcome === "REJECTED" ? SURVEY_INTAKE_STATUS.rejected : SURVEY_INTAKE_STATUS.accepted,
    manifestSchemaVersion: typeof manifestRecord?.schemaVersion === "string" ? manifestRecord.schemaVersion : null,
    manifestSha256: report.manifestSha256,
    packageId: typeof manifestRecord?.packageId === "string" ? manifestRecord.packageId : null,
    surveyId: typeof manifestRecord?.surveyId === "string" ? manifestRecord.surveyId : null,
    sourceSiteId: typeof manifestRecord?.siteId === "string" ? manifestRecord.siteId : null,
    sourceFloorId: typeof manifestRecord?.floorId === "string" ? manifestRecord.floorId : null,
    report,
    rowVersion: record.rowVersion + 1,
    verifiedBy: operatorId,
    verifiedAt: timestamp,
  });
}

export function createSurveyMaterializationJobRecord({
  jobId,
  intake,
  snapshot,
  snapshotSha256,
  operatorId,
  occurredAt = new Date(),
}) {
  kebabIdentifier(jobId, "jobId");
  requiredIdentifier(operatorId, "operatorId");
  if (!intake || typeof intake !== "object" || intake.status !== SURVEY_INTAKE_STATUS.accepted) {
    throw new TwinDomainError(
      "SURVEY_MATERIALIZATION_INTAKE_INELIGIBLE",
      "Only an accepted survey intake can create a materialization job.",
    );
  }
  kebabIdentifier(intake.intakeId, "intake.intakeId");
  kebabIdentifier(intake.draftId, "intake.draftId");
  sha256(intake.manifestSha256, "intake.manifestSha256");
  sha256(snapshotSha256, "snapshotSha256");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.schemaVersion !== "brash.survey-materialization-snapshot/v1"
    || snapshot.intakeId !== intake.intakeId
    || snapshot.draftId !== intake.draftId
    || snapshot.manifestSha256 !== intake.manifestSha256
    || !Array.isArray(snapshot.artifacts)
    || snapshot.artifacts.length < 1
    || snapshot.artifacts.length > 256) {
    throw new TwinDomainError(
      "SURVEY_MATERIALIZATION_SNAPSHOT_INVALID",
      "Materialization snapshot must match the accepted intake identity and contain bounded artifacts.",
    );
  }
  const timestamp = isoDate(occurredAt, "occurredAt");
  return Object.freeze({
    jobId,
    intakeId: intake.intakeId,
    draftId: intake.draftId,
    status: SURVEY_MATERIALIZATION_STATUS.pending,
    manifestSha256: intake.manifestSha256,
    snapshotSha256,
    snapshot: Object.freeze(structuredClone(snapshot)),
    output: null,
    outputUploadId: null,
    outputArtifactSha256: null,
    attemptCount: 0,
    maximumAttempts: 3,
    nextAttemptAt: timestamp,
    leaseOwner: null,
    leaseExpiresAt: null,
    startedAt: null,
    completedAt: null,
    failureReason: null,
    rowVersion: 1,
    createdBy: operatorId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function eventTypeFor(action) {
  if (action === null) return MAP_DRAFT_EVENT_TYPE.created;
  if (action === MAP_DRAFT_ACTION.submitReview) return MAP_DRAFT_EVENT_TYPE.reviewSubmitted;
  if (action === MAP_DRAFT_ACTION.returnToDraft) return MAP_DRAFT_EVENT_TYPE.returnedToDraft;
  if (action === MAP_DRAFT_ACTION.markValidated) return MAP_DRAFT_EVENT_TYPE.validated;
  throw new TwinDomainError("MAP_DRAFT_ACTION_INVALID", `Unsupported map draft action ${String(action)}.`);
}

function requireOpenUpload(record) {
  if (!record || typeof record !== "object") {
    throw new TwinDomainError("UPLOAD_REQUIRED", "Upload session record is required.");
  }
  if (![UPLOAD_STATUS.initiated, UPLOAD_STATUS.uploading].includes(record.status)) {
    throw new TwinDomainError("UPLOAD_TRANSITION_INVALID", `Upload ${record.uploadId} is ${record.status}.`);
  }
}

function requireRecordStatus(record, expected) {
  if (record.status !== expected) {
    throw new TwinDomainError(
      "MAP_DRAFT_TRANSITION_INVALID",
      `Expected map draft status ${expected}, received ${record.status}.`,
    );
  }
}

function isoDate(value, fieldName) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TwinDomainError("DATE_INVALID", `${fieldName} must be a valid date.`);
  }
  return date.toISOString();
}

function requiredIdentifier(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TwinDomainError("IDENTIFIER_REQUIRED", `${fieldName} is required.`);
  }
}

function sha256(value, fieldName) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TwinDomainError("UPLOAD_HASH_INVALID", `${fieldName} must be 64 lowercase hexadecimal characters.`);
  }
}

function publicationHash(value, fieldName) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TwinDomainError(
      "PUBLICATION_HASH_INVALID",
      `${fieldName} must be 64 lowercase hexadecimal characters.`,
    );
  }
}

function positiveSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TwinDomainError("UPLOAD_NUMBER_INVALID", `${fieldName} must be a positive safe integer.`);
  }
}

function nonNegativeSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TwinDomainError("UPLOAD_NUMBER_INVALID", `${fieldName} must be a non-negative safe integer.`);
  }
}

function mediaTypeValue(value) {
  if (typeof value !== "string"
    || value.length > 255
    || !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(value)) {
    throw new TwinDomainError("UPLOAD_MEDIA_TYPE_INVALID", "mediaType must be a simple valid MIME type.");
  }
}

function originalFileName(value) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > 255
    || /[\\/\0-\x1f\x7f]/.test(value)) {
    throw new TwinDomainError("UPLOAD_FILE_NAME_INVALID", "originalName must be a safe base file name.");
  }
}

function boundedText(value, fieldName, maximumLength) {
  if (typeof value !== "string"
    || value.trim() === ""
    || value.length > maximumLength
    || /[\0-\x1f\x7f]/.test(value)) {
    throw new TwinDomainError(
      "SURVEY_INTAKE_FIELD_INVALID",
      `${fieldName} must be non-empty text of at most ${maximumLength} characters without control characters.`,
    );
  }
}

function kebabIdentifier(value, fieldName) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TwinDomainError("IDENTIFIER_INVALID", `${fieldName} must be a lowercase kebab-case identifier.`);
  }
}
