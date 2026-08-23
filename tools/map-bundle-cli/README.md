# Map Bundle CLI

Offline operations tool for Twin Map Bundles.

Validation and inspection support legacy Bundle/Scene v1 and the current
Bundle/Scene v2 integrity model. Scene v2 additionally verifies every GLB level
against its bound root artifact identity and sealed budgets.

Planned commands:

- `validate`: Validate schema, checksums, coordinate frames, and topology.
- `inspect`: Show a manifest and artifact summary.
- `diff`: Compare spatial, semantic, and topology changes between releases.
- `pack`: Package validated draft artifacts into an immutable bundle.
- `unpack`: Safely extract a bundle for inspection.

The first phase must not add a Fleet Control push/import command. Integration
data ownership and authorization must be agreed by both projects first.

## Available commands

```bash
node cli.js validate <bundle-directory> [--json]
node cli.js inspect <bundle-directory>
node cli.js diff <old-bundle-directory> <new-bundle-directory>
node cli.js publish <bundle-directory> <release-store-directory>
```

`validate`, `inspect`, `diff`, and atomic `publish` are implemented. `pack` and
`unpack` will be implemented after the draft/release storage flow is complete.
