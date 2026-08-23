# Integrations

External-system integrations are isolated here. Every integration explicitly
defines its contract version, data ownership, failure behavior, and direction.

- `fleet-control/`: Published twin release and live 3D overlay contracts.
- `embodied-controller/`: Processed robot-survey package and ingest boundary.
- `manager-notifications/`: Provider-neutral delivery of reviewed asset-change
  results to site or floor managers.

No integration may depend directly on another project's source code or database.
