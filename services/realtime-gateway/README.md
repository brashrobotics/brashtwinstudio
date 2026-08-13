# Realtime Gateway

Delivers low-latency but reproducible live information to Studio Web.

## Responsibilities

- Publish job progress and log summaries.
- Show active survey coverage and low-resolution previews.
- Stream semantic inference results to the UI as they arrive.
- Announce the presence of users editing the same draft.

Published messages do not replace the durable system record. If the client
misses messages, it must be able to reload the current snapshot from the Twin API.
