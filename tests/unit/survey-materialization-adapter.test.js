import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import {
  SurveyMaterializationAdapterError,
  createSurveyMaterializationPreview,
  serializeSurveyMaterializationPreview,
} from "@brash-twin/embodied-survey/materialization";

test("standardized survey streams produce a bounded deterministic preview", async () => {
  const fixture = surveyFixture();
  const preview = await createSurveyMaterializationPreview(fixture.snapshot, {
    openArtifactStream: fixture.openArtifactStream,
  });
  assert.equal(preview.schemaVersion, "brash.survey-materialization-preview/v2");
  assert.equal(preview.coordinateSystem.rootFrameId, "slam-map");
  assert.equal(preview.coordinateFrames.sampleCount, 3);
  assert.equal(preview.calibration.sensorCount, 2);
  assert.deepEqual(preview.calibration.modalities, { IMU: 1, LIDAR: 1 });
  assert.equal(preview.trajectory.sampleCount, 5);
  assert.equal(preview.trajectory.pathLengthMetres, 4.009975124);
  assert.deepEqual(preview.trajectory.positionBounds, {
    minimum: [0, 0, 0],
    maximum: [2, 2, 0.2],
  });
  assert.equal(preview.reconstruction.vertexCount, 6);
  assert.deepEqual(preview.reconstruction.bounds, {
    minimum: [-1, -2, 0],
    maximum: [3, 2, 2],
  });
  assert.equal(preview.reconstruction.preview.points.length, 6);
  assert.equal(preview.reconstruction.planProjection.method, "TRAJECTORY_ENVELOPE_XY");
  assert.equal(preview.reconstruction.planProjection.sourcePointCount, 6);
  assert.equal(preview.reconstruction.planProjection.projectedPointCount, 3);
  assert.ok(preview.reconstruction.planProjection.samples.length <= 4_096);
  assert.ok(preview.reconstruction.planProjection.columns * preview.reconstruction.planProjection.rows <= 4_096);
  assert.equal(preview.qualityWarnings.length, 0);
  assert.equal(Object.isFrozen(preview.reconstruction.preview.points), true);
  assert.ok(serializeSurveyMaterializationPreview(preview).byteLength < 4 * 1024 * 1024);
});

test("materialization rejects changed bytes and cross-frame reconstruction", async () => {
  const corrupted = surveyFixture();
  const trajectory = corrupted.snapshot.artifacts.find((artifact) => artifact.role === "TRAJECTORY");
  corrupted.content.set(trajectory.sha256, Buffer.from("changed"));
  await assert.rejects(
    () => createSurveyMaterializationPreview(corrupted.snapshot, {
      openArtifactStream: corrupted.openArtifactStream,
    }),
    (error) => error instanceof SurveyMaterializationAdapterError
      && ["SURVEY_ARTIFACT_SIZE_MISMATCH", "SURVEY_ARTIFACT_INTEGRITY_FAILED"].includes(error.code),
  );

  const mismatched = surveyFixture();
  mismatched.snapshot.artifacts.find((artifact) => artifact.role === "POINT_CLOUD_MAP").frameId = "other-map";
  await assert.rejects(
    () => createSurveyMaterializationPreview(mismatched.snapshot, {
      openArtifactStream: mismatched.openArtifactStream,
    }),
    (error) => error instanceof SurveyMaterializationAdapterError
      && error.code === "SURVEY_SPATIAL_FRAME_MISMATCH",
  );
});

test("trajectory record and PLY vertex limits fail before unbounded processing", async () => {
  const fixture = surveyFixture();
  await assert.rejects(
    () => createSurveyMaterializationPreview(fixture.snapshot, {
      openArtifactStream: fixture.openArtifactStream,
      limits: { maximumTrajectoryPoses: 4 },
    }),
    (error) => error instanceof SurveyMaterializationAdapterError
      && error.code === "SURVEY_TRAJECTORY_LIMIT_INVALID",
  );
  await assert.rejects(
    () => createSurveyMaterializationPreview(fixture.snapshot, {
      openArtifactStream: fixture.openArtifactStream,
      limits: { maximumPointCloudVertices: 5 },
    }),
    (error) => error instanceof SurveyMaterializationAdapterError
      && error.code === "SURVEY_POINT_CLOUD_LIMIT_EXCEEDED",
  );
});

