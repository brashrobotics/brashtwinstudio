import { CatalogError } from "@brash-twin/application";
import { DraftArtifactError } from "@brash-twin/application/draft-artifacts";
import { UploadError } from "@brash-twin/application/uploads";
import { ValidationJobError } from "@brash-twin/application/validation-jobs";
import { SurveyIntakeError } from "@brash-twin/application/survey-intakes";
import { SurveyMaterializationError } from "@brash-twin/application/survey-materializations";
import { SurveyQualityReviewError } from "@brash-twin/application/survey-quality-reviews";
import { SemanticCandidateError } from "@brash-twin/application/semantic-candidates";
import { SensorVisibilityError } from "@brash-twin/application/sensor-visibility";
import { TwinAssetError } from "@brash-twin/application/twin-assets";
import { SurveyRegistrationError } from "@brash-twin/application/survey-registrations";
import { ArtifactStoreError } from "@brash-twin/artifact-store";

const MANAGED_ARTIFACT_ROLES = new Set([
  "SURVEY_PREVIEW",
  "SURVEY_QUALITY_REPORT",
  "SURVEY_QUALITY_ACCEPTANCE",
  "REGISTRATION_REPORT",
  "REGISTRATION_ACCEPTANCE",
  "ASSET_CANDIDATE_REPORT",
  "ASSET_CANDIDATE_REVIEW",
  "SENSOR_VISIBILITY_REPORT",
  "TWIN_ASSETS",
  "ASSET_CHANGE_REPORT",
  "ASSET_CHANGE_REVIEW",
  "VALIDATION_REPORT",
]);

export class TwinApi {
  #catalog;
  #uploads;
  #draftArtifacts;
  #surveyIntakes;
  #surveyMaterializations;
  #surveyQualityReviews;
  #surveyRegistrations;
  #semanticCandidates;
  #sensorVisibility;
  #twinAssets;
  #validationJobs;
  #releaseStore;
  #readiness;

  constructor({
    catalog,
    uploads,
    draftArtifacts,
    surveyIntakes,
    surveyMaterializations,
    surveyQualityReviews,
    surveyRegistrations,
    semanticCandidates,
    sensorVisibility,
    twinAssets,
    validationJobs,
    releaseStore,
    readiness = async () => ({ ready: true, mode: "memory" }),
  }) {
    if (!catalog) throw new TypeError("Twin catalog service is required.");
    if (!uploads) throw new TypeError("Upload service is required.");
    if (!draftArtifacts) throw new TypeError("Draft artifact service is required.");
    if (!surveyIntakes) throw new TypeError("Survey intake service is required.");
    if (!surveyMaterializations) throw new TypeError("Survey materialization service is required.");
    if (!surveyQualityReviews) throw new TypeError("Survey quality review service is required.");
    if (!surveyRegistrations) throw new TypeError("Survey registration service is required.");
    if (!semanticCandidates) throw new TypeError("Semantic candidate service is required.");
    if (!sensorVisibility) throw new TypeError("Sensor visibility service is required.");
    if (!twinAssets) throw new TypeError("Twin asset service is required.");
    if (!validationJobs) throw new TypeError("Validation job service is required.");
    if (!releaseStore) throw new TypeError("Release store is required.");
    if (typeof readiness !== "function") throw new TypeError("Readiness probe must be a function.");
    this.#catalog = catalog;
    this.#uploads = uploads;
    this.#draftArtifacts = draftArtifacts;
    this.#surveyIntakes = surveyIntakes;
    this.#surveyMaterializations = surveyMaterializations;
    this.#surveyQualityReviews = surveyQualityReviews;
    this.#surveyRegistrations = surveyRegistrations;
    this.#semanticCandidates = semanticCandidates;
    this.#sensorVisibility = sensorVisibility;
    this.#twinAssets = twinAssets;
    this.#validationJobs = validationJobs;
    this.#releaseStore = releaseStore;
    this.#readiness = readiness;
  }

  async handle(request) {
    try {
      return await this.#route(normalizeRequest(request));
    } catch (error) {
      return errorResponse(error);
    }
  }

