# End-to-End Tests

Validate critical user journeys at browser and service boundaries:

1. Create a project/floor and upload sources.
2. Align CAD with a scan.
3. Verify a semantic suggestion and assign names/properties.
4. Edit topology and correct validation errors.
5. Publish a release and verify that it cannot be mutated.
6. Review moved/missing asset candidates from a new survey.
7. Select the same asset in 2D and 3D.

The implemented HTTP scenario currently binds a completed IFC upload as a source,
binds a deterministic import report as a derived artifact with producer/config
provenance, and reads the lineage back through the API.

Use small deterministic scene fixtures for 3D tests.
