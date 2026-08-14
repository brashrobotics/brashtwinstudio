import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TwinCatalogService } from "@brash-twin/application";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { UploadService } from "@brash-twin/application/uploads";
import { ValidationJobService } from "@brash-twin/application/validation-jobs";
import { SurveyIntakeService } from "@brash-twin/application/survey-intakes";
import { SurveyMaterializationService } from "@brash-twin/application/survey-materializations";
import { SurveyQualityReviewService } from "@brash-twin/application/survey-quality-reviews";
import { SemanticCandidateService } from "@brash-twin/application/semantic-candidates";
import { SurveyRegistrationService } from "@brash-twin/application/survey-registrations";
import {
  ImmutableReleaseStore,
  LocalMultipartArtifactStore,
} from "@brash-twin/artifact-store";
import { InMemoryTwinCatalogRepository } from "@brash-twin/persistence";
import { InMemoryDraftArtifactRepository } from "@brash-twin/persistence/draft-artifacts";
import {
  InMemoryOutboxRepository,
  InMemoryTwinUnitOfWork,
} from "@brash-twin/persistence/outbox";
import { InMemoryUploadRepository } from "@brash-twin/persistence/uploads";
import { InMemoryValidationJobRepository } from "@brash-twin/persistence/validation-jobs";
import { InMemorySurveyIntakeRepository } from "@brash-twin/persistence/survey-intakes";
import { InMemorySurveyMaterializationRepository } from "@brash-twin/persistence/survey-materializations";
import { TwinApi } from "../../services/twin-api/index.js";
import { startTwinApiServer } from "../../services/twin-api/server.js";

const bundleFixture = fileURLToPath(new URL("../fixtures/bundles/demo-plant@1", import.meta.url));
const surveyFixture = fileURLToPath(new URL("../fixtures/surveys/embodied-demo.v1.json", import.meta.url));

