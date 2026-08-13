import {
  AmbientLight,
  Box3,
  Box3Helper,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ViewerMode, WorldEntity, WorldSnapshot, WorldStore } from "@brash-twin/viewer-sdk";

const MAX_DRAWING_BUFFER_PIXELS = 2_400_000;

export interface DrawingBufferSize {
  width: number;
  height: number;
  scale: number;
}

export interface WorldInteraction {
  position: { x: number; y: number; z: number } | null;
  entityId: string | null;
}

export interface ThreeWorldRuntimeOptions {
  onWorldClick?(interaction: WorldInteraction): boolean;
}

export function boundedDrawingBuffer(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maximumPixels = MAX_DRAWING_BUFFER_PIXELS,
): DrawingBufferSize {
  const safeWidth = Math.max(1, Math.floor(cssWidth));
  const safeHeight = Math.max(1, Math.floor(cssHeight));
  const safeRatio = Number.isFinite(devicePixelRatio) ? Math.min(3, Math.max(1, devicePixelRatio)) : 1;
  const requestedWidth = Math.floor(safeWidth * safeRatio);
  const requestedHeight = Math.floor(safeHeight * safeRatio);
  const requestedPixels = requestedWidth * requestedHeight;
  const scale = requestedPixels > maximumPixels ? Math.sqrt(maximumPixels / requestedPixels) : 1;
  return {
    width: Math.max(1, Math.floor(requestedWidth * scale)),
    height: Math.max(1, Math.floor(requestedHeight * scale)),
    scale,
  };
}

export class ThreeWorldRuntime {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly perspectiveCamera = new PerspectiveCamera(48, 1, 0.05, 2_000);
  readonly orthographicCamera = new OrthographicCamera(-20, 20, 12, -12, 0.05, 2_000);
  #camera: Camera;
  #controls: OrbitControls;
  #mode: ViewerMode;
  #store: WorldStore;
  #canvas: HTMLCanvasElement;
  #world = new Group();
  #pickTargets: Object3D[] = [];
  #raycaster = new Raycaster();
  #pointer = new Vector2();
  #floorPlane = new Plane(new Vector3(0, 0, 1), 0);
  #selectionHelper: Box3Helper | null = null;
  #geometryFingerprint = "";
  #selectedEntityId: string | null = null;
  #resizeObserver: ResizeObserver;
  #frame: number | null = null;
  #disposed = false;
  #onWorldClick: ThreeWorldRuntimeOptions["onWorldClick"];
  #handleControlsChange = (): void => this.invalidate();

