import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SampledFleetReplay } from "@brash-twin/fleet-replay";
import { demoData, tileUrl } from "./demo-data";

interface Runtime {
  robot: THREE.Group;
  routeLines: Map<string, THREE.Line>;
  alarmBoxes: THREE.Object3D[];
}

export function FleetScene({ sample }: { sample: SampledFleetReplay }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setError("WebGL is unavailable in this browser.");
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071012);
    scene.fog = new THREE.Fog(0x071012, 32, 75);
    const camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.05, 250);
    camera.position.set(26, 28, 31);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(15, 0, -8);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 5;
    controls.maxDistance = 90;
    scene.add(new THREE.HemisphereLight(0xc8ffff, 0x172327, 2.2));
    const directional = new THREE.DirectionalLight(0xffffff, 2.5);
    directional.position.set(14, 30, 12);
    scene.add(directional);
    const grid = new THREE.GridHelper(64, 64, 0x215459, 0x153236);
    grid.position.set(15, -0.02, -10);
    scene.add(grid);

    const routeLines = new Map<string, THREE.Line>();
    const nodes = new Map(demoData.topology.nodes.map((node) => [node.nodeId, node]));
    for (const edge of demoData.topology.edges) {
      const from = nodes.get(edge.fromNodeId)!;
      const to = nodes.get(edge.toNodeId)!;
      const geometry = new THREE.BufferGeometry().setFromPoints([world(from.position), world(to.position)]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x294b50, transparent: true, opacity: 0.8 }));
      line.position.y += 0.1;
      scene.add(line);
      routeLines.set(edge.edgeId, line);
    }

    const robot = createRobot();
    scene.add(robot);
    const alarmBoxes: THREE.Object3D[] = [];
    for (const asset of demoData.assets.assets) {
      const size = new THREE.Vector3(
        asset.bounds3d.maximum.x - asset.bounds3d.minimum.x,
        asset.bounds3d.maximum.z - asset.bounds3d.minimum.z,
        asset.bounds3d.maximum.y - asset.bounds3d.minimum.y,
      );
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
        new THREE.LineBasicMaterial({ color: 0xff4d55, transparent: true, opacity: 0 }),
      );
      box.name = asset.assetId;
      box.position.set(
        (asset.bounds3d.minimum.x + asset.bounds3d.maximum.x) / 2,
        (asset.bounds3d.minimum.z + asset.bounds3d.maximum.z) / 2,
        -(asset.bounds3d.minimum.y + asset.bounds3d.maximum.y) / 2,
      );
      scene.add(box);
      alarmBoxes.push(box);
    }
    runtimeRef.current = { robot, routeLines, alarmBoxes };

    const loader = new GLTFLoader();
    for (const tile of demoData.sceneManifest.tiles) {
      const level = tile.levels.find((candidate) => candidate.level === 0) ?? tile.levels[0];
      const url = tileUrl(level.path);
      if (!url) {
        setError(`Scene tile URL is missing for ${level.path}.`);
        continue;
      }
      loader.load(url, (gltf) => {
        if (disposed) return;
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.frustumCulled = true;
            object.castShadow = false;
            object.receiveShadow = false;
          }
        });
        scene.add(gltf.scene);
      }, undefined, () => {
        if (!disposed) setError(`Unable to load ${level.path}.`);
      });
    }

    const resize = new ResizeObserver(() => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(container);
    let animation = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animation = requestAnimationFrame(render);
    };
    render();
    return () => {
      disposed = true;
      runtimeRef.current = null;
      cancelAnimationFrame(animation);
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const robot = sample.robots[0];
    if (!runtime || !robot) return;
    runtime.robot.position.copy(world(robot.position));
    runtime.robot.quaternion.set(robot.orientation.x, robot.orientation.z, -robot.orientation.y, robot.orientation.w);
    const activeEdges = new Set(sample.routes.flatMap((route: any) => route.edgeIds));
    for (const [edgeId, line] of runtime.routeLines) {
      const active = activeEdges.has(edgeId);
      (line.material as THREE.LineBasicMaterial).color.set(active ? 0x2ff0d0 : 0x294b50);
      (line.material as THREE.LineBasicMaterial).opacity = active ? 1 : 0.55;
    }
    const alarmAssets = new Set(sample.alarms.map((alarm: any) => alarm.assetId).filter(Boolean));
    runtime.alarmBoxes.forEach((box) => {
      ((box as THREE.LineSegments).material as THREE.LineBasicMaterial).opacity = alarmAssets.has(box.name) ? 1 : 0;
      box.visible = alarmAssets.has(box.name);
    });
  }, [sample]);

  return <div className="fleet-canvas" ref={containerRef}>{error && <div className="canvas-error">{error}</div>}</div>;
}

function createRobot() {
  const group = new THREE.Group();
  group.name = "brash-amr-01";
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.52, 0.72),
    new THREE.MeshStandardMaterial({ color: 0xff7a28, roughness: 0.34, metalness: 0.45 }),
  );
  body.position.y = 0.34;
  group.add(body);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.42, 18),
    new THREE.MeshStandardMaterial({ color: 0xe9fbff, emissive: 0x2ff0d0, emissiveIntensity: 0.45 }),
  );
  mast.position.set(0, 0.78, 0);
  group.add(mast);
  const direction = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.42, 3),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  direction.rotation.z = -Math.PI / 2;
  direction.position.set(0.68, 0.42, 0);
  group.add(direction);
  return group;
}

function world(position: { x: number; y: number; z: number }) {
  return new THREE.Vector3(position.x, position.z, -position.y);
}
