# Domain

Contains the infrastructure-independent Mapping/Twin business model.

## Main aggregates

- `SurveySession`
- `CoordinateFrame`
- `MapDraft` and `MapRelease`
- `TwinAsset` and `AssetRevision`
- `SemanticObservation`
- `ChangeCandidate`
- `ProcessingJob`

The domain must not know about HTTP, databases, GPU frameworks, vendor message
types, or rendering engines.

## Implemented core

- `MapDraft` aggregate producing immutable releases.
- Persistable `createMapDraftRecord` representation.
- `SUBMIT_REVIEW`, `RETURN_TO_DRAFT`, and `MARK_VALIDATED` transitions.
- Audit identity and time plus optimistic `rowVersion` increments on every
  transition.
- Versioned lifecycle event envelopes and audit payloads for draft creation,
  review, return, and validation transitions.
- `INITIATED -> COMPLETED|QUARANTINED|CANCELLED|EXPIRED` upload lifecycle with
  content-identity and terminal-state rules.
- `OPEN -> ACCEPTED|REJECTED` embodied survey intake lifecycle with sealed
  manifest/upload identities and exactly one verification transition.
- Source/derived draft artifact roles with spatial-frame requirements, immutable
  input identity, and producer version/config-hash provenance.
- System-managed asset candidate, Twin asset revision, change report, and
  independent change-review roles; each correction is append-only evidence.
- `PENDING_APPROVAL -> APPROVED -> PUBLISHING -> STORE_PUBLISHED -> COMPLETED`
  publication state with a mandatory requester/approver separation.
- Sealed bundle/draft/validation identities and a versioned
  `MapReleasePublished.v1` event envelope.
