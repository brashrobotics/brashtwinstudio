# Survey Fixtures

Small synthetic manifests exercise the Brash Embodied Controller transfer
boundary without storing sensor binaries in source control.

`embodied-demo.v1.json` declares representative frame, calibration, trajectory,
point-cloud, and quality artifacts. Its hashes and byte counts are synthetic;
the fixture validates manifest behavior only.

Real survey data remains external and optional. Integration tests must use an
explicit environment variable and must never download multi-gigabyte inputs as
a side effect.
