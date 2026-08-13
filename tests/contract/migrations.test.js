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
  ]);

  for (const file of files) {
    const sql = await readFile(`${migrationDirectory}/${file}`, "utf8");
    assert.match(sql, /^BEGIN;/);
    assert.match(sql, /COMMIT;\s*$/);
    assert.doesNotMatch(sql, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i);
  }
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
