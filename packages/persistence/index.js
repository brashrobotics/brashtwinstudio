export class PersistenceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export class InMemoryTwinCatalogRepository {
  #sites = new Map();
  #buildings = new Map();
  #floors = new Map();
  #families = new Map();
  #drafts = new Map();

  async createSite(record) {
    createUnique(this.#sites, record.siteId, record, "Site");
    return clone(record);
  }

  async getSite(siteId) {
    return cloneOrNull(this.#sites.get(siteId));
  }

  async listSites() {
    return sorted(this.#sites.values(), (record) => record.siteId);
  }

  async createBuilding(record) {
    requireReference(this.#sites, record.siteId, "Site");
    createUnique(this.#buildings, buildingKey(record.siteId, record.buildingId), record, "Building");
    return clone(record);
  }

  async getBuilding(siteId, buildingId) {
    return cloneOrNull(this.#buildings.get(buildingKey(siteId, buildingId)));
  }

  async listBuildings(siteId) {
    return sorted(
      [...this.#buildings.values()].filter((record) => record.siteId === siteId),
      (record) => record.buildingId,
    );
  }

  async createFloor(record) {
    requireReference(this.#buildings, buildingKey(record.siteId, record.buildingId), "Building");
    createUnique(this.#floors, record.floorId, record, "Floor");
    return clone(record);
  }

  async getFloor(floorId) {
    return cloneOrNull(this.#floors.get(floorId));
  }

  async listFloors(siteId) {
    return sorted(
      [...this.#floors.values()].filter((record) => !siteId || record.siteId === siteId),
      (record) => record.floorId,
    );
  }

  async createMapFamily(record) {
    requireReference(this.#floors, record.floorId, "Floor");
    createUnique(this.#families, record.familyId, record, "Map family");
    return clone(record);
  }

  async getMapFamily(familyId) {
    return cloneOrNull(this.#families.get(familyId));
  }

  async listMapFamilies(floorId) {
    return sorted(
      [...this.#families.values()].filter((record) => !floorId || record.floorId === floorId),
      (record) => record.familyId,
    );
  }

  async createMapDraft(record) {
    requireReference(this.#families, record.familyId, "Map family");
    if ([...this.#drafts.values()].some((draft) => draft.familyId === record.familyId && draft.revision === record.revision)) {
      throw new PersistenceError("ALREADY_EXISTS", `Map revision ${record.familyId}@${record.revision} already exists.`);
    }
    createUnique(this.#drafts, record.draftId, record, "Map draft");
    return clone(record);
  }

  async getMapDraft(draftId) {
    return cloneOrNull(this.#drafts.get(draftId));
  }

  async listMapDrafts(familyId) {
    return [...this.#drafts.values()]
      .filter((record) => !familyId || record.familyId === familyId)
      .sort((left, right) => left.familyId.localeCompare(right.familyId) || left.revision - right.revision)
      .map(clone);
  }

  async saveMapDraft(record, expectedRowVersion) {
    const current = this.#drafts.get(record.draftId);
    if (!current) throw new PersistenceError("NOT_FOUND", `Map draft ${record.draftId} was not found.`);
    if (current.rowVersion !== expectedRowVersion || record.rowVersion !== expectedRowVersion + 1) {
      throw new PersistenceError("CONCURRENCY_CONFLICT", `Map draft ${record.draftId} was modified concurrently.`);
    }
    if (current.familyId !== record.familyId || current.revision !== record.revision) {
      throw new PersistenceError("IMMUTABLE_IDENTITY", "Map draft family and revision cannot be changed.");
    }
    this.#drafts.set(record.draftId, clone(record));
    return clone(record);
  }

  snapshotForUnitOfWork() {
    return Object.freeze({
      sites: cloneMap(this.#sites),
      buildings: cloneMap(this.#buildings),
      floors: cloneMap(this.#floors),
      families: cloneMap(this.#families),
      drafts: cloneMap(this.#drafts),
    });
  }

  restoreUnitOfWorkSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new PersistenceError("SNAPSHOT_REQUIRED", "A catalog unit-of-work snapshot is required.");
    }
    this.#sites = cloneMap(snapshot.sites);
    this.#buildings = cloneMap(snapshot.buildings);
    this.#floors = cloneMap(snapshot.floors);
    this.#families = cloneMap(snapshot.families);
    this.#drafts = cloneMap(snapshot.drafts);
  }
}

export class PostgresTwinCatalogRepository {
  #database;

  constructor(database) {
    if (!database || typeof database.query !== "function") {
      throw new PersistenceError("DATABASE_REQUIRED", "A database query port is required.");
    }
    this.#database = database;
  }

  async createSite(record) {
    return this.#one(
      `INSERT INTO twin_sites (site_id, display_name, timezone, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [record.siteId, record.displayName, record.timezone, record.createdBy, record.createdAt],
      siteFromRow,
      "Site",
    );
  }

  async getSite(siteId) {
    return this.#maybe("SELECT * FROM twin_sites WHERE site_id = $1", [siteId], siteFromRow);
  }

  async listSites() {
    return this.#many("SELECT * FROM twin_sites ORDER BY site_id", [], siteFromRow);
  }

  async createBuilding(record) {
    return this.#one(
      `INSERT INTO twin_buildings (site_id, building_id, display_name, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [record.siteId, record.buildingId, record.displayName, record.createdBy, record.createdAt],
      buildingFromRow,
      "Building",
    );
  }

  async getBuilding(siteId, buildingId) {
    return this.#maybe(
      "SELECT * FROM twin_buildings WHERE site_id = $1 AND building_id = $2",
      [siteId, buildingId],
      buildingFromRow,
    );
  }

  async listBuildings(siteId) {
    return this.#many(
      "SELECT * FROM twin_buildings WHERE site_id = $1 ORDER BY building_id",
      [siteId],
      buildingFromRow,
    );
  }

  async createFloor(record) {
    return this.#one(
      `INSERT INTO twin_floors
       (floor_id, site_id, building_id, display_name, elevation_meters, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [record.floorId, record.siteId, record.buildingId, record.displayName, record.elevationMeters, record.createdBy, record.createdAt],
      floorFromRow,
      "Floor",
    );
  }

  async getFloor(floorId) {
    return this.#maybe("SELECT * FROM twin_floors WHERE floor_id = $1", [floorId], floorFromRow);
  }

  async listFloors(siteId) {
    if (siteId) {
      return this.#many("SELECT * FROM twin_floors WHERE site_id = $1 ORDER BY floor_id", [siteId], floorFromRow);
    }
    return this.#many("SELECT * FROM twin_floors ORDER BY floor_id", [], floorFromRow);
  }

  async createMapFamily(record) {
    return this.#one(
      `INSERT INTO twin_map_families (family_id, floor_id, display_name, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [record.familyId, record.floorId, record.displayName, record.createdBy, record.createdAt],
      mapFamilyFromRow,
      "Map family",
    );
  }

  async getMapFamily(familyId) {
    return this.#maybe("SELECT * FROM twin_map_families WHERE family_id = $1", [familyId], mapFamilyFromRow);
  }

  async listMapFamilies(floorId) {
    if (floorId) {
      return this.#many("SELECT * FROM twin_map_families WHERE floor_id = $1 ORDER BY family_id", [floorId], mapFamilyFromRow);
    }
    return this.#many("SELECT * FROM twin_map_families ORDER BY family_id", [], mapFamilyFromRow);
  }

  async createMapDraft(record) {
    return this.#one(
      `INSERT INTO twin_map_drafts
       (draft_id, family_id, revision, canonical_frame_id, status, validation_report_sha256,
        row_version, created_by, created_at, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        record.draftId,
        record.familyId,
        record.revision,
        record.canonicalFrameId,
        record.status,
        record.validationReportSha256,
        record.rowVersion,
        record.createdBy,
        record.createdAt,
        record.updatedBy,
        record.updatedAt,
      ],
      mapDraftFromRow,
      "Map draft",
    );
  }

  async getMapDraft(draftId) {
    return this.#maybe("SELECT * FROM twin_map_drafts WHERE draft_id = $1", [draftId], mapDraftFromRow);
  }

  async listMapDrafts(familyId) {
    if (familyId) {
      return this.#many(
        "SELECT * FROM twin_map_drafts WHERE family_id = $1 ORDER BY revision",
        [familyId],
        mapDraftFromRow,
      );
    }
    return this.#many("SELECT * FROM twin_map_drafts ORDER BY family_id, revision", [], mapDraftFromRow);
  }

  async saveMapDraft(record, expectedRowVersion) {
    let result;
    try {
      result = await this.#database.query(
        `UPDATE twin_map_drafts
         SET status = $2,
             validation_report_sha256 = $3,
             row_version = $4,
             updated_by = $5,
             updated_at = $6
         WHERE draft_id = $1 AND row_version = $7
         RETURNING *`,
        [
          record.draftId,
          record.status,
          record.validationReportSha256,
          record.rowVersion,
          record.updatedBy,
          record.updatedAt,
          expectedRowVersion,
        ],
      );
    } catch (error) {
      throw translateDatabaseError(error, "Map draft");
    }
    if (result.rows.length === 0) {
      throw new PersistenceError("CONCURRENCY_CONFLICT", `Map draft ${record.draftId} was modified concurrently.`);
    }
    return mapDraftFromRow(result.rows[0]);
  }

  async #one(sql, parameters, mapper, entityName) {
    try {
      const result = await this.#database.query(sql, parameters);
      return mapper(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error, entityName);
    }
  }

  async #maybe(sql, parameters, mapper) {
    const result = await this.#database.query(sql, parameters);
    return result.rows[0] ? mapper(result.rows[0]) : null;
  }

  async #many(sql, parameters, mapper) {
    const result = await this.#database.query(sql, parameters);
    return result.rows.map(mapper);
  }
}

function translateDatabaseError(error, entityName) {
  if (error?.code === "23505") return new PersistenceError("ALREADY_EXISTS", `${entityName} already exists.`, { cause: error });
  if (error?.code === "23503") return new PersistenceError("REFERENCE_NOT_FOUND", `${entityName} references a missing parent.`, { cause: error });
  return error;
}

function siteFromRow(row) {
  return {
    siteId: row.site_id,
    displayName: row.display_name,
    timezone: row.timezone,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

function buildingFromRow(row) {
  return {
    siteId: row.site_id,
    buildingId: row.building_id,
    displayName: row.display_name,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

function floorFromRow(row) {
  return {
    floorId: row.floor_id,
    siteId: row.site_id,
    buildingId: row.building_id,
    displayName: row.display_name,
    elevationMeters: Number(row.elevation_meters),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

function mapFamilyFromRow(row) {
  return {
    familyId: row.family_id,
    floorId: row.floor_id,
    displayName: row.display_name,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  };
}

function mapDraftFromRow(row) {
  return {
    draftId: row.draft_id,
    familyId: row.family_id,
    revision: row.revision,
    canonicalFrameId: row.canonical_frame_id,
    status: row.status,
    validationReportSha256: row.validation_report_sha256,
    rowVersion: Number(row.row_version),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
  };
}

function createUnique(collection, key, record, entityName) {
  if (collection.has(key)) throw new PersistenceError("ALREADY_EXISTS", `${entityName} already exists.`);
  collection.set(key, clone(record));
}

function requireReference(collection, key, entityName) {
  if (!collection.has(key)) throw new PersistenceError("REFERENCE_NOT_FOUND", `${entityName} was not found.`);
}

function buildingKey(siteId, buildingId) {
  return `${siteId}\u0000${buildingId}`;
}

function sorted(values, classifier) {
  return [...values].sort((left, right) => classifier(left).localeCompare(classifier(right))).map(clone);
}

function clone(value) {
  return structuredClone(value);
}

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function cloneMap(value) {
  if (!(value instanceof Map)) throw new PersistenceError("SNAPSHOT_INVALID", "Snapshot collections must be maps.");
  return new Map([...value.entries()].map(([key, record]) => [key, clone(record)]));
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
