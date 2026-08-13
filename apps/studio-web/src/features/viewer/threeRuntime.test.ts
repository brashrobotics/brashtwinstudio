import { describe, expect, it } from "vitest";
import { boundedDrawingBuffer } from "./threeRuntime";

describe("viewer drawing-buffer budget", () => {
  it("preserves ordinary canvas resolution", () => {
    expect(boundedDrawingBuffer(800, 600, 2, 2_400_000)).toEqual({
      width: 1600,
      height: 1200,
      scale: 1,
    });
  });

  it("caps high-DPI canvases without changing aspect ratio materially", () => {
    const result = boundedDrawingBuffer(3840, 2160, 2, 2_400_000);
    expect(result.width * result.height).toBeLessThanOrEqual(2_400_000);
    expect(result.width / result.height).toBeCloseTo(16 / 9, 2);
    expect(result.scale).toBeLessThan(1);
  });
});
