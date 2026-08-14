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

PostgreSQL triggers prevent updates and deletes to primary release records,
release-artifact bindings, and asset revisions linked to a release. Draft artifact
bindings and input edges are also append-only.
Validation-run records are append-only and must reference a `VALIDATION_REPORT`
binding belonging to the same draft and SHA-256 content identity.
Publication triggers prevent requester self-approval, identity mutation, illegal
state transitions, approval deletion, and completed-history mutation.
Survey intake mappings are append-only; an intake can move from `OPEN` to one
terminal verification result exactly once.
Survey materialization snapshot rows are append-only and can only reference an
accepted intake and the exact manifest identity sealed during verification.
