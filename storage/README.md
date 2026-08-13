# Storage

Defines the policy for keeping metadata separate from large geometry and sensor
artifacts.

- Relational database: sites, revisions, assets, jobs, observations, audits, and
  indexes.
- Object store: raw surveys, point clouds, images, meshes, LODs, and bundle files.
- Event/outbox: reliable asynchronous job and notification delivery.

The database stores checksums, URIs, sizes, MIME types, and bounds instead of
large binary content.

- `migrations/`: Schema changes.
- `object-store/`: Bucket and retention layout.
