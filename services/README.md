# Services

Services manage user requests, metadata lifecycles, and asynchronous job
orchestration. CPU/GPU-intensive work is delegated to `workers/`.

- `twin-api/`: Primary application and domain API.
- `job-orchestrator/`: State machine for long-running pipeline jobs.
- `change-detection/`: Compares observations with the published baseline.
- `realtime-gateway/`: Publishes job progress and live previews.
