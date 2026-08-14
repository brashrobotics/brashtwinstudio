import { TwinCatalogService } from "@brash-twin/application";
import { DraftArtifactService } from "@brash-twin/application/draft-artifacts";
import { UploadService } from "@brash-twin/application/uploads";
import { ValidationJobService } from "@brash-twin/application/validation-jobs";
import { PublicationService } from "@brash-twin/application/publications";
import { SurveyIntakeService } from "@brash-twin/application/survey-intakes";
import { SurveyMaterializationService } from "@brash-twin/application/survey-materializations";
import { SurveyQualityReviewService } from "@brash-twin/application/survey-quality-reviews";
import { SemanticCandidateService } from "@brash-twin/application/semantic-candidates";
import { SurveyRegistrationService } from "@brash-twin/application/survey-registrations";
import {
  ImmutableReleaseStore,
  LocalMultipartArtifactStore,
} from "@brash-twin/artifact-store";
import { PostgresMigrationRunner } from "@brash-twin/migrations";
import {
  InMemoryTwinCatalogRepository,
  PostgresTwinCatalogRepository,
} from "@brash-twin/persistence";
import {
  InMemoryDraftArtifactRepository,
  PostgresDraftArtifactRepository,
} from "@brash-twin/persistence/draft-artifacts";
import {
  InMemoryOutboxRepository,
  InMemoryTwinUnitOfWork,
  PostgresOutboxRepository,
  PostgresTwinUnitOfWork,
} from "@brash-twin/persistence/outbox";
import {
  InMemoryUploadRepository,
  PostgresUploadRepository,
} from "@brash-twin/persistence/uploads";
import {
  InMemoryValidationJobRepository,
  PostgresValidationJobRepository,
} from "@brash-twin/persistence/validation-jobs";
import {
  InMemoryPublicationRepository,
  PostgresPublicationRepository,
} from "@brash-twin/persistence/publications";
import {
  InMemorySurveyIntakeRepository,
  PostgresSurveyIntakeRepository,
} from "@brash-twin/persistence/survey-intakes";
import {
  InMemorySurveyMaterializationRepository,
  PostgresSurveyMaterializationRepository,
} from "@brash-twin/persistence/survey-materializations";
import {
  createPostgresPool,
  createPostgresQueryPort,
  loadPostgresConfig,
} from "@brash-twin/persistence/postgres";
import { TwinApi } from "./index.js";
import { loadTwinApiConfig } from "./config.js";
import { fileURLToPath } from "node:url";

