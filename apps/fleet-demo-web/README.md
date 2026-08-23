# Fleet 3D Integration Demo

Standalone visual proof that one immutable Twin Map Bundle can be combined with
versioned live operational state without modifying Fleet Control.

The demo loads the committed `demo-plant@2` Scene Manifest v2 and its actual GLB
LOD0 tiles, then samples the synthetic Fleet Live Replay v1 fixture to display:

- robot model and interpolated canonical pose;
- mission and robot state;
- topology route and reservation state;
- asset-, edge-, and robot-linked alarms;
- source and next replay sequence;
- static scene tile/byte integrity metadata.

Static release geometry and live overlays remain separate inputs. This app owns
no mission assignment, traffic reservation, robot control, or Fleet database
write.

## Run

From the repository root:

```bash
npm run dev:fleet-demo
```

Open `http://127.0.0.1:4392`. Use the timeline, play/pause button, speed selector,
mouse orbit, wheel zoom, and right-button pan.

The full demo gate is `npm run check:fleet-demo`.
