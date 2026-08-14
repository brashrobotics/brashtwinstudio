# Database Migrations

Contains ordered, forward-only migrations for the relational metadata schema.

Initial schema families:

- Site, building, floor, and coordinate frame
- Survey session and sensor profile
- Processing job and artifact metadata
- Draft/release and publication audit
- Twin asset, observation, and change candidate
- Review, approval, and outbox event

Published releases and audit history must never be deleted during migration.

## Implemented migrations

- `001_site_map_release.sql`: Site/building/floor, draft, immutable release,
  artifact catalog, and publication audit.
- `002_survey_jobs_outbox.sql`: Survey records, durable job/lease model, and
  transactional outbox.
- `003_semantic_assets_changes.sql`: Frame sets, versioned twin assets, semantic
  observations, change candidates, and review decisions.
- `004_outbox_delivery_leases.sql`: Outbox lease fields, consistency constraint,
  and pending-delivery claim index for concurrent dispatchers.
- `005_upload_sessions.sql`: Upload intent, expiry, content identity, terminal
  completion/quarantine rules, and artifact-metadata links.
- `006_draft_artifact_provenance.sql`: Completed upload-to-draft bindings,
  source/derived role separation, immutable same-draft input lineage,
  producer/config provenance, and update/delete guards.
- `007_validation_runs.sql`: Release-validation job results, immutable report
  binding/hash identity, validator configuration, severity counts, and
  consistency guards tying each run to a succeeded validation job.
- `008_publication_state_machine.sql`: Sealed publication requests, append-only
  two-person approval, recovery leases, legal state transitions, and immutable
  completion history.
- `009_survey_intakes.sql`: Atomic, completed-upload-bound embodied survey
  evidence and a single immutable acceptance or rejection transition.
- `010_survey_materialization_jobs.sql`: One accepted-intake-bound,
  content-hashed materialization snapshot per editable draft, protected by
  composite provenance and append-only guards.
- `011_survey_materialization_lifecycle.sql`: Leased execution and bounded
  retries over an immutable input snapshot, with a content-addressed preview
  artifact reference for successful jobs.
- `012_survey_artifact_lineage.sql`: Accepted survey source bindings and
  source-frame preview derivation roles, with the artifact input bound aligned
  to the 256-file survey intake limit.
- `013_registration_acceptance.sql`: Immutable registration-review evidence role
  derived from one quality-scored survey-to-design registration report.
- `014_survey_quality_review.sql`: Spatial survey-quality report and immutable
  operator acceptance roles derived from one materialization preview.
- `015_semantic_asset_candidates.sql`: Derived semantic observations, canonical
  asset-candidate reports, and immutable operator-review provenance roles.
- `016_twin_asset_promotion_changes.sql`: Spatial, derived `TWIN_ASSETS` revision
  and `ASSET_CHANGE_REPORT` roles protected by the append-only draft provenance
  graph.

PostgreSQL triggers prevent updates and deletes to primary release records,
release-artifact bindings, and asset revisions linked to a release. Draft artifact
bindings and input edges are also append-only.
Validation-run records are append-only and must reference a `VALIDATION_REPORT`
binding belonging to the same draft and SHA-256 content identity.
Publication triggers prevent requester self-approval, identity mutation, illegal
state transitions, approval deletion, and completed-history mutation.
Survey intake mappings are append-only; an intake can move from `OPEN` to one
terminal verification result exactly once.
Survey materialization input snapshots remain immutable and can only reference
an accepted intake and the exact manifest identity sealed during verification;
only guarded execution-state transitions may update their job rows.
Each successful survey preview is a derived draft artifact with immutable
input edges to every accepted survey source artifact used to create it.
