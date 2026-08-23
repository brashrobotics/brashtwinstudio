import { describe, expect, it } from "vitest";
import { sampleFleetReplay, validateFleetReplay } from "@brash-twin/fleet-replay";
import { demoData, tileUrl } from "./demo-data";

describe("Fleet integration demo fixtures", () => {
  it("binds replay and scene tiles to one immutable map release", () => {
    const validation = validateFleetReplay(demoData.replay, {
      manifest: demoData.manifest,
      topology: demoData.topology,
      frames: demoData.coordinateFrames,
      assets: demoData.assets,
    });
    expect(validation.frameCount).toBe(6);
    expect(demoData.sceneManifest.mapReleaseId).toBe(validation.mapReleaseId);
    expect(demoData.sceneManifest.tiles.every((tile) => tileUrl(tile.levels[0].path))).toBe(true);
  });

  it("interpolates canonical robot position without mutating source frames", () => {
    const before = structuredClone(demoData.replay.frames);
    const sample = sampleFleetReplay(demoData.replay, 0.5);
    expect(sample.robots[0].position).toEqual({ x: 14, y: 4, z: 0.45 });
    expect(demoData.replay.frames).toEqual(before);
  });
});
