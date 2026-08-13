# Synthetic SVG Floorplan Fixture

`demo-floorplan.svg` is a project-owned synthetic factory drawing for SVG
import, coordinate normalization, and viewer tests. It contains no third-party
data and may be used without external license restrictions.

Expected properties:

- physical size: 30 m by 20 m;
- source units: millimetres through root dimensions and `viewBox`;
- supported geometry: rectangle, linear path, polyline, polygon, and line;
- one translated group;
- one intentionally unsupported cubic path that must produce a warning and no
  geometry.
