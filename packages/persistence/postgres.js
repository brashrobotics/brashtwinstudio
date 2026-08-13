import pg from "pg";

const { Pool } = pg;

const DEFAULTS = Object.freeze({
  maximumConnections: 10,
  connectionTimeoutMilliseconds: 5_000,
  idleTimeoutMilliseconds: 30_000,
  statementTimeoutMilliseconds: 30_000,
  applicationName: "brash-twin-api",
});

export class PostgresConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PostgresConfigurationError";
    this.code = code;
  }
}

export function loadPostgresConfig(environment = process.env) {
  const connectionString = requiredConnectionString(environment.TWIN_DATABASE_URL);
  const sslMode = enumValue(
    environment.TWIN_DATABASE_SSL_MODE ?? "disable",
    ["disable", "require", "verify-full"],
    "TWIN_DATABASE_SSL_MODE",
  );
  return Object.freeze({
    connectionString,
    sslMode,
    maximumConnections: positiveInteger(
      environment.TWIN_DATABASE_POOL_MAX ?? DEFAULTS.maximumConnections,
      "TWIN_DATABASE_POOL_MAX",
      1,
      100,
    ),
    connectionTimeoutMilliseconds: positiveInteger(
      environment.TWIN_DATABASE_CONNECT_TIMEOUT_MS ?? DEFAULTS.connectionTimeoutMilliseconds,
      "TWIN_DATABASE_CONNECT_TIMEOUT_MS",
      100,
      120_000,
    ),
    idleTimeoutMilliseconds: positiveInteger(
      environment.TWIN_DATABASE_IDLE_TIMEOUT_MS ?? DEFAULTS.idleTimeoutMilliseconds,
      "TWIN_DATABASE_IDLE_TIMEOUT_MS",
      1_000,
      600_000,
    ),
    statementTimeoutMilliseconds: positiveInteger(
      environment.TWIN_DATABASE_STATEMENT_TIMEOUT_MS ?? DEFAULTS.statementTimeoutMilliseconds,
      "TWIN_DATABASE_STATEMENT_TIMEOUT_MS",
      100,
      600_000,
    ),
    applicationName: applicationName(environment.TWIN_DATABASE_APPLICATION_NAME ?? DEFAULTS.applicationName),
  });
}

export function createPostgresPool(configuration, options = {}) {
  if (!configuration || typeof configuration !== "object") {
    throw new PostgresConfigurationError("DATABASE_CONFIG_REQUIRED", "PostgreSQL configuration is required.");
  }
  const PoolConstructor = options.PoolConstructor ?? Pool;
  const pool = new PoolConstructor({
    connectionString: configuration.connectionString,
    max: configuration.maximumConnections,
    connectionTimeoutMillis: configuration.connectionTimeoutMilliseconds,
    idleTimeoutMillis: configuration.idleTimeoutMilliseconds,
    statement_timeout: configuration.statementTimeoutMilliseconds,
    application_name: configuration.applicationName,
    ssl: sslConfiguration(configuration.sslMode),
  });
  pool.on?.("error", (error) => options.onBackgroundError?.(error));
  return pool;
}

export function createPostgresQueryPort(pool) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    throw new PostgresConfigurationError("DATABASE_POOL_REQUIRED", "A PostgreSQL pool is required.");
  }
  return Object.freeze({
    query(text, parameters = []) {
      return pool.query(text, parameters);
    },
    async transaction(operation) {
      if (typeof operation !== "function") throw new TypeError("Transaction operation must be a function.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(Object.freeze({
          query(text, parameters = []) {
            return client.query(text, parameters);
          },
        }));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async session(operation) {
      if (typeof operation !== "function") throw new TypeError("Session operation must be a function.");
      const client = await pool.connect();
      const query = (text, parameters = []) => client.query(text, parameters);
      try {
        return await operation(Object.freeze({
          query,
          async transaction(transactionOperation) {
            if (typeof transactionOperation !== "function") {
              throw new TypeError("Transaction operation must be a function.");
            }
            await query("BEGIN");
            try {
              const result = await transactionOperation(Object.freeze({ query }));
              await query("COMMIT");
              return result;
            } catch (error) {
              await query("ROLLBACK").catch(() => undefined);
              throw error;
            }
          },
        }));
      } finally {
        client.release();
      }
    },
    async health() {
      const startedAt = performance.now();
      try {
        const result = await pool.query("SELECT 1 AS healthy");
        return Object.freeze({
          ready: result.rows[0]?.healthy === 1,
          latencyMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
          pool: poolStats(pool),
        });
      } catch (error) {
        return Object.freeze({
          ready: false,
          latencyMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
          pool: poolStats(pool),
          errorCode: safeDatabaseErrorCode(error),
        });
      }
    },
    close() {
      return pool.end();
    },
  });
}

function requiredConnectionString(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PostgresConfigurationError("DATABASE_URL_REQUIRED", "TWIN_DATABASE_URL is required in PostgreSQL mode.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new PostgresConfigurationError("DATABASE_URL_INVALID", "TWIN_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new PostgresConfigurationError("DATABASE_URL_INVALID", "TWIN_DATABASE_URL must use postgres:// or postgresql://.");
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
    throw new PostgresConfigurationError("DATABASE_URL_INVALID", "TWIN_DATABASE_URL requires a host and database name.");
  }
  return value;
}

function positiveInteger(value, fieldName, minimum, maximum) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PostgresConfigurationError(
      "DATABASE_CONFIG_INVALID",
      `${fieldName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function enumValue(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new PostgresConfigurationError("DATABASE_CONFIG_INVALID", `${fieldName} must be one of ${allowed.join(", ")}.`);
  }
  return value;
}

function applicationName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,63}$/.test(value)) {
    throw new PostgresConfigurationError(
      "DATABASE_CONFIG_INVALID",
      "TWIN_DATABASE_APPLICATION_NAME must contain 1-63 safe identifier characters.",
    );
  }
  return value;
}

function sslConfiguration(mode) {
  if (mode === "disable") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

function poolStats(pool) {
  return Object.freeze({
    total: finiteOrZero(pool.totalCount),
    idle: finiteOrZero(pool.idleCount),
    waiting: finiteOrZero(pool.waitingCount),
  });
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function safeDatabaseErrorCode(error) {
  if (typeof error?.code === "string" && /^[A-Z0-9_]{1,20}$/.test(error.code)) return error.code;
  return "DATABASE_UNAVAILABLE";
}