test("HTTP API creates spatial hierarchy, validates a draft, and exposes releases", async () => {
  const storeRoot = await mkdtemp(join(tmpdir(), "brash-api-releases-"));
  const releaseStore = new ImmutableReleaseStore(storeRoot);
  await releaseStore.publish(bundleFixture);
  const catalog = memoryCatalog({
    clock: () => new Date("2026-08-13T14:00:00.000Z"),
  });
  const uploadRoot = await mkdtemp(join(tmpdir(), "brash-api-uploads-"));
  const uploadSystem = memoryUploads(uploadRoot, {
    clock: () => new Date("2026-08-13T14:00:00.000Z"),
  });
  const draftArtifacts = memoryDraftArtifacts(catalog, uploadSystem.uploads, {
    clock: () => new Date("2026-08-13T14:00:00.000Z"),
  });
  const validationJobs = memoryValidationJobs(catalog, draftArtifacts, uploadSystem, {
    clock: () => new Date("2026-08-13T14:00:00.000Z"),
  });
  const surveyIntakes = memorySurveyIntakes(catalog, uploadSystem, {
    clock: () => new Date("2026-08-13T14:00:00.000Z"),
  });
  const surveyMaterializations = memorySurveyMaterializations(
    catalog,
    surveyIntakes,
    uploadSystem,
    { draftArtifacts, clock: () => new Date("2026-08-13T14:00:00.000Z") },
  );
  const surveyQualityReviews = memorySurveyQualityReviews(
    catalog,
    surveyMaterializations,
    draftArtifacts,
    uploadSystem,
    { clock: () => new Date("2026-08-13T14:00:00.000Z") },
  );
  const surveyRegistrations = memorySurveyRegistrations(
    catalog,
    surveyMaterializations,
    draftArtifacts,
    uploadSystem,
    surveyQualityReviews,
    { clock: () => new Date("2026-08-13T14:00:00.000Z") },
  );
  const semanticCandidates = memorySemanticCandidates(
    catalog,
    surveyRegistrations,
    draftArtifacts,
    uploadSystem,
    { clock: () => new Date("2026-08-13T14:00:00.000Z") },
  );
  const api = new TwinApi({
    catalog,
    uploads: uploadSystem.uploads,
    draftArtifacts,
    surveyIntakes,
    surveyMaterializations,
    surveyQualityReviews,
    surveyRegistrations,
    semanticCandidates,
    validationJobs,
    releaseStore,
  });
  const server = await startTwinApiServer({ api, host: "127.0.0.1", port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    assert.equal((await request(baseUrl, "GET", "/health")).body.status, "ready");
    assert.equal((await request(baseUrl, "GET", "/health/live")).body.status, "ok");
    assert.equal((await request(baseUrl, "GET", "/health/ready")).body.persistence.mode, "memory");

    const strictBody = await request(baseUrl, "POST", "/api/v1/sites", {
      siteId: "rejected-site",
      displayName: "Rejected",
      timezone: "UTC",
      operatorId: "engineer-1",
      unexpected: true,
    });
    assert.equal(strictBody.status, 400);
    assert.equal(strictBody.body.error.code, "BODY_FIELD_UNSUPPORTED");

    assert.equal((await request(baseUrl, "POST", "/api/v1/sites", {
      siteId: "demo-site",
      displayName: "Demo Site",
      timezone: "Europe/Istanbul",
      operatorId: "engineer-1",
    })).status, 201);

    assert.equal((await request(baseUrl, "POST", "/api/v1/sites/demo-site/buildings", {
      buildingId: "main-building",
      displayName: "Main Building",
      operatorId: "engineer-1",
    })).status, 201);

    assert.equal((await request(baseUrl, "POST", "/api/v1/sites/demo-site/buildings/main-building/floors", {
      floorId: "floor-1",
      displayName: "Floor 1",
      elevationMeters: 0,
      operatorId: "engineer-1",
    })).status, 201);

    assert.equal((await request(baseUrl, "POST", "/api/v1/map-families", {
      familyId: "demo-plant",
      floorId: "floor-1",
      displayName: "Demo Plant",
      operatorId: "engineer-1",
    })).status, 201);

    const draftCreated = await request(baseUrl, "POST", "/api/v1/map-drafts", {
      draftId: "draft-demo-1",
      familyId: "demo-plant",
      revision: 1,
      canonicalFrameId: "demo-plant/floor-1",
      operatorId: "engineer-1",
    });
    assert.equal(draftCreated.status, 201);
    assert.equal(draftCreated.body.draft.status, "DRAFT");

    const validationContent = Buffer.from("validation source fixture");
    const validationSha256 = createHash("sha256").update(validationContent).digest("hex");
    assert.equal((await request(baseUrl, "POST", "/api/v1/uploads", {
      uploadId: "upload-validation-source",
      expectedSha256: validationSha256,
      expectedBytes: validationContent.byteLength,
      mediaType: "application/octet-stream",
      originalName: "validation-source.ifc",
      operatorId: "engineer-1",
    })).status, 201);
    await uploadSystem.multipartStore.putPart("upload-validation-source", 1, validationContent);
    assert.equal((await request(baseUrl, "POST", "/api/v1/uploads/upload-validation-source/complete", {
      operatorId: "engineer-1",
    })).body.session.status, "COMPLETED");
    assert.equal((await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-1/artifacts", {
      bindingId: "validation-source-1",
      uploadId: "upload-validation-source",
      role: "BIM_SOURCE",
      coordinateFrameId: "demo-plant/floor-1",
      operatorId: "engineer-1",
    })).status, 201);

    const review = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-1/submit-review", {
      operatorId: "engineer-2",
    });
    assert.equal(review.body.draft.status, "IN_REVIEW");

    const validationJob = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-1/validation-jobs", {
      jobId: "validation-job-1",
      operatorId: "approver-1",
    });
    assert.equal(validationJob.status, 201);
    assert.equal(validationJob.body.job.status, "PENDING");
    const validationRun = await request(baseUrl, "POST", "/api/v1/validation-jobs/validation-job-1/run", {
      operatorId: "approver-1",
    });
    assert.equal(validationRun.status, 200);
    assert.equal(validationRun.body.job.status, "SUCCEEDED");
    assert.equal(validationRun.body.job.output.outcome, "PASSED");
    const validated = await request(baseUrl, "GET", "/api/v1/map-drafts/draft-demo-1");
    assert.equal(validated.body.draft.status, "VALIDATED");
    assert.equal(validated.body.draft.rowVersion, 3);
    const reportBytes = await uploadSystem.multipartStore.get(validationRun.body.job.output.reportSha256);
    const report = JSON.parse(reportBytes.toString("utf8"));
    assert.equal(report.schemaVersion, "brash.draft-validation-report/v2");
    assert.equal(report.outcome, "PASSED");
    assert.deepEqual(report.inputs.map((input) => input.bindingId), ["validation-source-1"]);

    const directValidationRemoved = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-1/validate", {
      validationReportSha256: "b".repeat(64),
      operatorId: "approver-1",
    });
    assert.equal(directValidationRemoved.status, 404);
    assert.equal(directValidationRemoved.body.error.code, "ROUTE_NOT_FOUND");

    const releases = await request(baseUrl, "GET", "/api/v1/releases");
    assert.deepEqual(releases.body.releases.map((release) => release.mapReleaseId), ["demo-plant@1"]);

    const release = await request(baseUrl, "GET", "/api/v1/releases/demo-plant%401");
    assert.equal(release.body.release.bundleId, "bundle-demo-plant-1");

    const floors = await request(baseUrl, "GET", "/api/v1/floors?siteId=demo-site");
    assert.deepEqual(floors.body.floors.map((floor) => floor.floorId), ["floor-1"]);

    const uploadContent = Buffer.from("small IFC upload fixture");
    const uploadSha256 = createHash("sha256").update(uploadContent).digest("hex");
    const initiated = await request(baseUrl, "POST", "/api/v1/uploads", {
      uploadId: "upload-ifc-1",
      expectedSha256: uploadSha256,
      expectedBytes: uploadContent.byteLength,
      mediaType: "application/octet-stream",
      originalName: "factory.ifc",
      operatorId: "engineer-1",
    });
    assert.equal(initiated.status, 201);
    assert.equal(initiated.body.session.status, "INITIATED");
    assert.equal(initiated.body.upload.provider, "local-filesystem");
    await uploadSystem.multipartStore.putPart("upload-ifc-1", 1, uploadContent);

    const completedUpload = await request(baseUrl, "POST", "/api/v1/uploads/upload-ifc-1/complete", {
      operatorId: "engineer-1",
    });
    assert.equal(completedUpload.status, 200);
    assert.equal(completedUpload.body.session.status, "COMPLETED");
    assert.equal(completedUpload.body.session.artifactSha256, uploadSha256);
    assert.deepEqual(await uploadSystem.multipartStore.get(uploadSha256), uploadContent);

    assert.equal((await request(baseUrl, "POST", "/api/v1/map-drafts", {
      draftId: "draft-demo-2",
      familyId: "demo-plant",
      revision: 2,
      canonicalFrameId: "demo-plant/floor-1",
      operatorId: "engineer-1",
    })).status, 201);

    const surveyPackage = await createSurveyPackageFixture();
    const surveyArtifactUploads = [];
    for (const artifact of surveyPackage.manifest.artifacts) {
      const uploadId = `survey-${artifact.artifactId}`;
      await uploadThroughApi(
        baseUrl,
        uploadSystem.multipartStore,
        uploadId,
        surveyPackage.content.get(artifact.artifactId),
        artifact.mediaType,
        artifact.path.split("/").at(-1),
      );
      surveyArtifactUploads.push({ artifactId: artifact.artifactId, uploadId });
    }
    const manifestBytes = Buffer.from(JSON.stringify(surveyPackage.manifest));
    await uploadThroughApi(
      baseUrl,
      uploadSystem.multipartStore,
      "survey-manifest-1",
      manifestBytes,
      "application/json",
      "manifest.json",
    );
    const intakeCreated = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-2/survey-intakes", {
      intakeId: "survey-intake-1",
      manifestUploadId: "survey-manifest-1",
      artifactUploads: surveyArtifactUploads,
      operatorId: "mapping-operator-1",
    });
    assert.equal(intakeCreated.status, 201);
    assert.equal(intakeCreated.body.intake.status, "OPEN");
    const intakeVerified = await request(baseUrl, "POST", "/api/v1/survey-intakes/survey-intake-1/verify", {
      operatorId: "mapping-reviewer-1",
    });
    assert.equal(intakeVerified.status, 200);
    assert.equal(intakeVerified.body.intake.status, "ACCEPTED");
    assert.equal(intakeVerified.body.intake.report.outcome, "ACCEPTED");
    assert.deepEqual(
      (await request(baseUrl, "GET", "/api/v1/map-drafts/draft-demo-2/survey-intakes"))
        .body.intakes.map((intake) => intake.intakeId),
      ["survey-intake-1"],
    );
    assert.equal(
      (await request(baseUrl, "GET", "/api/v1/survey-intakes/survey-intake-1")).body.intake.packageId,
      surveyPackage.manifest.packageId,
    );
    const materializationCreated = await request(
      baseUrl,
      "POST",
      "/api/v1/survey-intakes/survey-intake-1/materializations",
      { jobId: "survey-materialization-1", operatorId: "mapping-operator-1" },
    );
    assert.equal(materializationCreated.status, 201);
    assert.equal(materializationCreated.body.job.status, "PENDING");
    assert.equal(materializationCreated.body.job.snapshot.coordinateSystem.rootFrameId, "slam-map");
    assert.equal(materializationCreated.body.job.snapshot.artifacts.length, 5);
    assert.equal(
      (await request(baseUrl, "GET", "/api/v1/survey-materializations/survey-materialization-1"))
        .body.job.snapshotSha256,
      materializationCreated.body.job.snapshotSha256,
    );
    assert.deepEqual(
      (await request(baseUrl, "GET", "/api/v1/map-drafts/draft-demo-2/survey-materializations"))
        .body.jobs.map((job) => job.jobId),
      ["survey-materialization-1"],
    );
    const materializationRun = await request(
      baseUrl,
      "POST",
      "/api/v1/survey-materializations/survey-materialization-1/run",
      { workerId: "materializer-1", operatorId: "mapping-operator-1" },
    );
    assert.equal(materializationRun.status, 200);
    assert.equal(materializationRun.body.job.status, "SUCCEEDED");
    assert.equal(materializationRun.body.job.output.summary.trajectoryPoseCount, 5);
    assert.equal(materializationRun.body.job.output.previewBindingId, "survey-preview-survey-materialization-1");
    const materializationPreview = await request(
      baseUrl,
      "GET",
      "/api/v1/survey-materializations/survey-materialization-1/preview",
    );
    assert.equal(materializationPreview.status, 200);
    assert.equal(materializationPreview.body.preview.coordinateSystem.rootFrameId, "slam-map");
    assert.equal(materializationPreview.body.preview.reconstruction.vertexCount, 6);

    const qualityCreated = await request(
      baseUrl,
      "POST",
      "/api/v1/map-drafts/draft-demo-2/survey-quality-reviews",
      {
        qualityReviewId: "survey-quality-1",
        materializationJobId: "survey-materialization-1",
        operatorId: "mapping-quality-operator",
      },
    );
    assert.equal(qualityCreated.status, 201);
    assert.equal(qualityCreated.body.qualityReview.report.outcome, "PASSED");
    assert.ok(qualityCreated.body.qualityReview.report.coverageGrid.cells.length > 0);
    const qualityAccepted = await request(
      baseUrl,
      "POST",
      "/api/v1/map-drafts/draft-demo-2/survey-quality-reviews/survey-quality-1/acceptance",
      { decision: "APPROVED", reviewerId: "mapping-quality-reviewer" },
    );
    assert.equal(qualityAccepted.status, 201);
    assert.equal(qualityAccepted.body.acceptance.report.decision, "APPROVED");

    const forgedQualityAcceptance = await request(
      baseUrl,
      "POST",
      "/api/v1/map-drafts/draft-demo-2/artifacts",
      {
        bindingId: "forged-quality-acceptance",
        uploadId: "upload-ifc-1",
        role: "SURVEY_QUALITY_ACCEPTANCE",
        coordinateFrameId: "demo-plant/floor-1",
        operatorId: "untrusted-client",
      },
    );
    assert.equal(forgedQualityAcceptance.status, 403);
    assert.equal(forgedQualityAcceptance.body.error.code, "ARTIFACT_ROLE_MANAGED");

    const sourceBinding = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-2/artifacts", {
      bindingId: "source-ifc-1",
      uploadId: "upload-ifc-1",
      role: "BIM_SOURCE",
      coordinateFrameId: "demo-plant/floor-1",
      operatorId: "engineer-1",
    });
    assert.equal(sourceBinding.status, 201);
    assert.equal(sourceBinding.body.artifact.kind, "SOURCE");
    assert.equal(sourceBinding.body.artifact.artifactSha256, uploadSha256);

    const registrationCreated = await request(
      baseUrl,
      "POST",
      "/api/v1/map-drafts/draft-demo-2/survey-registrations",
      {
        registrationId: "survey-registration-1",
        materializationJobId: "survey-materialization-1",
        targetBindingId: "source-ifc-1",
        allowScale: false,
        operatorId: "mapping-operator-1",
        controlPoints: [
          { controlPointId: "cp-1", source: { x: 0, y: 0 }, target: { x: 5, y: 10 } },
          { controlPointId: "cp-2", source: { x: 1, y: 0 }, target: { x: 6, y: 10 } },
          { controlPointId: "cp-3", source: { x: 1, y: 1 }, target: { x: 6, y: 11 } },
        ],
      },
    );
    assert.equal(registrationCreated.status, 201);
    assert.equal(registrationCreated.body.registration.report.transform.scale, 1);
    assert.equal(registrationCreated.body.registration.report.quality.outcome, "PASSED");
    assert.equal(registrationCreated.body.registration.report.targetEvidence.bindingId, "source-ifc-1");
    assert.deepEqual(registrationCreated.body.registration.report.transform.translation, { x: 5, y: 10 });
    assert.equal(
      (await request(baseUrl, "GET", "/api/v1/map-drafts/draft-demo-2/survey-registrations"))
        .body.registrations[0].report.registrationId,
      "survey-registration-1",
    );
    const registrationAccepted = await request(
      baseUrl,
      "POST",
      "/api/v1/map-drafts/draft-demo-2/survey-registrations/survey-registration-1/acceptance",
      {
        decision: "APPROVED",
        reviewerId: "mapping-reviewer-1",
        note: "Registration evidence reviewed.",
      },
    );
    assert.equal(registrationAccepted.status, 201);
    assert.equal(registrationAccepted.body.acceptance.report.decision, "APPROVED");

    const semanticModel = {
      name: "e2e-semantic-detector",
      version: "1.0.0",
      parametersSha256: "9".repeat(64),
    };
    const observationContent = Buffer.from(`${JSON.stringify({
      schemaVersion: "brash.semantic-observations/v1",
      observationSetId: "e2e-observations-1",
      sourceFrameId: "slam-map",
      model: semanticModel,
      observations: [{
        observationId: "panel-observation-1",
        classId: "electrical-panel",
        confidence: 0.96,
        position: [1, 2, 1.2],
        dimensions: [0.8, 0.3, 1.8],
        evidence: [{
          bindingId: materializationRun.body.job.output.previewBindingId,
          artifactSha256: materializationRun.body.job.output.previewSha256,
        }],
      }],
    }, null, 2)}\n`);
    await uploadThroughApi(
      baseUrl,
      uploadSystem.multipartStore,
      "semantic-observations-upload-1",
      observationContent,
      "application/json",
      "semantic-observations.json",
    );
    const observationBinding = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-2/artifacts", {
      bindingId: "semantic-observations-1",
      uploadId: "semantic-observations-upload-1",
      role: "SEMANTIC_OBSERVATIONS",
      coordinateFrameId: "slam-map",
      inputBindingIds: [materializationRun.body.job.output.previewBindingId],
      producer: semanticModel,
      operatorId: "semantic-worker-1",
    });
    assert.equal(observationBinding.status, 201);
    const candidateSet = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-2/semantic-candidates", {
      candidateSetId: "candidate-set-1",
      registrationId: "survey-registration-1",
      observationBindingId: "semantic-observations-1",
      operatorId: "semantic-operator-1",
    });
    assert.equal(candidateSet.status, 201);
    assert.deepEqual(candidateSet.body.candidateSet.report.candidates[0].canonicalPosition, [6, 12, 1.2]);
    const candidateId = candidateSet.body.candidateSet.report.candidates[0].candidateId;
    const candidateReview = await request(
      baseUrl,
      "POST",
      "/api/v1/map-drafts/draft-demo-2/semantic-candidates/candidate-set-1/review",
      {
        reviewerId: "factory-operator-1",
        decisions: [{
          candidateId,
          decision: "ACCEPTED",
          displayName: "Main Electrical Panel",
          assetType: "electrical-panel",
          properties: { voltage: 400, critical: true },
        }],
      },
    );
    assert.equal(candidateReview.status, 201);
    assert.equal(candidateReview.body.review.report.summary.acceptedCount, 1);
    assert.equal(
      (await request(baseUrl, "GET", "/api/v1/map-drafts/draft-demo-2/semantic-candidates"))
        .body.candidateSets[0].review.report.decisions[0].displayName,
      "Main Electrical Panel",
    );

    const reportContent = Buffer.from("deterministic IFC import report");
    const reportSha256 = createHash("sha256").update(reportContent).digest("hex");
    assert.equal((await request(baseUrl, "POST", "/api/v1/uploads", {
      uploadId: "upload-report-1",
      expectedSha256: reportSha256,
      expectedBytes: reportContent.byteLength,
      mediaType: "application/json",
      originalName: "import-report.json",
      operatorId: "pipeline-1",
    })).status, 201);
    await uploadSystem.multipartStore.putPart("upload-report-1", 1, reportContent);
    assert.equal((await request(baseUrl, "POST", "/api/v1/uploads/upload-report-1/complete", {
      operatorId: "pipeline-1",
    })).body.session.status, "COMPLETED");

    const derivedBinding = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-2/artifacts", {
      bindingId: "import-report-1",
      uploadId: "upload-report-1",
      role: "IMPORT_REPORT",
      inputBindingIds: ["source-ifc-1"],
      producer: {
        name: "brash-ifc-importer",
        version: "0.1.0",
        parametersSha256: "c".repeat(64),
      },
      operatorId: "pipeline-1",
    });
    assert.equal(derivedBinding.status, 201);
    assert.equal(derivedBinding.body.artifact.kind, "DERIVED");
    assert.deepEqual(derivedBinding.body.artifact.inputBindings, [{
      bindingId: "source-ifc-1",
      artifactSha256: uploadSha256,
    }]);

    const provenance = await request(baseUrl, "GET", "/api/v1/map-drafts/draft-demo-2/artifacts");
    assert.equal(provenance.status, 200);
    assert.equal(provenance.body.artifacts.filter((artifact) => artifact.role === "SURVEY_SOURCE").length, 5);
    assert.equal(
      provenance.body.artifacts.find((artifact) => artifact.role === "SURVEY_PREVIEW").inputBindings.length,
      5,
    );
    assert.deepEqual(
      provenance.body.artifacts
        .filter((artifact) => [
          "IMPORT_REPORT",
          "BIM_SOURCE",
          "SURVEY_QUALITY_REPORT",
          "SURVEY_QUALITY_ACCEPTANCE",
          "REGISTRATION_REPORT",
          "REGISTRATION_ACCEPTANCE",
          "SEMANTIC_OBSERVATIONS",
          "ASSET_CANDIDATE_REPORT",
          "ASSET_CANDIDATE_REVIEW",
        ].includes(artifact.role))
        .map((artifact) => artifact.bindingId),
      [
        "asset-candidate-report-candidate-set-1",
        "asset-candidate-review-candidate-set-1",
        "import-report-1",
        "semantic-observations-1",
        "source-ifc-1",
        "survey-quality-acceptance-survey-quality-1",
        "survey-quality-report-survey-quality-1",
        "survey-registration-acceptance-survey-registration-1",
        "survey-registration-report-survey-registration-1",
      ],
    );

    assert.equal((await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-2/submit-review", {
      operatorId: "engineer-2",
    })).status, 200);
    const releaseValidation = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-2/validation-jobs", {
      jobId: "validation-job-registration-approved",
      operatorId: "approver-2",
    });
    assert.equal(releaseValidation.status, 201);
    const releaseValidationRun = await request(
      baseUrl,
      "POST",
      "/api/v1/validation-jobs/validation-job-registration-approved/run",
      { operatorId: "approver-2" },
    );
    assert.equal(releaseValidationRun.body.job.output.outcome, "PASSED");

    const lockedBinding = await request(baseUrl, "POST", "/api/v1/map-drafts/draft-demo-1/artifacts", {
      uploadId: "upload-ifc-1",
      role: "BIM_SOURCE",
      coordinateFrameId: "demo-plant/floor-1",
      operatorId: "engineer-1",
    });
    assert.equal(lockedBinding.status, 409);
    assert.equal(lockedBinding.body.error.code, "DRAFT_ARTIFACT_DRAFT_LOCKED");
  } finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
});

