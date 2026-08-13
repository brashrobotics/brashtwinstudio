# Kubernetes Deployment

This directory is reserved for deployment definitions once production
requirements have been validated.

Planned responsibilities:

- Separate CPU and GPU worker node pools.
- Autoscale job workers from queue depth.
- Provide direct object-store access for large uploads.
- Manage API and web availability and rollouts independently.
- Enforce network policies, secrets, and service-account boundaries.
- Observe job cancellation, preemption, and GPU capacity.

Keep this empty during the MVP to avoid premature platform complexity.
