import { describe, expect, it } from "vitest";
import { importSvgFloorplan, SvgFloorplanImportError } from "@brash-twin/importers/svg-floorplan";

const VALID_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="30000mm" height="20000mm" viewBox="0 0 30000 20000">
  <rect id="shell" x="0" y="0" width="30000" height="20000"/>
  <path id="office" d="M 1000 1000 H 5000 V 4000 H 1000 Z"/>
  <polyline id="aisle" points="1000,10000 5000,10000 8000,12000"/>
  <polygon id="cell" points="10000,1000 14000,1000 14000,5000 10000,5000"/>
  <g transform="translate(500 250)"><line id="divider" x1="15000" y1="1000" x2="15000" y2="6000"/></g>
  <path id="curve" d="M 0 0 C 1 1 2 2 3 3"/>
</svg>`;

describe("safe SVG floorplan importer", () => {
  it("normalizes physical viewBox coordinates to centred metres with provenance", async () => {
    const report = await importSvgFloorplan(VALID_SVG, { canonicalFrameId: "plant/floor-1" });

    expect(report.schemaVersion).toBe("brash.floorplan-import-report/v1");
    expect(report.configuration.metresPerUserUnit).toBe(0.001);
    expect(report.bounds).toEqual({
      minimum: { x: -15, y: -10, z: 0 },
      maximum: { x: 15, y: 10, z: 0 },
    });
    expect(report.summary).toEqual(expect.objectContaining({
      entityCount: 5,
      warningCount: 1,
      shapeCounts: { path: 1, polyline: 1, polygon: 1, rect: 1, line: 1 },
    }));
    expect(report.issues[0]).toEqual(expect.objectContaining({ code: "SVG_PATH_COMMAND_UNSUPPORTED", elementRef: "#curve" }));
    expect(report.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.configuration.sha256).toMatch(/^[a-f0-9]{64}$/);

    const divider = report.entities.find((entity) => entity.entityId === "cad-svg-divider");
    expect(divider?.geometry).toEqual({
      type: "POLYLINE",
      closed: false,
      points: [
        { x: 0.5, y: 8.75, z: 0 },
        { x: 0.5, y: 3.75, z: 0 },
      ],
    });
  });

  it("produces identical source and configuration digests for identical input", async () => {
    const left = await importSvgFloorplan(VALID_SVG, { canonicalFrameId: "plant/floor-1" });
    const right = await importSvgFloorplan(VALID_SVG, { canonicalFrameId: "plant/floor-1" });
    expect(right.source.sha256).toBe(left.source.sha256);
    expect(right.configuration.sha256).toBe(left.configuration.sha256);
    expect(right.entities).toEqual(left.entities);
  });

  it.each([
    ["SVG_DOCTYPE_FORBIDDEN", `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"/>`],
    ["SVG_ACTIVE_CONTENT_FORBIDDEN", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`],
    ["SVG_REFERENCE_FORBIDDEN", `<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.test/a.svg#x"/></svg>`],
    ["SVG_EVENT_HANDLER_FORBIDDEN", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`],
  ])("rejects active or externally-referenced content with %s", async (code, source) => {
    await expect(importSvgFloorplan(source, {
      canonicalFrameId: "plant/floor-1",
      sourceUnit: "m",
    })).rejects.toEqual(expect.objectContaining({ code } satisfies Partial<SvgFloorplanImportError>));
  });

  it("requires explicit units for pixel drawings and accepts a bounded explicit override", async () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="960px" height="480px" viewBox="0 0 960 480"><rect width="960" height="480"/></svg>`;
    await expect(importSvgFloorplan(source, { canonicalFrameId: "plant/floor-1" }))
      .rejects.toEqual(expect.objectContaining({ code: "SVG_UNIT_UNRESOLVED" }));

    const report = await importSvgFloorplan(source, {
      canonicalFrameId: "plant/floor-1",
      sourceUnit: "px",
      pixelsPerInch: 96,
    });
    expect(report.configuration.metresPerUserUnit).toBeCloseTo(0.0254 / 96, 9);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SVG_UNIT_OVERRIDE_APPLIED" }),
    ]));
  });

  it("rejects non-uniform physical scaling instead of distorting geometry", async () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="10m" height="5m" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>`;
    await expect(importSvgFloorplan(source, { canonicalFrameId: "plant/floor-1" }))
      .rejects.toEqual(expect.objectContaining({ code: "SVG_NON_UNIFORM_SCALE" }));
  });
});