test("HTTP boundary rejects malformed JSON without invoking application logic", async () => {
  const storeRoot = await mkdtemp(join(tmpdir(), "brash-api-invalid-json-"));
  const uploadRoot = await mkdtemp(join(tmpdir(), "brash-api-invalid-json-uploads-"));
  const catalog = memoryCatalog();
  const uploadSystem = memoryUploads(uploadRoot);
  const draftArtifacts = memoryDraftArtifacts(catalog, uploadSystem.uploads);
  const surveyIntakes = memorySurveyIntakes(catalog, uploadSystem);
  const surveyMaterializations = memorySurveyMaterializations(catalog, surveyIntakes, uploadSystem, { draftArtifacts });
  const surveyQualityReviews = memorySurveyQualityReviews(catalog, surveyMaterializations, draftArtifacts, uploadSystem);
  const surveyRegistrations = memorySurveyRegistrations(catalog, surveyMaterializations, draftArtifacts, uploadSystem, surveyQualityReviews);
  const semanticCandidates = memorySemanticCandidates(catalog, surveyRegistrations, draftArtifacts, uploadSystem);
  const api = new TwinApi({
    catalog,
    uploads: uploadSystem.uploads,
    draftArtifacts,
    surveyIntakes,
    surveyMaterializations,
    surveyQualityReviews,
    surveyRegistrations,
    semanticCandidates,
    validationJobs: memoryValidationJobs(catalog, draftArtifacts, uploadSystem),
    releaseStore: new ImmutableReleaseStore(storeRoot),
  });
  const server = await startTwinApiServer({ api, host: "127.0.0.1", port: 0 });
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/sites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "JSON_INVALID");
  } finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
});

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function memoryCatalog(options = {}) {
  const repository = new InMemoryTwinCatalogRepository();
  const outboxRepository = new InMemoryOutboxRepository();
  const unitOfWork = new InMemoryTwinUnitOfWork({ catalogRepository: repository, outboxRepository });
  return new TwinCatalogService({ repository, unitOfWork, ...options });
}

