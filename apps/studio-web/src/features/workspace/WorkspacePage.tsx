import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { TwinApiClient } from "../../api/client";
import type {
  DraftArtifactBinding,
  AssetCandidateSetRecord,
  AssetChangeSetRecord,
  DraftTwinAssetSetRecord,
  ReviewAssetChangesInput,
  ReviewAssetCandidateSetInput,
  MapDraft,
  MapDraftStatus,
  SurveyMaterializationJob,
  SurveyMaterializationPreview,
  SurveyQualityRecord,
  SurveyRegistrationControlPoint,
  SurveyRegistrationRecord,
  SensorVisibilityRecord,
  ManagerNotificationRecord,
  ManagerNotificationRoute,
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
  const draftArtifacts = useQuery({
    queryKey: ["draft-artifacts", draftId],
    queryFn: ({ signal }) => api.listDraftArtifacts(draftId, signal),
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
  const surveyQualityReviews = useQuery({
    queryKey: ["survey-quality-reviews", draftId],
    queryFn: ({ signal }) => api.listSurveyQualityReviews(draftId, signal),
    enabled: draftId !== "",
  });
  const semanticCandidateSets = useQuery({
    queryKey: ["semantic-candidates", draftId],
    queryFn: ({ signal }) => api.listSemanticCandidateSets(draftId, signal),
    enabled: draftId !== "",
  });
  const sensorVisibilityReports = useQuery({
    queryKey: ["sensor-visibility", draftId],
    queryFn: ({ signal }) => api.listSensorVisibilityReports(draftId, signal),
    enabled: draftId !== "",
  });
  const twinAssetSets = useQuery({
    queryKey: ["twin-assets", draftId],
    queryFn: ({ signal }) => api.listDraftTwinAssetSets(draftId, signal),
    enabled: draftId !== "",
  });
  const assetChangeSets = useQuery({
    queryKey: ["asset-changes", draftId],
    queryFn: ({ signal }) => api.listDraftAssetChangeSets(draftId, signal),
    enabled: draftId !== "",
  });
  const managerNotificationRoutes = useQuery({
    queryKey: ["manager-notification-routes", siteId, floorId],
    queryFn: ({ signal }) => api.listManagerNotificationRoutes(siteId, floorId, signal),
    enabled: siteId !== "" && floorId !== "",
  });
  const managerNotifications = useQuery({
    queryKey: ["manager-notifications", draftId],
    queryFn: ({ signal }) => api.listDraftManagerNotifications(draftId, signal),
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
  const latestQuality = useMemo(
    () => latestSurveyQualityReview(surveyQualityReviews.data ?? [], latestMaterialization?.jobId),
    [surveyQualityReviews.data, latestMaterialization?.jobId],
  );
  const latestCandidateSet = useMemo(
    () => latestSemanticCandidateSet(semanticCandidateSets.data ?? []),
    [semanticCandidateSets.data],
  );
  const latestVisibility = useMemo(
    () => latestSensorVisibility(sensorVisibilityReports.data ?? []),
    [sensorVisibilityReports.data],
  );
  const latestAssetSet = useMemo(() => latestTwinAssetSet(twinAssetSets.data ?? []), [twinAssetSets.data]);
  const latestChangeSet = useMemo(() => latestAssetChangeSet(assetChangeSets.data ?? []), [assetChangeSets.data]);
  const promotableCandidateSet = useMemo(() => {
    const promoted = new Set((twinAssetSets.data ?? []).flatMap(
      (assetSet) => assetSet.report.assets.map((asset) => asset.source.candidateSetId),
    ));
    const compared = new Set((assetChangeSets.data ?? []).map((changeSet) => changeSet.report.observations.candidateSetId));
    return [...(semanticCandidateSets.data ?? [])].reverse().find((candidateSet) => (
      candidateSet.review !== null
      && candidateSet.review.report.summary.acceptedCount > 0
      && !promoted.has(candidateSet.report.candidateSetId)
      && !compared.has(candidateSet.report.candidateSetId)
    )) ?? null;
  }, [assetChangeSets.data, semanticCandidateSets.data, twinAssetSets.data]);
  const changeCandidateSet = useMemo(() => {
    if (!latestAssetSet) return null;
    const baselineSources = new Set((twinAssetSets.data ?? []).flatMap(
      (assetSet) => assetSet.report.assets.map((asset) => asset.source.candidateSetId),
    ));
    const compared = new Set((assetChangeSets.data ?? []).map((changeSet) => changeSet.report.observations.candidateSetId));
    return [...(semanticCandidateSets.data ?? [])].reverse().find((candidateSet) => (
      !baselineSources.has(candidateSet.report.candidateSetId)
      && !compared.has(candidateSet.report.candidateSetId)
    )) ?? null;
  }, [assetChangeSets.data, latestAssetSet, semanticCandidateSets.data, twinAssetSets.data]);
  const changeVisibility = useMemo(() => {
    if (!changeCandidateSet) return null;
    return [...(sensorVisibilityReports.data ?? [])].reverse().find((visibility) => (
      visibility.report.registrationId === changeCandidateSet.report.registrationId
      && visibility.report.registrationAcceptance.bindingId
        === changeCandidateSet.report.registrationAcceptance.bindingId
      && visibility.report.registrationAcceptance.sha256
        === changeCandidateSet.report.registrationAcceptance.sha256
      && visibility.report.observations.semanticObservationSetId
        === changeCandidateSet.report.observations.observationSetId
    )) ?? null;
  }, [changeCandidateSet, sensorVisibilityReports.data]);
  const createQuality = useMutation({
    mutationFn: () => api.createSurveyQualityReview(draftId, {
      materializationJobId: latestMaterialization!.jobId,
      operatorId: identity.subject,
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["survey-quality-reviews", draftId] }),
  });
  const reviewQuality = useMutation({
    mutationFn: ({ decision, reviewerId }: { decision: "APPROVED" | "REJECTED"; reviewerId: string }) => (
      api.reviewSurveyQuality(draftId, latestQuality!.report.qualityReviewId, { decision, reviewerId })
    ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["survey-quality-reviews", draftId] }),
  });
  const createRegistration = useMutation({
    mutationFn: ({ targetBindingId, controlPoints }: {
      targetBindingId: string;
      controlPoints: SurveyRegistrationControlPoint[];
    }) => api.createSurveyRegistration(draftId, {
      materializationJobId: latestMaterialization!.jobId,
      targetBindingId,
      controlPoints,
      allowScale: false,
      operatorId: identity.subject,
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["survey-registrations", draftId] }),
  });
  const reviewRegistration = useMutation({
    mutationFn: ({ decision, reviewerId }: { decision: "APPROVED" | "REJECTED"; reviewerId: string }) => (
      api.reviewSurveyRegistration(draftId, latestRegistration!.report.registrationId, { decision, reviewerId })
    ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["survey-registrations", draftId] }),
  });
  const createCandidateSet = useMutation({
    mutationFn: (observationBindingId: string) => api.createSemanticCandidateSet(draftId, {
      registrationId: latestRegistration!.report.registrationId,
      observationBindingId,
      operatorId: identity.subject,
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["semantic-candidates", draftId] }),
  });
  const reviewCandidateSet = useMutation({
    mutationFn: (input: ReviewAssetCandidateSetInput) => api.reviewSemanticCandidateSet(
      draftId,
      latestCandidateSet!.report.candidateSetId,
      input,
    ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["semantic-candidates", draftId] }),
  });
  const createVisibility = useMutation({
    mutationFn: (observationBindingId: string) => api.createSensorVisibilityReport(draftId, {
      registrationId: latestRegistration!.report.registrationId,
      observationBindingId,
      operatorId: identity.subject,
    }),
    onSuccess: async () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sensor-visibility", draftId] }),
      queryClient.invalidateQueries({ queryKey: ["draft-artifacts", draftId] }),
    ]),
  });
  const promoteAssets = useMutation({
    mutationFn: () => api.promoteDraftTwinAssets(draftId, {
      candidateSetId: promotableCandidateSet!.report.candidateSetId,
      operatorId: identity.subject,
    }),
    onSuccess: async () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["twin-assets", draftId] }),
      queryClient.invalidateQueries({ queryKey: ["draft-artifacts", draftId] }),
    ]),
  });
  const detectChanges = useMutation({
    mutationFn: () => api.detectDraftAssetChanges(draftId, {
      candidateSetId: changeCandidateSet!.report.candidateSetId,
      visibilityReportId: changeVisibility!.report.visibilityReportId,
      operatorId: identity.subject,
    }),
    onSuccess: async () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["asset-changes", draftId] }),
      queryClient.invalidateQueries({ queryKey: ["draft-artifacts", draftId] }),
    ]),
  });
  const reviewChanges = useMutation({
    mutationFn: (input: ReviewAssetChangesInput) => api.reviewDraftAssetChanges(
      draftId,
      latestChangeSet!.report.changeSetId,
      input,
    ),
    onSuccess: async () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["asset-changes", draftId] }),
      queryClient.invalidateQueries({ queryKey: ["draft-artifacts", draftId] }),
    ]),
  });
  const applyChanges = useMutation({
    mutationFn: () => api.applyDraftAssetChanges(draftId, latestChangeSet!.report.changeSetId, {
      operatorId: identity.subject,
    }),
    onSuccess: async () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["twin-assets", draftId] }),
      queryClient.invalidateQueries({ queryKey: ["asset-changes", draftId] }),
      queryClient.invalidateQueries({ queryKey: ["draft-artifacts", draftId] }),
    ]),
  });
  const createNotificationRoute = useMutation({
    mutationFn: (input: {
      scopeType: "SITE" | "FLOOR";
      channel: "EMAIL" | "WEBHOOK";
      destination: string;
      displayLabel: string;
    }) => api.createManagerNotificationRoute({
      ...input,
      siteId,
      ...(input.scopeType === "FLOOR" ? { floorId } : {}),
      operatorId: identity.subject,
    }),
    onSuccess: async () => queryClient.invalidateQueries({
      queryKey: ["manager-notification-routes", siteId, floorId],
    }),
  });
  const routeManagerNotification = useMutation({
    mutationFn: (notificationId: string) => api.routeManagerNotification(notificationId, {
      operatorId: identity.subject,
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["manager-notifications", draftId] }),
  });
  const retryNotificationDelivery = useMutation({
    mutationFn: (deliveryId: string) => api.retryManagerNotificationDelivery(deliveryId, {
      operatorId: identity.subject,
    }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["manager-notifications", draftId] }),
  });
  const registrationTargets = useMemo(() => (draftArtifacts.data ?? []).filter(
    (artifact) => ["BIM_SOURCE", "FLOORPLAN_SOURCE"].includes(artifact.role)
      && artifact.coordinateFrameId === selectedDraft?.canonicalFrameId,
  ), [draftArtifacts.data, selectedDraft?.canonicalFrameId]);
  const semanticObservationBindings = useMemo(() => (draftArtifacts.data ?? []).filter(
    (artifact) => artifact.role === "SEMANTIC_OBSERVATIONS",
  ), [draftArtifacts.data]);
  const visibilityObservationBindings = useMemo(() => (draftArtifacts.data ?? []).filter(
    (artifact) => artifact.role === "SENSOR_VISIBILITY_OBSERVATIONS",
  ), [draftArtifacts.data]);
  const pendingVisibilityObservationBindings = useMemo(() => {
    const transformedBindings = new Set((sensorVisibilityReports.data ?? []).map(
      (visibility) => visibility.report.observations.bindingId,
    ));
    return visibilityObservationBindings.filter((binding) => !transformedBindings.has(binding.bindingId));
  }, [sensorVisibilityReports.data, visibilityObservationBindings]);
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
              surveyQuality={latestQuality?.report ?? null}
              semanticCandidateSet={latestCandidateSet}
              sensorVisibility={latestVisibility}
              twinAssetSet={latestAssetSet}
              assetChangeSet={latestChangeSet}
            />
          </Suspense>

          <aside className="dashboard-rail">
            <DraftPanel draft={selectedDraft} />
            <SurveyPanel
              job={latestMaterialization}
              preview={surveyPreview.data ?? null}
              loading={surveyMaterializations.isPending && draftId !== ""}
              previewReady={surveyPreview.isSuccess}
            />
            <SurveyQualityPanel
              materialization={latestMaterialization}
              quality={latestQuality}
              busy={createQuality.isPending || reviewQuality.isPending}
              error={[createQuality.error, reviewQuality.error].find(
                (candidate) => candidate instanceof Error,
              )?.message ?? null}
              onCreate={() => createQuality.mutateAsync()}
              onReview={(decision, reviewerId) => reviewQuality.mutateAsync({ decision, reviewerId })}
            />
            <SurveyRegistrationPanel
              preview={surveyPreview.data ?? null}
              registration={latestRegistration}
              targets={registrationTargets}
              qualityApproved={latestQuality?.acceptance?.report.decision === "APPROVED"}
              busy={createRegistration.isPending || reviewRegistration.isPending}
              error={[createRegistration.error, reviewRegistration.error].find(
                (candidate) => candidate instanceof Error,
              )?.message ?? null}
              onRegister={(targetBindingId, controlPoints) => createRegistration.mutateAsync({ targetBindingId, controlPoints })}
              onReview={(decision, reviewerId) => reviewRegistration.mutateAsync({ decision, reviewerId })}
            />
            <SemanticCandidatesPanel
              registration={latestRegistration}
              candidateSet={latestCandidateSet}
              observationBindings={semanticObservationBindings}
              busy={createCandidateSet.isPending || reviewCandidateSet.isPending}
              error={[createCandidateSet.error, reviewCandidateSet.error].find(
                (candidate) => candidate instanceof Error,
              )?.message ?? null}
              onCreate={(observationBindingId) => createCandidateSet.mutateAsync(observationBindingId)}
              onReview={(input) => reviewCandidateSet.mutateAsync(input)}
            />
            <SensorVisibilityPanel
              registration={latestRegistration}
              visibility={latestVisibility}
              observationBindings={pendingVisibilityObservationBindings}
              busy={createVisibility.isPending}
              error={createVisibility.error instanceof Error ? createVisibility.error.message : null}
              onCreate={(observationBindingId) => createVisibility.mutateAsync(observationBindingId)}
            />
            <TwinAssetsPanel
              assetSet={latestAssetSet}
              changeSet={latestChangeSet}
              visibility={changeVisibility}
              promotableCandidateSet={promotableCandidateSet}
              changeCandidateSet={changeCandidateSet}
              busy={promoteAssets.isPending || detectChanges.isPending || reviewChanges.isPending || applyChanges.isPending}
              error={[promoteAssets.error, detectChanges.error, reviewChanges.error, applyChanges.error].find(
                (candidate) => candidate instanceof Error,
              )?.message ?? null}
              onPromote={() => promoteAssets.mutateAsync()}
              onDetectChanges={() => detectChanges.mutateAsync()}
              onReviewChanges={(input) => reviewChanges.mutateAsync(input)}
              onApplyChanges={() => applyChanges.mutateAsync()}
            />
            <ManagerNotificationsPanel
              routes={managerNotificationRoutes.data ?? []}
              notifications={managerNotifications.data ?? []}
              busy={createNotificationRoute.isPending
                || routeManagerNotification.isPending
                || retryNotificationDelivery.isPending}
              error={[
                managerNotificationRoutes.error,
                managerNotifications.error,
                createNotificationRoute.error,
                routeManagerNotification.error,
                retryNotificationDelivery.error,
              ].find((candidate) => candidate instanceof Error)?.message ?? null}
              onCreateRoute={(input) => createNotificationRoute.mutateAsync(input)}
              onRoute={(notificationId) => routeManagerNotification.mutateAsync(notificationId)}
              onRetry={(deliveryId) => retryNotificationDelivery.mutateAsync(deliveryId)}
            />
            <ValidationPanel job={latestValidation} loading={validationJobs.isPending && draftId !== ""} />
            <section className="panel release-panel">
              <div className="panel-heading compact">
                <div><p className="section-index">12 / OUTPUT</p><h3>{t("latestReleases")}</h3></div>
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

