import {
  diffSpatialDocuments,
  publishManualTwinRelease,
  solveSimilarity2D,
  validateManualTwin,
  type ControlPointPair,
  type ManualTwinRelease,
  type ManualTwinValidationReport,
  type RegistrationReport,
} from "@brash-twin/manual-twin";
import type { FloorplanImportReport } from "@brash-twin/importers/svg-floorplan";
import type { SpatialEditorDocument, SpatialFeature } from "@brash-twin/spatial-editor";
import type { WorldEntity } from "@brash-twin/viewer-sdk";
import { useEffect, useMemo, useState } from "react";
import { useIdentity } from "../../auth/identity";
import { useI18n } from "../../i18n/i18n";

export function ManualTwinMilestone({
  floorplan,
  registration,
  onRegistration,
  editorDocument,
  baselineFeatures,
  worldEntities,
  familyId,
  revision,
  canonicalFrameId,
  release,
  releaseView,
  onPublished,
  onReleaseView,
}: {
  floorplan: FloorplanImportReport | null;
  registration: RegistrationReport | null;
  onRegistration(report: RegistrationReport): void;
  editorDocument: SpatialEditorDocument;
  baselineFeatures: readonly Readonly<SpatialFeature>[];
  worldEntities: readonly Readonly<WorldEntity>[];
  familyId: string;
  revision: number;
  canonicalFrameId: string;
  release: ManualTwinRelease | null;
  releaseView: boolean;
  onPublished(release: ManualTwinRelease): void;
  onReleaseView(enabled: boolean): void;
}) {
  const { identity } = useIdentity();
  const { t } = useI18n();
  const [controlPoints, setControlPoints] = useState<ControlPointPair[]>([]);
  const [allowScale, setAllowScale] = useState(true);
  const [validation, setValidation] = useState<ManualTwinValidationReport | null>(null);
  const [approver, setApprover] = useState("local-approver");
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diff = useMemo(
    () => diffSpatialDocuments(baselineFeatures, editorDocument.features),
    [baselineFeatures, editorDocument.features],
  );

  useEffect(() => {
    setControlPoints(floorplan ? defaultControlPoints(floorplan) : []);
    setValidation(null);
    setApprovedBy(null);
  }, [floorplan?.source.sha256]);

  useEffect(() => {
    setValidation(null);
    setApprovedBy(null);
  }, [editorDocument.revision, registration?.solver.configurationSha256]);

  const run = async <T,>(key: string, operation: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    setError(null);
    try {
      return await operation();
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "Manual Twin operation failed.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const solve = async (): Promise<void> => {
    if (!floorplan) return;
    const report = await run("solve", () => solveSimilarity2D({
      controlPoints,
      sourceFrameId: `svg:${floorplan.source.sha256.slice(0, 16)}`,
      canonicalFrameId,
      allowScale,
    }));
    if (report) onRegistration(report);
  };

  const validate = async (): Promise<void> => {
    if (!floorplan || !registration) return;
    const report = await run("validate", () => validateManualTwin({
      floorplan,
      registration,
      editorDocument,
    }));
    if (report) setValidation(report);
  };

  const approve = (): void => {
    setError(null);
    const normalized = approver.trim();
    if (!validation?.valid) {
      setError(t("passingValidationRequired"));
    } else if (!normalized || normalized === identity.subject) {
      setError(t("secondApproverRequired"));
    } else {
      setApprovedBy(normalized);
    }
  };

  const publish = async (): Promise<void> => {
    if (!floorplan || !registration || !validation || !approvedBy) return;
    const published = await run("publish", () => publishManualTwinRelease({
      mapReleaseId: `${familyId || "manual-twin"}@${revision}`,
      familyId: familyId || "manual-twin",
      revision,
      canonicalFrameId,
      publishedAt: new Date().toISOString(),
      requestedBy: identity.subject,
      approvedBy,
      floorplan,
      registration,
      editorDocument,
      validation,
      diff,
      worldEntities: structuredClone([...worldEntities]),
    }));
    if (published) onPublished(published);
  };

  return (
    <section className="manual-milestone" aria-label={t("manualTwinMilestone")}>
      <div className="milestone-heading">
        <div><p className="section-index">06 / MILESTONE</p><h3>{t("manualTwinMilestone")}</h3></div>
        {release
          ? <span className="milestone-state is-published">{releaseView ? t("releaseView") : t("publishedPreview")}</span>
          : <span className="milestone-state">{approvedBy ? t("approved") : validation?.valid ? t("validated") : t("draft")}</span>}
      </div>

      <div className="milestone-grid">
        <div className="milestone-step">
          <span className="milestone-step-label">1 · {t("alignment")}</span>
          {!floorplan ? <p>{t("importBeforeAlignment")}</p> : (
            <>
              <div className="control-point-table">
                <span>ID</span><span>SX</span><span>SY</span><span>TX</span><span>TY</span>
                {controlPoints.map((pair, index) => (
                  <ControlPointRow
                    key={pair.controlPointId}
                    pair={pair}
                    onChange={(next) => setControlPoints((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? next : candidate))}
                  />
                ))}
              </div>
              <div className="milestone-actions">
                <label className="scale-lock"><input type="checkbox" checked={allowScale} onChange={(event) => setAllowScale(event.currentTarget.checked)} /> {t("allowScale")}</label>
                <button type="button" disabled={busy !== null} onClick={() => void solve()}>{busy === "solve" ? t("solving") : t("solveAlignment")}</button>
              </div>
              {registration && (
                <div className="registration-metrics">
                  <span>RMSE<strong>{registration.metrics.rmseMetres.toFixed(4)} m</strong></span>
                  <span>MAX<strong>{registration.metrics.maximumErrorMetres.toFixed(4)} m</strong></span>
                  <span>SCALE<strong>{registration.transform.scale.toFixed(6)}</strong></span>
                  <span>ROT<strong>{registration.transform.rotationRadians.toFixed(4)} rad</strong></span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="milestone-step">
          <span className="milestone-step-label">2 · {t("validateAndDiff")}</span>
          <div className="diff-metrics">
            <span>+<strong>{diff.summary.addedCount}</strong></span>
            <span>△<strong>{diff.summary.modifiedCount}</strong></span>
            <span>−<strong>{diff.summary.removedCount}</strong></span>
            <span>=<strong>{diff.summary.unchangedCount}</strong></span>
          </div>
          <button className="milestone-primary" type="button" disabled={!floorplan || !registration || busy !== null || releaseView} onClick={() => void validate()}>
            {busy === "validate" ? t("validating") : t("runMilestoneValidation")}
          </button>
          {validation && (
            <div className={`milestone-validation ${validation.valid ? "is-valid" : "is-invalid"}`}>
              <strong>{validation.valid ? t("validationPassed") : t("validationFailed")}</strong>
              <span>{validation.summary.errorCount} {t("qualityErrors")} · {validation.summary.warningCount} {t("qualityWarnings")}</span>
              {validation.issues.slice(0, 3).map((issue) => <small key={`${issue.code}:${issue.featureId ?? "draft"}`}>{issue.code}</small>)}
            </div>
          )}
        </div>

        <div className="milestone-step">
          <span className="milestone-step-label">3 · {t("approvalAndPublish")}</span>
          {release ? (
            <div className="release-proof">
              <strong>{release.mapReleaseId}</strong>
              <code title={release.releaseSha256}>{release.releaseSha256.slice(0, 16)}</code>
              <span>{release.approvals.requestedBy} → {release.approvals.approvedBy}</span>
              <button type="button" onClick={() => onReleaseView(!releaseView)}>{releaseView ? t("returnToDraft") : t("openReadOnlyRelease")}</button>
            </div>
          ) : (
            <>
              <label className="approver-field"><span>{t("approverIdentity")}</span><input value={approver} onChange={(event) => { setApprover(event.currentTarget.value); setApprovedBy(null); }} /></label>
              <div className="milestone-actions split">
                <button type="button" disabled={!validation?.valid || busy !== null} onClick={approve}>{approvedBy ? t("approved") : t("approve")}</button>
                <button type="button" disabled={!approvedBy || busy !== null} onClick={() => void publish()}>{busy === "publish" ? t("publishing") : t("publishPreview")}</button>
              </div>
              <small className="approval-proof">{identity.subject} ≠ {approvedBy ?? approver}</small>
            </>
          )}
        </div>
      </div>
      {error && <div className="milestone-error" role="alert">{error}</div>}
      <p className="milestone-boundary">{t("localMilestoneBoundary")}</p>
    </section>
  );
}

function ControlPointRow({ pair, onChange }: { pair: ControlPointPair; onChange(pair: ControlPointPair): void }) {
  return (
    <>
      <b>{pair.controlPointId.replace("cp-", "")}</b>
      <PointInput value={pair.source.x} onValue={(x) => onChange({ ...pair, source: { ...pair.source, x } })} />
      <PointInput value={pair.source.y} onValue={(y) => onChange({ ...pair, source: { ...pair.source, y } })} />
      <PointInput value={pair.target.x} onValue={(x) => onChange({ ...pair, target: { ...pair.target, x } })} />
      <PointInput value={pair.target.y} onValue={(y) => onChange({ ...pair, target: { ...pair.target, y } })} />
    </>
  );
}

function PointInput({ value, onValue }: { value: number; onValue(value: number): void }) {
  return <input type="number" step="0.05" value={value} onChange={(event) => event.currentTarget.value !== "" && onValue(Number(event.currentTarget.value))} />;
}

function defaultControlPoints(floorplan: FloorplanImportReport): ControlPointPair[] {
  const { minimum, maximum } = floorplan.bounds;
  const points = [
    { x: minimum.x, y: minimum.y },
    { x: maximum.x, y: minimum.y },
    { x: maximum.x, y: maximum.y },
  ];
  return points.map((point, index) => ({ controlPointId: `cp-${index + 1}`, source: point, target: point }));
}