  async #route({ method, url, body }) {
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/health/live") {
      return response(200, { status: "ok", service: "brash-twin-api" });
    }

    if (method === "GET" && ["/health", "/health/ready"].includes(pathname)) {
      const readiness = await this.#readiness();
      return response(readiness.ready ? 200 : 503, {
        status: readiness.ready ? "ready" : "not-ready",
        service: "brash-twin-api",
        persistence: readiness,
      });
    }

    if (pathname === "/api/v1/sites") {
      if (method === "GET") return response(200, { sites: await this.#catalog.listSites() });
      if (method === "POST") {
        return response(201, { site: await this.#catalog.createSite(objectBody(body, ["siteId", "displayName", "timezone", "operatorId"])) });
      }
    }

    const buildingsMatch = pathname.match(/^\/api\/v1\/sites\/([^/]+)\/buildings$/);
    if (buildingsMatch) {
      const siteId = segment(buildingsMatch[1]);
      if (method === "GET") return response(200, { buildings: await this.#catalog.listBuildings(siteId) });
      if (method === "POST") {
        return response(201, { building: await this.#catalog.createBuilding(siteId, objectBody(body, ["buildingId", "displayName", "operatorId"])) });
      }
    }

    const floorsMatch = pathname.match(/^\/api\/v1\/sites\/([^/]+)\/buildings\/([^/]+)\/floors$/);
    if (floorsMatch && method === "POST") {
      const floor = await this.#catalog.createFloor(
        segment(floorsMatch[1]),
        segment(floorsMatch[2]),
        objectBody(body, ["floorId", "displayName", "elevationMeters", "operatorId"]),
      );
      return response(201, { floor });
    }

    if (method === "GET" && pathname === "/api/v1/floors") {
      return response(200, { floors: await this.#catalog.listFloors(optionalQuery(url, "siteId")) });
    }

    if (pathname === "/api/v1/map-families") {
      if (method === "GET") {
        return response(200, { families: await this.#catalog.listMapFamilies(optionalQuery(url, "floorId")) });
      }
      if (method === "POST") {
        return response(201, { family: await this.#catalog.createMapFamily(objectBody(body, ["familyId", "floorId", "displayName", "operatorId"])) });
      }
    }

    if (pathname === "/api/v1/map-drafts") {
      if (method === "GET") {
        return response(200, { drafts: await this.#catalog.listMapDrafts(optionalQuery(url, "familyId")) });
      }
      if (method === "POST") {
        return response(201, { draft: await this.#catalog.createMapDraft(objectBody(body, ["draftId", "familyId", "revision", "canonicalFrameId", "operatorId"])) });
      }
    }

    const draftActionMatch = pathname.match(/^\/api\/v1\/map-drafts\/([^/]+)\/(submit-review|return-to-draft)$/);
    if (draftActionMatch && method === "POST") {
      const draftId = segment(draftActionMatch[1]);
      const input = objectBody(body, ["operatorId"]);
      let draft;
      if (draftActionMatch[2] === "submit-review") {
        draft = await this.#catalog.submitMapDraftForReview(draftId, input.operatorId);
      } else {
        draft = await this.#catalog.returnMapDraftToDraft(draftId, input.operatorId);
      }
      return response(200, { draft });
    }

    const draftArtifactsMatch = pathname.match(/^\/api\/v1\/map-drafts\/([^/]+)\/artifacts$/);
    if (draftArtifactsMatch) {
      const draftId = segment(draftArtifactsMatch[1]);
      if (method === "GET") {
        return response(200, { artifacts: await this.#draftArtifacts.list(draftId) });
      }
      if (method === "POST") {
        const input = objectBody(body, [
          "bindingId",
          "uploadId",
          "role",
          "coordinateFrameId",
          "inputBindingIds",
          "producer",
          "operatorId",
        ]);
        if (MANAGED_ARTIFACT_ROLES.has(input.role)) {
          throw new ApiError(
            "ARTIFACT_ROLE_MANAGED",
            `Artifact role ${input.role} can only be created by its owning workflow.`,
            403,
          );
        }
        const artifact = await this.#draftArtifacts.bind(draftId, input);
        return response(201, { artifact });
      }
    }

    const draftValidationJobsMatch = pathname.match(/^\/api\/v1\/map-drafts\/([^/]+)\/validation-jobs$/);
    if (draftValidationJobsMatch) {
      const draftId = segment(draftValidationJobsMatch[1]);
      if (method === "GET") {
        return response(200, { jobs: await this.#validationJobs.list(draftId) });
      }
      if (method === "POST") {
        const job = await this.#validationJobs.create(
          draftId,
          objectBody(body, ["jobId", "operatorId"]),
        );
        return response(201, { job });
      }
    }

    const draftSurveyIntakesMatch = pathname.match(/^\/api\/v1\/map-drafts\/([^/]+)\/survey-intakes$/);
    if (draftSurveyIntakesMatch) {
      const draftId = segment(draftSurveyIntakesMatch[1]);
      if (method === "GET") {
        return response(200, { intakes: await this.#surveyIntakes.list(draftId) });
      }
      if (method === "POST") {
        const intake = await this.#surveyIntakes.create(draftId, objectBody(body, [
          "intakeId",
          "manifestUploadId",
          "artifactUploads",
          "operatorId",
        ]));
        return response(201, { intake });
      }
    }

    const surveyIntakeVerifyMatch = pathname.match(/^\/api\/v1\/survey-intakes\/([^/]+)\/verify$/);
    if (surveyIntakeVerifyMatch && method === "POST") {
      const intake = await this.#surveyIntakes.verify(
        segment(surveyIntakeVerifyMatch[1]),
        objectBody(body, ["operatorId"]),
      );
      return response(200, { intake });
    }

    const draftSurveyMaterializationsMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/survey-materializations$/,
    );
    if (draftSurveyMaterializationsMatch && method === "GET") {
      return response(200, {
        jobs: await this.#surveyMaterializations.list(segment(draftSurveyMaterializationsMatch[1])),
      });
    }

    const draftSurveyRegistrationsMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/survey-registrations$/,
    );
    if (draftSurveyRegistrationsMatch) {
      const draftId = segment(draftSurveyRegistrationsMatch[1]);
      if (method === "GET") {
        return response(200, { registrations: await this.#surveyRegistrations.list(draftId) });
      }
      if (method === "POST") {
        const registration = await this.#surveyRegistrations.create(draftId, objectBody(body, [
          "registrationId",
          "materializationJobId",
          "targetBindingId",
          "controlPoints",
          "allowScale",
          "operatorId",
        ]));
        return response(201, { registration });
      }
    }

    const draftSurveyQualityMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/survey-quality-reviews$/,
    );
    if (draftSurveyQualityMatch) {
      const draftId = segment(draftSurveyQualityMatch[1]);
      if (method === "GET") return response(200, { qualityReviews: await this.#surveyQualityReviews.list(draftId) });
      if (method === "POST") {
        const qualityReview = await this.#surveyQualityReviews.create(
          draftId,
          objectBody(body, ["qualityReviewId", "materializationJobId", "operatorId"]),
        );
        return response(201, { qualityReview });
      }
    }

    const surveyQualityAcceptanceMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/survey-quality-reviews\/([^/]+)\/acceptance$/,
    );
    if (surveyQualityAcceptanceMatch && method === "POST") {
      const acceptance = await this.#surveyQualityReviews.review(
        segment(surveyQualityAcceptanceMatch[1]),
        segment(surveyQualityAcceptanceMatch[2]),
        objectBody(body, ["decision", "reviewerId", "note"]),
      );
      return response(201, { acceptance });
    }

    const surveyRegistrationReviewMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/survey-registrations\/([^/]+)\/acceptance$/,
    );
    if (surveyRegistrationReviewMatch && method === "POST") {
      const acceptance = await this.#surveyRegistrations.review(
        segment(surveyRegistrationReviewMatch[1]),
        segment(surveyRegistrationReviewMatch[2]),
        objectBody(body, ["decision", "reviewerId", "note"]),
      );
      return response(201, { acceptance });
    }

    const semanticCandidatesMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/semantic-candidates$/,
    );
    if (semanticCandidatesMatch) {
      const draftId = segment(semanticCandidatesMatch[1]);
      if (method === "GET") return response(200, { candidateSets: await this.#semanticCandidates.list(draftId) });
      if (method === "POST") {
        const candidateSet = await this.#semanticCandidates.create(draftId, objectBody(body, [
          "candidateSetId", "registrationId", "observationBindingId", "operatorId",
        ]));
        return response(201, { candidateSet });
      }
    }

    const semanticCandidateReviewMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/semantic-candidates\/([^/]+)\/review$/,
    );
    if (semanticCandidateReviewMatch && method === "POST") {
      const review = await this.#semanticCandidates.review(
        segment(semanticCandidateReviewMatch[1]),
        segment(semanticCandidateReviewMatch[2]),
        objectBody(body, ["decisions", "reviewerId", "note"]),
      );
      return response(201, { review });
    }

    const sensorVisibilityMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/sensor-visibility$/,
    );
    if (sensorVisibilityMatch) {
      const draftId = segment(sensorVisibilityMatch[1]);
      if (method === "GET") {
        return response(200, { visibilityReports: await this.#sensorVisibility.list(draftId) });
      }
      if (method === "POST") {
        const visibilityReport = await this.#sensorVisibility.create(draftId, objectBody(body, [
          "visibilityReportId", "registrationId", "observationBindingId", "operatorId",
        ]));
        return response(201, { visibilityReport });
      }
    }

    const twinAssetsMatch = pathname.match(/^\/api\/v1\/map-drafts\/([^/]+)\/twin-assets$/);
    if (twinAssetsMatch) {
      const draftId = segment(twinAssetsMatch[1]);
      if (method === "GET") return response(200, { assetSets: await this.#twinAssets.list(draftId) });
      if (method === "POST") {
        const assetSet = await this.#twinAssets.promote(
          draftId,
          objectBody(body, ["assetSetId", "candidateSetId", "operatorId"]),
        );
        return response(201, { assetSet });
      }
    }

    const assetChangesMatch = pathname.match(/^\/api\/v1\/map-drafts\/([^/]+)\/asset-changes$/);
    if (assetChangesMatch) {
      const draftId = segment(assetChangesMatch[1]);
      if (method === "GET") return response(200, { changeSets: await this.#twinAssets.listChanges(draftId) });
      if (method === "POST") {
        const changeSet = await this.#twinAssets.detectChanges(
          draftId,
          objectBody(body, ["changeSetId", "candidateSetId", "visibilityReportId", "operatorId"]),
        );
        return response(201, { changeSet });
      }
    }

    const assetChangeReviewMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/asset-changes\/([^/]+)\/review$/,
    );
    if (assetChangeReviewMatch && method === "POST") {
      const review = await this.#twinAssets.reviewChanges(
        segment(assetChangeReviewMatch[1]),
        segment(assetChangeReviewMatch[2]),
        objectBody(body, [
          "reviewId", "reviewerId", "coverageQualificationAcknowledged", "decisions", "note",
        ]),
      );
      return response(201, { review });
    }

    const assetChangeApplyMatch = pathname.match(
      /^\/api\/v1\/map-drafts\/([^/]+)\/asset-changes\/([^/]+)\/apply$/,
    );
    if (assetChangeApplyMatch && method === "POST") {
      const assetSet = await this.#twinAssets.applyChanges(
        segment(assetChangeApplyMatch[1]),
        segment(assetChangeApplyMatch[2]),
        objectBody(body, ["assetSetId", "operatorId"]),
      );
      return response(201, { assetSet });
    }

    const surveyIntakeMaterializationsMatch = pathname.match(
      /^\/api\/v1\/survey-intakes\/([^/]+)\/materializations$/,
    );
    if (surveyIntakeMaterializationsMatch && method === "POST") {
      const job = await this.#surveyMaterializations.create(
        segment(surveyIntakeMaterializationsMatch[1]),
        objectBody(body, ["jobId", "operatorId"]),
      );
      return response(201, { job });
    }

    const surveyMaterializationMatch = pathname.match(/^\/api\/v1\/survey-materializations\/([^/]+)$/);
    if (surveyMaterializationMatch && method === "GET") {
      return response(200, {
        job: await this.#surveyMaterializations.get(segment(surveyMaterializationMatch[1])),
      });
    }

    const surveyMaterializationRunMatch = pathname.match(
      /^\/api\/v1\/survey-materializations\/([^/]+)\/run$/,
    );
    if (surveyMaterializationRunMatch && method === "POST") {
      const job = await this.#surveyMaterializations.run(
        segment(surveyMaterializationRunMatch[1]),
        objectBody(body, ["workerId", "operatorId"]),
      );
      return response(200, { job });
    }

    const surveyMaterializationPreviewMatch = pathname.match(
      /^\/api\/v1\/survey-materializations\/([^/]+)\/preview$/,
    );
    if (surveyMaterializationPreviewMatch && method === "GET") {
      return response(200, {
        preview: await this.#surveyMaterializations.getPreview(
          segment(surveyMaterializationPreviewMatch[1]),
        ),
      });
    }

    const surveyIntakeMatch = pathname.match(/^\/api\/v1\/survey-intakes\/([^/]+)$/);
    if (surveyIntakeMatch && method === "GET") {
      return response(200, { intake: await this.#surveyIntakes.get(segment(surveyIntakeMatch[1])) });
    }

    const validationJobActionMatch = pathname.match(/^\/api\/v1\/validation-jobs\/([^/]+)\/run$/);
    if (validationJobActionMatch && method === "POST") {
      const job = await this.#validationJobs.run(
        segment(validationJobActionMatch[1]),
        objectBody(body, ["operatorId"]),
      );
      return response(200, { job });
    }

    const validationJobMatch = pathname.match(/^\/api\/v1\/validation-jobs\/([^/]+)$/);
    if (validationJobMatch && method === "GET") {
      return response(200, { job: await this.#validationJobs.get(segment(validationJobMatch[1])) });
    }

    const draftMatch = pathname.match(/^\/api\/v1\/map-drafts\/([^/]+)$/);
    if (draftMatch && method === "GET") {
      return response(200, { draft: await this.#catalog.getMapDraft(segment(draftMatch[1])) });
    }

    if (pathname === "/api/v1/uploads") {
      if (method === "GET") {
        return response(200, { uploads: await this.#uploads.list(optionalQuery(url, "status")) });
      }
      if (method === "POST") {
        const result = await this.#uploads.initiate(objectBody(body, [
          "uploadId",
          "expectedSha256",
          "expectedBytes",
          "mediaType",
          "originalName",
          "operatorId",
        ]));
        return response(201, result);
      }
    }

    const uploadActionMatch = pathname.match(/^\/api\/v1\/uploads\/([^/]+)\/(complete|cancel)$/);
    if (uploadActionMatch && method === "POST") {
      const uploadId = segment(uploadActionMatch[1]);
      const input = objectBody(
        body,
        uploadActionMatch[2] === "complete" ? ["operatorId", "parts"] : ["operatorId"],
      );
      const session = uploadActionMatch[2] === "complete"
        ? await this.#uploads.complete(uploadId, input)
        : await this.#uploads.cancel(uploadId, input);
      return response(200, { session });
    }

    const uploadMatch = pathname.match(/^\/api\/v1\/uploads\/([^/]+)$/);
    if (uploadMatch && method === "GET") {
      return response(200, { session: await this.#uploads.get(segment(uploadMatch[1])) });
    }

    if (pathname === "/api/v1/releases" && method === "GET") {
      return response(200, { releases: await this.#releaseStore.list() });
    }

    const releaseMatch = pathname.match(/^\/api\/v1\/releases\/([^/]+)$/);
    if (releaseMatch && method === "GET") {
      const releaseId = segment(releaseMatch[1]);
      if (!await this.#releaseStore.has(releaseId)) {
        throw new ApiError("RELEASE_NOT_FOUND", `Release ${releaseId} was not found.`, 404);
      }
      return response(200, { release: await this.#releaseStore.getManifest(releaseId) });
    }

    return response(404, { error: { code: "ROUTE_NOT_FOUND", message: `${method} ${pathname} was not found.` } });
  }
}

export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function normalizeRequest(request) {
  if (!request || typeof request !== "object") throw new ApiError("REQUEST_INVALID", "Request is required.");
  return {
    method: String(request.method ?? "GET").toUpperCase(),
    url: new URL(request.url ?? "/", "http://127.0.0.1"),
    body: request.body,
  };
}

function objectBody(value, allowedFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("BODY_INVALID", "JSON request body must be an object.");
  }
  const unsupported = Object.keys(value).filter((field) => !allowedFields.includes(field));
  if (unsupported.length > 0) {
    throw new ApiError("BODY_FIELD_UNSUPPORTED", `Unsupported request fields: ${unsupported.sort().join(", ")}.`);
  }
  return value;
}

function optionalQuery(url, name) {
  const value = url.searchParams.get(name);
  return value === null ? undefined : value;
}

function segment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError("PATH_INVALID", "Path contains invalid URL encoding.");
  }
}

function response(status, body) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "content-type": "application/json; charset=utf-8" }),
    body,
  });
}

function errorResponse(error) {
  if (error instanceof ApiError) return response(error.status, { error: { code: error.code, message: error.message } });
  if (error instanceof CatalogError) {
    const status = statusForCatalogError(error.code);
    return response(status, { error: { code: error.code, message: error.message } });
  }
  if (error instanceof UploadError) {
    return response(statusForUploadError(error.code), { error: { code: error.code, message: error.message } });
  }
  if (error instanceof DraftArtifactError) {
    return response(statusForDraftArtifactError(error.code), { error: { code: error.code, message: error.message } });
  }
  if (error instanceof ValidationJobError) {
    return response(statusForValidationJobError(error.code), { error: { code: error.code, message: error.message } });
  }
  if (error instanceof SurveyIntakeError) {
    return response(statusForSurveyIntakeError(error.code), { error: { code: error.code, message: error.message } });
  }
  if (error instanceof SurveyMaterializationError) {
    return response(statusForSurveyMaterializationError(error.code), {
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof SurveyQualityReviewError) {
    return response(statusForSurveyQualityReviewError(error.code), {
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof SurveyRegistrationError) {
    return response(statusForSurveyRegistrationError(error.code), {
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof SemanticCandidateError) {
    return response(statusForSemanticCandidateError(error.code), {
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof SensorVisibilityError) {
    return response(statusForSensorVisibilityError(error.code), {
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof TwinAssetError) {
    return response(statusForTwinAssetError(error.code), {
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof ArtifactStoreError) {
    const status = error.code === "RELEASE_ID_INVALID" ? 400 : 500;
    return response(status, { error: { code: error.code, message: error.message } });
  }
  console.error(error);
  return response(500, { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
}

function statusForCatalogError(code) {
  if (["MAP_DRAFT_NOT_FOUND", "CATALOG_NOT_FOUND", "CATALOG_PARENT_NOT_FOUND"].includes(code)) return 404;
  if (["CATALOG_CONFLICT", "CATALOG_CONCURRENCY_CONFLICT", "MAP_DRAFT_TRANSITION_INVALID"].includes(code)) return 409;
  if (code === "CATALOG_PERSISTENCE_ERROR") return 500;
  return 400;
}

function statusForUploadError(code) {
  if (code === "UPLOAD_NOT_FOUND") return 404;
  if ([
    "UPLOAD_CONFLICT",
    "UPLOAD_ALREADY_EXISTS",
    "UPLOAD_ALREADY_FINALIZED",
    "UPLOAD_COMPLETION_IN_PROGRESS",
    "UPLOAD_CONCURRENCY_CONFLICT",
    "UPLOAD_NOT_READY",
    "UPLOAD_PART_CONFLICT",
    "UPLOAD_TRANSITION_INVALID",
  ].includes(code)) return 409;
  if (["UPLOAD_INTEGRITY_MISMATCH", "ARTIFACT_INTEGRITY_FAILED"].includes(code)) return 422;
  if (code === "UPLOAD_PERSISTENCE_ERROR") return 500;
  return 400;
}

function statusForDraftArtifactError(code) {
  if (["DRAFT_ARTIFACT_INPUT_NOT_FOUND", "DRAFT_ARTIFACT_REFERENCE_NOT_FOUND"].includes(code)) return 404;
  if ([
    "DRAFT_ARTIFACT_CONFLICT",
    "DRAFT_ARTIFACT_DRAFT_LOCKED",
    "DRAFT_ARTIFACT_UPLOAD_INCOMPLETE",
  ].includes(code)) return 409;
  if (code === "DRAFT_ARTIFACT_PERSISTENCE_ERROR") return 500;
  return 400;
}

function statusForValidationJobError(code) {
  if (["VALIDATION_JOB_NOT_FOUND", "VALIDATION_JOB_REFERENCE_NOT_FOUND"].includes(code)) return 404;
  if ([
    "VALIDATION_DRAFT_NOT_IN_REVIEW",
    "VALIDATION_INPUTS_REQUIRED",
    "VALIDATION_JOB_CONFLICT",
    "VALIDATION_JOB_CONCURRENCY_CONFLICT",
    "VALIDATION_JOB_NOT_RUNNABLE",
    "VALIDATION_SNAPSHOT_CHANGED",
  ].includes(code)) return 409;
  if (code === "VALIDATION_JOB_PERSISTENCE_ERROR") return 500;
  return 400;
}

function statusForSurveyIntakeError(code) {
  if (["SURVEY_INTAKE_NOT_FOUND", "SURVEY_INTAKE_REFERENCE_NOT_FOUND", "SURVEY_INTAKE_UPLOAD_NOT_FOUND"].includes(code)) return 404;
  if ([
    "SURVEY_INTAKE_CONFLICT",
    "SURVEY_INTAKE_CONCURRENCY_CONFLICT",
    "SURVEY_INTAKE_DRAFT_LOCKED",
    "SURVEY_INTAKE_IMMUTABLE",
    "SURVEY_INTAKE_UPLOAD_INCOMPLETE",
  ].includes(code)) return 409;
  if (code === "SURVEY_INTAKE_PERSISTENCE_ERROR") return 500;
  return 400;
}

function statusForSurveyMaterializationError(code) {
  if ([
    "SURVEY_MATERIALIZATION_NOT_FOUND",
    "SURVEY_MATERIALIZATION_REFERENCE_NOT_FOUND",
  ].includes(code)) return 404;
  if ([
    "SURVEY_MATERIALIZATION_CONFLICT",
    "SURVEY_MATERIALIZATION_DRAFT_LOCKED",
    "SURVEY_MATERIALIZATION_IMMUTABLE",
    "SURVEY_MATERIALIZATION_INTAKE_INELIGIBLE",
    "SURVEY_MATERIALIZATION_CONCURRENCY_CONFLICT",
    "SURVEY_MATERIALIZATION_NOT_RUNNABLE",
    "SURVEY_MATERIALIZATION_PREVIEW_NOT_READY",
    "SURVEY_MATERIALIZATION_PREVIEW_CONFLICT",
  ].includes(code)) return 409;
  if ([
    "SURVEY_MATERIALIZATION_MANIFEST_INTEGRITY_FAILED",
    "SURVEY_MATERIALIZATION_MANIFEST_IDENTITY_MISMATCH",
    "SURVEY_MATERIALIZATION_ARTIFACT_IDENTITY_MISMATCH",
    "SURVEY_MATERIALIZATION_SNAPSHOT_INTEGRITY_FAILED",
    "SURVEY_MATERIALIZATION_PREVIEW_INTEGRITY_FAILED",
    "SURVEY_MATERIALIZATION_PROVENANCE_INVALID",
  ].includes(code)) return 422;
  if (code === "SURVEY_MATERIALIZATION_PERSISTENCE_ERROR") return 500;
  return 400;
}

function statusForSurveyRegistrationError(code) {
  if (code === "SURVEY_REGISTRATION_NOT_FOUND") return 404;
  if ([
    "SURVEY_REGISTRATION_CONFLICT",
    "SURVEY_REGISTRATION_DRAFT_LOCKED",
    "SURVEY_REGISTRATION_PREVIEW_INELIGIBLE",
    "SURVEY_REGISTRATION_TARGET_INELIGIBLE",
    "SURVEY_REGISTRATION_REVIEW_CONFLICT",
    "SURVEY_REGISTRATION_REVIEWER_CONFLICT",
    "SURVEY_REGISTRATION_QUALITY_FAILED",
    "SURVEY_REGISTRATION_QUALITY_REVIEW_REQUIRED",
  ].includes(code)) return 409;
  if (code === "SURVEY_REGISTRATION_INTEGRITY_FAILED") return 422;
  return 400;
}

function statusForSurveyQualityReviewError(code) {
  if (code === "SURVEY_QUALITY_NOT_FOUND") return 404;
  if ([
    "SURVEY_QUALITY_CONFLICT",
    "SURVEY_QUALITY_DRAFT_LOCKED",
    "SURVEY_QUALITY_PREVIEW_INELIGIBLE",
    "SURVEY_QUALITY_REVIEW_CONFLICT",
    "SURVEY_QUALITY_REVIEWER_CONFLICT",
    "SURVEY_QUALITY_FAILED",
  ].includes(code)) return 409;
  if (code === "SURVEY_QUALITY_INTEGRITY_FAILED") return 422;
  return 400;
}

function statusForSemanticCandidateError(code) {
  if (["SEMANTIC_CANDIDATE_NOT_FOUND", "SEMANTIC_OBSERVATIONS_NOT_FOUND"].includes(code)) return 404;
  if ([
    "SEMANTIC_CANDIDATE_CONFLICT",
    "SEMANTIC_CANDIDATE_DRAFT_LOCKED",
    "SEMANTIC_CANDIDATE_REGISTRATION_REQUIRED",
    "SEMANTIC_CANDIDATE_REVIEW_CONFLICT",
    "SEMANTIC_CANDIDATE_REVIEWER_CONFLICT",
  ].includes(code)) return 409;
  if (code === "SEMANTIC_CANDIDATE_INTEGRITY_FAILED") return 422;
  return 400;
}

function statusForSensorVisibilityError(code) {
  if (code === "SENSOR_VISIBILITY_OBSERVATIONS_NOT_FOUND") return 404;
  if ([
    "SENSOR_VISIBILITY_CONFLICT",
    "SENSOR_VISIBILITY_DRAFT_LOCKED",
    "SENSOR_VISIBILITY_REGISTRATION_REQUIRED",
  ].includes(code)) return 409;
  if (code === "SENSOR_VISIBILITY_INTEGRITY_FAILED") return 422;
  return 400;
}

function statusForTwinAssetError(code) {
  if ([
    "TWIN_ASSET_CANDIDATE_NOT_FOUND",
    "TWIN_ASSET_CHANGE_NOT_FOUND",
    "TWIN_ASSET_VISIBILITY_REQUIRED",
  ].includes(code)) return 404;
  if ([
    "TWIN_ASSET_PROMOTION_CONFLICT",
    "TWIN_ASSET_CHANGE_CONFLICT",
    "TWIN_ASSET_DRAFT_LOCKED",
    "TWIN_ASSET_REVIEW_REQUIRED",
    "TWIN_ASSET_ACCEPTED_CANDIDATE_REQUIRED",
    "TWIN_ASSET_BASELINE_REQUIRED",
    "TWIN_ASSET_CHANGE_INPUT_INVALID",
    "TWIN_ASSET_VISIBILITY_CONTEXT_MISMATCH",
    "TWIN_ASSET_CHANGE_WORKFLOW_REQUIRED",
    "TWIN_ASSET_CHANGE_REVIEW_CONFLICT",
    "TWIN_ASSET_CHANGE_REVIEWER_CONFLICT",
    "TWIN_ASSET_CHANGE_REVIEW_REQUIRED",
    "TWIN_ASSET_CONFIRMED_CHANGE_REQUIRED",
    "TWIN_ASSET_CHANGE_APPLY_CONFLICT",
    "TWIN_ASSET_CHANGE_BASELINE_STALE",
  ].includes(code)) return 409;
  if (code === "TWIN_ASSET_INTEGRITY_FAILED") return 422;
  return 400;
}
