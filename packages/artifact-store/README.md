# Artifact Store

The Twin Studio boundary for large files and published release storage.

## Implemented components

- `ContentAddressedArtifactStore`: Addresses content by SHA-256, deduplicates
  identical bytes, and verifies integrity.
- `ImmutableReleaseStore`: Revalidates a valid Twin Map Bundle in staging and
  publishes it with one atomic rename. Publication inputs can be sealed under a
  publication identity and resumed after a process or database interruption.
- `LocalMultipartArtifactStore`: Keeps upload parts in staging outside the API
  process, assembles them with constant memory, validates SHA-256 and byte length,
  and moves only valid content into content-addressed storage. Mismatches remain
  under quarantine, while a completion receipt makes retries idempotent.

Both content-addressed local adapters expose `openReadStream(sha256)` for worker
consumption. A stream opens only after regular-file and content-address checks,
so bounded parsers do not need to load point clouds or recording archives into
API memory.

Release identifiers use `family-id@revision`. The same identity cannot be
published twice. The store never modifies the source bundle or a published
target.

The publication state machine compares canonical bundle descriptors, including
the manifest SHA-256 and every artifact identity. If a retry finds an existing
release, it proceeds only when that immutable identity is exactly the one sealed
by the database request.

The same immutable store accepts validated Twin Map Bundle v2 outputs. Scene
Manifest v2 and every referenced GLB must already pass provenance, budget, and
path/hash/byte/media checks before staging or publication can succeed.

The local filesystem implementation is intended for development and pilots. A
production S3 adapter must provide the same behavioral contract.