function SensorVisibilityPanel({
  registration,
  visibility,
  observationBindings,
  busy,
  error,
  onCreate,
}: {
  registration: SurveyRegistrationRecord | null;
  visibility: SensorVisibilityRecord | null;
  observationBindings: DraftArtifactBinding[];
  busy: boolean;
  error: string | null;
  onCreate(observationBindingId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [observationBindingId, setObservationBindingId] = useState("");
  const registrationApproved = registration?.acceptance?.report.decision === "APPROVED";
  useEffect(() => {
    setObservationBindingId((current) => observationBindings.some(
      (binding) => binding.bindingId === current,
    ) ? current : observationBindings[0]?.bindingId ?? "");
  }, [observationBindings]);
  return (
    <section className="panel sensor-visibility-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">08 / VISIBILITY</p><h3>{t("sensorVisibility")}</h3></div>
        {visibility && <span className={`job-state job-${visibility.report.qualification.outcome === "QUALIFIED" ? "succeeded" : "failed"}`}>
          {visibility.report.qualification.outcome}
        </span>}
      </div>
      {visibility && (
        <>
          <dl className="metadata-list">
            <div><dt>{t("visibilityCells")}</dt><dd>{visibility.report.coverage.qualifiedCellCount}/{visibility.report.coverage.cellCount}</dd></div>
            <div><dt>{t("visibilityArea")}</dt><dd>{visibility.report.coverage.summedCellAreaSquareMeters.toFixed(1)} m²</dd></div>
            <div className="metadata-wide"><dt>{t("visibilityEvidence")}</dt><dd>{visibility.report.evidence.map((item) => item.kind).join(" · ")}</dd></div>
          </dl>
          {visibility.report.qualification.issues.length > 0 && (
            <ul className="quality-issue-list">{visibility.report.qualification.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          )}
          <p className="muted-copy">{t("visibilityEvidenceNotice")}</p>
        </>
      )}
      {!registrationApproved && !visibility ? (
        <p className="muted-copy">{t("visibilityNeedsRegistration")}</p>
      ) : registrationApproved && observationBindings.length === 0 && !visibility ? (
        <p className="muted-copy">{t("visibilityNeedsObservations")}</p>
      ) : registrationApproved && observationBindings.length > 0 ? (
        <>
          <label className="registration-target-select">
            <span>{t("visibilityObservationSource")}</span>
            <select value={observationBindingId} onChange={(event) => setObservationBindingId(event.target.value)}>
              {observationBindings.map((binding) => (
                <option key={binding.bindingId} value={binding.bindingId}>{binding.bindingId}</option>
              ))}
            </select>
          </label>
          <button
            className="registration-submit"
            type="button"
            disabled={busy || observationBindingId === ""}
            onClick={() => void onCreate(observationBindingId)}
          >{t("createVisibilityReport")}</button>
        </>
      ) : null}
      {error && <p className="registration-error" role="alert">{error}</p>}
    </section>
  );
}

function TwinAssetsPanel({
  assetSet,
  changeSet,
  visibility,
  promotableCandidateSet,
  changeCandidateSet,
  busy,
  error,
  onPromote,
  onDetectChanges,
  onReviewChanges,
  onApplyChanges,
}: {
  assetSet: DraftTwinAssetSetRecord | null;
  changeSet: AssetChangeSetRecord | null;
  visibility: SensorVisibilityRecord | null;
  promotableCandidateSet: AssetCandidateSetRecord | null;
  changeCandidateSet: AssetCandidateSetRecord | null;
  busy: boolean;
  error: string | null;
  onPromote(): Promise<unknown>;
  onDetectChanges(): Promise<unknown>;
  onReviewChanges(input: ReviewAssetChangesInput): Promise<unknown>;
  onApplyChanges(): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [reviewerId, setReviewerId] = useState("factory-change-reviewer");
  const [coverageAcknowledged, setCoverageAcknowledged] = useState(false);
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, {
    decision: "CONFIRMED" | "DISMISSED";
    displayName: string;
    assetType: string;
    propertiesJson: string;
  }>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!changeSet || changeSet.review) return;
    setDecisionDrafts(Object.fromEntries(changeSet.report.changes.map((change) => [
      change.changeId,
      {
        decision: "CONFIRMED",
        displayName: change.semanticClass.replaceAll("-", " "),
        assetType: change.semanticClass,
        propertiesJson: "{}",
      },
    ])));
    setCoverageAcknowledged(false);
    setFormError(null);
  }, [changeSet?.report.changeSetId, changeSet?.review?.report.reviewId]);

  async function submitChangeReview(): Promise<void> {
    if (!changeSet) return;
    try {
      const decisions: ReviewAssetChangesInput["decisions"] = changeSet.report.changes.map((change) => {
        const draft = decisionDrafts[change.changeId];
        if (!draft) throw new Error(t("assetChangeReviewIncomplete"));
        if (draft.decision === "DISMISSED") return { changeId: change.changeId, decision: "DISMISSED" };
        if (change.changeType !== "APPEARED") return { changeId: change.changeId, decision: "CONFIRMED" };
        const properties = JSON.parse(draft.propertiesJson) as unknown;
        if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
          throw new Error(t("candidatePropertiesInvalid"));
        }
        return {
          changeId: change.changeId,
          decision: "CONFIRMED",
          displayName: draft.displayName,
          assetType: draft.assetType,
          properties: properties as Record<string, string | number | boolean>,
        };
      });
      setFormError(null);
      await onReviewChanges({
        reviewerId,
        coverageQualificationAcknowledged: coverageAcknowledged,
        decisions,
      });
    } catch (reviewError) {
      setFormError(reviewError instanceof Error ? reviewError.message : t("assetChangeReviewIncomplete"));
    }
  }

  const changeApplied = Boolean(changeSet && assetSet?.report.sourceChangeSet?.changeSetId === changeSet.report.changeSetId);
  const legacyCoverage = changeSet?.report.schemaVersion === "brash.asset-change-report/v1";
  return (
    <section className="panel twin-assets-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">09 / TWIN ASSETS</p><h3>{t("twinAssets")}</h3></div>
        {assetSet && <span className="job-state job-succeeded">r{assetSet.report.revision}</span>}
      </div>
      {!assetSet && !promotableCandidateSet ? (
        <p className="muted-copy">{t("twinAssetsNeedReview")}</p>
      ) : (
        <>
          {assetSet && (
            <dl className="metadata-list">
              <div><dt>{t("assetRevision")}</dt><dd>r{assetSet.report.revision}</dd></div>
              <div><dt>{t("assetCount")}</dt><dd>{assetSet.report.assets.length}</dd></div>
              <div className="metadata-wide"><dt>{t("promotedBy")}</dt><dd>{assetSet.report.promotedBy}</dd></div>
            </dl>
          )}
          {promotableCandidateSet && (
            <button className="registration-submit" type="button" disabled={busy} onClick={() => void onPromote()}>
              {assetSet ? t("promoteAssetRevision") : t("promoteTwinAssets")}
            </button>
          )}
          {assetSet && changeCandidateSet && visibility && (
            <button className="registration-submit" type="button" disabled={busy} onClick={() => void onDetectChanges()}>
              {t("detectAssetChanges")}
            </button>
          )}
          {assetSet && changeCandidateSet && !visibility && (
            <p className="muted-copy">{t("assetChangesNeedVisibility")}</p>
          )}
          {assetSet && !changeCandidateSet && !changeSet && <p className="muted-copy">{t("assetChangesNeedLaterScan")}</p>}
        </>
      )}
      {changeSet && (
        <div className="asset-change-summary">
          <p className="job-id">{changeSet.report.changeSetId} · {
            changeApplied ? t("changesApplied") : changeSet.review ? t("reviewed") : t("reviewRequired")
          }</p>
          <dl className="metadata-list">
            <div><dt>{t("movedAssets")}</dt><dd>{changeSet.report.summary.movedCount}</dd></div>
            <div><dt>{t("missingAssets")}</dt><dd>{changeSet.report.summary.missingCount}</dd></div>
            <div><dt>{t("appearedAssets")}</dt><dd>{changeSet.report.summary.appearedCount}</dd></div>
            <div><dt>{t("unchangedAssets")}</dt><dd>{changeSet.report.summary.unchangedCount}</dd></div>
            {!legacyCoverage && <div><dt>{t("visibilityQualification")}</dt><dd>{changeSet.report.coverage.qualificationOutcome}</dd></div>}
            {!legacyCoverage && <div><dt>{t("visibilityCells")}</dt><dd>{changeSet.report.coverage.cellCount}</dd></div>}
          </dl>
          {changeSet.review ? (
            <>
              <ul className="semantic-review-list">{changeSet.report.changes.map((change) => {
                const decision = changeSet.review!.report.decisions.find((candidate) => candidate.changeId === change.changeId);
                return (
                  <li key={change.changeId}>
                    <strong>{decision?.displayName ?? change.semanticClass}</strong>
                    <span>{change.changeType} · {decision?.decision}</span>
                  </li>
                );
              })}</ul>
              <dl className="metadata-list">
                <div><dt>{t("confirmedChanges")}</dt><dd>{changeSet.review.report.summary.confirmedCount}</dd></div>
                <div><dt>{t("dismissedChanges")}</dt><dd>{changeSet.review.report.summary.dismissedCount}</dd></div>
                <div className="metadata-wide"><dt>{t("reviewerIdentity")}</dt><dd>{changeSet.review.report.reviewerId}</dd></div>
              </dl>
              {!changeApplied && changeSet.review.report.summary.confirmedCount > 0 && (
                <button className="registration-submit" type="button" disabled={busy} onClick={() => void onApplyChanges()}>
                  {t("applyConfirmedChanges")}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="semantic-candidate-list">{changeSet.report.changes.map((change) => {
                const decision = decisionDrafts[change.changeId];
                if (!decision) return null;
                return (
                  <article key={change.changeId}>
                    <header><strong>{change.semanticClass}</strong><span>{change.changeType} · {(change.confidence * 100).toFixed(0)}%</span></header>
                    <select value={decision.decision} onChange={(event) => setDecisionDrafts((current) => ({
                      ...current,
                      [change.changeId]: { ...decision, decision: event.target.value as "CONFIRMED" | "DISMISSED" },
                    }))}>
                      <option value="CONFIRMED">{t("confirmChange")}</option>
                      <option value="DISMISSED">{t("dismissChange")}</option>
                    </select>
                    {change.changeType === "APPEARED" && decision.decision === "CONFIRMED" && <>
                      <input aria-label={t("assetName")} value={decision.displayName} onChange={(event) => setDecisionDrafts((current) => ({ ...current, [change.changeId]: { ...decision, displayName: event.target.value } }))} />
                      <input aria-label={t("assetType")} value={decision.assetType} onChange={(event) => setDecisionDrafts((current) => ({ ...current, [change.changeId]: { ...decision, assetType: event.target.value } }))} />
                      <textarea aria-label={t("assetProperties")} value={decision.propertiesJson} onChange={(event) => setDecisionDrafts((current) => ({ ...current, [change.changeId]: { ...decision, propertiesJson: event.target.value } }))} />
                    </>}
                  </article>
                );
              })}</div>
              {legacyCoverage && changeSet.report.changes.some((change) => change.changeType === "MISSING"
                && decisionDrafts[change.changeId]?.decision === "CONFIRMED") && (
                <label className="registration-target-select">
                  <input type="checkbox" checked={coverageAcknowledged} onChange={(event) => setCoverageAcknowledged(event.target.checked)} />
                  <span>{t("acknowledgeApproximateCoverage")}</span>
                </label>
              )}
              <div className="registration-review">
                <label><span>{t("reviewerIdentity")}</span><input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
                <button type="button" disabled={busy || reviewerId.trim() === ""} onClick={() => void submitChangeReview()}>{t("sealChangeReview")}</button>
              </div>
            </>
          )}
          <p className="muted-copy">{t(legacyCoverage ? "assetChangeEnvelopeNotice" : "assetChangeVisibilityNotice")}</p>
        </div>
      )}
      {(formError ?? error) && <p className="registration-error" role="alert">{formError ?? error}</p>}
    </section>
  );
}

function ManagerNotificationsPanel({
  routes,
  notifications,
  busy,
  error,
  onCreateRoute,
  onRoute,
  onRetry,
}: {
  routes: ManagerNotificationRoute[];
  notifications: ManagerNotificationRecord[];
  busy: boolean;
  error: string | null;
  onCreateRoute(input: {
    scopeType: "SITE" | "FLOOR";
    channel: "EMAIL" | "WEBHOOK";
    destination: string;
    displayLabel: string;
  }): Promise<unknown>;
  onRoute(notificationId: string): Promise<unknown>;
  onRetry(deliveryId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [scopeType, setScopeType] = useState<"SITE" | "FLOOR">("FLOOR");
  const [channel, setChannel] = useState<"EMAIL" | "WEBHOOK">("EMAIL");
  const [destination, setDestination] = useState("");
  const [displayLabel, setDisplayLabel] = useState("");
  const latest = [...notifications].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt)
      || right.notificationId.localeCompare(left.notificationId)
  ))[0] ?? null;
  const stateClass = latest?.status === "DELIVERED" || latest?.status === "NOT_REQUIRED"
    ? "succeeded"
    : latest?.status === "FAILED" || latest?.status === "ROUTING_REQUIRED" ? "failed" : "running";

  async function createRoute(): Promise<void> {
    await onCreateRoute({ scopeType, channel, destination, displayLabel });
    setDestination("");
    setDisplayLabel("");
  }

  return (
    <section className="panel manager-notifications-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">10 / NOTIFY</p><h3>{t("managerNotifications")}</h3></div>
        {latest && <span className={`job-state job-${stateClass}`}>{latest.status}</span>}
      </div>
      {latest ? (
        <>
          <dl className="metadata-list">
            <div><dt>{t("criticalChanges")}</dt><dd>{latest.message.summary.criticalCount}</dd></div>
            <div><dt>{t("deliveryRoutes")}</dt><dd>{latest.deliveries.length}</dd></div>
            <div className="metadata-wide"><dt>{t("notificationSubject")}</dt><dd>{latest.message.subject}</dd></div>
          </dl>
          {latest.deliveries.length > 0 && (
            <ul className="semantic-review-list">{latest.deliveries.map((delivery) => (
              <li key={delivery.deliveryId}>
                <strong>{delivery.displayLabel}</strong>
                <span>{delivery.channel} · {delivery.destinationHint} · {delivery.status} · {delivery.deliveryAttempts} {t("attempts")}</span>
                {delivery.lastError && <small>{delivery.lastError}</small>}
                {delivery.status === "DEAD_LETTER" && (
                  <button type="button" disabled={busy} onClick={() => void onRetry(delivery.deliveryId)}>
                    {t("retryDelivery")}
                  </button>
                )}
              </li>
            ))}</ul>
          )}
          {latest.status === "ROUTING_REQUIRED" && routes.length > 0 && (
            <button className="registration-submit" type="button" disabled={busy} onClick={() => void onRoute(latest.notificationId)}>
              {t("routeNotification")}
            </button>
          )}
          <p className="muted-copy">{t("notificationEvidenceNotice")}</p>
        </>
      ) : <p className="muted-copy">{t("noManagerNotifications")}</p>}

      <div className="registration-review">
        <label>
          <span>{t("routeScope")}</span>
          <select value={scopeType} onChange={(event) => setScopeType(event.target.value as "SITE" | "FLOOR")}>
            <option value="FLOOR">{t("floor")}</option>
            <option value="SITE">{t("site")}</option>
          </select>
        </label>
        <label>
          <span>{t("notificationChannel")}</span>
          <select value={channel} onChange={(event) => setChannel(event.target.value as "EMAIL" | "WEBHOOK")}>
            <option value="EMAIL">EMAIL</option>
            <option value="WEBHOOK">WEBHOOK</option>
          </select>
        </label>
        <label><span>{t("routeLabel")}</span><input value={displayLabel} onChange={(event) => setDisplayLabel(event.target.value)} /></label>
        <label><span>{t("routeDestination")}</span><input value={destination} onChange={(event) => setDestination(event.target.value)} /></label>
        <button
          type="button"
          disabled={busy || destination.trim() === "" || displayLabel.trim() === ""}
          onClick={() => void createRoute()}
        >{t("addNotificationRoute")}</button>
      </div>
      {routes.length > 0 && (
        <ul className="quality-issue-list">{routes.map((route) => (
          <li key={route.routeId}>{route.displayLabel} · {route.scopeType} · {route.channel} · {route.destinationHint}</li>
        ))}</ul>
      )}
      {error && <p className="registration-error" role="alert">{error}</p>}
    </section>
  );
}

function ValidationPanel({ job, loading }: { job: ValidationJob | null; loading: boolean }) {
  const { t } = useI18n();
  const summary = job?.output?.summary;
  return (
    <section className="panel validation-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">11 / VALIDATE</p><h3>{t("validation")}</h3></div>
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

type CandidateDecisionDraft = {
  decision: "ACCEPTED" | "REJECTED";
  displayName: string;
  assetType: string;
  propertiesJson: string;
};

function SemanticCandidatesPanel({
  registration,
  candidateSet,
  observationBindings,
  busy,
  error,
  onCreate,
  onReview,
}: {
  registration: SurveyRegistrationRecord | null;
  candidateSet: AssetCandidateSetRecord | null;
  observationBindings: DraftArtifactBinding[];
  busy: boolean;
  error: string | null;
  onCreate(observationBindingId: string): Promise<unknown>;
  onReview(input: ReviewAssetCandidateSetInput): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [observationBindingId, setObservationBindingId] = useState("");
  const [reviewerId, setReviewerId] = useState("factory-asset-reviewer");
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, CandidateDecisionDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const registrationApproved = registration?.acceptance?.report.decision === "APPROVED";

  useEffect(() => {
    setObservationBindingId((current) => observationBindings.some(
      (binding) => binding.bindingId === current,
    ) ? current : observationBindings[0]?.bindingId ?? "");
  }, [observationBindings]);

  useEffect(() => {
    if (!candidateSet || candidateSet.review) return;
    setDecisionDrafts(Object.fromEntries(candidateSet.report.candidates.map((candidate) => [
      candidate.candidateId,
      {
        decision: "ACCEPTED",
        displayName: candidate.suggestedClass.replaceAll("-", " "),
        assetType: candidate.suggestedClass,
        propertiesJson: "{}",
      },
    ])));
    setFormError(null);
  }, [candidateSet?.report.candidateSetId, candidateSet?.review?.report.reviewedAt]);

  async function submitReview(): Promise<void> {
    if (!candidateSet) return;
    try {
      const decisions: ReviewAssetCandidateSetInput["decisions"] = candidateSet.report.candidates.map((candidate) => {
        const draft = decisionDrafts[candidate.candidateId];
        if (!draft) throw new Error(t("candidateReviewIncomplete"));
        if (draft.decision === "REJECTED") return { candidateId: candidate.candidateId, decision: "REJECTED" };
        const properties = JSON.parse(draft.propertiesJson) as unknown;
        if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
          throw new Error(t("candidatePropertiesInvalid"));
        }
        return {
          candidateId: candidate.candidateId,
          decision: "ACCEPTED",
          displayName: draft.displayName,
          assetType: draft.assetType,
          properties: properties as Record<string, string | number | boolean>,
        };
      });
      setFormError(null);
      await onReview({ reviewerId, decisions });
    } catch (candidateError) {
      setFormError(candidateError instanceof Error ? candidateError.message : t("candidatePropertiesInvalid"));
    }
  }

  return (
    <section className="panel semantic-candidates-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">07 / SEMANTICS</p><h3>{t("semanticCandidates")}</h3></div>
        {candidateSet && <span className={`job-state job-${candidateSet.review ? "succeeded" : "pending"}`}>
          {candidateSet.review ? t("reviewed") : t("candidate")}
        </span>}
      </div>
      {!registrationApproved ? <p className="muted-copy">{t("semanticNeedsRegistration")}</p> : !candidateSet ? (
        observationBindings.length === 0 ? <p className="muted-copy">{t("semanticNeedsObservations")}</p> : (
          <>
            <label className="registration-target-select">
              <span>{t("semanticObservationSet")}</span>
              <select value={observationBindingId} onChange={(event) => setObservationBindingId(event.target.value)}>
                {observationBindings.map((binding) => <option key={binding.bindingId} value={binding.bindingId}>{binding.bindingId}</option>)}
              </select>
            </label>
            <button className="registration-submit" type="button" disabled={busy || !observationBindingId} onClick={() => void onCreate(observationBindingId)}>
              {t("extractCandidates")}
            </button>
          </>
        )
      ) : candidateSet.review ? (
        <>
          <dl className="metadata-list">
            <div><dt>{t("acceptedCandidates")}</dt><dd>{candidateSet.review.report.summary.acceptedCount}</dd></div>
            <div><dt>{t("rejectedCandidates")}</dt><dd>{candidateSet.review.report.summary.rejectedCount}</dd></div>
          </dl>
          <ul className="semantic-review-list">{candidateSet.review.report.decisions.map((decision) => (
            <li key={decision.candidateId}><strong>{decision.displayName ?? decision.candidateId}</strong><span>{decision.decision}</span></li>
          ))}</ul>
          <p className="job-id">{candidateSet.review.report.reviewerId}</p>
        </>
      ) : (
        <>
          <p className="muted-copy">{t("semanticCandidatesAreObservations")}</p>
          <div className="semantic-candidate-list">{candidateSet.report.candidates.map((candidate) => {
            const decision = decisionDrafts[candidate.candidateId];
            if (!decision) return null;
            return (
              <article key={candidate.candidateId}>
                <header><strong>{candidate.suggestedClass}</strong><span>{(candidate.confidence * 100).toFixed(0)}%</span></header>
                <select value={decision.decision} onChange={(event) => setDecisionDrafts((current) => ({
                  ...current,
                  [candidate.candidateId]: { ...decision, decision: event.target.value as CandidateDecisionDraft["decision"] },
                }))}>
                  <option value="ACCEPTED">{t("acceptCandidate")}</option>
                  <option value="REJECTED">{t("rejectCandidate")}</option>
                </select>
                {decision.decision === "ACCEPTED" && <>
                  <input aria-label={t("assetName")} value={decision.displayName} onChange={(event) => setDecisionDrafts((current) => ({ ...current, [candidate.candidateId]: { ...decision, displayName: event.target.value } }))} />
                  <input aria-label={t("assetType")} value={decision.assetType} onChange={(event) => setDecisionDrafts((current) => ({ ...current, [candidate.candidateId]: { ...decision, assetType: event.target.value } }))} />
                  <textarea aria-label={t("assetProperties")} value={decision.propertiesJson} onChange={(event) => setDecisionDrafts((current) => ({ ...current, [candidate.candidateId]: { ...decision, propertiesJson: event.target.value } }))} />
                </>}
              </article>
            );
          })}</div>
          <div className="registration-review">
            <label><span>{t("reviewerIdentity")}</span><input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
            <button type="button" disabled={busy || reviewerId.trim() === ""} onClick={() => void submitReview()}>{t("saveCandidateReview")}</button>
          </div>
        </>
      )}
      {(formError || error) && <p className="registration-error" role="alert">{formError ?? error}</p>}
    </section>
  );
}

function SurveyQualityPanel({ materialization, quality, busy, error, onCreate, onReview }: {
  materialization: SurveyMaterializationJob | null;
  quality: SurveyQualityRecord | null;
  busy: boolean;
  error: string | null;
  onCreate(): Promise<unknown>;
  onReview(decision: "APPROVED" | "REJECTED", reviewerId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [reviewerId, setReviewerId] = useState("survey-quality-reviewer");
  const acceptance = quality?.acceptance?.report ?? null;
  return (
    <section className="panel survey-quality-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">05 / QUALITY</p><h3>{t("surveyQualityReview")}</h3></div>
        {quality && <span className={`job-state job-${acceptance?.decision === "APPROVED" ? "succeeded" : quality.report.outcome === "PASSED" ? "pending" : "failed"}`}>
          {acceptance?.decision ?? quality.report.outcome}
        </span>}
      </div>
      {!materialization || materialization.status !== "SUCCEEDED" ? <p className="muted-copy">{t("qualityNeedsPreview")}</p> : !quality ? (
        <button className="registration-submit" type="button" disabled={busy} onClick={() => void onCreate()}>{t("generateQualityReport")}</button>
      ) : (
        <>
          <dl className="metadata-list quality-review-summary">
            <div><dt>{t("declaredCoverage")}</dt><dd>{quality.report.metrics.declaredCoverageRatio === null ? "–" : `${(quality.report.metrics.declaredCoverageRatio * 100).toFixed(1)}%`}</dd></div>
            <div><dt>{t("sampledOccupancy")}</dt><dd>{(quality.report.metrics.sampledOccupancyRatio * 100).toFixed(1)}%</dd></div>
            <div><dt>{t("pointDensity")}</dt><dd>{quality.report.metrics.pointDensityPerSquareMetre.toFixed(1)} pt/m²</dd></div>
            <div><dt>{t("maximumStep")}</dt><dd>{quality.report.metrics.trajectoryMaximumStepMetres.toFixed(2)} m</dd></div>
          </dl>
          {quality.report.issues.length > 0 && <ul className="quality-issue-list">{quality.report.issues.map((issue) => <li key={issue.code}>{issue.code}</li>)}</ul>}
          {!acceptance && (
            <div className="registration-review">
              <label><span>{t("reviewerIdentity")}</span><input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
              <div>
                <button type="button" disabled={busy || reviewerId.trim() === "" || quality.report.outcome !== "PASSED"} onClick={() => void onReview("APPROVED", reviewerId)}>{t("approveSurveyQuality")}</button>
                <button type="button" disabled={busy || reviewerId.trim() === ""} onClick={() => void onReview("REJECTED", reviewerId)}>{t("rejectSurveyQuality")}</button>
              </div>
            </div>
          )}
          {acceptance && <p className="job-id">{acceptance.decision} · {acceptance.reviewerId}</p>}
        </>
      )}
      {error && <p className="registration-error" role="alert">{error}</p>}
    </section>
  );
}

function SurveyPanel({ job, preview, loading, previewReady }: {
  job: SurveyMaterializationJob | null;
  preview: SurveyMaterializationPreview | null;
  loading: boolean;
  previewReady: boolean;
}) {
  const { t } = useI18n();
  const projection = preview?.reconstruction.planProjection;
  const planWidth = projection ? projection.bounds.maximum[0] - projection.bounds.minimum[0] : null;
  const planHeight = projection ? projection.bounds.maximum[1] - projection.bounds.minimum[1] : null;
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
            {preview && <div><dt>{t("pathLength")}</dt><dd>{preview.trajectory.pathLengthMetres.toFixed(1)} m</dd></div>}
            {projection && <div><dt>{t("planResolution")}</dt><dd>{projection.resolutionMetres.toFixed(2)} m</dd></div>}
            {projection && planWidth !== null && planHeight !== null && (
              <div className="metadata-wide"><dt>{t("operationalPlan")}</dt><dd>{planWidth.toFixed(1)} × {planHeight.toFixed(1)} m · {projection.samples.length.toLocaleString()} cells</dd></div>
            )}
            <div className="metadata-wide"><dt>{t("sourceFrame")}</dt><dd>{job.output?.sourceFrameId ?? "–"}</dd></div>
          </dl>
          <p className="job-id">{job.jobId} · {previewReady ? t("previewReady") : t("previewPending")}</p>
        </>
      ) : <p className="muted-copy">{t("noSurveyMaterialization")}</p>}
    </section>
  );
}

function SurveyRegistrationPanel({ preview, registration, targets, qualityApproved, busy, error, onRegister, onReview }: {
  preview: SurveyMaterializationPreview | null;
  registration: SurveyRegistrationRecord | null;
  targets: DraftArtifactBinding[];
  qualityApproved: boolean;
  busy: boolean;
  error: string | null;
  onRegister(targetBindingId: string, controlPoints: SurveyRegistrationControlPoint[]): Promise<unknown>;
  onReview(decision: "APPROVED" | "REJECTED", reviewerId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [controlPoints, setControlPoints] = useState<SurveyRegistrationControlPoint[]>([]);
  const [targetBindingId, setTargetBindingId] = useState("");
  const [reviewerId, setReviewerId] = useState("registration-reviewer");
  useEffect(() => {
    if (registration) {
      setTargetBindingId(registration.report.targetEvidence.bindingId);
      setControlPoints(registration.report.residuals.map(({ controlPointId, source, target }) => ({
        controlPointId,
        source: { ...source },
        target: { ...target },
      })));
    } else if (preview) {
      setTargetBindingId(targets[0]?.bindingId ?? "");
      setControlPoints(defaultSurveyControlPoints(preview));
    }
  }, [preview?.source.revision, registration?.report.registrationId, targets[0]?.bindingId]);
  const review = registration?.acceptance?.report ?? null;
  return (
    <section className="panel survey-registration-panel">
      <div className="panel-heading compact">
        <div><p className="section-index">06 / ALIGN</p><h3>{t("surveyRegistration")}</h3></div>
        {registration && <span className={`job-state job-${review?.decision === "APPROVED" ? "succeeded" : registration.report.quality.outcome === "PASSED" ? "pending" : "failed"}`}>
          {review?.decision ?? registration.report.quality.outcome}
        </span>}
      </div>
      {!preview ? <p className="muted-copy">{t("registrationNeedsPreview")}</p> : (
        <>
          {!qualityApproved && !registration && <p className="muted-copy">{t("registrationNeedsQualityApproval")}</p>}
          {targets.length === 0 ? <p className="muted-copy">{t("registrationNeedsTarget")}</p> : (
            <label className="registration-target-select">
              <span>{t("registrationTarget")}</span>
              <select value={targetBindingId} onChange={(event) => setTargetBindingId(event.target.value)}>
                {targets.map((target) => (
                  <option key={target.bindingId} value={target.bindingId}>{target.bindingId} · {target.role}</option>
                ))}
              </select>
            </label>
          )}
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
            disabled={busy || controlPoints.length < 2 || targetBindingId === "" || !qualityApproved}
            onClick={() => void onRegister(targetBindingId, controlPoints)}
          >{busy ? t("registeringSurvey") : t("saveRegistrationVersion")}</button>
          {registration && (
            <dl className="metadata-list registration-summary">
              <div><dt>RMSE</dt><dd>{registration.report.metrics.rmseMetres.toFixed(3)} m</dd></div>
              <div><dt>{t("registrationQuality")}</dt><dd>{registration.report.quality.outcome}</dd></div>
              <div className="metadata-wide"><dt>{t("registrationTarget")}</dt><dd>{registration.report.targetEvidence.bindingId}</dd></div>
            </dl>
          )}
          {registration && !review && (
            <div className="registration-review">
              <label><span>{t("reviewerIdentity")}</span><input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} /></label>
              <div>
                <button type="button" disabled={busy || reviewerId.trim() === "" || registration.report.quality.outcome !== "PASSED"} onClick={() => void onReview("APPROVED", reviewerId)}>{t("approveRegistration")}</button>
                <button type="button" disabled={busy || reviewerId.trim() === ""} onClick={() => void onReview("REJECTED", reviewerId)}>{t("rejectRegistration")}</button>
              </div>
            </div>
          )}
          {review && <p className="job-id">{review.decision} · {review.reviewerId}</p>}
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
  const bounds = preview.reconstruction.planProjection?.bounds ?? preview.reconstruction.bounds;
  const [minimumX, minimumY] = bounds.minimum;
  const [maximumX, maximumY] = bounds.maximum;
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

function latestSurveyQualityReview(reviews: SurveyQualityRecord[], materializationJobId?: string): SurveyQualityRecord | null {
  return [...reviews]
    .filter((review) => materializationJobId === undefined || review.report.materializationJobId === materializationJobId)
    .sort((left, right) => right.report.createdAt.localeCompare(left.report.createdAt))[0] ?? null;
}

function latestSemanticCandidateSet(candidateSets: AssetCandidateSetRecord[]): AssetCandidateSetRecord | null {
  return [...candidateSets]
    .sort((left, right) => right.report.createdAt.localeCompare(left.report.createdAt)
      || right.report.candidateSetId.localeCompare(left.report.candidateSetId))[0] ?? null;
}

function latestSensorVisibility(reports: SensorVisibilityRecord[]): SensorVisibilityRecord | null {
  return [...reports].sort((left, right) => right.report.createdAt.localeCompare(left.report.createdAt))[0] ?? null;
}

function latestTwinAssetSet(assetSets: DraftTwinAssetSetRecord[]): DraftTwinAssetSetRecord | null {
  return [...assetSets].sort((left, right) => right.report.revision - left.report.revision)[0] ?? null;
}

function latestAssetChangeSet(changeSets: AssetChangeSetRecord[]): AssetChangeSetRecord | null {
  return [...changeSets].sort((left, right) => right.report.createdAt.localeCompare(left.report.createdAt)
    || right.report.changeSetId.localeCompare(left.report.changeSetId))[0] ?? null;
}
