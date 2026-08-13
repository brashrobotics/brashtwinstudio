# Brash Mapping & Twin Studio Agent Boundary

## Scope

Work in this directory is limited to the standalone Brash Mapping & Twin Studio
product.

## Repository isolation

- Do not modify `../brashfleetcontrol` unless the user explicitly requests a
  coordinated Fleet Control change in the current task.
- Do not import source files, database tables, build outputs, environment files,
  or unpublished internal types from `../brashfleetcontrol`.
- Integrate through versioned schemas, fixtures, events, and `Twin Map Bundle`
  artefacts owned by this project.
- Keep runtime services, deployment definitions, package management, tests, and
  environment configuration independent from Fleet Control.
- Treat any existing changes in the sibling project as user-owned work.

## Product rules

- Preserve raw survey evidence and coordinate-frame provenance.
- Treat AI detections as observations until a review policy promotes them to
  twin assets.
- Never mutate a published map release; create a new revision.
- Keep static release geometry separate from live operational state.
- Add or update the nearest README when introducing a new top-level component.
