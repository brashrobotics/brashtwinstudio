const REPLAY_VERSION = "brash.fleet-live-replay/v1";
const OVERLAY_VERSION = "brash.fleet-live-overlay/v1";
const ROUTE_STATES = new Set(["PLANNED", "RESERVED", "ACTIVE", "DELAYED", "SAFETY_HOLD"]);
const ALARM_SEVERITIES = new Set(["INFO", "WARNING", "CRITICAL"]);

export class FleetReplayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FleetReplayError";
    this.code = code;
  }
}

export function validateFleetReplay(replay, { manifest, topology, frames, assets } = {}) {
  if (!isRecord(replay) || replay.schemaVersion !== REPLAY_VERSION) fail("FLEET_REPLAY_SCHEMA_UNSUPPORTED", "Replay v1 is required.");
  for (const field of ["replayId", "mapReleaseId", "coordinateFrameId"]) requiredText(replay[field], field);
  const startedAt = timestamp(replay.startedAt, "startedAt");
  const endedAt = timestamp(replay.endedAt, "endedAt");
  if (endedAt <= startedAt) fail("FLEET_REPLAY_TIME_INVALID", "endedAt must follow startedAt.");
  if (!Array.isArray(replay.frames) || replay.frames.length < 2 || replay.frames.length > 10_000) {
    fail("FLEET_REPLAY_FRAMES_INVALID", "Replay must contain between 2 and 10,000 frames.");
  }
  if (manifest) {
    if (manifest.mapReleaseId !== replay.mapReleaseId) fail("FLEET_REPLAY_RELEASE_MISMATCH", "Replay and bundle release identities differ.");
    if (manifest.canonicalFrameId !== replay.coordinateFrameId) fail("FLEET_REPLAY_FRAME_MISMATCH", "Replay must use the bundle canonical frame.");
  }
  const knownFrames = new Set((frames?.frames ?? []).map((frame) => frame.frameId));
  if (frames && !knownFrames.has(replay.coordinateFrameId)) fail("FLEET_REPLAY_FRAME_UNKNOWN", "Replay coordinate frame is absent from the release.");
  const edgeIds = new Set((topology?.edges ?? []).map((edge) => edge.edgeId));
  const assetIds = new Set((assets?.assets ?? []).map((asset) => asset.assetId));
  let previousObservedAt = -Infinity;
  replay.frames.forEach((frame, index) => {
    validateOverlay(frame, {
      index,
      replay,
      edgeIds,
      assetIds,
      bounds: manifest?.bounds,
      startedAt,
      endedAt,
      previousObservedAt,
    });
    previousObservedAt = Date.parse(frame.observedAt);
  });
  return Object.freeze({
    valid: true,
    replayId: replay.replayId,
    mapReleaseId: replay.mapReleaseId,
    coordinateFrameId: replay.coordinateFrameId,
    frameCount: replay.frames.length,
    durationMilliseconds: endedAt - startedAt,
    robotIds: Object.freeze([...new Set(replay.frames.flatMap((frame) => frame.robots.map((robot) => robot.robotId)))].sort()),
  });
}

export function sampleFleetReplay(replay, progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    fail("FLEET_REPLAY_PROGRESS_INVALID", "Replay progress must be between zero and one.");
  }
  if (!Array.isArray(replay?.frames) || replay.frames.length < 2) fail("FLEET_REPLAY_FRAMES_INVALID", "Replay frames are unavailable.");
  const position = progress * (replay.frames.length - 1);
  const sourceIndex = Math.floor(position);
  const nextIndex = Math.min(replay.frames.length - 1, sourceIndex + 1);
  const alpha = position - sourceIndex;
  const source = replay.frames[sourceIndex];
  const next = replay.frames[nextIndex];
  const nextRobots = new Map(next.robots.map((robot) => [robot.robotId, robot]));
  const robots = source.robots.map((robot) => {
    const candidate = nextRobots.get(robot.robotId) ?? robot;
    return Object.freeze({
      ...robot,
      position: Object.freeze({
        x: interpolate(robot.position.x, candidate.position.x, alpha),
        y: interpolate(robot.position.y, candidate.position.y, alpha),
        z: interpolate(robot.position.z, candidate.position.z, alpha),
      }),
      orientation: Object.freeze(normalizeQuaternion({
        x: interpolate(robot.orientation.x, candidate.orientation.x, alpha),
        y: interpolate(robot.orientation.y, candidate.orientation.y, alpha),
        z: interpolate(robot.orientation.z, candidate.orientation.z, alpha),
        w: interpolate(robot.orientation.w, candidate.orientation.w, alpha),
      })),
    });
  });
  return Object.freeze({
    sourceSequence: source.sequence,
    nextSequence: next.sequence,
    alpha,
    observedAt: new Date(interpolate(Date.parse(source.observedAt), Date.parse(next.observedAt), alpha)).toISOString(),
    robots: Object.freeze(robots),
    routes: Object.freeze(structuredClone(alpha < 0.5 ? source.routes : next.routes)),
    alarms: Object.freeze(structuredClone(alpha < 0.5 ? source.alarms : next.alarms)),
  });
}

