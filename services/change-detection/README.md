# Change Detection Service

Compares observations from a new survey with the published baseline.

## Responsibilities

- Match observations and assets in the same coordinate system.
- Produce `MOVED`, `MISSING`, `APPEARED`, `GEOMETRY_CHANGED`, and `BLOCKED`
  candidates.
- Account for localization uncertainty, visibility, and occlusion.
- Apply per-asset tolerances, minimum confidence, and repeated-verification
  policies.
- Combine evidence from multiple survey passes into one candidate.
- Request a new draft or operational event for an approved change.

The service does not send messages directly to alarm channels; it emits a domain
event that notification channels may subscribe to.

After an independent review is applied, `TwinAssetChangesApplied.v1` is the
versioned subscription boundary. The manager-notification projector converts it
into a redacted delivery message without exposing asset geometry, properties,
images, contact destinations, or provider credentials.
