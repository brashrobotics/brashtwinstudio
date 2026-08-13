#!/usr/bin/env node
import { createServer } from "node:http";
import { createTwinApiSystem } from "./bootstrap.js";

const bodyLimitBytes = 1_048_576;

export function startTwinApiServer({ api, host = "127.0.0.1", port = 4380 }) {
  if (!api) throw new TypeError("Twin API is required.");
  const server = createServer(async (request, serverResponse) => {
    try {
      const body = await readJsonBody(request);
      const result = await api.handle({
        method: request.method,
        url: request.url,
        body,
      });
      serverResponse.writeHead(result.status, result.headers);
      serverResponse.end(JSON.stringify(result.body));
    } catch (error) {
      const status = error instanceof HttpInputError ? error.status : 500;
      const code = error instanceof HttpInputError ? error.code : "INTERNAL_ERROR";
      const message = error instanceof HttpInputError ? error.message : "An unexpected error occurred.";
      if (!(error instanceof HttpInputError)) console.error(error);
      serverResponse.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({ error: { code, message } }));
    }
  });
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveStart(server));
  });
}

class HttpInputError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function readJsonBody(request) {
  if (["GET", "HEAD"].includes(request.method ?? "GET")) return undefined;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > bodyLimitBytes) throw new HttpInputError("BODY_TOO_LARGE", "Request body exceeds 1 MiB.", 413);
    chunks.push(chunk);
  }
  if (bytes === 0) return undefined;
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpInputError("CONTENT_TYPE_UNSUPPORTED", "Request body must use application/json.", 415);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpInputError("JSON_INVALID", "Request body is not valid JSON.", 400);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const system = createTwinApiSystem({
    onDatabaseBackgroundError(error) {
      console.error("PostgreSQL pool background error", { code: error?.code ?? "DATABASE_UNAVAILABLE" });
    },
  });
  const server = await startTwinApiServer({
    api: system.api,
    host: system.config.host,
    port: system.config.port,
  });
  console.log(`Brash Twin API listening at http://${system.config.host}:${system.config.port}`, {
    persistenceMode: system.config.persistenceMode,
    applicationEnvironment: system.config.applicationEnvironment,
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      await system.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
