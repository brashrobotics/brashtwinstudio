# Workers

CPU/GPU-intensive, horizontally scalable mapping workers live here. Workers read
immutable inputs from the job queue, write immutable outputs to the object store,
and report results to the Job Orchestrator.

- `slam-worker/`: External SLAM ownership and adapter-boundary documentation;
  no SLAM runtime is implemented in Twin Studio.
- `fusion-worker/`: CAD/BIM-to-scan alignment and difference analysis.
- `semantic-worker/`: Object suggestions from images and point clouds.
- `scene-worker/`: Web-optimized 2D/3D release artifacts.
