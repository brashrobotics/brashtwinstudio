# OpenAPI

The versioned external contract for the Twin Studio HTTP API.

`twin-api.v1.yaml` defines the site/building/floor hierarchy, map family and draft
lifecycle, multipart upload sessions, append-only draft artifact provenance, and
the read-only release catalog. It intentionally excludes endpoints that stream
large geometry through the API process or publish from a server filesystem path.