function memoryUploads(rootDirectory, options = {}) {
  const repository = new InMemoryUploadRepository();
  const multipartStore = new LocalMultipartArtifactStore(rootDirectory, { clock: options.clock });
  const uploads = new UploadService({ repository, multipartStore, ...options });
  return { repository, multipartStore, uploads };
}

function memoryDraftArtifacts(catalog, uploads, options = {}) {
  return new DraftArtifactService({
    repository: new InMemoryDraftArtifactRepository(),
    catalog,
    uploads,
    ...options,
  });
}

function memoryValidationJobs(catalog, draftArtifacts, uploadSystem, options = {}) {
  return new ValidationJobService({
    repository: new InMemoryValidationJobRepository(),
    catalog,
    draftArtifacts,
    uploads: uploadSystem.uploads,
    multipartStore: uploadSystem.multipartStore,
    ...options,
  });
}

function memorySurveyIntakes(catalog, uploadSystem, options = {}) {
  return new SurveyIntakeService({
    repository: new InMemorySurveyIntakeRepository(),
    catalog,
    uploads: uploadSystem.uploads,
    multipartStore: uploadSystem.multipartStore,
    ...options,
  });
}

function memorySurveyMaterializations(catalog, surveyIntakes, uploadSystem, options = {}) {
  return new SurveyMaterializationService({
    repository: new InMemorySurveyMaterializationRepository(),
    surveyIntakes,
    catalog,
    uploads: uploadSystem.uploads,
    multipartStore: uploadSystem.multipartStore,
    ...options,
  });
}

