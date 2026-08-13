import { PersistenceError } from "./index.js";

export class InMemoryDraftArtifactRepository {
  #bindings = new Map();

  async create(record) {
    if (this.#bindings.has(record.bindingId)) {
      throw new PersistenceError("ALREADY_EXISTS", `Draft artifact binding ${record.bindingId} already exists.`);
    }
    if ([...this.#bindings.values()].some((binding) => binding.draftId === record.draftId
      && binding.role === record.role
      && binding.artifactSha256 === record.artifactSha256)) {
      throw new PersistenceError(
        "ALREADY_EXISTS",
        `Artifact ${record.artifactSha256} is already bound as ${record.role} in draft ${record.draftId}.`,
      );
    }
    for (const input of record.inputBindings) {
      const storedInput = this.#bindings.get(input.bindingId);
      if (!storedInput
        || storedInput.draftId !== record.draftId
        || storedInput.artifactSha256 !== input.artifactSha256) {
        throw new PersistenceError(
          "REFERENCE_NOT_FOUND",
          `Input binding ${input.bindingId} does not identify an immutable artifact in draft ${record.draftId}.`,
        );
      }
    }
    this.#bindings.set(record.bindingId, clone(record));
    return clone(record);
  }

  async get(bindingId) {
    return this.#bindings.has(bindingId) ? clone(this.#bindings.get(bindingId)) : null;
  }

  async list(draftId) {
    return [...this.#bindings.values()]
      .filter((binding) => binding.draftId === draftId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.bindingId.localeCompare(right.bindingId))
      .map(clone);
  }
}

export class PostgresDraftArtifactRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function" || typeof database.transaction !== "function") {
      throw new PersistenceError(
        "DATABASE_TRANSACTION_REQUIRED",
        "Draft artifact persistence requires database query and transaction ports.",
      );
    }
    this.#database = database;
  }

  async create(record) {
    try {
      return await this.#database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO twin_draft_artifacts
           (binding_id, draft_id, upload_id, artifact_sha256, role, artifact_kind,
            input_count, coordinate_frame_id, producer_name, producer_version,
            producer_parameters_sha256, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          bindingParameters(record),
        );
        for (const input of record.inputBindings) {
          await transaction.query(
            `INSERT INTO twin_draft_artifact_inputs
             (draft_id, binding_id, input_binding_id, input_artifact_sha256)
             VALUES ($1, $2, $3, $4)`,
            [record.draftId, record.bindingId, input.bindingId, input.artifactSha256],
          );
        }
        return clone(record);
      });
    } catch (error) {
      throw translateDatabaseError(error, record.bindingId);
    }
  }

  async get(bindingId) {
    const result = await this.#database.query(
      `${selectWithInputsSql()} WHERE artifact.binding_id = $1 ORDER BY input.input_binding_id`,
      [bindingId],
    );
    return result.rows.length > 0 ? bindingFromRows(result.rows) : null;
  }

  async list(draftId) {
    const result = await this.#database.query(
      `${selectWithInputsSql()}
       WHERE artifact.draft_id = $1
       ORDER BY artifact.created_at, artifact.binding_id, input.input_binding_id`,
      [draftId],
    );
    const grouped = new Map();
    for (const row of result.rows) {
      if (!grouped.has(row.binding_id)) grouped.set(row.binding_id, []);
      grouped.get(row.binding_id).push(row);
    }
    return [...grouped.values()].map(bindingFromRows);
  }
}

function selectWithInputsSql() {
  return `SELECT artifact.*,
                 input.input_binding_id,
                 input.input_artifact_sha256
          FROM twin_draft_artifacts artifact
          LEFT JOIN twin_draft_artifact_inputs input
            ON input.binding_id = artifact.binding_id`;
}

function bindingParameters(record) {
  return [
    record.bindingId,
    record.draftId,
    record.uploadId,
    record.artifactSha256,
    record.role,
    record.kind,
    record.inputBindings.length,
    record.coordinateFrameId,
    record.producer?.name ?? null,
    record.producer?.version ?? null,
    record.producer?.parametersSha256 ?? null,
    record.createdBy,
    record.createdAt,
  ];
}

function bindingFromRows(rows) {
  const row = rows[0];
  return {
    bindingId: row.binding_id,
    draftId: row.draft_id,
    uploadId: row.upload_id,
    artifactSha256: row.artifact_sha256,
    role: row.role,
    kind: row.artifact_kind,
    coordinateFrameId: row.coordinate_frame_id,
    inputBindings: rows
      .filter((input) => input.input_binding_id !== null)
      .map((input) => ({
        bindingId: input.input_binding_id,
        artifactSha256: input.input_artifact_sha256,
      })),
    producer: row.producer_name === null ? null : {
      name: row.producer_name,
      version: row.producer_version,
      parametersSha256: row.producer_parameters_sha256,
    },
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

function translateDatabaseError(error, bindingId) {
  if (error instanceof PersistenceError) return error;
  if (error?.code === "23505") {
    return new PersistenceError(
      "ALREADY_EXISTS",
      `Draft artifact binding ${bindingId} conflicts with existing provenance.`,
      { cause: error },
    );
  }
  if (error?.code === "23503") {
    return new PersistenceError(
      "REFERENCE_NOT_FOUND",
      `Draft artifact binding ${bindingId} references a missing or incomplete upload, draft, or input.`,
      { cause: error },
    );
  }
  if (error?.code === "23514") {
    return new PersistenceError(
      "PROVENANCE_CONSTRAINT_VIOLATION",
      `Draft artifact binding ${bindingId} violates provenance constraints.`,
      { cause: error },
    );
  }
  return error;
}

function clone(value) {
  return structuredClone(value);
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
