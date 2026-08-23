# Fleet Demo Fixture Builder

Creates a deterministic, non-customer `demo-plant@2` release from the
project-owned `demo-plant@1` geometry, then runs the production Scene Manifest
v2 packager.

```bash
node tools/fleet-demo-fixture/cli.js <empty-target-directory>
```

The command exists only to reproduce the committed visual-integration fixture.
It never edits the v1 source fixture and refuses an existing target.
