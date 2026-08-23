# Scene CLI

Builds an immutable Twin Map Bundle v2 staging directory with deterministic GLB
LOD tiles.

```bash
node tools/scene-cli/cli.js package <source-bundle> <target-bundle> \
  --validation-report-sha256 <64-lowercase-hex>
```

The command refuses an existing target and never modifies the source. The
target becomes visible only after complete bundle validation succeeds.
