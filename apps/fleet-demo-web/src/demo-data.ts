import manifest from "../../../tests/fixtures/bundles/demo-plant@2/manifest.json";
import sceneManifest from "../../../tests/fixtures/bundles/demo-plant@2/scene/manifest.json";
import topology from "../../../tests/fixtures/bundles/demo-plant@2/topology.json";
import coordinateFrames from "../../../tests/fixtures/bundles/demo-plant@2/coordinate-frames.json";
import assets from "../../../tests/fixtures/bundles/demo-plant@2/assets.json";
import replay from "../../../tests/fixtures/fleet-demo/demo-mission-replay.v1.json";

export const demoData = Object.freeze({ manifest, sceneManifest, topology, coordinateFrames, assets, replay });

export const sceneTileUrls = import.meta.glob(
  "../../../tests/fixtures/bundles/demo-plant@2/scene/tiles/*.glb",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

export function tileUrl(path: string): string | null {
  const entry = Object.entries(sceneTileUrls).find(([sourcePath]) => sourcePath.endsWith(path.replace("scene/tiles/", "")));
  return entry?.[1] ?? null;
}
