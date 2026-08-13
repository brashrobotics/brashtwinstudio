import { resolve } from "node:path";

export class TwinApiConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TwinApiConfigurationError";
    this.code = code;
  }
}

export function loadTwinApiConfig(environment = process.env) {
  const applicationEnvironment = enumValue(
    environment.TWIN_APP_ENV ?? "development",
    ["development", "test", "production"],
    "TWIN_APP_ENV",
  );
  const persistenceMode = enumValue(
    environment.TWIN_PERSISTENCE_MODE ?? "memory",
    ["memory", "postgres"],
    "TWIN_PERSISTENCE_MODE",
  );
  if (applicationEnvironment === "production" && persistenceMode !== "postgres") {
    throw new TwinApiConfigurationError(
      "PRODUCTION_PERSISTENCE_REQUIRED",
      "Production requires TWIN_PERSISTENCE_MODE=postgres.",
    );
  }
  return Object.freeze({
    applicationEnvironment,
    persistenceMode,
    host: host(environment.TWIN_HTTP_HOST ?? "127.0.0.1"),
    port: port(environment.TWIN_HTTP_PORT ?? "4380"),
    releaseStorePath: resolve(pathValue(environment.TWIN_RELEASE_STORE_PATH ?? ".local/twin-store")),
    objectStorePath: resolve(pathValue(environment.TWIN_OBJECT_STORE_PATH ?? ".local/object-store")),
  });
}

function enumValue(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new TwinApiConfigurationError("CONFIG_INVALID", `${fieldName} must be one of ${allowed.join(", ")}.`);
  }
  return value;
}

function host(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9.:-]{1,255}$/.test(value)) {
    throw new TwinApiConfigurationError("CONFIG_INVALID", "TWIN_HTTP_HOST is invalid.");
  }
  return value;
}

function port(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TwinApiConfigurationError("CONFIG_INVALID", "TWIN_HTTP_PORT must be a valid TCP port.");
  }
  return parsed;
}

function pathValue(value) {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new TwinApiConfigurationError("CONFIG_INVALID", "TWIN_RELEASE_STORE_PATH is invalid.");
  }
  return value;
}
