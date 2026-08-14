export const CONTRACT_VERSIONS = Object.freeze({
  rawSurveyPackage: "brash.raw-survey-package/v1",
  twinMapBundle: "brash.twin-map-bundle/v1",
  coordinateFrames: "brash.coordinate-frames/v1",
  topology: "brash.navigation-topology/v1",
  twinAssets: "brash.twin-assets/v1",
  sceneManifest: "brash.scene-manifest/v1",
  liveOverlay: "brash.fleet-live-overlay/v1",
  draftValidationReport: "brash.draft-validation-report/v2",
  floorplanImportReport: "brash.floorplan-import-report/v1",
  registrationReport: "brash.registration-report/v1",
  embodiedSurveyPackage: "brash.embodied-survey-package/v1",
  embodiedSurveyIngestReport: "brash.embodied-survey-ingest-report/v1",
  surveyMaterializationPreview: "brash.survey-materialization-preview/v1",
  surveyQualityReport: "brash.survey-quality-report/v1",
  surveyQualityAcceptance: "brash.survey-quality-acceptance/v1",
  surveyCoordinateFrames: "brash.survey-coordinate-frames/v1",
  surveyCalibration: "brash.survey-calibration/v1",
  surveyRegistrationReport: "brash.survey-registration-report/v2",
  surveyRegistrationAcceptance: "brash.survey-registration-acceptance/v1",
  semanticObservations: "brash.semantic-observations/v1",
  assetCandidateReport: "brash.asset-candidate-report/v1",
  assetCandidateReview: "brash.asset-candidate-review/v1",
  draftTwinAssetsV1: "brash.draft-twin-assets/v1",
  draftTwinAssets: "brash.draft-twin-assets/v2",
  assetChangeReport: "brash.asset-change-report/v1",
  assetChangeReview: "brash.asset-change-review/v1",
});

export const ARTIFACT_ROLES = Object.freeze({
  coordinateFrames: "COORDINATE_FRAMES",
  topology: "NAVIGATION_TOPOLOGY",
  twinAssets: "TWIN_ASSETS",
  zones: "SEMANTIC_ZONES",
  sceneManifest: "SCENE_MANIFEST",
  floorplan: "FLOORPLAN",
  occupancy: "OCCUPANCY",
});

export const REQUIRED_BUNDLE_ARTIFACT_ROLES = Object.freeze([
  ARTIFACT_ROLES.coordinateFrames,
  ARTIFACT_ROLES.topology,
  ARTIFACT_ROLES.twinAssets,
  ARTIFACT_ROLES.zones,
  ARTIFACT_ROLES.sceneManifest,
]);

export const DRAFT_ARTIFACT_KINDS = Object.freeze(["SOURCE", "DERIVED"]);

export const DRAFT_ARTIFACT_ROLES = Object.freeze([
  "BIM_SOURCE",
  "FLOORPLAN_SOURCE",
  "POINT_CLOUD_SOURCE",
  "TRAJECTORY_SOURCE",
  "CAMERA_SOURCE",
  "CALIBRATION_SOURCE",
  "SURVEY_SOURCE",
  "SURVEY_PREVIEW",
  "SURVEY_QUALITY_REPORT",
  "SURVEY_QUALITY_ACCEPTANCE",
  "SEMANTIC_OBSERVATIONS",
  "ASSET_CANDIDATE_REPORT",
  "ASSET_CANDIDATE_REVIEW",
  "TWIN_ASSETS",
  "ASSET_CHANGE_REPORT",
  "ASSET_CHANGE_REVIEW",
  "REGISTERED_POINT_CLOUD",
  "RECONSTRUCTED_MESH",
  "OCCUPANCY",
  "ELEVATION",
  "SCENE_TILESET",
  "IMPORT_REPORT",
  "REGISTRATION_REPORT",
  "REGISTRATION_ACCEPTANCE",
  "VALIDATION_REPORT",
]);

export function isContractVersion(value, expected) {
  return typeof value === "string" && value === expected;
}
