# Tools

Contains CLI tools for controlled developer and operator maintenance and
inspection workflows.

- `map-bundle-cli/`: Bundle creation, validation, diff, and inspection.
- `scene-cli/`: Atomic optimized-scene generation and Bundle v2 packaging.
- `fleet-demo-fixture/`: Reproducible project-owned Bundle v2 visual fixture.
- `database-cli/`: PostgreSQL migration status and application.
- `dataset-cli/`: External dataset integrity and structure inspection.
- `demo-seed/`: Compact end-to-end development survey and registration seed.
- `grandtour-seed/`: Real GrandTour ETH-2 processed-survey import demo.

CLI tools must reuse domain validation packages instead of implementing separate,
conflicting validation rules.
