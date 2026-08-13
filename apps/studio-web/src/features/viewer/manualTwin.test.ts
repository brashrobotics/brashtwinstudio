import { describe, expect, it } from "vitest";
import { importSvgFloorplan, type FloorplanImportReport } from "@brash-twin/importers/svg-floorplan";
import {
  applySimilarity2D,
  diffSpatialDocuments,
  publishManualTwinRelease,
  solveSimilarity2D,
  validateManualTwin,
  ManualTwinError,
  type ControlPointPair,
  type RegistrationReport,
} from "@brash-twin/manual-twin";
import { createSpatialEditorStore, spatialFeaturesToWorldEntities } from "@brash-twin/spatial-editor";
import { diagnosticEditorFeatures } from "./editorSeed";

const FLOORPLAN = `<svg xmlns="http://www.w3.org/2000/svg" width="30m" height="20m" viewBox="0 0 30 20"><rect width="30" height="20"/></svg>`;

async function fixtureInputs(): Promise<{
  floorplan: FloorplanImportReport;
  registration: RegistrationReport;
  editorStore: ReturnType<typeof createSpatialEditorStore>;
}> {
  const floorplan = await importSvgFloorplan(FLOORPLAN, { canonicalFrameId: "demo-plant/floor-1" });
  const registration = await solveSimilarity2D({
    sourceFrameId: `svg:${floorplan.source.sha256.slice(0, 12)}`,
    canonicalFrameId: floorplan.canonicalFrameId,
    controlPoints: [
      { controlPointId: "cp-1", source: { x: -15, y: -10 }, target: { x: -15, y: -10 } },
      { controlPointId: "cp-2", source: { x: 15, y: -10 }, target: { x: 15, y: -10 } },
      { controlPointId: "cp-3", source: { x: 15, y: 10 }, target: { x: 15, y: 10 } },
    ],
  });
  return { floorplan, registration, editorStore: createSpatialEditorStore(diagnosticEditorFeatures) };
}

