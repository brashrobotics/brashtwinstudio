const EPSILON = 1e-12;

export const IDENTITY_TRANSFORM = Object.freeze({
  translation: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  scale: 1,
});

export class CoordinateFrameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoordinateFrameError";
    this.code = code;
  }
}

export function normalizeTransform(transform) {
  if (!transform || typeof transform !== "object") {
    throw new CoordinateFrameError("TRANSFORM_REQUIRED", "A transform is required.");
  }
  const translation = vector3(transform.translation, "translation");
  const rotation = normalizeQuaternion(transform.rotation);
  const scale = transform.scale ?? 1;
  if (!Number.isFinite(scale) || scale < EPSILON) {
    throw new CoordinateFrameError("TRANSFORM_SCALE_INVALID", "Transform scale must be finite and positive.");
  }
  return { translation, rotation, scale };
}

export function applyTransform(transform, point) {
  const normalized = normalizeTransform(transform);
  const value = vector3(point, "point");
  const scaled = scaleVector(value, normalized.scale);
  return addVectors(rotateVector(normalized.rotation, scaled), normalized.translation);
}

// Returns a transform that applies `first`, then `second`.
export function composeTransforms(first, second) {
  const left = normalizeTransform(first);
  const right = normalizeTransform(second);
  return normalizeTransform({
    translation: addVectors(
      right.translation,
      rotateVector(right.rotation, scaleVector(left.translation, right.scale)),
    ),
    rotation: multiplyQuaternions(right.rotation, left.rotation),
    scale: left.scale * right.scale,
  });
}

export function invertTransform(transform) {
  const normalized = normalizeTransform(transform);
  const inverseRotation = conjugateQuaternion(normalized.rotation);
  const inverseScale = 1 / normalized.scale;
  return normalizeTransform({
    translation: scaleVector(rotateVector(inverseRotation, normalized.translation), -inverseScale),
    rotation: inverseRotation,
    scale: inverseScale,
  });
}

export class CoordinateFrameGraph {
  #frames;

  constructor(frames) {
    if (!Array.isArray(frames) || frames.length === 0) {
      throw new CoordinateFrameError("FRAME_REQUIRED", "At least one coordinate frame is required.");
    }
    this.#frames = new Map();
    for (const frame of frames) {
      if (!frame || typeof frame.frameId !== "string" || frame.frameId.trim() === "") {
        throw new CoordinateFrameError("FRAME_ID_REQUIRED", "Every coordinate frame requires an ID.");
      }
      if (this.#frames.has(frame.frameId)) {
        throw new CoordinateFrameError("FRAME_ID_DUPLICATE", `Duplicate coordinate frame ${frame.frameId}.`);
      }
      this.#frames.set(frame.frameId, {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId ?? null,
        transformToParent: normalizeTransform(frame.transformToParent ?? IDENTITY_TRANSFORM),
      });
    }
    for (const frame of this.#frames.values()) {
      if (frame.parentFrameId && !this.#frames.has(frame.parentFrameId)) {
        throw new CoordinateFrameError(
          "FRAME_PARENT_UNKNOWN",
          `Coordinate frame ${frame.frameId} references unknown parent ${frame.parentFrameId}.`,
        );
      }
    }
    for (const frameId of this.#frames.keys()) this.#lineage(frameId);
  }

  has(frameId) {
    return this.#frames.has(frameId);
  }

  transformBetween(sourceFrameId, targetFrameId) {
    const source = this.#toRoot(sourceFrameId);
    const target = this.#toRoot(targetFrameId);
    if (source.rootFrameId !== target.rootFrameId) {
      throw new CoordinateFrameError(
        "FRAME_ROOT_MISMATCH",
        `${sourceFrameId} and ${targetFrameId} do not share a coordinate-frame root.`,
      );
    }
    return composeTransforms(source.transform, invertTransform(target.transform));
  }

  transformPoint(point, sourceFrameId, targetFrameId) {
    return applyTransform(this.transformBetween(sourceFrameId, targetFrameId), point);
  }

  #toRoot(frameId) {
    const lineage = this.#lineage(frameId);
    let transform = IDENTITY_TRANSFORM;
    for (let index = 0; index < lineage.length - 1; index += 1) {
      transform = composeTransforms(transform, lineage[index].transformToParent);
    }
    return { rootFrameId: lineage.at(-1).frameId, transform };
  }

  #lineage(frameId) {
    const first = this.#frames.get(frameId);
    if (!first) throw new CoordinateFrameError("FRAME_NOT_FOUND", `Coordinate frame ${frameId} was not found.`);
    const seen = new Set();
    const lineage = [];
    let frame = first;
    while (frame) {
      if (seen.has(frame.frameId)) {
        throw new CoordinateFrameError("FRAME_CYCLE", `Coordinate frame cycle detected at ${frame.frameId}.`);
      }
      seen.add(frame.frameId);
      lineage.push(frame);
      frame = frame.parentFrameId ? this.#frames.get(frame.parentFrameId) : null;
    }
    return lineage;
  }
}

function vector3(value, fieldName) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new CoordinateFrameError("VECTOR_INVALID", `${fieldName} must contain finite x, y, and z values.`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

function normalizeQuaternion(value) {
  if (!value || ![value.x, value.y, value.z, value.w].every(Number.isFinite)) {
    throw new CoordinateFrameError("QUATERNION_INVALID", "Rotation must contain finite x, y, z, and w values.");
  }
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (length < EPSILON) {
    throw new CoordinateFrameError("QUATERNION_ZERO", "Rotation quaternion cannot be zero.");
  }
  return { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length };
}

function multiplyQuaternions(left, right) {
  return {
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  };
}

function conjugateQuaternion(value) {
  return { x: -value.x, y: -value.y, z: -value.z, w: value.w };
}

function rotateVector(rotation, value) {
  const vectorQuaternion = { x: value.x, y: value.y, z: value.z, w: 0 };
  const rotated = multiplyQuaternions(
    multiplyQuaternions(rotation, vectorQuaternion),
    conjugateQuaternion(rotation),
  );
  return { x: rotated.x, y: rotated.y, z: rotated.z };
}

function addVectors(left, right) {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function scaleVector(value, scale) {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}
