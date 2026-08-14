import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { TwinApiClient } from "../../api/client";
import type {
  MapDraft,
  MapDraftStatus,
  SurveyMaterializationJob,
  SurveyMaterializationPreview,
  SurveyRegistrationControlPoint,
  SurveyRegistrationRecord,
  ValidationJob,
} from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { useIdentity } from "../../auth/identity";

const SpatialWorkspace = lazy(() => import("../viewer/SpatialWorkspace"));

export function WorkspacePage({ api }: { api: TwinApiClient }) {
  const { t } = useI18n();
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [draftId, setDraftId] = useState("");

  const sites = useQuery({ queryKey: ["sites"], queryFn: ({ signal }) => api.listSites(signal) });
  const floors = useQuery({
    queryKey: ["floors", siteId],
    queryFn: ({ signal }) => api.listFloors(siteId, signal),
    enabled: siteId !== "",
  });
  const families = useQuery({
    queryKey: ["map-families", floorId],
    queryFn: ({ signal }) => api.listMapFamilies(floorId, signal),
    enabled: floorId !== "",
  });
  const drafts = useQuery({
    queryKey: ["map-drafts", familyId],
    queryFn: ({ signal }) => api.listMapDrafts(familyId, signal),
    enabled: familyId !== "",
  });
  const validationJobs = useQuery({
    queryKey: ["validation-jobs", draftId],
    queryFn: ({ signal }) => api.listValidationJobs(draftId, signal),
    enabled: draftId !== "",
  });
  const surveyMaterializations = useQuery({
    queryKey: ["survey-materializations", draftId],
    queryFn: ({ signal }) => api.listSurveyMaterializations(draftId, signal),
    enabled: draftId !== "",
  });
  const surveyRegistrations = useQuery({
    queryKey: ["survey-registrations", draftId],
    queryFn: ({ signal }) => api.listSurveyRegistrations(draftId, signal),
    enabled: draftId !== "",
  });
  const releases = useQuery({
    queryKey: ["releases"],
    queryFn: ({ signal }) => api.listReleases(signal),
  });

  useDefaultSelection(sites.data?.map((site) => site.siteId), siteId, (value) => {
    setSiteId(value); setFloorId(""); setFamilyId(""); setDraftId("");
  });
  useDefaultSelection(floors.data?.map((floor) => floor.floorId), floorId, (value) => {
    setFloorId(value); setFamilyId(""); setDraftId("");
  });
  useDefaultSelection(families.data?.map((family) => family.familyId), familyId, (value) => {
    setFamilyId(value); setDraftId("");
  });
  useDefaultSelection(drafts.data?.map((draft) => draft.draftId), draftId, setDraftId, true);

  const selectedDraft = drafts.data?.find((draft) => draft.draftId === draftId) ?? null;
  const latestValidation = useMemo(() => latestJob(validationJobs.data ?? []), [validationJobs.data]);
  const latestMaterialization = useMemo(
    () => latestSurveyMaterialization(surveyMaterializations.data ?? []),
    [surveyMaterializations.data],
  );
  const surveyPreview = useQuery({
    queryKey: ["survey-materialization-preview", latestMaterialization?.jobId ?? ""],
    queryFn: ({ signal }) => api.getSurveyMaterializationPreview(latestMaterialization!.jobId, signal),
    enabled: latestMaterialization?.status === "SUCCEEDED",
  });
  const latestRegistration = useMemo(
    () => latestSurveyRegistration(surveyRegistrations.data ?? []),
    [surveyRegistrations.data],
  );
  const createRegistration = useMutation({
    mutationFn: (controlPoints: SurveyRegistrationControlPoint[]) => api.createSurveyRegistration(draftId, {
      materializationJobId: latestMaterialization!.jobId,
      controlPoints,
      allowScale: false,
      operatorId: identity.subject,
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["survey-registrations", draftId] }),
  });
  const firstError = [sites.error, floors.error, families.error, drafts.error].find(Boolean);
  const initialLoading = sites.isPending;

  if (initialLoading) {
    return <LoadingPanel label={t("loading")} />;
  }
  if (firstError) {
    return (
      <ErrorPanel
        message={firstError instanceof Error ? firstError.message : t("apiOffline")}
        onRetry={() => void sites.refetch()}
      />
    );
  }

  return (
    <div className="workspace-page">
      <section className="workspace-heading">
        <div>
          <p className="section-index">01 / CONTEXT</p>
          <h2>{t("chooseContext")}</h2>
          <p>{t("chooseContextHint")}</p>
        </div>
        <div className="sync-indicator"><span /> {t("synced")}</div>
      </section>

      <section className="context-grid" aria-label={t("chooseContext")}>
        <ContextSelect
          label={t("site")}
          value={siteId}
          options={(sites.data ?? []).map((site) => ({ value: site.siteId, label: site.displayName }))}
          onChange={(value) => { setSiteId(value); setFloorId(""); setFamilyId(""); setDraftId(""); }}
          placeholder={t("select")}
        />
        <ContextSelect
          label={t("floor")}
          value={floorId}
          options={(floors.data ?? []).map((floor) => ({ value: floor.floorId, label: floor.displayName }))}
          onChange={(value) => { setFloorId(value); setFamilyId(""); setDraftId(""); }}
          placeholder={t("select")}
          disabled={!siteId || floors.isPending}
        />
        <ContextSelect
          label={t("map")}
          value={familyId}
          options={(families.data ?? []).map((family) => ({ value: family.familyId, label: family.displayName }))}
          onChange={(value) => { setFamilyId(value); setDraftId(""); }}
          placeholder={t("select")}
          disabled={!floorId || families.isPending}
        />
        <ContextSelect
          label={t("draft")}
          value={draftId}
          options={(drafts.data ?? []).map((draft) => ({
            value: draft.draftId,
            label: `r${draft.revision} · ${draft.status.replaceAll("_", " ")}`,
          }))}
          onChange={setDraftId}
          placeholder={t("select")}
          disabled={!familyId || drafts.isPending}
        />
      </section>

      {(sites.data?.length ?? 0) === 0 ? (
        <EmptyPanel title={t("noRecords")} description={t("noRecordsHint")} />
      ) : (
        <div className="workspace-dashboard">
          <Suspense fallback={<LoadingPanel label={t("spatialWorkspace")} />}>
            <SpatialWorkspace
              canonicalFrameId={selectedDraft?.canonicalFrameId ?? "workspace-unassigned"}
              familyId={(selectedDraft?.familyId ?? familyId) || "manual-twin"}
              revision={selectedDraft?.revision ?? 1}
              surveyPreview={surveyPreview.data ?? null}
              surveyRegistration={latestRegistration?.report ?? null}
            />
          </Suspense>

          <aside className="dashboard-rail">
            <DraftPanel draft={selectedDraft} />
            <SurveyPanel
              job={latestMaterialization}
              loading={surveyMaterializations.isPending && draftId !== ""}
              previewReady={surveyPreview.isSuccess}
            />
            <SurveyRegistrationPanel
              preview={surveyPreview.data ?? null}
              registration={latestRegistration}
              busy={createRegistration.isPending}
              error={createRegistration.error instanceof Error ? createRegistration.error.message : null}
              onRegister={(controlPoints) => createRegistration.mutateAsync(controlPoints)}
            />
            <ValidationPanel job={latestValidation} loading={validationJobs.isPending && draftId !== ""} />
            <section className="panel release-panel">
              <div className="panel-heading compact">
                <div><p className="section-index">07 / OUTPUT</p><h3>{t("latestReleases")}</h3></div>
                <span className="count-chip">{releases.data?.length ?? 0}</span>
              </div>
              {(releases.data?.length ?? 0) === 0 ? <p className="muted-copy">{t("noReleases")}</p> : (
                <ul className="release-list">
                  {releases.data?.slice(-3).reverse().map((release) => (
                    <li key={release.mapReleaseId}>
                      <span className="release-icon">R{release.revision}</span>
                      <span><strong>{release.mapReleaseId}</strong><small>{release.artifacts.length} artifacts</small></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function ContextSelect({ label, value, options, onChange, placeholder, disabled = false }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <label className="context-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function DraftPanel({ draft }: { draft: MapDraft | null }) {
  const { t } = useI18n();
  return (
    <section className="panel draft-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">03 / DRAFT</p><h3>{t("latestDraft")}</h3></div>
        {draft && <StatusBadge status={draft.status} />}
      </div>
      {draft ? (
        <dl className="metadata-list">
          <div><dt>{t("revision")}</dt><dd>r{draft.revision}</dd></div>
          <div><dt>{t("rowVersion")}</dt><dd>{draft.rowVersion}</dd></div>
          <div className="metadata-wide"><dt>{t("canonicalFrame")}</dt><dd>{draft.canonicalFrameId}</dd></div>
        </dl>
      ) : <p className="muted-copy">{t("noRecords")}</p>}
    </section>
  );
}

function ValidationPanel({ job, loading }: { job: ValidationJob | null; loading: boolean }) {
  const { t } = useI18n();
  const summary = job?.output?.summary;
  return (
    <section className="panel validation-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">06 / QUALITY</p><h3>{t("validation")}</h3></div>
        {job && <span className={`job-state job-${job.status.toLowerCase()}`}>{job.status}</span>}
      </div>
      {loading ? <div className="skeleton-row" /> : job ? (
        <>
          <div className="quality-metrics">
            <Metric value={summary?.errorCount ?? "–"} label={t("qualityErrors")} tone="error" />
            <Metric value={summary?.warningCount ?? "–"} label={t("qualityWarnings")} tone="warning" />
          </div>
          <p className="job-id">{job.jobId}</p>
        </>
      ) : <p className="muted-copy">{t("validationNotRun")}</p>}
    </section>
  );
}

function SurveyPanel({ job, loading, previewReady }: {
  job: SurveyMaterializationJob | null;
  loading: boolean;
  previewReady: boolean;
}) {
  const { t } = useI18n();
  return (
    <section className="panel survey-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">04 / SURVEY</p><h3>{t("surveyMaterialization")}</h3></div>
        {job && <span className={`job-state job-${job.status.toLowerCase()}`}>{job.status}</span>}
      </div>
      {loading ? <div className="skeleton-row" /> : job ? (
        <>
          <dl className="metadata-list">
            <div><dt>{t("trajectoryPoses")}</dt><dd>{job.output?.summary.trajectoryPoseCount ?? "–"}</dd></div>
            <div><dt>{t("surveyPoints")}</dt><dd>{job.output?.summary.pointCloudVertexCount ?? "–"}</dd></div>
            <div className="metadata-wide"><dt>{t("sourceFrame")}</dt><dd>{job.output?.sourceFrameId ?? "–"}</dd></div>
          </dl>
          <p className="job-id">{job.jobId} · {previewReady ? t("previewReady") : t("previewPending")}</p>
        </>
      ) : <p className="muted-copy">{t("noSurveyMaterialization")}</p>}
    </section>
  );
}

function SurveyRegistrationPanel({ preview, registration, busy, error, onRegister }: {
  preview: SurveyMaterializationPreview | null;
  registration: SurveyRegistrationRecord | null;
  busy: boolean;
  error: string | null;
  onRegister(controlPoints: SurveyRegistrationControlPoint[]): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [controlPoints, setControlPoints] = useState<SurveyRegistrationControlPoint[]>([]);
  useEffect(() => {
    if (registration) {
      setControlPoints(registration.report.residuals.map(({ controlPointId, source, target }) => ({
        controlPointId,
        source: { ...source },
        target: { ...target },
      })));
    } else if (preview) {
      setControlPoints(defaultSurveyControlPoints(preview));
    }
  }, [preview?.source.revision, registration?.report.registrationId]);
  return (
    <section className="panel survey-registration-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">05 / ALIGN</p><h3>{t("surveyRegistration")}</h3></div>
        {registration && <span className="job-state job-succeeded">REGISTERED</span>}
      </div>
      {!preview ? <p className="muted-copy">{t("registrationNeedsPreview")}</p> : (
        <>
          <div className="survey-registration-grid">
            <span>ID</span><span>SX</span><span>SY</span><span>TX</span><span>TY</span>
            {controlPoints.map((pair, index) => (
              <SurveyControlPointRow
                key={pair.controlPointId}
                pair={pair}
                onChange={(next) => setControlPoints((current) => current.map(
                  (candidate, candidateIndex) => candidateIndex === index ? next : candidate,
                ))}
              />
            ))}
          </div>
          <button
            className="registration-submit"
            type="button"
            disabled={busy || controlPoints.length < 2}
            onClick={() => void onRegister(controlPoints)}
          >{busy ? t("registeringSurvey") : t("saveRegistrationVersion")}</button>
          {registration && (
            <dl className="metadata-list registration-summary">
              <div><dt>RMSE</dt><dd>{registration.report.metrics.rmseMetres.toFixed(3)} m</dd></div>
              <div><dt>{t("rotation")}</dt><dd>{registration.report.transform.rotationRadians.toFixed(3)} rad</dd></div>
              <div className="metadata-wide"><dt>{t("targetFrame")}</dt><dd>{registration.report.canonicalFrameId}</dd></div>
            </dl>
          )}
          {error && <p className="registration-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}

function SurveyControlPointRow({ pair, onChange }: {
  pair: SurveyRegistrationControlPoint;
  onChange(pair: SurveyRegistrationControlPoint): void;
}) {
  return (
    <>
      <b>{pair.controlPointId.replace("cp-", "")}</b>
      <RegistrationNumber value={pair.source.x} onChange={(x) => onChange({ ...pair, source: { ...pair.source, x } })} />
      <RegistrationNumber value={pair.source.y} onChange={(y) => onChange({ ...pair, source: { ...pair.source, y } })} />
      <RegistrationNumber value={pair.target.x} onChange={(x) => onChange({ ...pair, target: { ...pair.target, x } })} />
      <RegistrationNumber value={pair.target.y} onChange={(y) => onChange({ ...pair, target: { ...pair.target, y } })} />
    </>
  );
}

function RegistrationNumber({ value, onChange }: { value: number; onChange(value: number): void }) {
  return <input type="number" step="0.05" value={value} onChange={(event) => event.currentTarget.value !== "" && onChange(Number(event.currentTarget.value))} />;
}

function defaultSurveyControlPoints(preview: SurveyMaterializationPreview): SurveyRegistrationControlPoint[] {
  const [minimumX, minimumY] = preview.reconstruction.bounds.minimum;
  const [maximumX, maximumY] = preview.reconstruction.bounds.maximum;
  return [
    { x: minimumX, y: minimumY },
    { x: maximumX, y: minimumY },
    { x: maximumX, y: maximumY },
  ].map((point, index) => ({
    controlPointId: `cp-${index + 1}`,
    source: point,
    target: { ...point },
  }));
}

function StatusBadge({ status }: { status: MapDraftStatus }) {
  return <span className={`status-badge status-${status.toLowerCase().replaceAll("_", "-")}`}>{status.replaceAll("_", " ")}</span>;
}

function Metric({ value, label, tone }: { value: number | string; label: string; tone: "error" | "warning" }) {
  return <div className={`metric metric-${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function LoadingPanel({ label }: { label: string }) {
  return <div className="state-panel"><span className="loading-ring" /><strong>{label}</strong></div>;
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry(): void }) {
  const { t } = useI18n();
  return (
    <div className="state-panel state-error">
      <span className="error-mark">!</span><strong>{t("apiOffline")}</strong><p>{message}</p>
      <button type="button" onClick={onRetry}>{t("retry")}</button>
    </div>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return <div className="state-panel"><span className="empty-glyph">◇</span><strong>{title}</strong><p>{description}</p></div>;
}

function useDefaultSelection(
  values: string[] | undefined,
  current: string,
  select: (value: string) => void,
  latest = false,
) {
  useEffect(() => {
    if (!values || values.length === 0 || (current && values.includes(current))) return;
    select(latest ? values[values.length - 1] ?? "" : values[0] ?? "");
  }, [current, latest, select, values]);
}

function latestJob(jobs: ValidationJob[]): ValidationJob | null {
  return [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function latestSurveyMaterialization(jobs: SurveyMaterializationJob[]): SurveyMaterializationJob | null {
  return [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function latestSurveyRegistration(registrations: SurveyRegistrationRecord[]): SurveyRegistrationRecord | null {
  return [...registrations].sort((left, right) => right.report.createdAt.localeCompare(left.report.createdAt))[0] ?? null;
}
