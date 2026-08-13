import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresConfigurationError,
  createPostgresPool,
  createPostgresQueryPort,
  loadPostgresConfig,
} from "@brash-twin/persistence/postgres";
import { loadTwinApiConfig } from "../../services/twin-api/config.js";

test("PostgreSQL config is strict and produces bounded pool settings", () => {
  const config = loadPostgresConfig({
    TWIN_DATABASE_URL: "postgres://twin:secret@db.internal:5432/brash_twin",
    TWIN_DATABASE_SSL_MODE: "verify-full",
    TWIN_DATABASE_POOL_MAX: "12",
    TWIN_DATABASE_CONNECT_TIMEOUT_MS: "2500",
    TWIN_DATABASE_IDLE_TIMEOUT_MS: "45000",
    TWIN_DATABASE_STATEMENT_TIMEOUT_MS: "20000",
    TWIN_DATABASE_APPLICATION_NAME: "brash-twin-test",
  });

  const pool = createPostgresPool(config, { PoolConstructor: FakePool });
  assert.deepEqual(pool.options, {
    connectionString: config.connectionString,
    max: 12,
    connectionTimeoutMillis: 2500,
    idleTimeoutMillis: 45000,
    statement_timeout: 20000,
    application_name: "brash-twin-test",
    ssl: { rejectUnauthorized: true },
  });
});

test("PostgreSQL config rejects missing URL and unsafe numeric settings", () => {
  assert.throws(
    () => loadPostgresConfig({}),
    (error) => error instanceof PostgresConfigurationError && error.code === "DATABASE_URL_REQUIRED",
  );
  assert.throws(
    () => loadPostgresConfig({ TWIN_DATABASE_URL: "postgres://db/brash", TWIN_DATABASE_POOL_MAX: "0" }),
    (error) => error instanceof PostgresConfigurationError && error.code === "DATABASE_CONFIG_INVALID",
  );
  assert.throws(
    () => loadPostgresConfig({ TWIN_DATABASE_URL: "https://db/brash" }),
    (error) => error instanceof PostgresConfigurationError && error.code === "DATABASE_URL_INVALID",
  );
});

test("query port commits, rolls back, and reports readiness without credentials", async () => {
  const pool = new FakePool({});
  const database = createPostgresQueryPort(pool);
  const result = await database.transaction(async (transaction) => {
    await transaction.query("INSERT INTO example VALUES ($1)", [42]);
    return "committed";
  });
  assert.equal(result, "committed");
  assert.deepEqual(pool.client.queries.map((entry) => entry.text), ["BEGIN", "INSERT INTO example VALUES ($1)", "COMMIT"]);

  pool.queryResult = { rows: [{ healthy: 1 }] };
  const health = await database.health();
  assert.equal(health.ready, true);
  assert.deepEqual(health.pool, { total: 1, idle: 1, waiting: 0 });

  pool.client.queries.length = 0;
  await assert.rejects(() => database.transaction(async () => {
    throw new Error("operation failed");
  }), /operation failed/);
  assert.deepEqual(pool.client.queries.map((entry) => entry.text), ["BEGIN", "ROLLBACK"]);
  assert.equal(pool.client.released, true);
});

test("API config forbids ephemeral memory persistence in production", () => {
  assert.throws(
    () => loadTwinApiConfig({ TWIN_APP_ENV: "production", TWIN_PERSISTENCE_MODE: "memory" }),
    /Production requires/,
  );
  const config = loadTwinApiConfig({
    TWIN_APP_ENV: "production",
    TWIN_PERSISTENCE_MODE: "postgres",
    TWIN_HTTP_HOST: "0.0.0.0",
    TWIN_HTTP_PORT: "4380",
    TWIN_RELEASE_STORE_PATH: ".local/releases",
    TWIN_OBJECT_STORE_PATH: ".local/objects",
  });
  assert.equal(config.persistenceMode, "postgres");
  assert.equal(config.port, 4380);
  assert.match(config.objectStorePath, /\.local\/objects$/);
});

class FakePool {
  constructor(options) {
    this.options = options;
    this.totalCount = 1;
    this.idleCount = 1;
    this.waitingCount = 0;
    this.queryResult = { rows: [] };
    this.client = new FakeClient();
  }

  on() {}

  query() {
    return Promise.resolve(this.queryResult);
  }

  connect() {
    return Promise.resolve(this.client);
  }

  end() {
    return Promise.resolve();
  }
}

class FakeClient {
  queries = [];
  released = false;

  query(text, parameters) {
    this.queries.push({ text, parameters });
    return Promise.resolve({ rows: [] });
  }

  release() {
    this.released = true;
  }
}
