# Deployment

Contains deployment definitions for Mapping & Twin Studio that remain independent
from Fleet Control.

- `compose/`: Development and single-site pilot deployment.
- `kubernetes/`: Future scaled worker and production orchestration.

Deployment must treat the metadata database, object store, job queue, API, web
application, and worker profiles as separate components.
