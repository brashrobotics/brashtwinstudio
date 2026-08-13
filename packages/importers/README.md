# Importers

Contains adapters that convert source files into a canonical, lossless
intermediate model.

Planned importer families:

- CAD/DXF and SVG floorplans
- BIM/IFC
- 2D occupancy maps
- Point-cloud formats
- ROS-compatible recording packages
- Vendor navigation-graph exports

An importer never modifies its source. It reports source units, frame
information, unsupported features, and conversion warnings.

## First working adapter

The first adapter keeps external evaluation datasets outside source control,
validates their sizes and SHA-512 values from a manifest, and streams IFC STEP
and TUM trajectory inspection:

- IFC schema, project length unit, and basic building-element counts
- Storey names and elevation values
- TUM timestamp ordering, quaternion norms, position bounds, and path length
- Dataset license/purpose boundaries and source provenance

Real IFC triangulation is performed separately with IfcOpenShell through
`workers/fusion-worker/ifc_inspector.py`. Large or non-redistributable source data
is never copied into this package.

## Safe SVG floorplan adapter

`@brash-twin/importers/svg-floorplan` converts a bounded SVG subset into
canonical metre-based viewer entities and a deterministic
`brash.floorplan-import-report/v1` report.

The adapter:

- rejects DTD/entity expansion, scripts, event handlers, foreign namespaces,
  URL-bearing styles, embedded media, and external references before geometry
  extraction;
- requires a positive `viewBox` and either physical root dimensions or an
  explicit source-unit override;
- refuses non-uniform X/Y metre scales instead of distorting the drawing;
- supports rectangles, lines, polylines, polygons, and linear SVG path commands;
- applies bounded matrix, translate, scale, and rotate transforms;
- reports unsupported curves, nested viewports, rounded-corner flattening, and
  ignored elements;
- caps source size, element count, point count, and retained warnings;
- records source and effective-configuration SHA-256 digests, bounds, units,
  canonical frame identity, and shape counts.

The source is never modified. Browser users can select `mm`, `cm`, `m`, `in`,
`ft`, or `px` explicitly when the drawing does not carry trustworthy physical
root dimensions.

The subpath also exports the same browser/Node-compatible canonical SHA-256
primitive used by manual milestone sealing, preventing hash implementations
from diverging across provenance boundaries.
