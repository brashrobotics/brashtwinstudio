# Fleet Replay

Validates and samples `brash.fleet-live-replay/v1` fixtures against one immutable
Twin Map Bundle release.

The package keeps operational state separate from static release geometry. It
checks release/frame identity, strictly increasing time and sequence, unique
robot/route/alarm identities, normalized quaternions, route-edge references,
alarm references, and optional release bounds. It does not assign missions,
reserve traffic, or write into Fleet Control.

`sampleFleetReplay` interpolates robot pose for visualization while returning
the sealed source/next sequence and interpolation fraction. It never rewrites a
contract frame.
