import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_VERSIONS,
  DRAFT_ARTIFACT_KINDS,
  DRAFT_ARTIFACT_ROLES,
} from "@brash-twin/contracts";

const schemaDirectory = fileURLToPath(new URL("../../packages/contracts/schemas", import.meta.url));

test("every published schema has a unique HTTPS identifier", async () => {
  const files = (await readdir(schemaDirectory)).filter((file) => file.endsWith(".schema.json"));
  const schemas = await Promise.all(files.map(async (file) => JSON.parse(await readFile(`${schemaDirectory}/${file}`, "utf8"))));
  assert.equal(files.length, 32);
  assert.equal(new Set(schemas.map((schema) => schema.$id)).size, schemas.length);
  for (const schema of schemas) {
    assert.match(schema.$id, /^https:\/\/schemas\.brashrobotics\.com\//);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
  assert.equal(CONTRACT_VERSIONS.twinMapBundle, "brash.twin-map-bundle/v1");
  assert.equal(CONTRACT_VERSIONS.draftValidationReport, "brash.draft-validation-report/v2");
  assert.equal(CONTRACT_VERSIONS.floorplanImportReport, "brash.floorplan-import-report/v1");
  assert.equal(CONTRACT_VERSIONS.registrationReport, "brash.registration-report/v1");
  assert.equal(CONTRACT_VERSIONS.embodiedSurveyPackage, "brash.embodied-survey-package/v1");
  assert.equal(CONTRACT_VERSIONS.embodiedSurveyIngestReport, "brash.embodied-survey-ingest-report/v1");
  assert.equal(CONTRACT_VERSIONS.surveyMaterializationPreviewV1, "brash.survey-materialization-preview/v1");
  assert.equal(CONTRACT_VERSIONS.surveyMaterializationPreview, "brash.survey-materialization-preview/v2");
  assert.equal(CONTRACT_VERSIONS.surveyCoordinateFrames, "brash.survey-coordinate-frames/v1");
  assert.equal(CONTRACT_VERSIONS.surveyCalibration, "brash.survey-calibration/v1");
  assert.equal(CONTRACT_VERSIONS.surveyRegistrationReport, "brash.survey-registration-report/v2");
  assert.equal(CONTRACT_VERSIONS.surveyRegistrationAcceptance, "brash.survey-registration-acceptance/v1");
  assert.equal(CONTRACT_VERSIONS.semanticObservations, "brash.semantic-observations/v1");
  assert.equal(CONTRACT_VERSIONS.sensorVisibilityObservations, "brash.sensor-visibility-observations/v1");
  assert.equal(CONTRACT_VERSIONS.sensorVisibilityReport, "brash.sensor-visibility-report/v1");
  assert.equal(CONTRACT_VERSIONS.assetCandidateReport, "brash.asset-candidate-report/v1");
  assert.equal(CONTRACT_VERSIONS.assetCandidateReview, "brash.asset-candidate-review/v1");
  assert.equal(CONTRACT_VERSIONS.draftTwinAssetsV1, "brash.draft-twin-assets/v1");
  assert.equal(CONTRACT_VERSIONS.draftTwinAssets, "brash.draft-twin-assets/v2");
  assert.equal(CONTRACT_VERSIONS.assetChangeReportV1, "brash.asset-change-report/v1");
  assert.equal(CONTRACT_VERSIONS.assetChangeReport, "brash.asset-change-report/v2");
  assert.equal(CONTRACT_VERSIONS.assetChangeReview, "brash.asset-change-review/v1");
  assert.equal(CONTRACT_VERSIONS.surveyQualityReport, "brash.survey-quality-report/v1");
  assert.equal(CONTRACT_VERSIONS.surveyQualityAcceptance, "brash.survey-quality-acceptance/v1");
});

test("OpenAPI catalog documents every implemented operation", async () => {
  const specification = await readFile(`${schemaDirectory}/../openapi/twin-api.v1.yaml`, "utf8");
  const operations = [
    "getHealth",
    "getLiveness",
    "getReadiness",
    "listSites",
    "createSite",
    "listBuildings",
    "createBuilding",
    "createFloor",
    "listFloors",
    "listMapFamilies",
    "createMapFamily",
    "listMapDrafts",
    "createMapDraft",
    "getMapDraft",
    "submitMapDraftForReview",
    "returnMapDraftToDraft",
    "listDraftValidationJobs",
    "createDraftValidationJob",
    "getDraftValidationJob",
    "runDraftValidationJob",
    "listDraftArtifacts",
    "bindDraftArtifact",
    "listDraftSurveyIntakes",
    "createSurveyIntake",
    "getSurveyIntake",
    "verifySurveyIntake",
    "listDraftSurveyMaterializations",
    "createSurveyMaterialization",
    "getSurveyMaterialization",
    "runSurveyMaterialization",
    "getSurveyMaterializationPreview",
    "listDraftSurveyRegistrations",
    "createSurveyRegistration",
    "reviewSurveyRegistration",
    "listSurveyQualityReviews",
    "createSurveyQualityReview",
    "reviewSurveyQuality",
    "listSemanticCandidateSets",
    "createSemanticCandidateSet",
    "reviewSemanticCandidateSet",
    "listSensorVisibilityReports",
    "createSensorVisibilityReport",
    "listDraftTwinAssetSets",
    "promoteDraftTwinAssets",
    "listDraftAssetChangeSets",
    "detectDraftAssetChanges",
    "reviewDraftAssetChanges",
    "applyDraftAssetChanges",
    "listUploadSessions",
    "initiateUploadSession",
    "getUploadSession",
    "completeUploadSession",
    "cancelUploadSession",
    "listMapReleases",
    "getMapRelease",
  ];
  for (const operationId of operations) assert.match(specification, new RegExp(`operationId: ${operationId}\\b`));
  for (const role of DRAFT_ARTIFACT_ROLES) assert.match(specification, new RegExp(`- ${role}\\b`));
  for (const kind of DRAFT_ARTIFACT_KINDS) assert.match(specification, new RegExp(`\\b${kind}\\b`));
});
