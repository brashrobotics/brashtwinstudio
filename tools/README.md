# Tools

Contains CLI tools for controlled developer and operator maintenance and
inspection workflows.

- `map-bundle-cli/`: Bundle creation, validation, diff, and inspection.
- `database-cli/`: PostgreSQL migration status and application.
- `dataset-cli/`: External dataset integrity and structure inspection.
- `demo-seed/`: Compact end-to-end development survey and registration seed.

CLI tools must reuse domain validation packages instead of implementing separate,
conflicting validation rules.
