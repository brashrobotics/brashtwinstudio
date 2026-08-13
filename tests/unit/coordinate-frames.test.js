import assert from "node:assert/strict";
import test from "node:test";
import {
  CoordinateFrameError,
  CoordinateFrameGraph,
  applyTransform,
  composeTransforms,
  invertTransform,
} from "@brash-twin/coordinate-frames";

const identityRotation = { x: 0, y: 0, z: 0, w: 1 };

test("compose and inverse preserve a 3D point", () => {
  const first = {
    translation: { x: 10, y: -2, z: 1 },
    rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
    scale: 2,
  };
  const second = {
    translation: { x: 4, y: 3, z: 0 },
    rotation: identityRotation,
    scale: 0.5,
  };
  const composed = composeTransforms(first, second);
  const point = { x: 1, y: 2, z: 3 };
  const sequential = applyTransform(second, applyTransform(first, point));
  assertPointClose(applyTransform(composed, point), sequential);
  assertPointClose(applyTransform(invertTransform(composed), sequential), point);
});

test("frame graph resolves vendor and sensor coordinates into canonical space", () => {
  const graph = new CoordinateFrameGraph([
    {
      frameId: "plant/floor-1",
      parentFrameId: null,
      transformToParent: { translation: { x: 0, y: 0, z: 0 }, rotation: identityRotation, scale: 1 },
    },
    {
      frameId: "vendor-map",
      parentFrameId: "plant/floor-1",
      transformToParent: { translation: { x: 10, y: 5, z: 0 }, rotation: identityRotation, scale: 1 },
    },
    {
      frameId: "camera",
      parentFrameId: "vendor-map",
      transformToParent: { translation: { x: 1, y: 0, z: 1.5 }, rotation: identityRotation, scale: 1 },
    },
  ]);

  assert.deepEqual(
    graph.transformPoint({ x: 2, y: 3, z: 0 }, "camera", "plant/floor-1"),
    { x: 13, y: 8, z: 1.5 },
  );
  assertPointClose(
    graph.transformPoint({ x: 13, y: 8, z: 1.5 }, "plant/floor-1", "camera"),
    { x: 2, y: 3, z: 0 },
  );
});

test("frame graph rejects cycles", () => {
  assert.throws(
    () => new CoordinateFrameGraph([
      { frameId: "a", parentFrameId: "b", transformToParent: identity() },
      { frameId: "b", parentFrameId: "a", transformToParent: identity() },
    ]),
    (error) => error instanceof CoordinateFrameError && error.code === "FRAME_CYCLE",
  );
});

function identity() {
  return { translation: { x: 0, y: 0, z: 0 }, rotation: identityRotation, scale: 1 };
}

function assertPointClose(actual, expected) {
  for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9, `${axis}: ${actual[axis]} != ${expected[axis]}`);
}
