import { createWorldStore, type WorldEntity, type WorldStore } from "@brash-twin/viewer-sdk";
import {
  createSpatialEditorStore,
  findSpatialFeature,
  snapToGrid,
  spatialFeaturesToWorldEntities,
  type SpatialEditorStore,
  type SpatialEditorTool,
} from "@brash-twin/spatial-editor";
import {
  importSvgFloorplan,
  type FloorplanImportReport,
  type SvgSourceUnit,
} from "@brash-twin/importers/svg-floorplan";
import {
  transformWorldEntities2D,
  type ManualTwinRelease,
  type RegistrationReport,
} from "@brash-twin/manual-twin";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { useI18n } from "../../i18n/i18n";
import type { SurveyMaterializationPreview, SurveyRegistrationReport } from "../../api/types";
import { diagnosticEntities, diagnosticLayers } from "./diagnosticWorld";
import { diagnosticEditorFeatures } from "./editorSeed";
import { EditorToolbar, FeatureInspector } from "./EditorControls";
import { ManualTwinMilestone } from "./ManualTwinMilestone";
import { ThreeWorldRuntime, type WorldInteraction } from "./threeRuntime";
import { surveyPreviewWorldEntities } from "./surveyPreviewWorld";

export function SpatialWorkspace({
  canonicalFrameId,
  familyId,
  revision,
  surveyPreview,
  surveyRegistration,
}: {
  canonicalFrameId: string;
  familyId: string;
  revision: number;
  surveyPreview: SurveyMaterializationPreview | null;
  surveyRegistration: SurveyRegistrationReport | null;
}) {
  const { t } = useI18n();
  const [editorStore] = useState<SpatialEditorStore>(() => createSpatialEditorStore(diagnosticEditorFeatures));
  const editorSnapshot = useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);
  const [store] = useState<WorldStore>(() => createWorldStore({
    canonicalFrameId: canonicalFrameId || "workspace-unassigned",
    layers: diagnosticLayers,
    entities: [...diagnosticEntities, ...spatialFeaturesToWorldEntities(diagnosticEditorFeatures)],
  }));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ThreeWorldRuntime | null>(null);
  const interactionHandlerRef = useRef<(interaction: WorldInteraction) => boolean>(() => false);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [sourceUnit, setSourceUnit] = useState<SvgSourceUnit | "">("");
  const [importReport, setImportReport] = useState<FloorplanImportReport | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importRequestRef = useRef(0);
  const [activeTool, setActiveTool] = useState<SpatialEditorTool>("SELECT");
  const [pendingEdgeNodeId, setPendingEdgeNodeId] = useState<string | null>(null);
  const [zoneDraftPoints, setZoneDraftPoints] = useState<Array<{ x: number; y: number; z: number }>>([]);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [selectionRequest, setSelectionRequest] = useState<string | null>(null);
  const [registration, setRegistration] = useState<RegistrationReport | null>(null);
  const [release, setRelease] = useState<ManualTwinRelease | null>(null);
  const [releaseView, setReleaseView] = useState(false);
  const [surveySourceView, setSurveySourceView] = useState(false);
  const activeToolRef = useRef(activeTool);
  const pendingEdgeRef = useRef(pendingEdgeNodeId);
  const editorSnapshotRef = useRef(editorSnapshot);
  const releaseViewRef = useRef(releaseView);
  const surveySourceViewRef = useRef(surveySourceView);
  const previousSurveySourceViewRef = useRef(false);
  activeToolRef.current = activeTool;
  pendingEdgeRef.current = pendingEdgeNodeId;
  editorSnapshotRef.current = editorSnapshot;
  releaseViewRef.current = releaseView;
  surveySourceViewRef.current = surveySourceView;
  const readOnlyView = releaseView || surveySourceView;

  function executeEditorCommand<T>(command: () => T): T | null {
    try {
      const result = command();
      setEditorError(null);
      return result;
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Editor command failed.");
      return null;
    }
  }

  interactionHandlerRef.current = (interaction): boolean => {
    if (releaseViewRef.current || surveySourceViewRef.current) return false;
    const tool = activeToolRef.current;
    if (tool === "SELECT") return false;
    if (tool === "EDGE") {
      const candidate = findSpatialFeature(editorSnapshotRef.current.document.features, interaction.entityId);
      if (candidate?.kind !== "NODE") {
        setEditorError(t("edgeNodeRequired"));
        return true;
      }
      const startNodeId = pendingEdgeRef.current;
      if (!startNodeId) {
        setPendingEdgeNodeId(candidate.featureId);
        store.selectEntity(candidate.featureId);
        setEditorError(null);
      } else if (startNodeId === candidate.featureId) {
        setEditorError(t("edgeDifferentNode"));
      } else {
        const edgeId = executeEditorCommand(() => editorStore.addEdge(startNodeId, candidate.featureId));
        if (edgeId) setSelectionRequest(edgeId);
        setPendingEdgeNodeId(null);
      }
      return true;
    }
    if (!interaction.position) return true;
    const position = snapToGrid(interaction.position, 0.25);
    if (tool === "NODE") {
      const nodeId = executeEditorCommand(() => editorStore.addNode(position));
      if (nodeId) setSelectionRequest(nodeId);
    } else if (tool === "ASSET") {
      const assetId = executeEditorCommand(() => editorStore.addAsset(position));
      if (assetId) setSelectionRequest(assetId);
    } else if (tool === "ZONE") {
      setZoneDraftPoints((current) => {
        const previous = current.at(-1);
        return previous?.x === position.x && previous.y === position.y ? current : [...current, position];
      });
      setEditorError(null);
    }
    return true;
  };

  const selected = snapshot.entities.find((entity) => entity.entityId === snapshot.selectedEntityId) ?? null;
  const selectedFeature = readOnlyView
    ? null
    : findSpatialFeature(editorSnapshot.document.features, snapshot.selectedEntityId);
  const coordinate = snapshot.pointerWorld;

  useEffect(() => {
    setSurveySourceView(surveyPreview !== null && surveyRegistration === null);
    if (surveyPreview) setReleaseView(false);
  }, [surveyPreview?.source.revision, surveyRegistration?.registrationId]);

  useEffect(() => {
    const frameId = surveySourceView && surveyPreview
      ? surveyPreview.coordinateSystem.rootFrameId
      : canonicalFrameId;
    if (frameId) store.setCanonicalFrame(frameId);
  }, [canonicalFrameId, store, surveyPreview, surveySourceView]);

  useEffect(() => {
    if (surveySourceView && surveyPreview) {
      store.setLayerVisibility("survey", true);
      store.setEntities(surveyPreviewWorldEntities(surveyPreview));
      runtimeRef.current?.sync(store.getSnapshot());
      runtimeRef.current?.fitWorld();
      previousSurveySourceViewRef.current = true;
      return;
    }
    if (releaseView && release) {
      store.setEntities(structuredClone(release.snapshot.worldEntities));
      return;
    }
    const diagnosticCad = diagnosticEntities.filter((entity) => entity.layerId === "cad");
    const evidence = diagnosticEntities.filter((entity) => entity.layerId !== "cad"
      && !(surveyRegistration && entity.layerId === "survey"));
    const sourceCad = importReport?.entities ?? diagnosticCad;
    const alignedCad = registration ? transformWorldEntities2D(sourceCad, registration) : structuredClone(sourceCad);
    const registeredSurvey = surveyPreview && surveyRegistration
      ? surveyPreviewWorldEntities(surveyPreview, surveyRegistration)
      : [];
    store.setEntities([
      ...alignedCad,
      ...registeredSurvey,
      ...evidence,
      ...spatialFeaturesToWorldEntities(editorSnapshot.document.features),
      ...zonePreviewEntities(zoneDraftPoints),
    ]);
    if (previousSurveySourceViewRef.current) {
      runtimeRef.current?.sync(store.getSnapshot());
      runtimeRef.current?.fitWorld();
      previousSurveySourceViewRef.current = false;
    }
  }, [
    editorSnapshot.document.revision,
    importReport,
    registration,
    release,
    releaseView,
    store,
    surveyPreview,
    surveyRegistration,
    surveySourceView,
    zoneDraftPoints,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof WebGLRenderingContext === "undefined") return;
    try {
      const runtime = new ThreeWorldRuntime(canvas, store, {
        onWorldClick: (interaction) => interactionHandlerRef.current(interaction),
      });
      runtimeRef.current = runtime;
      return () => {
        runtime.dispose();
        runtimeRef.current = null;
      };
    } catch (error) {
      setRendererError(error instanceof Error ? error.message : "WebGL initialization failed.");
      return undefined;
    }
  }, [store]);

  useEffect(() => runtimeRef.current?.sync(snapshot), [snapshot]);

  useEffect(() => {
    if (!selectionRequest || !snapshot.entities.some((entity) => entity.entityId === selectionRequest)) return;
    store.selectEntity(selectionRequest);
    setSelectionRequest(null);
  }, [selectionRequest, snapshot.entities, store]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const element = event.target as HTMLElement | null;
      if (element?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (releaseView || surveySourceView) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        executeEditorCommand(() => event.shiftKey ? editorStore.redo() : editorStore.undo());
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        executeEditorCommand(() => editorStore.redo());
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedFeature) {
        event.preventDefault();
        executeEditorCommand(() => editorStore.removeFeature(selectedFeature.featureId));
      } else if (event.key === "Escape") {
        setPendingEdgeNodeId(null);
        setZoneDraftPoints([]);
        setEditorError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorSnapshot.document.revision, editorStore, releaseView, selectedFeature, surveySourceView]);

  const importFloorplanSource = async (loadSource: () => Promise<string>, fileName: string): Promise<void> => {
    const requestId = importRequestRef.current + 1;
    importRequestRef.current = requestId;
    setImporting(true);
    setImportError(null);
    try {
      const report = await importSvgFloorplan(await loadSource(), {
        canonicalFrameId: store.getSnapshot().canonicalFrameId,
        ...(sourceUnit ? { sourceUnit } : {}),
      });
      if (requestId !== importRequestRef.current) return;
      setImportReport(report);
      setImportFileName(fileName);
      setRegistration(null);
      store.setLayerVisibility("cad", true);
    } catch (error) {
      if (requestId !== importRequestRef.current) return;
      setImportError(error instanceof Error ? error.message : "SVG floorplan import failed.");
    } finally {
      if (requestId === importRequestRef.current) setImporting(false);
    }
  };

  const handleFloorplan = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await importFloorplanSource(() => file.text(), file.name);
  };

  const loadDemoFloorplan = async (): Promise<void> => {
    await importFloorplanSource(async () => {
      const response = await fetch("/fixtures/demo-floorplan.svg", { headers: { accept: "image/svg+xml" } });
      if (!response.ok) throw new Error(`Demo floorplan request failed with HTTP ${response.status}.`);
      return response.text();
    }, "demo-floorplan.svg");
  };

  const changeTool = (tool: SpatialEditorTool): void => {
    setActiveTool(tool);
    setPendingEdgeNodeId(null);
    setZoneDraftPoints([]);
    setEditorError(null);
  };

  const finishZone = (): void => {
    const zoneId = executeEditorCommand(() => editorStore.addZone(zoneDraftPoints));
    if (!zoneId) return;
    setZoneDraftPoints([]);
    setSelectionRequest(zoneId);
  };

  const removeSelectedFeature = (): void => {
    if (!selectedFeature) return;
    executeEditorCommand(() => editorStore.removeFeature(selectedFeature.featureId));
  };

  return (
    <section className="spatial-viewer panel">
      <div className="panel-heading viewer-heading">
        <div>
          <p className="section-index">02 / WORLD</p>
          <h3>{t("spatialWorkspace")}</h3>
          <small className="frame-identity">{snapshot.canonicalFrameId}</small>
        </div>
        <div className="viewer-actions">
          {surveyPreview && (
            <button
              className="survey-source-control"
              type="button"
              aria-pressed={surveySourceView}
              onClick={() => {
                setSurveySourceView((current) => !current);
                setReleaseView(false);
                setActiveTool("SELECT");
                store.selectEntity(null);
              }}
            >{surveySourceView ? t("returnToDraftWorld") : t("openSurveySource")}</button>
          )}
          <label className="source-unit-control">
            <span className="sr-only">{t("svgSourceUnit")}</span>
            <select
              value={sourceUnit}
              aria-label={t("svgSourceUnit")}
              disabled={readOnlyView}
              onChange={(event) => setSourceUnit(event.currentTarget.value as SvgSourceUnit | "")}
            >
              <option value="">{t("svgUnitsAuto")}</option>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
              <option value="in">in</option>
              <option value="ft">ft</option>
              <option value="px">px / 96 PPI</option>
            </select>
          </label>
          <button className="demo-floorplan-control" type="button" disabled={importing || readOnlyView} onClick={() => void loadDemoFloorplan()}>{t("loadDemo")}</button>
          <label className={`floorplan-import-control${importing ? " is-busy" : ""}`}>
            <input type="file" accept=".svg,image/svg+xml" disabled={importing || readOnlyView} onChange={handleFloorplan} />
            {importing ? t("importingFloorplan") : t("importSvg")}
          </label>
          <div className="segmented-control" aria-label="Spatial view mode">
            <button
              type="button"
              className={snapshot.viewMode === "2D" ? "is-active" : ""}
              aria-pressed={snapshot.viewMode === "2D"}
              onClick={() => store.setViewMode("2D")}
            >2D</button>
            <button
              type="button"
              className={snapshot.viewMode === "3D" ? "is-active" : ""}
              aria-pressed={snapshot.viewMode === "3D"}
              onClick={() => store.setViewMode("3D")}
            >3D</button>
          </div>
        </div>
      </div>
      <div className="map-stage viewer-stage">
        <canvas
          ref={canvasRef}
          className={`world-canvas${activeTool === "SELECT" || readOnlyView ? "" : " is-editing"}`}
          role="img"
          tabIndex={0}
          aria-label={`${snapshot.viewMode} digital twin view in ${snapshot.canonicalFrameId}`}
        />
        {rendererError && (
          <div className="viewer-unavailable" role="alert">
            <strong>GPU viewer unavailable</strong>
            <span>{rendererError}</span>
          </div>
        )}
        <div className="viewer-coordinate" aria-live="off">
          <span>WORLD / M</span>
          <strong>{coordinate ? formatCoordinate(coordinate.x, coordinate.y, coordinate.z) : "— / — / —"}</strong>
        </div>
        <div className="viewer-help">
          {toolHint(activeTool, pendingEdgeNodeId, t)}
        </div>
        {surveySourceView && surveyPreview ? (
          <div className="survey-source-banner">
            <span>{t("unalignedSurveySource")}</span>
            <strong>{surveyPreview.coordinateSystem.rootFrameId}</strong>
          </div>
        ) : surveyRegistration && surveyPreview ? (
          <div className="registered-survey-banner">
            <span>{t("registeredSurveyOverlay")}</span>
            <strong>{surveyRegistration.metrics.rmseMetres.toFixed(3)} m RMSE</strong>
          </div>
        ) : releaseView ? (
          <div className="release-view-banner"><span>{t("releaseView")}</span><strong>{release?.mapReleaseId}</strong></div>
        ) : (
          <EditorToolbar
            tool={activeTool}
            setTool={changeTool}
            snapshot={editorSnapshot}
            pendingEdgeNodeId={pendingEdgeNodeId}
            zonePointCount={zoneDraftPoints.length}
            finishZone={finishZone}
            cancelDrawing={() => { setPendingEdgeNodeId(null); setZoneDraftPoints([]); setEditorError(null); }}
            undo={() => executeEditorCommand(() => editorStore.undo())}
            redo={() => executeEditorCommand(() => editorStore.redo())}
          />
        )}
        {editorError && <div className="editor-command-error" role="alert">{editorError}</div>}
        {importError && (
          <div className="floorplan-import-error" role="alert">
            <strong>{t("floorplanRejected")}</strong>
            <span>{importError}</span>
          </div>
        )}
        {importReport && !importError && (
          <details className="floorplan-import-report">
            <summary>{t("floorplanImported")} · {importReport.summary.entityCount}</summary>
            <div>
              <strong>{importFileName}</strong>
              <span>{formatBounds(importReport)}</span>
              <span>{importReport.summary.pointCount} {t("floorplanPoints")} · {importReport.summary.warningCount} {t("floorplanWarnings")}</span>
              <code title={importReport.source.sha256}>SHA · {importReport.source.sha256.slice(0, 12)}</code>
              {importReport.issues.slice(0, 2).map((issue) => (
                <small key={`${issue.code}:${issue.elementRef ?? "document"}`}>{issue.code} · {issue.elementRef ?? "SVG"}</small>
              ))}
            </div>
          </details>
        )}
        {selectedFeature && !readOnlyView && (
          <FeatureInspector
            feature={selectedFeature}
            store={editorStore}
            remove={removeSelectedFeature}
            onError={setEditorError}
          />
        )}
        {selected && !selectedFeature && (
          <button className="selection-card" type="button" onClick={() => store.selectEntity(null)}>
            <span>SELECTED / {selected.layerId.toUpperCase()}</span>
            <strong>{selected.label}</strong>
            <small>{selected.entityId} · click to clear</small>
          </button>
        )}
        <div className="viewer-layers" aria-label="World layers">
          {snapshot.layers.map((layer) => (
            <button
              key={layer.layerId}
              type="button"
              className={layer.visible ? "is-visible" : ""}
              aria-pressed={layer.visible}
              onClick={() => store.toggleLayer(layer.layerId)}
            >
              <i style={{ backgroundColor: layer.color }} />
              {layer.label}
            </button>
          ))}
        </div>
        <div className="viewer-compass" aria-hidden="true">
          <span className="north">N</span><i className="axis-y" /><i className="axis-x" /><small>X</small>
        </div>
      </div>
      {!surveySourceView && <ManualTwinMilestone
        floorplan={importReport}
        registration={registration}
        onRegistration={setRegistration}
        editorDocument={editorSnapshot.document}
        baselineFeatures={diagnosticEditorFeatures}
        worldEntities={snapshot.entities}
        familyId={familyId}
        revision={revision}
        canonicalFrameId={snapshot.canonicalFrameId}
        release={release}
        releaseView={releaseView}
        onPublished={(published) => {
          setRelease(published);
          setReleaseView(true);
          setActiveTool("SELECT");
          setPendingEdgeNodeId(null);
          setZoneDraftPoints([]);
          store.selectEntity(null);
        }}
        onReleaseView={(enabled) => {
          setReleaseView(enabled);
          setSurveySourceView(false);
          setActiveTool("SELECT");
          store.selectEntity(null);
        }}
      />}
    </section>
  );
}