function memorySurveyQualityReviews(catalog, materializations, draftArtifacts, uploadSystem, options = {}) {
  return new SurveyQualityReviewService({
    catalog,
    materializations,
    draftArtifacts,
    uploads: uploadSystem.uploads,
    multipartStore: uploadSystem.multipartStore,
    ...options,
  });
}

function memorySurveyRegistrations(catalog, materializations, draftArtifacts, uploadSystem, qualityReviews, options = {}) {
  return new SurveyRegistrationService({
    catalog,
    materializations,
    qualityReviews,
    draftArtifacts,
    uploads: uploadSystem.uploads,
    multipartStore: uploadSystem.multipartStore,
    ...options,
  });
}

function memorySemanticCandidates(catalog, registrations, draftArtifacts, uploadSystem, options = {}) {
  return new SemanticCandidateService({
    catalog,
    registrations,
    draftArtifacts,
    uploads: uploadSystem.uploads,
    multipartStore: uploadSystem.multipartStore,
    ...options,
  });
}

async function uploadThroughApi(baseUrl, multipartStore, uploadId, content, mediaType, originalName) {
  const expectedSha256 = createHash("sha256").update(content).digest("hex");
  const initiated = await request(baseUrl, "POST", "/api/v1/uploads", {
    uploadId,
    expectedSha256,
    expectedBytes: content.byteLength,
    mediaType,
    originalName,
    operatorId: "mapping-operator-1",
  });
  assert.equal(initiated.status, 201);
  await multipartStore.putPart(uploadId, 1, content);
  const completed = await request(baseUrl, "POST", `/api/v1/uploads/${uploadId}/complete`, {
    operatorId: "mapping-operator-1",
  });
  assert.equal(completed.body.session.status, "COMPLETED");
}

