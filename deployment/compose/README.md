# Compose Deployment

Planned components for local development and pilot environments:

- Studio Web
- Twin API
- Job Orchestrator and Realtime Gateway
- Metadata database
- S3-compatible object store
- Durable job/event queue
- Optional CPU/GPU worker profiles

Fleet Control must not be included in this Compose project. Integration is tested
separately through fixtures or an external URL.

## PostgreSQL development profile

```bash
docker compose -f deployment/compose/postgres.yaml up -d
TWIN_DATABASE_URL=postgres://twin:twin-local-only@127.0.0.1:5432/brash_twin \
  npm run db:migrate
TWIN_PERSISTENCE_MODE=postgres \
TWIN_DATABASE_URL=postgres://twin:twin-local-only@127.0.0.1:5432/brash_twin \
  npm run dev:api
```

The default credentials are for localhost development only and must not be used
as production secrets. This Compose project does not include Fleet Control.
