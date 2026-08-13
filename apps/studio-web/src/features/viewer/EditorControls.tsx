import type {
  AssetFeature,
  SpatialEditorSnapshot,
  SpatialEditorStore,
  SpatialEditorTool,
  SpatialFeature,
  TopologyNodeFeature,
  ZoneFeature,
} from "@brash-twin/spatial-editor";
import { useI18n } from "../../i18n/i18n";

export function EditorToolbar({
  tool,
  setTool,
  snapshot,
  pendingEdgeNodeId,
  zonePointCount,
  finishZone,
  cancelDrawing,
  undo,
  redo,
}: {
  tool: SpatialEditorTool;
  setTool(tool: SpatialEditorTool): void;
  snapshot: SpatialEditorSnapshot;
  pendingEdgeNodeId: string | null;
  zonePointCount: number;
  finishZone(): void;
  cancelDrawing(): void;
  undo(): void;
  redo(): void;
}) {
  const { t } = useI18n();
  const tools: Array<{ tool: SpatialEditorTool; label: string }> = [
    { tool: "SELECT", label: t("toolSelect") },
    { tool: "NODE", label: t("toolNode") },
    { tool: "EDGE", label: t("toolEdge") },
    { tool: "ZONE", label: t("toolZone") },
    { tool: "ASSET", label: t("toolAsset") },
  ];
  return (
    <div className="editor-toolbar" aria-label={t("spatialEditorTools")}>
      <div className="editor-tool-row">
        {tools.map((item) => (
          <button
            key={item.tool}
            type="button"
            className={tool === item.tool ? "is-active" : ""}
            aria-pressed={tool === item.tool}
            onClick={() => setTool(item.tool)}
          >{item.label}</button>
        ))}
        <i />
        <button type="button" disabled={!snapshot.canUndo} onClick={undo} aria-label={t("undo")}>↶</button>
        <button type="button" disabled={!snapshot.canRedo} onClick={redo} aria-label={t("redo")}>↷</button>
      </div>
      {(pendingEdgeNodeId || zonePointCount > 0) && (
        <div className="editor-drawing-status">
          <span>
            {pendingEdgeNodeId
              ? `${t("edgeStart")}: ${pendingEdgeNodeId}`
              : `${zonePointCount} ${t("zoneVertices")}`}
          </span>
          {zonePointCount > 0 && (
            <button type="button" disabled={zonePointCount < 3} onClick={finishZone}>{t("finishZone")}</button>
          )}
          <button type="button" onClick={cancelDrawing}>{t("cancel")}</button>
        </div>
      )}
    </div>
  );
}

export function FeatureInspector({
  feature,
  store,
  remove,
  onError,
}: {
  feature: Readonly<SpatialFeature>;
  store: SpatialEditorStore;
  remove(): void;
  onError(message: string | null): void;
}) {
  const { t } = useI18n();
  const run = (command: () => void): void => {
    try {
      command();
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Editor command failed.");
    }
  };
  return (
    <aside className="feature-inspector" aria-label={t("featureInspector")}>
      <div className="feature-inspector-heading">
        <span>{feature.kind} / {feature.featureId}</span>
        <button type="button" onClick={remove} aria-label={t("deleteFeature")}>×</button>
      </div>
      <label className="inspector-field inspector-wide">
        <span>{t("featureName")}</span>
        <input
          key={`${feature.featureId}:${feature.label}`}
          type="text"
          defaultValue={feature.label}
          maxLength={200}
          onBlur={(event) => {
            const label = event.currentTarget.value.trim();
            if (!label || label === feature.label) return;
            run(() => updateLabel(store, feature, label));
          }}
        />
      </label>
      {feature.kind === "NODE" && <NodeFields feature={feature} store={store} run={run} />}
      {feature.kind === "EDGE" && (
        <div className="edge-reference-grid">
          <span>FROM<strong>{feature.fromNodeId}</strong></span>
          <span>TO<strong>{feature.toNodeId}</strong></span>
        </div>
      )}
      {feature.kind === "ASSET" && <AssetFields feature={feature} store={store} run={run} />}
      {feature.kind === "ZONE" && <ZoneFields feature={feature} store={store} run={run} />}
      <button className="inspector-delete" type="button" onClick={remove}>{t("deleteFeature")}</button>
    </aside>
  );
}