  constructor(canvas: HTMLCanvasElement, store: WorldStore, options: ThreeWorldRuntimeOptions = {}) {
    this.#canvas = canvas;
    this.#store = store;
    this.#onWorldClick = options.onWorldClick;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0x0b1014, 1);
    this.scene.background = new Color(0x0b1014);
    this.scene.add(this.#world);
    this.scene.add(new AmbientLight(0xb8c2c8, 1.7));
    const keyLight = new DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(8, -10, 20);
    this.scene.add(keyLight);
    const grid = new GridHelper(40, 40, 0x35434c, 0x1c272e);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.015;
    this.scene.add(grid);

    this.perspectiveCamera.up.set(0, 0, 1);
    this.perspectiveCamera.position.set(25, -28, 23);
    this.perspectiveCamera.lookAt(0, 0, 0);
    this.orthographicCamera.up.set(0, 1, 0);
    this.orthographicCamera.position.set(0, 0, 50);
    this.orthographicCamera.lookAt(0, 0, 0);
    this.#mode = store.getSnapshot().viewMode;
    this.#camera = this.#mode === "2D" ? this.orthographicCamera : this.perspectiveCamera;
    this.#controls = this.#createControls(this.#camera, this.#mode);
    this.#resizeObserver = new ResizeObserver(() => this.resize());
    this.#resizeObserver.observe(canvas);
    canvas.addEventListener("pointermove", this.#handlePointerMove);
    canvas.addEventListener("pointerleave", this.#handlePointerLeave);
    canvas.addEventListener("click", this.#handleClick);
    this.#raycaster.params.Line = { threshold: 0.35 };
    this.resize();
    this.sync(store.getSnapshot());
  }

  sync(snapshot: WorldSnapshot): void {
    if (snapshot.viewMode !== this.#mode) this.#switchMode(snapshot.viewMode);
    const fingerprint = JSON.stringify({
      layers: snapshot.layers,
      entities: snapshot.entities,
    });
    if (fingerprint !== this.#geometryFingerprint) {
      this.#geometryFingerprint = fingerprint;
      this.#rebuildWorld(snapshot);
    }
    if (snapshot.selectedEntityId !== this.#selectedEntityId) {
      this.#selectedEntityId = snapshot.selectedEntityId;
      this.#updateSelection(snapshot.selectedEntityId);
    }
    this.invalidate();
  }

  resize(): void {
    if (this.#disposed) return;
    const width = Math.max(1, this.#canvas.clientWidth);
    const height = Math.max(1, this.#canvas.clientHeight);
    const buffer = boundedDrawingBuffer(width, height, window.devicePixelRatio);
    this.renderer.setSize(buffer.width, buffer.height, false);
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    const viewHeight = 26;
    const viewWidth = viewHeight * (width / height);
    this.orthographicCamera.left = -viewWidth / 2;
    this.orthographicCamera.right = viewWidth / 2;
    this.orthographicCamera.top = viewHeight / 2;
    this.orthographicCamera.bottom = -viewHeight / 2;
    this.orthographicCamera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate(): void {
    if (this.#disposed || this.#frame !== null) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      this.#controls.update();
      this.renderer.render(this.scene, this.#camera);
    });
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#resizeObserver.disconnect();
    this.#controls.dispose();
    this.#canvas.removeEventListener("pointermove", this.#handlePointerMove);
    this.#canvas.removeEventListener("pointerleave", this.#handlePointerLeave);
    this.#canvas.removeEventListener("click", this.#handleClick);
    this.#disposeWorld();
    this.renderer.dispose();
  }

  #createControls(camera: Camera, mode: ViewerMode): OrbitControls {
    const controls = new OrbitControls(camera, this.#canvas);
    controls.target.set(0, 0, 0);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.minDistance = 2;
    controls.maxDistance = 180;
    controls.minZoom = 0.25;
    controls.maxZoom = 12;
    if (mode === "2D") {
      controls.enableRotate = false;
      controls.mouseButtons.LEFT = MOUSE.PAN;
      controls.mouseButtons.RIGHT = MOUSE.PAN;
    }
    controls.addEventListener("change", this.#handleControlsChange);
    return controls;
  }

  #switchMode(mode: ViewerMode): void {
    const target = this.#controls.target.clone();
    this.#controls.removeEventListener("change", this.#handleControlsChange);
    this.#controls.dispose();
    this.#mode = mode;
    this.#camera = mode === "2D" ? this.orthographicCamera : this.perspectiveCamera;
    this.#controls = this.#createControls(this.#camera, mode);
    this.#controls.target.copy(target);
    this.#controls.update();
  }

  #rebuildWorld(snapshot: WorldSnapshot): void {
    this.#disposeWorld();
    const layers = new Map(snapshot.layers.map((layer) => [layer.layerId, layer]));
    const groups = new Map<string, Group>();
    for (const layer of snapshot.layers) {
      const group = new Group();
      group.name = layer.layerId;
      group.visible = layer.visible;
      groups.set(layer.layerId, group);
      this.#world.add(group);
    }
    for (const entity of snapshot.entities) {
      const layer = layers.get(entity.layerId);
      const group = groups.get(entity.layerId);
      if (!layer || !group) continue;
      const object = createEntityObject(entity, layer.color, layer.kind === "ZONE");
      object.userData.entityId = entity.entityId;
      object.userData.selectable = layer.selectable;
      object.name = entity.label;
      object.position.set(entity.position.x, entity.position.y, entity.position.z);
      object.rotation.z = entity.rotationZ ?? 0;
      group.add(object);
      if (layer.selectable) this.#pickTargets.push(object);
    }
    this.#updateSelection(snapshot.selectedEntityId);
  }

  #disposeWorld(): void {
    if (this.#selectionHelper) {
      this.scene.remove(this.#selectionHelper);
      disposeMaterial(this.#selectionHelper.material);
      this.#selectionHelper = null;
    }
    this.#world.traverse((object) => {
      const candidate = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
      candidate.geometry?.dispose();
      if (Array.isArray(candidate.material)) candidate.material.forEach((material) => material.dispose());
      else candidate.material?.dispose();
    });
    this.#world.clear();
    this.#pickTargets = [];
  }

  #updateSelection(entityId: string | null): void {
    if (this.#selectionHelper) {
      this.scene.remove(this.#selectionHelper);
      disposeMaterial(this.#selectionHelper.material);
      this.#selectionHelper = null;
    }
    if (entityId === null) return;
    const object = this.#pickTargets.find((candidate) => candidate.userData.entityId === entityId);
    if (!object) return;
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) return;
    this.#selectionHelper = new Box3Helper(box, 0xb9f227);
    this.scene.add(this.#selectionHelper);
  }

  #setPointer(event: PointerEvent): void {
    const bounds = this.#canvas.getBoundingClientRect();
    this.#pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.#pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  }

  #handlePointerMove = (event: PointerEvent): void => {
    this.#setPointer(event);
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const hit = this.#raycaster.ray.intersectPlane(this.#floorPlane, new Vector3());
    this.#store.setPointerWorld(hit ? { x: hit.x, y: hit.y, z: 0 } : null);
  };

  #handlePointerLeave = (): void => {
    this.#store.setPointerWorld(null);
  };

  #handleClick = (event: MouseEvent): void => {
    this.#setPointer(event as PointerEvent);
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const intersections = this.#raycaster.intersectObjects(this.#pickTargets, true);
    const hit = intersections.find((intersection) => entityIdFromObject(intersection.object));
    const entityId = hit ? entityIdFromObject(hit.object) : null;
    const floorHit = this.#raycaster.ray.intersectPlane(this.#floorPlane, new Vector3());
    const consumed = this.#onWorldClick?.({
      entityId,
      position: floorHit ? { x: floorHit.x, y: floorHit.y, z: 0 } : null,
    }) ?? false;
    if (!consumed) this.#store.selectEntity(entityId);
  };
}

function createEntityObject(entity: WorldEntity, color: string, transparent: boolean): Object3D {
  const tint = new Color(color);
  if (entity.geometry.type === "BOX") {
    const geometry = new BoxGeometry(entity.geometry.size.x, entity.geometry.size.y, entity.geometry.size.z);
    const mesh = new Mesh(geometry, new MeshStandardMaterial({
      color: tint,
      metalness: 0.12,
      roughness: 0.7,
      transparent: true,
      opacity: 0.72,
    }));
    const edges = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: tint }));
    mesh.add(edges);
    return mesh;
  }
  if (entity.geometry.type === "POINT") {
    return new Mesh(
      new SphereGeometry(entity.geometry.radius, 16, 10),
      new MeshBasicMaterial({ color: tint }),
    );
  }
  if (entity.geometry.type === "POLYGON") {
    const shape = new Shape();
    entity.geometry.points.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, point.y);
      else shape.lineTo(point.x, point.y);
    });
    shape.closePath();
    return new Mesh(
      new ShapeGeometry(shape),
      new MeshBasicMaterial({ color: tint, transparent: true, opacity: transparent ? 0.14 : 0.25, side: DoubleSide }),
    );
  }
  const points = entity.geometry.points.map((point) => new Vector3(point.x, point.y, point.z));
  if (entity.geometry.closed) points.push(points[0]?.clone() ?? new Vector3());
  return new Line(
    new BufferGeometry().setFromPoints(points),
    new LineBasicMaterial({ color: tint }),
  );
}

function entityIdFromObject(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    if (typeof current.userData.entityId === "string") return current.userData.entityId;
    current = current.parent;
  }
  return null;
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) material.forEach((candidate) => candidate.dispose());
  else material.dispose();
}
