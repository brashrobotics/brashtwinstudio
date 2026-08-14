import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationDirectory = fileURLToPath(new URL("../../storage/migrations", import.meta.url));

test("metadata migrations are ordered, transactional, and forward-only", async () => {
  const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(files, [
    "001_site_map_release.sql",
    "002_survey_jobs_outbox.sql",
    "003_semantic_assets_changes.sql",
    "004_outbox_delivery_leases.sql",
    "005_upload_sessions.sql",
    "006_draft_artifact_provenance.sql",
    "007_validation_runs.sql",
    "008_publication_state_machine.sql",
    "009_survey_intakes.sql",
    "010_survey_materialization_jobs.sql",
    "011_survey_materialization_lifecycle.sql",
    "012_survey_artifact_lineage.sql",
    "013_registration_acceptance.sql",
    "014_survey_quality_review.sql",
    "015_semantic_asset_candidates.sql",
  ]);

  for (const file of files) {
    const sql = await readFile(`${migrationDirectory}/${file}`, "utf8");
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /COMMIT;\s*$/);
    assert.doesNotMatch(sql, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
  }
});

test("semantic observations and reviewed asset candidates extend immutable provenance", async () => {
  const sql = await readFile(`${migrationDirectory}/015_semantic_asset_candidates.sql`, "utf8");
  assert.match(sql, /'SEMANTIC_OBSERVATIONS'/);
  assert.match(sql, /'ASSET_CANDIDATE_REPORT'/);
  assert.match(sql, /'ASSET_CANDIDATE_REVIEW'/);
  assert.match(sql, /twin_draft_artifacts_spatial_frame_check/);
});

test("survey quality reports and acceptance extend immutable provenance", async () => {
  const sql = await readFile(`${migrationDirectory}/014_survey_quality_review.sql`, "utf8");
  assert.match(sql, /'SURVEY_QUALITY_REPORT'/);
  assert.match(sql, /'SURVEY_QUALITY_ACCEPTANCE'/);
  assert.match(sql, /twin_draft_artifacts_spatial_frame_check/);
});

test("registration acceptance is a derived immutable provenance role", async () => {
  const sql = await readFile(`${migrationDirectory}/013_registration_acceptance.sql`, "utf8");
  assert.match(sql, /'REGISTRATION_ACCEPTANCE'/);
  assert.match(sql, /artifact_kind = 'DERIVED'/);
  assert.match(sql, /coordinate_frame_id IS NOT NULL/);
});

test("survey lineage adds bounded source and preview provenance roles", async () => {
  const sql = await readFile(`${migrationDirectory}/012_survey_artifact_lineage.sql`, "utf8");
  assert.match(sql, /'SURVEY_SOURCE'/);
  assert.match(sql, /'SURVEY_PREVIEW'/);
  assert.match(sql, /input_count <= 256/);
  assert.match(sql, /twin_draft_artifacts_kind_role_check/);
  assert.match(sql, /twin_draft_artifacts_spatial_frame_check/);
});

test("survey materialization lifecycle leases workers and preserves sealed inputs", async () => {
  const sql = await readFile(`${migrationDirectory}/011_survey_materialization_lifecycle.sql`, "utf8");
  assert.match(sql, /status IN \('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'\)/);
  assert.match(sql, /lease_owner/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /maximum_attempts BETWEEN 1 AND 10/);
  assert.match(sql, /lease_owner IS NOT NULL/);
  assert.match(sql, /output \? 'schemaVersion'/);
  assert.match(sql, /twin_survey_materialization_output_upload_fk/);
  assert.match(sql, /Survey materialization input identity is immutable/);
  assert.match(sql, /CREATE TRIGGER twin_survey_materialization_lifecycle_guard/);
});

test("survey materialization migration requires accepted immutable intake snapshots", async () => {
  const sql = await readFile(`${migrationDirectory}/010_survey_materialization_jobs.sql`, "utf8");
  assert.match(sql, /CREATE TABLE twin_survey_materialization_jobs/);
  assert.match(sql, /twin_survey_materialization_intake_manifest_fk/);
  assert.match(sql, /status = 'PENDING'/);
  assert.match(sql, /intake_status <> 'ACCEPTED'/);
  assert.match(sql, /requires an editable DRAFT/);
  assert.match(sql, /CREATE TRIGGER twin_survey_materialization_immutable/);
});

