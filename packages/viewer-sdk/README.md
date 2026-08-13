# Viewer SDK

A rendering-engine-independent scene and layer client model for Studio Web and
future controlled consumers.

## Responsibilities

- Share asset selection between 2D and 3D layers.
- Apply coordinate-frame and world transforms on the client.
- Manage LOD and regional artifact-loading policy.
- Define robot pose interpolation and route/alarm overlay data types.
- Provide a snapshot/event client model for replay timelines.

Fleet Control does not have to consume this SDK directly; it may implement the
published contract within its own application.

## Implemented core

`index.ts` provides the rendering-engine-independent canonical world store:

- Explicit metre/radian units and one `canonicalFrameId`
- Orthographic `2D` and perspective `3D` view modes
- CAD, survey, asset, zone, and topology layer registry
- Immutable, validated point, box, polyline, and polygon entities
- Shared `entityId` selection across every view
- World-coordinate pointer state
- Visibility rules that clear inaccessible selections
- Subscription snapshots suitable for React `useSyncExternalStore`

Studio Web implements the current Three.js renderer as an adapter over this
store. The domain-facing model has no Three.js types, allowing another renderer
or a controlled external consumer to implement the same behavior.
