# Manual Twin Milestone

Pure, browser-compatible functions for the first manual digital-twin acceptance
workflow.

## Responsibilities

- Solve deterministic 2D similarity or rigid transforms from at least three
  source/target control-point pairs.
- Report scale, rotation, translation, per-point residuals, RMSE, maximum error,
  solver identity, and configuration SHA-256 provenance.
- Project a solved transform onto viewer geometry without mutating source
  entities.
- Validate floorplan, alignment, asset, zone, and connected-topology readiness
  under an explicit policy.
- Produce deterministic feature-level draft diffs.
- Seal validated inputs, diff evidence, approvals, and read-only viewer entities
  into an immutable local milestone release.
- Enforce requester/approver separation and detect stale validation evidence.

## Boundary

The local milestone release is an operator-facing acceptance preview. Production
publication remains owned by Twin API's recoverable two-person publication
service and immutable release store. This package never calls or writes to Fleet
Control.
