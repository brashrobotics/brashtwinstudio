import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FleetReplayError, sampleFleetReplay, validateFleetReplay } from "@brash-twin/fleet-replay";

const bundleDirectory = fileURLToPath(new URL("../fixtures/bundles/demo-plant@2/", import.meta.url));
const replayPath = fileURLToPath(new URL("../fixtures/fleet-demo/demo-mission-replay.v1.json", import.meta.url));

test("Fleet replay validates against one immutable release and samples robot motion", async () => {
  const [manifest, topology, frames, assets, replay] = await Promise.all([
    json(`${bundleDirectory}/manifest.json`),
    json(`${bundleDirectory}/topology.json`),
    json(`${bundleDirectory}/coordinate-frames.json`),
    json(`${bundleDirectory}/assets.json`),
    json(replayPath),
  ]);
  const validation = validateFleetReplay(replay, { manifest, topology, frames, assets });
  assert.deepEqual(validation.robotIds, ["brash-amr-01"]);
  assert.equal(validation.frameCount, 6);
  assert.equal(validation.durationMilliseconds, 25_000);

  const halfway = sampleFleetReplay(replay, 0.5);
  assert.equal(halfway.sourceSequence, 2);
  assert.equal(halfway.nextSequence, 3);
  assert.equal(halfway.alpha, 0.5);
  assert.deepEqual(halfway.robots[0].position, { x: 14, y: 4, z: 0.45 });
  assert.equal(halfway.robots[0].missionId, "mission-conveyor-feed-42");
});

test("Fleet replay rejects release, topology, and sequence divergence", async () => {
  const [manifest, topology, frames, assets, replay] = await Promise.all([
    json(`${bundleDirectory}/manifest.json`),
    json(`${bundleDirectory}/topology.json`),
    json(`${bundleDirectory}/coordinate-frames.json`),
    json(`${bundleDirectory}/assets.json`),
    json(replayPath),
  ]);
  await assert.rejects(
    async () => validateFleetReplay({ ...replay, mapReleaseId: "another-release@1" }, { manifest, topology, frames, assets }),
    (error) => error instanceof FleetReplayError && error.code === "FLEET_REPLAY_RELEASE_MISMATCH",
  );
  const changedEdge = structuredClone(replay);
  changedEdge.frames[2].routes[0].edgeIds = ["UNKNOWN-EDGE"];
  assert.throws(
    () => validateFleetReplay(changedEdge, { manifest, topology, frames, assets }),
    (error) => error instanceof FleetReplayError && error.code === "FLEET_ROUTE_EDGE_UNKNOWN",
  );
  const changedSequence = structuredClone(replay);
  changedSequence.frames[4].sequence = 9;
  assert.throws(
    () => validateFleetReplay(changedSequence, { manifest, topology, frames, assets }),
    (error) => error instanceof FleetReplayError && error.code === "FLEET_OVERLAY_SEQUENCE_INVALID",
  );
});

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
