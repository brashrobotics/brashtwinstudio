import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const MIGRATION_PATTERN = /^(?<version>[0-9]{3,})_(?<name>[a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_KEY = 7_349_217_401;

export class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

export async function discoverMigrations(directory) {
  const absoluteDirectory = resolve(directory);
  const fileNames = (await readdir(absoluteDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const migrations = [];
  const versions = new Set();
  for (const fileName of fileNames) {
    const match = fileName.match(MIGRATION_PATTERN);
    if (!match) {
      throw new MigrationError("MIGRATION_NAME_INVALID", `Migration file ${fileName} must use NNN_name.sql format.`);
    }
    const version = Number(match.groups.version);
    if (!Number.isSafeInteger(version) || version < 1 || versions.has(version)) {
      throw new MigrationError("MIGRATION_VERSION_INVALID", `Migration version ${match.groups.version} is invalid or duplicated.`);
    }
    versions.add(version);
    const rawSql = await readFile(resolve(absoluteDirectory, fileName), "utf8");
    const sql = stripTransactionWrapper(rawSql, fileName);
    migrations.push(Object.freeze({
      version,
      name: match.groups.name,
      fileName,
      checksum: createHash("sha256").update(rawSql).digest("hex"),
      sql,
    }));
  }
  if (migrations.length === 0) throw new MigrationError("MIGRATION_REQUIRED", "At least one migration file is required.");
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version >= migrations[index].version) {
      throw new MigrationError("MIGRATION_ORDER_INVALID", "Migration versions must be strictly increasing.");
    }
  }
  return Object.freeze(migrations);
}

export class PostgresMigrationRunner {
  #database;
  #migrationDirectory;
  #clock;

  constructor({ database, migrationDirectory, clock = () => new Date() }) {
    if (!database || typeof database.session !== "function") {
      throw new MigrationError("DATABASE_SESSION_REQUIRED", "Migration runner requires a database session port.");
    }
    if (typeof migrationDirectory !== "string" || migrationDirectory.trim() === "") {
      throw new MigrationError("MIGRATION_DIRECTORY_REQUIRED", "Migration directory is required.");
    }
    this.#database = database;
    this.#migrationDirectory = migrationDirectory;
    this.#clock = clock;
  }

  async status() {
    const migrations = await discoverMigrations(this.#migrationDirectory);
    return this.#database.session(async (session) => {
      const applied = await historyTableExists(session) ? await appliedMigrations(session) : [];
      return buildStatus(migrations, applied);
    });
  }

  async migrate() {
    const migrations = await discoverMigrations(this.#migrationDirectory);
    return this.#database.session(async (session) => {
      await session.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      try {
        await ensureHistoryTable(session);
        const before = buildStatus(migrations, await appliedMigrations(session));
        assertHistoryCompatible(before);
        const appliedNow = [];
        for (const migration of migrations) {
          if (before.entries.some((entry) => entry.version === migration.version && entry.state === "APPLIED")) continue;
          await session.transaction(async (transaction) => {
            await transaction.query(migration.sql);
            await transaction.query(
              `INSERT INTO twin_schema_migrations
               (version, name, checksum, applied_at)
               VALUES ($1, $2, $3, $4)`,
              [migration.version, migration.name, migration.checksum, isoDate(this.#clock())],
            );
          });
          appliedNow.push(migration.version);
        }
        const after = buildStatus(migrations, await appliedMigrations(session));
        assertHistoryCompatible(after);
        return Object.freeze({ ...after, appliedNow: Object.freeze(appliedNow) });
      } finally {
        await session.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
      }
    });
  }
}

async function ensureHistoryTable(session) {
  await session.query(`
    CREATE TABLE IF NOT EXISTS twin_schema_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL,
      checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL
    )
  `);
}

async function historyTableExists(session) {
  const result = await session.query("SELECT to_regclass('twin_schema_migrations') AS table_name");
  return result.rows[0]?.table_name !== null && result.rows[0]?.table_name !== undefined;
}

async function appliedMigrations(session) {
  const result = await session.query(
    "SELECT version, name, checksum, applied_at FROM twin_schema_migrations ORDER BY version",
  );
  return result.rows.map((row) => ({
    version: Number(row.version),
    name: row.name,
    checksum: row.checksum,
    appliedAt: new Date(row.applied_at).toISOString(),
  }));
}

function buildStatus(local, applied) {
  const localByVersion = new Map(local.map((migration) => [migration.version, migration]));
  const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration]));
  const versions = [...new Set([...localByVersion.keys(), ...appliedByVersion.keys()])].sort((left, right) => left - right);
  const entries = versions.map((version) => {
    const migration = localByVersion.get(version);
    const historical = appliedByVersion.get(version);
    let state = "PENDING";
    if (!migration) state = "UNKNOWN_APPLIED";
    else if (historical && historical.name !== migration.name) state = "NAME_MISMATCH";
    else if (historical && historical.checksum !== migration.checksum) state = "CHECKSUM_MISMATCH";
    else if (historical) state = "APPLIED";
    return Object.freeze({
      version,
      name: migration?.name ?? historical.name,
      checksum: migration?.checksum ?? historical.checksum,
      appliedAt: historical?.appliedAt ?? null,
      state,
    });
  });
  return Object.freeze({
    currentVersion: applied.length === 0 ? 0 : Math.max(...applied.map((migration) => migration.version)),
    latestVersion: local.at(-1).version,
    pendingCount: entries.filter((entry) => entry.state === "PENDING").length,
    entries: Object.freeze(entries),
  });
}

function assertHistoryCompatible(status) {
  const incompatible = status.entries.filter((entry) => !["PENDING", "APPLIED"].includes(entry.state));
  if (incompatible.length > 0) {
    throw new MigrationError(
      "MIGRATION_HISTORY_INCOMPATIBLE",
      `Migration history is incompatible: ${incompatible.map((entry) => `${entry.version}:${entry.state}`).join(", ")}.`,
    );
  }
}

function stripTransactionWrapper(rawSql, fileName) {
  const normalized = rawSql.replace(/^\uFEFF/, "").trim();
  const match = normalized.match(/^BEGIN;\s*([\s\S]*?)\s*COMMIT;$/i);
  if (!match) {
    throw new MigrationError(
      "MIGRATION_TRANSACTION_WRAPPER_REQUIRED",
      `Migration ${fileName} must contain one outer BEGIN/COMMIT wrapper.`,
    );
  }
  if (/\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(match[1])) {
    throw new MigrationError("MIGRATION_NESTED_TRANSACTION", `Migration ${fileName} contains a nested transaction statement.`);
  }
  return match[1].trim();
}

function isoDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new MigrationError("MIGRATION_CLOCK_INVALID", "Migration clock returned an invalid date.");
  return date.toISOString();
}
