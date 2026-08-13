# Object Store Layout

Defines the logical bucket/key layout for large immutable files.

```text
raw-surveys/{siteId}/{surveyId}/...
processed/{surveyId}/{jobId}/{contentHash}/...
drafts/{draftId}/...
releases/{mapReleaseId}/...
evidence/{observationId}/...
```

Long-term retention and access policies for raw surveys must be defined
separately. Published release files must be immutable and content-hash verified.

## Local implementation

The development/pilot filesystem adapter is implemented by
`packages/artifact-store/ContentAddressedArtifactStore`. SHA-256 objects use this
layout:

```text
objects/sha256/{first-two-characters}/{full-sha256}
```

Every read may run an independent integrity check. A production S3 adapter must
preserve the same key and immutability behavior.

Multipart staging and result layout:

```text
staging/uploads/{uploadId}/{partNumber}.part
upload-receipts/{uploadId}.json
quarantine/{uploadId}/{observedSha256}.bin
```

The API manages only intent, metadata, and completion; large file bytes use the
object-store data plane. Checksum or byte-length mismatches never produce a final
object key.