async function createSurveyPackageFixture() {
  const manifest = JSON.parse(await readFile(surveyFixture, "utf8"));
  manifest.floorId = "floor-1";
  manifest.quality.trajectoryPoseCount = 5;
  const content = new Map();
  const values = new Map([
    ["frames-1", Buffer.from(JSON.stringify({
      schemaVersion: "brash.survey-coordinate-frames/v1",
      rootFrameId: "slam-map",
      frames: [
        surveyFrame("slam-map", null, [0, 0, 0]),
        surveyFrame("base-link", "slam-map", [0, 0, 0.4]),
        surveyFrame("lidar-link", "base-link", [0.2, 0, 0.3]),
      ],
    }))],
    ["calibration-1", Buffer.from(JSON.stringify({
      schemaVersion: "brash.survey-calibration/v1",
      calibrationId: "e2e-calibration",
      sensors: [
        surveySensor("lidar-main", "lidar-link", "LIDAR", "hesai-xt32", "1"),
        surveySensor("imu-main", "base-link", "IMU", "hg4930", "2"),
      ],
    }))],
    ["trajectory-1", Buffer.from([
      "1000 0 0 0 0 0 0 1",
      "1000.1 1 0 0 0 0 0 1",
      "1000.2 2 0 0.1 0 0 0 1",
      "1000.3 2 1 0.1 0 0 0 1",
      "1000.4 2 2 0.2 0 0 0 1",
      "",
    ].join("\n"))],
    ["point-cloud-map-1", surveyBinaryPly([
      [-1, -2, 0, 1],
      [0, 0, 0.5, 10],
      [1, 1, 1, 20],
      [2, 2, 1.5, 30],
      [3, -1, 2, 40],
      [1, -2, 0.25, 50],
    ])],
    ["quality-report-1", Buffer.from(JSON.stringify({ outcome: "PASSED" }))],
  ]);
  for (const artifact of manifest.artifacts) {
    const bytes = values.get(artifact.artifactId);
    artifact.sha256 = createHash("sha256").update(bytes).digest("hex");
    artifact.bytes = bytes.byteLength;
    content.set(artifact.artifactId, bytes);
  }
  return { manifest, content };
}

function surveyFrame(frameId, parentFrameId, [x, y, z]) {
  return {
    frameId,
    parentFrameId,
    transformToParent: {
      translation: { x, y, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
  };
}

function surveySensor(sensorId, frameId, modality, model, digit) {
  return { sensorId, frameId, modality, model, parametersSha256: digit.repeat(64) };
}

function surveyBinaryPly(points) {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property float intensity",
    "end_header",
    "",
  ].join("\n"));
  const body = Buffer.alloc(points.length * 16);
  points.forEach((point, index) => point.forEach((value, component) => {
    body.writeFloatLE(value, index * 16 + component * 4);
  }));
  return Buffer.concat([header, body]);
}