function NodeFields({
  feature,
  store,
  run,
}: {
  feature: Readonly<TopologyNodeFeature>;
  store: SpatialEditorStore;
  run(command: () => void): void;
}) {
  return (
    <div className="inspector-number-grid">
      <NumericField label="X / M" value={feature.position.x} onValue={(x) => run(() => store.updateNode(feature.featureId, { position: { ...feature.position, x } }))} />
      <NumericField label="Y / M" value={feature.position.y} onValue={(y) => run(() => store.updateNode(feature.featureId, { position: { ...feature.position, y } }))} />
    </div>
  );
}

function AssetFields({
  feature,
  store,
  run,
}: {
  feature: Readonly<AssetFeature>;
  store: SpatialEditorStore;
  run(command: () => void): void;
}) {
  return (
    <div className="inspector-number-grid">
      <NumericField label="X / M" value={feature.center.x} onValue={(x) => run(() => store.updateAsset(feature.featureId, { center: { ...feature.center, x } }))} />
      <NumericField label="Y / M" value={feature.center.y} onValue={(y) => run(() => store.updateAsset(feature.featureId, { center: { ...feature.center, y } }))} />
      <NumericField label="WIDTH / M" value={feature.width} min={0.01} onValue={(width) => run(() => store.updateAsset(feature.featureId, { width }))} />
      <NumericField label="DEPTH / M" value={feature.depth} min={0.01} onValue={(depth) => run(() => store.updateAsset(feature.featureId, { depth }))} />
      <NumericField label="HEIGHT / M" value={feature.height} min={0.01} onValue={(height) => run(() => store.updateAsset(feature.featureId, { height }))} />
      <NumericField label="ROT Z / RAD" value={feature.rotationZ} onValue={(rotationZ) => run(() => store.updateAsset(feature.featureId, { rotationZ }))} />
    </div>
  );
}

function ZoneFields({
  feature,
  store,
  run,
}: {
  feature: Readonly<ZoneFeature>;
  store: SpatialEditorStore;
  run(command: () => void): void;
}) {
  const { t } = useI18n();
  return (
    <div className="zone-vertex-editor">
      <span>{feature.points.length} {t("zoneVertices")}</span>
      {feature.points.slice(0, 8).map((point, index) => (
        <div key={index}>
          <b>{index + 1}</b>
          <NumericField label="X" value={point.x} onValue={(x) => run(() => store.updateZoneVertex(feature.featureId, index, { ...point, x }))} />
          <NumericField label="Y" value={point.y} onValue={(y) => run(() => store.updateZoneVertex(feature.featureId, index, { ...point, y }))} />
        </div>
      ))}
      {feature.points.length > 8 && <small>+{feature.points.length - 8} {t("moreVertices")}</small>}
    </div>
  );
}

function NumericField({
  label,
  value,
  min,
  onValue,
}: {
  label: string;
  value: number;
  min?: number;
  onValue(value: number): void;
}) {
  return (
    <label className="inspector-field">
      <span>{label}</span>
      <input
        type="number"
        step="0.05"
        value={value}
        {...(min === undefined ? {} : { min })}
        onChange={(event) => {
          if (event.currentTarget.value === "") return;
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onValue(next);
        }}
      />
    </label>
  );
}

function updateLabel(store: SpatialEditorStore, feature: Readonly<SpatialFeature>, label: string): void {
  if (feature.kind === "NODE") store.updateNode(feature.featureId, { label });
  else if (feature.kind === "EDGE") store.updateEdge(feature.featureId, { label });
  else if (feature.kind === "ZONE") store.updateZone(feature.featureId, { label });
  else if (feature.kind === "ASSET") store.updateAsset(feature.featureId, { label });
}