describe("manual twin alignment and milestone", () => {
  it("recovers a known 2D similarity transform and residual evidence", async () => {
    const angle = Math.PI / 6;
    const transform = { scale: 1.2, rotationRadians: angle, translation: { x: 2, y: -3 } };
    const sources = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 3 }];
    const controlPoints: ControlPointPair[] = sources.map((source, index) => ({
      controlPointId: `cp-${index + 1}`,
      source,
      target: applySimilarity2D(transform, source),
    }));

    const report = await solveSimilarity2D({
      controlPoints,
      sourceFrameId: "svg:floor-a",
      canonicalFrameId: "plant/floor-1",
    });

    expect(report.transform.scale).toBeCloseTo(1.2, 8);
    expect(report.transform.rotationRadians).toBeCloseTo(angle, 8);
    expect(report.transform.translation).toEqual({ x: 2, y: -3 });
    expect(report.metrics.controlPointCount).toBe(4);
    expect(report.metrics.rmseMetres).toBeLessThan(1e-8);
    expect(report.metrics.maximumErrorMetres).toBeLessThan(1e-8);
    expect(report.solver.configurationSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects insufficient and degenerate control points", async () => {
    await expect(solveSimilarity2D({
      controlPoints: [], sourceFrameId: "source", canonicalFrameId: "target",
    })).rejects.toEqual(expect.objectContaining({ code: "REGISTRATION_CONTROL_POINT_COUNT" }));
    await expect(solveSimilarity2D({
      controlPoints: [1, 2, 3].map((index) => ({
        controlPointId: `cp-${index}`, source: { x: 1, y: 1 }, target: { x: 2, y: 2 },
      })),
      sourceFrameId: "source",
      canonicalFrameId: "target",
    })).rejects.toEqual(expect.objectContaining({ code: "REGISTRATION_GEOMETRY_DEGENERATE" }));
  });

  it("validates floorplan, alignment, asset, zone, and connected topology readiness", async () => {
    const { floorplan, registration, editorStore } = await fixtureInputs();
    const report = await validateManualTwin({
      floorplan,
      registration,
      editorDocument: editorStore.getSnapshot().document,
    });

    expect(report.valid).toBe(true);
    expect(report.summary).toEqual({
      errorCount: 0,
      warningCount: 0,
      assetCount: 4,
      zoneCount: 2,
      topologyNodeCount: 5,
      topologyEdgeCount: 4,
    });
    expect(report.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces a stable ID-level diff", () => {
    const changed = structuredClone(diagnosticEditorFeatures);
    const asset = changed.find((feature) => feature.featureId === "asset-panel-01");
    if (asset?.kind === "ASSET") asset.width = 1.5;
    changed.pop();
    changed.push({ kind: "ASSET", featureId: "asset-new", label: "New", center: { x: 0, y: 0, z: 0 }, width: 1, depth: 1, height: 1, rotationZ: 0 });

    const diff = diffSpatialDocuments(diagnosticEditorFeatures, changed);
    expect(diff.modified).toEqual(["asset-panel-01"]);
    expect(diff.added).toEqual(["asset-new"]);
    expect(diff.removed).toEqual(["route-edge-4"]);
    expect(diff.summary).toEqual(expect.objectContaining({ addedCount: 1, removedCount: 1, modifiedCount: 1 }));
  });

  it("seals a passing two-person milestone as an immutable read-only release", async () => {
    const { floorplan, registration, editorStore } = await fixtureInputs();
    const editorDocument = editorStore.getSnapshot().document;
    const validation = await validateManualTwin({ floorplan, registration, editorDocument });
    const diff = diffSpatialDocuments(diagnosticEditorFeatures, editorDocument.features);
    const release = await publishManualTwinRelease({
      mapReleaseId: "demo-plant@2",
      familyId: "demo-plant",
      revision: 2,
      canonicalFrameId: "demo-plant/floor-1",
      publishedAt: "2026-08-13T20:00:00.000Z",
      requestedBy: "local-operator",
      approvedBy: "local-approver",
      floorplan,
      registration,
      editorDocument,
      validation,
      diff,
      worldEntities: spatialFeaturesToWorldEntities(editorDocument.features),
    });

    expect(release.status).toBe("PUBLISHED");
    expect(release.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(release.releaseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(release)).toBe(true);
    expect(Object.isFrozen(release.snapshot.editorDocument.features)).toBe(true);
  });

  it("rejects self-approval and stale validation evidence", async () => {
    const { floorplan, registration, editorStore } = await fixtureInputs();
    const validatedDocument = editorStore.getSnapshot().document;
    const validation = await validateManualTwin({ floorplan, registration, editorDocument: validatedDocument });
    editorStore.addAsset({ x: 0, y: 0, z: 0 });
    const currentDocument = editorStore.getSnapshot().document;
    const base = {
      mapReleaseId: "demo-plant@2",
      familyId: "demo-plant",
      revision: 2,
      canonicalFrameId: "demo-plant/floor-1",
      publishedAt: "2026-08-13T20:00:00.000Z",
      floorplan,
      registration,
      editorDocument: currentDocument,
      validation,
      diff: diffSpatialDocuments(diagnosticEditorFeatures, currentDocument.features),
      worldEntities: spatialFeaturesToWorldEntities(currentDocument.features),
    };
    await expect(publishManualTwinRelease({ ...base, requestedBy: "operator", approvedBy: "operator" }))
      .rejects.toEqual(expect.objectContaining({ code: "MANUAL_TWIN_SELF_APPROVAL" } satisfies Partial<ManualTwinError>));
    await expect(publishManualTwinRelease({ ...base, requestedBy: "operator", approvedBy: "approver" }))
      .rejects.toEqual(expect.objectContaining({ code: "MANUAL_TWIN_VALIDATION_STALE" } satisfies Partial<ManualTwinError>));
  });
});
