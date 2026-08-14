import { CatalogError } from "@brash-twin/application";
import { DraftArtifactError } from "@brash-twin/application/draft-artifacts";
import { UploadError } from "@brash-twin/application/uploads";
import { ValidationJobError } from "@brash-twin/application/validation-jobs";
import { SurveyIntakeError } from "@brash-twin/application/survey-intakes";
import { SurveyMaterializationError } from "@brash-twin/application/survey-materializations";
import { SurveyRegistrationError } from "@brash-twin/application/survey-registrations";
import { ArtifactStoreError } from "@brash-twin/artifact-store";

export class TwinApi {
  #catalog;
  #uploads;
  #draftArtifacts;
  #surveyIntakes;
  #surveyMaterializations;
  #surveyRegistrations;
  #validationJobs;
  #releaseStore;
  #readiness;

  constructor({
    catalog,
    uploads,
    draftArtifacts,
    surveyIntakes,
    surveyMaterializations,
    surveyRegistrations,
    validationJobs,
    releaseStore,
    readiness = async () => ({ ready: true, mode: "memory" }),
  }) {
    if (!catalog) throw new TypeError("Twin catalog service is required.");
    if (!uploads) throw new TypeError("Upload service is required.");
    if (!draftArtifacts) throw new TypeError("Draft artifact service is required.");
    if (!surveyIntakes) throw new TypeError("Survey intake service is required.");
    if (!surveyMaterializations) throw new TypeError("Survey materialization service is required.");
    if (!surveyRegistrations) throw new TypeError("Survey registration service is required.");
    if (!validationJobs) throw new TypeError("Validation job service is required.");
    if (!releaseStore) throw new TypeError("Release store is required.");
    if (typeof readiness !== "function") throw new TypeError("Readiness probe must be a function.");
    this.#catalog = catalog;
    this.#uploads = uploads;
    this.#draftArtifacts = draftArtifacts;
    this.#surveyIntakes = surveyIntakes;
    this.#surveyMaterializations = surveyMaterializations;
    this.#surveyRegistrations = surveyRegistrations;
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
        const artifact = await this.#draftArtifacts.bind(draftId, objectBody(body, [
          "bindingId",
          "uploadId",
          "role",
          "coordinateFrameId",
          "inputBindingIds",
          "producer",
          "operatorId",
        ]));
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
  if (error instanceof SurveyRegistrationError) {
    return response(statusForSurveyRegistrationError(error.code), {
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
  ].includes(code)) return 409;
  if (code === "SURVEY_REGISTRATION_INTEGRITY_FAILED") return 422;
  return 400;
}