function validateOverlay(frame, context) {
  if (!isRecord(frame) || frame.schemaVersion !== OVERLAY_VERSION) fail("FLEET_OVERLAY_SCHEMA_UNSUPPORTED", `Frame ${context.index} is not overlay v1.`);
  if (frame.mapReleaseId !== context.replay.mapReleaseId) fail("FLEET_OVERLAY_RELEASE_MISMATCH", `Frame ${context.index} belongs to another release.`);
  if (frame.sequence !== context.index) fail("FLEET_OVERLAY_SEQUENCE_INVALID", `Frame ${context.index} must have sequence ${context.index}.`);
  const observedAt = timestamp(frame.observedAt, `frames[${context.index}].observedAt`);
  if (observedAt < context.startedAt || observedAt > context.endedAt || observedAt <= context.previousObservedAt) {
    fail("FLEET_OVERLAY_TIME_INVALID", `Frame ${context.index} time is outside or not increasing within replay bounds.`);
  }
  if (!Array.isArray(frame.robots) || !Array.isArray(frame.routes) || !Array.isArray(frame.alarms)) {
    fail("FLEET_OVERLAY_COLLECTION_INVALID", `Frame ${context.index} requires robot, route, and alarm arrays.`);
  }
  const robotIds = new Set();
  for (const robot of frame.robots) {
    requiredUnique(robot?.robotId, robotIds, "FLEET_ROBOT_ID_INVALID");
    if (robot.frameId !== context.replay.coordinateFrameId) fail("FLEET_ROBOT_FRAME_MISMATCH", `Robot ${robot.robotId} is outside the replay frame.`);
    vector3(robot.position, `robot ${robot.robotId} position`);
    quaternion(robot.orientation, `robot ${robot.robotId} orientation`);
    requiredText(robot.state, `robot ${robot.robotId} state`);
    timestamp(robot.poseObservedAt, `robot ${robot.robotId} poseObservedAt`);
    if (context.bounds && !insideBounds(robot.position, context.bounds)) fail("FLEET_ROBOT_OUT_OF_BOUNDS", `Robot ${robot.robotId} is outside the release bounds.`);
  }
  const routeIds = new Set();
  for (const route of frame.routes) {
    requiredUnique(route?.routeId, routeIds, "FLEET_ROUTE_ID_INVALID");
    if (!robotIds.has(route.robotId)) fail("FLEET_ROUTE_ROBOT_UNKNOWN", `Route ${route.routeId} references an unknown robot.`);
    if (!Array.isArray(route.edgeIds) || route.edgeIds.length === 0 || route.edgeIds.some((edgeId) => !context.edgeIds.has(edgeId))) {
      fail("FLEET_ROUTE_EDGE_UNKNOWN", `Route ${route.routeId} references an unknown or empty release edge list.`);
    }
    if (!ROUTE_STATES.has(route.state)) fail("FLEET_ROUTE_STATE_INVALID", `Route ${route.routeId} state is unsupported.`);
  }
  const alarmIds = new Set();
  for (const alarm of frame.alarms) {
    requiredUnique(alarm?.alarmId, alarmIds, "FLEET_ALARM_ID_INVALID");
    if (!ALARM_SEVERITIES.has(alarm.severity) || !requiredText(alarm.message, `alarm ${alarm.alarmId} message`)) {
      fail("FLEET_ALARM_INVALID", `Alarm ${alarm.alarmId} is invalid.`);
    }
    if (alarm.robotId !== undefined && !robotIds.has(alarm.robotId)) fail("FLEET_ALARM_ROBOT_UNKNOWN", `Alarm ${alarm.alarmId} references an unknown robot.`);
    if (alarm.assetId !== undefined && !context.assetIds.has(alarm.assetId)) fail("FLEET_ALARM_ASSET_UNKNOWN", `Alarm ${alarm.alarmId} references an unknown asset.`);
    if (alarm.edgeId !== undefined && !context.edgeIds.has(alarm.edgeId)) fail("FLEET_ALARM_EDGE_UNKNOWN", `Alarm ${alarm.alarmId} references an unknown edge.`);
  }
}

function requiredUnique(value, known, code) {
  requiredText(value, "identity");
  if (known.has(value)) fail(code, `Duplicate identity ${value}.`);
  known.add(value);
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") fail("FLEET_REPLAY_FIELD_REQUIRED", `${field} is required.`);
  return value;
}

function timestamp(value, field) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail("FLEET_REPLAY_TIME_INVALID", `${field} must be an ISO date-time.`);
  return time;
}

function vector3(value, field) {
  if (!isRecord(value) || ![value.x, value.y, value.z].every(Number.isFinite)) fail("FLEET_REPLAY_VECTOR_INVALID", `${field} must be finite.`);
}

function quaternion(value, field) {
  if (!isRecord(value) || ![value.x, value.y, value.z, value.w].every(Number.isFinite)) fail("FLEET_REPLAY_QUATERNION_INVALID", `${field} must be finite.`);
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (Math.abs(length - 1) > 0.001) fail("FLEET_REPLAY_QUATERNION_INVALID", `${field} must be normalized.`);
}

function normalizeQuaternion(value) {
  const length = Math.hypot(value.x, value.y, value.z, value.w) || 1;
  return { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length };
}

function insideBounds(position, bounds) {
  return ["x", "y", "z"].every((axis) => position[axis] >= bounds.minimum[axis] && position[axis] <= bounds.maximum[axis]);
}

function interpolate(left, right, alpha) {
  return left + (right - left) * alpha;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message) {
  throw new FleetReplayError(code, message);
}
