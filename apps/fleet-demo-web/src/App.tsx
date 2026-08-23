import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { sampleFleetReplay, validateFleetReplay } from "@brash-twin/fleet-replay";
import { demoData } from "./demo-data";

const FleetScene = lazy(() => import("./FleetScene").then((module) => ({ default: module.FleetScene })));

const validation = validateFleetReplay(demoData.replay, {
  manifest: demoData.manifest,
  topology: demoData.topology,
  frames: demoData.coordinateFrames,
  assets: demoData.assets,
});

export function App() {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const startedRef = useRef<number | null>(null);
  const originProgressRef = useRef(0);
  const sample = useMemo(() => sampleFleetReplay(demoData.replay, progress), [progress]);
  const robot = sample.robots[0];
  const route = sample.routes[0];

  useEffect(() => {
    if (!playing) {
      startedRef.current = null;
      return undefined;
    }
    originProgressRef.current = progress >= 1 ? 0 : progress;
    if (progress >= 1) setProgress(0);
    let frame = 0;
    const tick = (time: number) => {
      if (startedRef.current === null) startedRef.current = time;
      const elapsed = time - startedRef.current;
      const next = Math.min(1, originProgressRef.current + (elapsed * speed) / validation.durationMilliseconds);
      setProgress(next);
      if (next >= 1) {
        setPlaying(false);
        startedRef.current = null;
      } else {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  const setTimeline = (next: number) => {
    setPlaying(false);
    setProgress(next);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">BRASH ROBOTICS · CONTRACT DEMO</p>
          <h1>Fleet 3D Operations Preview</h1>
        </div>
        <div className="contract-badges">
          <span className="badge static">Static · Bundle v2</span>
          <span className="badge live">Live · Overlay v1</span>
          <span className="badge replay">Replay · v1</span>
        </div>
      </header>

      <section className="metrics" aria-label="Release metrics">
        <Metric label="Map release" value={demoData.manifest.mapReleaseId} />
        <Metric label="Canonical frame" value={demoData.manifest.canonicalFrameId} />
        <Metric label="Scene tiles / LODs" value={`${demoData.sceneManifest.tiles.length} / ${demoData.sceneManifest.tiles.flatMap((tile) => tile.levels).length}`} />
        <Metric label="Bound GLB bytes" value={formatBytes(demoData.sceneManifest.budgets.totalTileBytes)} />
        <Metric label="Replay sequence" value={`${sample.sourceSequence} → ${sample.nextSequence}`} />
      </section>

      <section className="workspace">
        <div className="viewport-card">
          <Suspense fallback={<div className="scene-loading">Loading immutable GLB scene…</div>}>
            <FleetScene sample={sample} />
          </Suspense>
          <div className="viewport-labels">
            <span>Actual GLB scene tiles</span>
            <span>Canonical metres · orbit / zoom / pan</span>
          </div>
        </div>

        <aside className="operations-panel">
          <Panel title="Robot">
            <Row label="Robot ID" value={robot?.robotId ?? "—"} />
            <Row label="State" value={robot?.state ?? "—"} tone="accent" />
            <Row label="Mission" value={robot?.missionId ?? "—"} />
            <Row label="Position" value={robot ? `${robot.position.x.toFixed(2)}, ${robot.position.y.toFixed(2)}, ${robot.position.z.toFixed(2)} m` : "—"} />
          </Panel>
          <Panel title="Traffic route">
            <Row label="Route" value={route?.routeId ?? "—"} />
            <Row label="Reservation" value={route?.state ?? "—"} tone={route?.state === "DELAYED" ? "warning" : "accent"} />
            <div className="edge-list">{route?.edgeIds.map((edgeId: string) => <span key={edgeId}>{edgeId}</span>)}</div>
          </Panel>
          <Panel title={`Alarms · ${sample.alarms.length}`}>
            {sample.alarms.length === 0
              ? <p className="quiet">No active alarms in this frame.</p>
              : sample.alarms.map((alarm: any) => (
                <article className={`alarm ${alarm.severity.toLowerCase()}`} key={alarm.alarmId}>
                  <strong>{alarm.severity}</strong><p>{alarm.message}</p><small>{alarm.assetId ?? alarm.edgeId ?? alarm.robotId}</small>
                </article>
              ))}
          </Panel>
        </aside>
      </section>

      <section className="timeline-card">
        <button className="play" onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : progress >= 1 ? "Replay" : "Play"}</button>
        <div className="timeline-main">
          <div className="timeline-labels"><span>{sample.observedAt}</span><span>{Math.round(progress * 100)}%</span></div>
          <input
            aria-label="Mission replay timeline"
            type="range"
            min="0"
            max="1000"
            value={Math.round(progress * 1000)}
            onChange={(event) => setTimeline(Number(event.target.value) / 1000)}
          />
        </div>
        <label className="speed">Speed
          <select value={speed} onChange={(event) => { setPlaying(false); setSpeed(Number(event.target.value)); }}>
            <option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option>
          </select>
        </label>
      </section>

      <footer>
        Static geometry comes from Twin Studio. Operational frames are synthetic Fleet-compatible data. No Fleet Control source or database is used.
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "accent" | "warning" }) {
  return <div className="row"><span>{label}</span><strong className={tone}>{value}</strong></div>;
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