test("survey intake migration atomically binds completed uploads and seals one terminal result", async () => {
  const intakeSql = await readFile(`${migrationDirectory}/009_survey_intakes.sql`, "utf8");
  assert.match(intakeSql, /CREATE TABLE twin_survey_intakes/);
  assert.match(intakeSql, /CREATE TABLE twin_survey_intake_artifacts/);
  assert.match(intakeSql, /twin_survey_intakes_manifest_upload_fk/);
  assert.match(intakeSql, /twin_survey_intake_artifacts_completed_upload_fk/);
  assert.match(intakeSql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(intakeSql, /FOR UPDATE/);
  assert.match(intakeSql, /requires an editable DRAFT/);
  assert.match(intakeSql, /OPEN to terminal verification transition/);
  assert.match(intakeSql, /CREATE TRIGGER twin_survey_intake_artifacts_immutable/);
});

test("publication state machine seals two-person approval and recovery history", async () => {
  const publicationSql = await readFile(`${migrationDirectory}/008_publication_state_machine.sql`, "utf8");
  assert.match(publicationSql, /CREATE TABLE twin_publication_requests/);
  assert.match(publicationSql, /CREATE TABLE twin_publication_approvals/);
  assert.match(publicationSql, /Publication approval requires a second person/);
  assert.match(publicationSql, /PUBLISHING.*STORE_PUBLISHED.*COMPLETED/s);
  assert.match(publicationSql, /CREATE TRIGGER twin_publication_approvals_immutable/);
});

test("validation runs reference immutable report bindings and successful validation jobs", async () => {
  const validationSql = await readFile(`${migrationDirectory}/007_validation_runs.sql`, "utf8");
  assert.match(validationSql, /CREATE TABLE twin_validation_runs/);
  assert.match(validationSql, /twin_validation_runs_report_identity_fk/);
  assert.match(validationSql, /job_record\.status <> 'SUCCEEDED'/);
  assert.match(validationSql, /CREATE TRIGGER twin_validation_runs_immutable/);
});

test("draft artifact provenance is completed-upload-bound, same-draft, and append-only", async () => {
  const provenanceSql = await readFile(`${migrationDirectory}/006_draft_artifact_provenance.sql`, "utf8");
  assert.match(provenanceSql, /twin_draft_artifacts_completed_upload_fk/);
  assert.match(provenanceSql, /twin_draft_artifact_inputs_same_draft_fk/);
  assert.match(provenanceSql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(provenanceSql, /WITH RECURSIVE ancestors/);
  assert.match(provenanceSql, /twin_draft_artifact_inputs_count_guard/);
  assert.match(provenanceSql, /CREATE TRIGGER twin_draft_artifacts_immutable/);
  assert.match(provenanceSql, /CREATE TRIGGER twin_draft_artifact_inputs_immutable/);
});

test("outbox delivery uses expiring leases for concurrent dispatchers", async () => {
  const outboxSql = await readFile(`${migrationDirectory}/004_outbox_delivery_leases.sql`, "utf8");
  assert.match(outboxSql, /ADD COLUMN lease_owner text/);
  assert.match(outboxSql, /ADD COLUMN lease_expires_at timestamptz/);
  assert.match(outboxSql, /twin_outbox_lease_pair_check/);
  assert.match(outboxSql, /twin_outbox_delivery_claim_idx/);
});

test("upload sessions enforce terminal integrity and quarantine metadata", async () => {
  const uploadSql = await readFile(`${migrationDirectory}/005_upload_sessions.sql`, "utf8");
  assert.match(uploadSql, /CREATE TABLE twin_upload_sessions/);
  assert.match(uploadSql, /status <> 'COMPLETED'/);
  assert.match(uploadSql, /status <> 'QUARANTINED'/);
  assert.match(uploadSql, /twin_upload_sessions_claim_idx/);
});

test("published release records have database-level immutability guards", async () => {
  const releaseSql = await readFile(`${migrationDirectory}/001_site_map_release.sql`, "utf8");
  const assetsSql = await readFile(`${migrationDirectory}/003_semantic_assets_changes.sql`, "utf8");
  assert.match(releaseSql, /CREATE TRIGGER twin_map_releases_immutable/);
  assert.match(releaseSql, /CREATE TRIGGER twin_release_artifacts_immutable/);
  assert.match(assetsSql, /CREATE TRIGGER twin_release_asset_revisions_immutable/);
});