test("materialization rejects a point cloud with no evidence near the trajectory", async () => {
  const fixture = surveyFixture();
  const pointCloud = fixture.snapshot.artifacts.find((artifact) => artifact.role === "POINT_CLOUD_MAP");
  fixture.content.delete(pointCloud.sha256);
  const farPly = binaryPly([[100, 100, 100, 1], [101, 101, 101, 2]]);
  pointCloud.sha256 = createHash("sha256").update(farPly).digest("hex");
  pointCloud.bytes = farPly.byteLength;
  fixture.content.set(pointCloud.sha256, farPly);
  await assert.rejects(
    () => createSurveyMaterializationPreview(fixture.snapshot, {
      openArtifactStream: fixture.openArtifactStream,
    }),
    (error) => error instanceof SurveyMaterializationAdapterError
      && error.code === "SURVEY_PLAN_PROJECTION_EMPTY",
  );
});

function surveyFixture() {
  const content = new Map();
  const frames = Buffer.from(JSON.stringify({
    schemaVersion: "brash.survey-coordinate-frames/v1",
    rootFrameId: "slam-map",
    frames: [
      frame("slam-map", null, [0, 0, 0]),
      frame("base-link", "slam-map", [0, 0, 0.4]),
      frame("lidar-link", "base-link", [0.2, 0, 0.3]),
    ],
  }));
  const calibration = Buffer.from(JSON.stringify({
    schemaVersion: "brash.survey-calibration/v1",
    calibrationId: "demo-calibration",
    sensors: [
      sensor("lidar-main", "lidar-link", "LIDAR", "hesai-xt32", "1"),
      sensor("imu-main", "base-link", "IMU", "hg4930", "2"),
    ],
  }));
  const trajectory = Buffer.from([
    "1000 0 0 0 0 0 0 1",
    "1000.1 1 0 0 0 0 0 1",
    "1000.2 2 0 0.1 0 0 0 1",
    "1000.3 2 1 0.1 0 0 0 1",
    "1000.4 2 2 0.2 0 0 0 1",
    "",
  ].join("\n"));
  const ply = binaryPly([
    [-1, -2, 0, 1],
    [0, 0, 0.5, 10],
    [1, 1, 1, 20],
    [2, 2, 1.5, 30],
    [3, -1, 2, 40],
    [1, -2, 0.25, 50],
  ]);
  const artifacts = [
    artifact(content, "frames-1", "COORDINATE_FRAMES", "application/vnd.brash.survey-coordinate-frames+json", frames),
    artifact(content, "calibration-1", "CALIBRATION", "application/vnd.brash.survey-calibration+json", calibration),
    { ...artifact(content, "trajectory-1", "TRAJECTORY", "application/vnd.brash.trajectory+tum", trajectory), frameId: "slam-map" },
    { ...artifact(content, "point-cloud-1", "POINT_CLOUD_MAP", "model/vnd.ply", ply), frameId: "slam-map" },
  ];
  const fixture = {
    content,
    snapshot: {
      schemaVersion: "brash.survey-materialization-snapshot/v1",
      intakeId: "intake-1",
      draftId: "draft-1",
      manifestSha256: "a".repeat(64),
      capture: {
        startedAt: "2026-08-14T08:00:00.000Z",
        completedAt: "2026-08-14T08:00:01.000Z",
      },
      coordinateSystem: {
        rootFrameId: "slam-map",
        lengthUnit: "METRE",
        handedness: "RIGHT_HANDED",
        upAxis: "Z",
      },
      quality: { outcome: "PASSED", trajectoryPoseCount: 5 },
      artifacts,
    },
  };
  fixture.openArtifactStream = async (sha256) => {
    const value = content.get(sha256);
    if (!value) throw new Error(`Missing test artifact ${sha256}.`);
    const middle = Math.max(1, Math.floor(value.byteLength / 2));
    return Readable.from([value.subarray(0, middle), value.subarray(middle)]);
  };
  return fixture;
}

function frame(frameId, parentFrameId, [x, y, z]) {
  return {
    frameId,
    parentFrameId,
    transformToParent: {
      translation: { x, y, z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
  };
}

function sensor(sensorId, frameId, modality, model, hashDigit) {
  return { sensorId, frameId, modality, model, parametersSha256: hashDigit.repeat(64) };
}

function artifact(content, artifactId, role, mediaType, value) {
  const sha256 = createHash("sha256").update(value).digest("hex");
  content.set(sha256, value);
  return { artifactId, role, mediaType, sha256, bytes: value.byteLength };
}

function binaryPly(points) {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property float intensity",
    "end_header",
    "",
  ].join("\n"));
  const body = Buffer.alloc(points.length * 16);
  points.forEach((point, index) => point.forEach((value, component) => {
    body.writeFloatLE(value, index * 16 + component * 4);
  }));
  return Buffer.concat([header, body]);
}
