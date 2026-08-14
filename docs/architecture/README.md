# Architecture

## Data flow

```text
Brash Embodied Controller
   sensor drivers + SLAM + localization
                         |
             Embodied Survey Package v1
                         |
                         v
       Multipart Object Store + Durable Survey Intake
                         |
              +----------+----------+
              v                     v
        Fusion Worker         Semantic Worker
              +----------+----------+
                         v
                     Map Draft
                         |
                Operator Review + Validation
                         |
                         v
                    Map Release
                         |
             Scene Worker -> Twin Map Bundle
                         |
          +--------------+----------------+
          v                               v
      Studio Viewer                 Fleet Control importer
```

## Deployment boundaries

- The API and Studio Web scale independently from GPU workers.
- Large survey artifacts go directly to the object store.
- Robot-side sensing, SLAM, localization, autonomy, and safety belong to Brash
  Embodied Controller.
- Twin Studio receives versioned processed outputs and never imports controller
  source code or runtime libraries.
- Durable queues and an outbox make job/event delivery reliable.
- Drafts and published releases use different access and caching policies.
- Fleet Control retains a separate deployment, repository, and data ownership.

## Publication atomicity

A bundle is validated at its source, sealed under a publication identity,
revalidated against checksums and semantic rules, and made visible with one
rename under a release lock. Failed staging never enters the release catalog,
and a published identity can never be reused.

The release store and PostgreSQL use a recoverable state machine instead of a
distributed transaction:

```text
PENDING_APPROVAL -> APPROVED -> PUBLISHING -> STORE_PUBLISHED -> COMPLETED
       |               |             |                |
  second person    lease claim   atomic rename    DB release + draft
                                                  + audit + outbox
```

If execution stops after the rename or store marker, a reconciler acquires an
expired lease, verifies the canonical manifest/artifact identity, and resumes.
The final database effects occur in one transaction.

## Survey intake atomicity

The manifest and every survey artifact first complete independent
content-addressed uploads. Intake creation then stores the manifest identity and
all artifact-to-upload mappings in one database transaction. Composite foreign
keys admit only completed uploads; a deferred count guard prevents partial
mapping sets. Verification reads at most the bounded JSON manifest, compares it
with the sealed upload metadata, and permits exactly one terminal result:

```text
COMPLETED UPLOADS -> OPEN INTAKE -> ACCEPTED | REJECTED
```

Both outcomes are audit history. Only an accepted intake may feed later survey
materialization and CAD-registration jobs.

## Catalog layers

```text
HTTP Server -> TwinApi -> TwinCatalogService -> CatalogRepository
                                                |- InMemory adapter
                                                `- PostgreSQL adapter

TwinApi -> ImmutableReleaseStore (read-only catalog)
PublicationService -> PublicationRepository + ImmutableReleaseStore
CLI                -> ImmutableReleaseStore (validated publication)
```

The HTTP API knows nothing about PostgreSQL SQL or filesystem paths. The
application service knows nothing about HTTP. Repository adapters provide the
same optimistic-concurrency behavior. The trusted publication service is not an
HTTP filesystem-path endpoint; a future packager will supply its sealed input.

## Trust boundaries

Embodied Controller producers authenticate with device identities; operators
authenticate with user identities. Publication and baseline changes require
separate permissions. Raw camera data is sensitive and is governed by access,
audit, and retention policies.
