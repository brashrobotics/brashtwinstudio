# Integration Tests

Contains checks that cross process boundaries, including real PostgreSQL and
external spatial datasets. External dataset binaries are not committed to the
repository. `conslam-dataset-live.test.js` runs only when
`TWIN_TEST_CONSLAM_DIR` is set; the IfcOpenShell triangulation gate additionally
requires `TWIN_IFCOPENSHELL_PYTHON`.

`grandtour-dataset-live.test.js` runs only when `TWIN_TEST_GRANDTOUR_DIR` and
`TWIN_GRANDTOUR_PYTHON` point to the verified base selection and its isolated
Python environment. It checks the three SHA-256 identities before bounded
inspection and does not require optional camera or IMU downloads.

These tests cover real infrastructure boundaries together:

- Upload -> object store -> ingest job
- Queue -> worker -> artifact -> job completion
- Draft -> validation -> immutable publication
- Observation -> change candidate -> review
- Reliable event production through transaction/outbox
- Completed upload -> draft source -> immutable derived-input provenance
- Completed survey uploads -> atomic intake -> manifest-only acceptance/rejection
- Job retry, cancellation, and process-restart recovery

Tests must not depend on an external Fleet Control service.