export default SpatialWorkspace;

function zonePreviewEntities(points: Array<{ x: number; y: number; z: number }>): WorldEntity[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [{
      entityId: "editor-zone-preview",
      layerId: "zones",
      label: "Zone drawing preview",
      position: { ...points[0]!, z: 0.08 },
      geometry: { type: "POINT", radius: 0.18 },
    }];
  }
  return [{
    entityId: "editor-zone-preview",
    layerId: "zones",
    label: "Zone drawing preview",
    position: { x: 0, y: 0, z: 0.08 },
    geometry: { type: "POLYLINE", points, closed: points.length >= 3 },
  }];
}

function toolHint(
  tool: SpatialEditorTool,
  pendingEdgeNodeId: string | null,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (tool === "NODE") return t("hintNode");
  if (tool === "ASSET") return t("hintAsset");
  if (tool === "ZONE") return t("hintZone");
  if (tool === "EDGE") return pendingEdgeNodeId ? t("hintEdgeEnd") : t("hintEdgeStart");
  return t("hintSelect");
}

function formatCoordinate(x: number, y: number, z: number): string {
  return `${signed(x)} / ${signed(y)} / ${signed(z)}`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatBounds(report: FloorplanImportReport): string {
  const width = report.bounds.maximum.x - report.bounds.minimum.x;
  const height = report.bounds.maximum.y - report.bounds.minimum.y;
  return `${width.toFixed(2)} × ${height.toFixed(2)} m · ${report.configuration.metresPerUserUnit} m/u`;
}
