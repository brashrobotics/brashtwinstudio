import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MigrationError, discoverMigrations } from "@brash-twin/migrations";

test("migration discovery orders versions and hashes raw content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "brash-migrations-"));
  await writeFile(join(directory, "002_second.sql"), "BEGIN;\nSELECT 2;\nCOMMIT;\n");
  await writeFile(join(directory, "001_first.sql"), "BEGIN;\nSELECT 1;\nCOMMIT;\n");

  const migrations = await discoverMigrations(directory);
  assert.deepEqual(migrations.map((migration) => migration.version), [1, 2]);
  assert.deepEqual(migrations.map((migration) => migration.sql), ["SELECT 1;", "SELECT 2;"]);
  assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)));
});

test("migration discovery rejects unsafe names and nested transaction control", async () => {
  const unsafeName = await mkdtemp(join(tmpdir(), "brash-migrations-name-"));
  await writeFile(join(unsafeName, "manual.sql"), "BEGIN; SELECT 1; COMMIT;");
  await assert.rejects(
    () => discoverMigrations(unsafeName),
    (error) => error instanceof MigrationError && error.code === "MIGRATION_NAME_INVALID",
  );

  const nested = await mkdtemp(join(tmpdir(), "brash-migrations-nested-"));
  await writeFile(join(nested, "001_nested.sql"), "BEGIN; BEGIN; SELECT 1; COMMIT; COMMIT;");
  await assert.rejects(
    () => discoverMigrations(nested),
    (error) => error instanceof MigrationError && error.code === "MIGRATION_NESTED_TRANSACTION",
  );
});
