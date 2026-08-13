#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { PostgresMigrationRunner } from "@brash-twin/migrations";
import {
  createPostgresPool,
  createPostgresQueryPort,
  loadPostgresConfig,
} from "@brash-twin/persistence/postgres";

const [command] = process.argv.slice(2);
if (!["migrate", "status"].includes(command)) {
  console.error("Usage: brash-twin-db <migrate|status>");
  process.exitCode = 2;
} else {
  const pool = createPostgresPool(loadPostgresConfig(process.env), {
    onBackgroundError(error) {
      console.error("PostgreSQL pool background error", { code: error?.code ?? "DATABASE_UNAVAILABLE" });
    },
  });
  const database = createPostgresQueryPort(pool);
  try {
    const migrationDirectory = fileURLToPath(new URL("../../storage/migrations", import.meta.url));
    const runner = new PostgresMigrationRunner({ database, migrationDirectory });
    const result = command === "migrate" ? await runner.migrate() : await runner.status();
    console.log(JSON.stringify(result, null, 2));
    if (command === "status" && result.entries.some((entry) => !["APPLIED", "PENDING"].includes(entry.state))) {
      process.exitCode = 1;
    }
  } finally {
    await database.close();
  }
}
