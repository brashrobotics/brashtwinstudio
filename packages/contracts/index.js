export const CONTRACT_VERSIONS = Object.freeze({
  rawSurveyPackage: "brash.raw-survey-package/v1",
  twinMapBundle: "brash.twin-map-bundle/v1",
  coordinateFrames: "brash.coordinate-frames/v1",
  topology: "brash.navigation-topology/v1",
  twinAssets: "brash.twin-assets/v1",
  sceneManifest: "brash.scene-manifest/v1",
  liveOverlay: "brash.fleet-live-overlay/v1",
  draftValidationReport: "brash.draft-validation-report/v1",
  floorplanImportReport: "brash.floorplan-import-report/v1",
  registrationReport: "brash.registration-report/v1",
  embodiedSurveyPackage: "brash.embodied-survey-package/v1",
  embodiedSurveyIngestReport: "brash.embodied-survey-ingest-report/v1",
  surveyMaterializationPreview: "brash.survey-materialization-preview/v1",
  surveyCoordinateFrames: "brash.survey-coordinate-frames/v1",
  surveyCalibration: "brash.survey-calibration/v1",
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
  "REGISTERED_POINT_CLOUD",
  "RECONSTRUCTED_MESH",
  "OCCUPANCY",
  "ELEVATION",
  "SCENE_TILESET",
  "IMPORT_REPORT",
  "REGISTRATION_REPORT",
  "VALIDATION_REPORT",
]);

export function isContractVersion(value, expected) {
  return typeof value === "string" && value === expected;
}
