# Bundle Fixtures

`demo-plant@1` is a small valid Twin Map Bundle example. It contains no binary 3D
tiles; its scene manifest uses an empty tile list so tests can focus on contracts
and spatial relationships.

`demo-plant@2` is the generated Scene Manifest v2 visual-integration fixture. It
contains four factory tiles with detailed and coarse GLB levels, all bound by
path, media type, SHA-256, and byte length in Twin Map Bundle v2. Rebuild it into
an empty directory with `node tools/fleet-demo-fixture/cli.js <target>`.
