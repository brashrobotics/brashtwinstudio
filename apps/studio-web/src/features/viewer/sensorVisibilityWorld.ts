import type { WorldEntity } from "@brash-twin/viewer-sdk";
import type { SensorVisibilityRecord } from "../../api/types";

export function sensorVisibilityWorldEntities(visibility: SensorVisibilityRecord): WorldEntity[] {
  const minimumConfidence = visibility.report.qualification.minimumVisibilityConfidence;
  return visibility.report.coverage.cells.map((cell) => ({
    entityId: `sensor-visibility-${cell.cellId}`,
    layerId: "visibility",
    label: [
      `Sensor visibility · ${(cell.visibilityConfidence * 100).toFixed(0)}%`,
      cell.visibilityConfidence >= minimumConfidence ? "qualified cell" : "below threshold",
      `${cell.sampleCount} samples`,
    ].join(" · "),
    position: { x: 0, y: 0, z: 0 },
    geometry: {
      type: "POLYGON" as const,
      points: cell.footprint.map(([x, y]) => ({ x, y, z: Math.max(0.06, cell.minimumZ + 0.06) })),
    },
  }));
}
