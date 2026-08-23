export interface FleetReplayValidation {
  readonly valid: true;
  readonly replayId: string;
  readonly mapReleaseId: string;
  readonly coordinateFrameId: string;
  readonly frameCount: number;
  readonly durationMilliseconds: number;
  readonly robotIds: readonly string[];
}

export interface SampledFleetReplay {
  readonly sourceSequence: number;
  readonly nextSequence: number;
  readonly alpha: number;
  readonly observedAt: string;
  readonly robots: readonly any[];
  readonly routes: readonly any[];
  readonly alarms: readonly any[];
}

export class FleetReplayError extends Error {
  readonly code: string;
}

export function validateFleetReplay(replay: any, context?: {
  manifest?: any;
  topology?: any;
  frames?: any;
  assets?: any;
}): FleetReplayValidation;

export function sampleFleetReplay(replay: any, progress: number): SampledFleetReplay;
