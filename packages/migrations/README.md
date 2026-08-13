# Migrations

Safely discovers, validates, and applies PostgreSQL metadata migrations.

## Guarantees

- Files are ordered as `NNN_name.sql`.
- Each file's SHA-256 is recorded in `twin_schema_migrations`.
- Execution stops if an applied migration's contents change.
- A PostgreSQL session advisory lock prevents multiple API instances from
  applying migrations concurrently.
- Migration SQL and its migration-record insert share one transaction.
- The runner removes each file's outer `BEGIN/COMMIT` wrapper in a controlled
  manner.
- Unknown or missing local migration history is treated as an error.
- `status` is read-only and does not create a history table in an empty database.

The runner supports forward-only migrations and never runs automatic down
migrations in production.