export function createTwinApiSystem({ environment = process.env, onDatabaseBackgroundError } = {}) {
  const config = loadTwinApiConfig(environment);
  const releaseStore = new ImmutableReleaseStore(config.releaseStorePath);
  const multipartArtifactStore = new LocalMultipartArtifactStore(config.objectStorePath);
  let repository;
  let outboxRepository;
  let uploadRepository;
  let draftArtifactRepository;
  let validationJobRepository;
  let publicationRepository;
  let surveyIntakeRepository;
  let surveyMaterializationRepository;
  let unitOfWork;
  let readiness;
  let close;

  if (config.persistenceMode === "postgres") {
    const postgresConfig = loadPostgresConfig(environment);
    const pool = createPostgresPool(postgresConfig, { onBackgroundError: onDatabaseBackgroundError });
    const database = createPostgresQueryPort(pool);
    const migrationDirectory = fileURLToPath(new URL("../../storage/migrations", import.meta.url));
    const migrationRunner = new PostgresMigrationRunner({ database, migrationDirectory });
    repository = new PostgresTwinCatalogRepository(database);
    outboxRepository = new PostgresOutboxRepository(database);
    uploadRepository = new PostgresUploadRepository(database);
    draftArtifactRepository = new PostgresDraftArtifactRepository(database);
    validationJobRepository = new PostgresValidationJobRepository(database);
    publicationRepository = new PostgresPublicationRepository(database);
    surveyIntakeRepository = new PostgresSurveyIntakeRepository(database);
    surveyMaterializationRepository = new PostgresSurveyMaterializationRepository(database);
    unitOfWork = new PostgresTwinUnitOfWork(database);
    readiness = async () => {
      const databaseHealth = await database.health();
      if (!databaseHealth.ready) return Object.freeze({ mode: "postgres", ...databaseHealth });
      try {
        const migrationStatus = await migrationRunner.status();
        const migrationsReady = migrationStatus.pendingCount === 0
          && migrationStatus.entries.every((entry) => entry.state === "APPLIED");
        return Object.freeze({
          mode: "postgres",
          ...databaseHealth,
          ready: migrationsReady,
          migrations: Object.freeze({
            ready: migrationsReady,
            currentVersion: migrationStatus.currentVersion,
            latestVersion: migrationStatus.latestVersion,
            pendingCount: migrationStatus.pendingCount,
          }),
        });
      } catch {
        return Object.freeze({
          mode: "postgres",
          ...databaseHealth,
          ready: false,
          migrations: Object.freeze({ ready: false, errorCode: "MIGRATION_STATUS_UNAVAILABLE" }),
        });
      }
    };
    close = () => database.close();
  } else {
    repository = new InMemoryTwinCatalogRepository();
    outboxRepository = new InMemoryOutboxRepository();
    uploadRepository = new InMemoryUploadRepository();
    draftArtifactRepository = new InMemoryDraftArtifactRepository();
    validationJobRepository = new InMemoryValidationJobRepository();
    publicationRepository = new InMemoryPublicationRepository({
      catalogRepository: repository,
      outboxRepository,
    });
    surveyIntakeRepository = new InMemorySurveyIntakeRepository();
    surveyMaterializationRepository = new InMemorySurveyMaterializationRepository();
    unitOfWork = new InMemoryTwinUnitOfWork({ catalogRepository: repository, outboxRepository });
    readiness = async () => Object.freeze({ ready: true, mode: "memory" });
    close = async () => undefined;
  }

  const catalog = new TwinCatalogService({ repository, unitOfWork });
  const uploads = new UploadService({ repository: uploadRepository, multipartStore: multipartArtifactStore });
  const draftArtifacts = new DraftArtifactService({
    repository: draftArtifactRepository,
    catalog,
    uploads,
  });
  const validationJobs = new ValidationJobService({
    repository: validationJobRepository,
    catalog,
    draftArtifacts,
    uploads,
    multipartStore: multipartArtifactStore,
  });
  const surveyIntakes = new SurveyIntakeService({
    repository: surveyIntakeRepository,
    catalog,
    uploads,
    multipartStore: multipartArtifactStore,
  });
  const surveyMaterializations = new SurveyMaterializationService({
    repository: surveyMaterializationRepository,
    surveyIntakes,
    catalog,
    uploads,
    draftArtifacts,
    multipartStore: multipartArtifactStore,
  });
  const surveyQualityReviews = new SurveyQualityReviewService({
    catalog,
    materializations: surveyMaterializations,
    draftArtifacts,
    uploads,
    multipartStore: multipartArtifactStore,
  });
  const surveyRegistrations = new SurveyRegistrationService({
    catalog,
    materializations: surveyMaterializations,
    qualityReviews: surveyQualityReviews,
    draftArtifacts,
    uploads,
    multipartStore: multipartArtifactStore,
  });
  const semanticCandidates = new SemanticCandidateService({
    catalog,
    registrations: surveyRegistrations,
    draftArtifacts,
    uploads,
    multipartStore: multipartArtifactStore,
  });
  const publications = new PublicationService({
    repository: publicationRepository,
    catalog,
    releaseStore,
  });
  const api = new TwinApi({
    catalog,
    uploads,
    draftArtifacts,
    surveyIntakes,
    surveyMaterializations,
    surveyQualityReviews,
    surveyRegistrations,
    semanticCandidates,
    validationJobs,
    releaseStore,
    readiness,
  });
  return Object.freeze({
    api,
    catalog,
    repository,
    outboxRepository,
    uploadRepository,
    draftArtifactRepository,
    validationJobRepository,
    publicationRepository,
    surveyIntakeRepository,
    surveyMaterializationRepository,
    unitOfWork,
    uploads,
    draftArtifacts,
    surveyIntakes,
    surveyMaterializations,
    surveyQualityReviews,
    surveyRegistrations,
    semanticCandidates,
    validationJobs,
    publications,
    multipartArtifactStore,
    releaseStore,
    config,
    readiness,
    close,
  });
}
