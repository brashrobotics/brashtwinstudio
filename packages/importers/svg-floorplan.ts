import type { Vector3Value, WorldEntity } from "@brash-twin/viewer-sdk";

export const FLOORPLAN_IMPORT_SCHEMA_VERSION = "brash.floorplan-import-report/v1";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_ELEMENTS = 50_000;
const MAX_POINTS = 200_000;
const MAX_ISSUES = 500;
const NUMBER_PATTERN = "[-+]?(?:(?:\\d+\\.?\\d*)|(?:\\.\\d+))(?:[eE][-+]?\\d+)?";
const NUMBER_TOKEN = new RegExp(NUMBER_PATTERN, "g");
const PATH_TOKEN = new RegExp(`[AaCcHhLlMmQqSsTtVvZz]|${NUMBER_PATTERN}`, "g");
const FORBIDDEN_MARKUP = [
  { pattern: /<!DOCTYPE\b/i, code: "SVG_DOCTYPE_FORBIDDEN" },
  { pattern: /<!ENTITY\b/i, code: "SVG_ENTITY_FORBIDDEN" },
  { pattern: /<\?xml-stylesheet\b/i, code: "SVG_STYLESHEET_FORBIDDEN" },
];
const FORBIDDEN_ELEMENTS = new Set([
  "script", "style", "foreignobject", "image", "use", "iframe", "object", "embed", "audio", "video",
]);
const IGNORED_ELEMENTS = new Set(["title", "desc", "metadata", "defs"]);
const CONTAINER_ELEMENTS = new Set(["g"]);
const SUPPORTED_GEOMETRY = new Set(["path", "polyline", "polygon", "rect", "line"]);

export type SvgSourceUnit = "mm" | "cm" | "m" | "in" | "ft" | "px";

export interface SvgFloorplanImportConfiguration {
  canonicalFrameId: string;
  sourceUnit?: SvgSourceUnit;
  pixelsPerInch?: number;
  flipY?: boolean;
  originMetres?: Vector3Value;
  layerId?: string;
}

export interface FloorplanImportIssue {
  severity: "WARNING";
  code: string;
  message: string;
  elementRef?: string;
}

export interface FloorplanBounds {
  minimum: Vector3Value;
  maximum: Vector3Value;
}

export interface FloorplanImportReport {
  schemaVersion: typeof FLOORPLAN_IMPORT_SCHEMA_VERSION;
  format: "SVG";
  canonicalFrameId: string;
  units: Readonly<{ length: "m"; angle: "rad" }>;
  source: {
    mediaType: "image/svg+xml";
    bytes: number;
    sha256: string;
  };
  configuration: {
    sha256: string;
    sourceUnit: SvgSourceUnit | "ROOT_DIMENSIONS";
    metresPerUserUnit: number;
    pixelsPerInch: number;
    flipY: boolean;
    originMode: "VIEWBOX_CENTER";
    originMetres: Vector3Value;
    layerId: string;
  };
  sourceSpace: {
    viewBox: { minX: number; minY: number; width: number; height: number };
    rootWidth: string | null;
    rootHeight: string | null;
  };
  bounds: FloorplanBounds;
  summary: {
    entityCount: number;
    pointCount: number;
    warningCount: number;
    shapeCounts: Record<"path" | "polyline" | "polygon" | "rect" | "line", number>;
  };
  issues: FloorplanImportIssue[];
  entities: WorldEntity[];
}

export class SvgFloorplanImportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SvgFloorplanImportError";
  }
}

export async function canonicalSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface Point2D {
  x: number;
  y: number;
}

interface SourcePolyline {
  points: Point2D[];
  closed: boolean;
}

interface EffectiveScale {
  sourceUnit: SvgSourceUnit | "ROOT_DIMENSIONS";
  metresPerUserUnit: number;
}

const IDENTITY_MATRIX: Matrix2D = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export async function importSvgFloorplan(
  sourceText: string,
  configuration: SvgFloorplanImportConfiguration,
): Promise<FloorplanImportReport> {
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new SvgFloorplanImportError("SVG_SOURCE_REQUIRED", "SVG source text is required.");
  }
  requiredIdentifier(configuration?.canonicalFrameId, "canonicalFrameId");
  const sourceBytes = new TextEncoder().encode(sourceText);
  if (sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new SvgFloorplanImportError(
      "SVG_SOURCE_TOO_LARGE",
      `SVG source exceeds the ${MAX_SOURCE_BYTES}-byte import limit.`,
    );
  }
  if (sourceText.includes("\0")) {
    throw new SvgFloorplanImportError("SVG_NUL_FORBIDDEN", "SVG source contains a NUL character.");
  }
  for (const forbidden of FORBIDDEN_MARKUP) {
    if (forbidden.pattern.test(sourceText)) {
      throw new SvgFloorplanImportError(forbidden.code, "SVG active or entity-expanding markup is forbidden.");
    }
  }
  if (typeof DOMParser === "undefined") {
    throw new SvgFloorplanImportError("SVG_DOM_PARSER_UNAVAILABLE", "This runtime does not provide a DOMParser.");
  }

  const document = new DOMParser().parseFromString(sourceText, "image/svg+xml");
  const parserError = document.getElementsByTagName("parsererror").item(0);
  if (parserError) {
    throw new SvgFloorplanImportError("SVG_XML_INVALID", "SVG source is not well-formed XML.");
  }
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg" || root.namespaceURI !== SVG_NAMESPACE) {
    throw new SvgFloorplanImportError("SVG_ROOT_INVALID", "The root element must be an SVG namespace element.");
  }

  const allElements = Array.from(document.getElementsByTagName("*"));
  if (allElements.length > MAX_ELEMENTS) {
    throw new SvgFloorplanImportError("SVG_ELEMENT_LIMIT_EXCEEDED", `SVG contains more than ${MAX_ELEMENTS} elements.`);
  }
  for (const element of allElements) assertSafeElement(element);

  const viewBox = parseViewBox(root.getAttribute("viewBox"));
  const rootWidth = root.getAttribute("width");
  const rootHeight = root.getAttribute("height");
  const issues: FloorplanImportIssue[] = [];
  let issuesTruncated = false;
  const addIssue = (issue: FloorplanImportIssue): void => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
    else issuesTruncated = true;
  };
  const scale = resolveScale(viewBox, rootWidth, rootHeight, configuration, addIssue);
  const flipY = configuration.flipY ?? true;
  const pixelsPerInch = validPixelsPerInch(configuration.pixelsPerInch);
  const originMetres = normalizeOrigin(configuration.originMetres);
  const layerId = configuration.layerId ?? "cad";
  requiredIdentifier(layerId, "layerId");
  const effectiveConfiguration = {
    sourceUnit: scale.sourceUnit,
    metresPerUserUnit: round(scale.metresPerUserUnit),
    pixelsPerInch,
    flipY,
    originMode: "VIEWBOX_CENTER" as const,
    originMetres,
    layerId,
  };
  const configurationSha256 = await sha256Hex(canonicalJson({
    canonicalFrameId: configuration.canonicalFrameId,
    ...effectiveConfiguration,
  }));

  const entities: WorldEntity[] = [];
  const entityIds = new Set<string>();
  const shapeCounts = { path: 0, polyline: 0, polygon: 0, rect: 0, line: 0 };
  let pointCount = 0;
  let generatedId = 0;

  const addPolylines = (element: Element, tag: keyof typeof shapeCounts, polylines: SourcePolyline[], matrix: Matrix2D): void => {
    const baseRef = elementReference(element, tag);
    for (const [subpathIndex, polyline] of polylines.entries()) {
      if (polyline.points.length < 2) {
        addIssue(warning("SVG_GEOMETRY_TOO_SHORT", "Geometry with fewer than two points was ignored.", baseRef));
        continue;
      }
      pointCount += polyline.points.length;
      if (pointCount > MAX_POINTS) {
        throw new SvgFloorplanImportError("SVG_POINT_LIMIT_EXCEEDED", `SVG contains more than ${MAX_POINTS} supported points.`);
      }
      const points = polyline.points.map((point) => canonicalPoint(
        applyMatrix(matrix, point),
        viewBox,
        scale.metresPerUserUnit,
        flipY,
        originMetres,
      ));
      generatedId += 1;
      const entityId = uniqueEntityId(
        `cad-svg-${safeId(element.getAttribute("id")) || `${tag}-${String(generatedId).padStart(4, "0")}`}${polylines.length > 1 ? `-${subpathIndex + 1}` : ""}`,
        entityIds,
      );
      entities.push({
        entityId,
        layerId,
        label: element.getAttribute("aria-label")?.trim() || element.getAttribute("id")?.trim() || `${tag} ${generatedId}`,
        position: { x: 0, y: 0, z: 0.02 },
        geometry: { type: "POLYLINE", points, closed: polyline.closed },
      });
      shapeCounts[tag] += 1;
    }
  };

  const visit = (parent: Element, parentMatrix: Matrix2D): void => {
    for (const child of Array.from(parent.children)) {
      const tag = child.localName.toLowerCase();
      if (child.namespaceURI !== SVG_NAMESPACE) continue;
      if (IGNORED_ELEMENTS.has(tag)) continue;
      const elementRef = elementReference(child, tag);
      const localMatrix = parseTransform(child.getAttribute("transform"), elementRef, addIssue);
      if (!localMatrix) continue;
      const matrix = multiplyMatrices(parentMatrix, localMatrix);
      if (CONTAINER_ELEMENTS.has(tag)) {
        visit(child, matrix);
        continue;
      }
      if (tag === "svg") {
        addIssue(warning("SVG_NESTED_VIEWPORT_UNSUPPORTED", "Nested SVG viewports are ignored.", elementRef));
        continue;
      }
      if (!SUPPORTED_GEOMETRY.has(tag)) {
        addIssue(warning("SVG_ELEMENT_UNSUPPORTED", `Unsupported SVG <${tag}> element was ignored.`, elementRef));
        continue;
      }
      try {
        if (tag === "path") {
          const path = parsePath(child.getAttribute("d"));
          if (path.unsupportedCommand) {
            addIssue(warning(
              "SVG_PATH_COMMAND_UNSUPPORTED",
              `Path command ${path.unsupportedCommand} is not supported; the path was ignored.`,
              elementRef,
            ));
          } else {
            addPolylines(child, "path", path.polylines, matrix);
          }
        } else if (tag === "polyline" || tag === "polygon") {
          const points = parsePointList(child.getAttribute("points"));
          addPolylines(child, tag, [{ points, closed: tag === "polygon" }], matrix);
        } else if (tag === "rect") {
          const x = numericAttribute(child, "x", 0);
          const y = numericAttribute(child, "y", 0);
          const width = numericAttribute(child, "width");
          const height = numericAttribute(child, "height");
          if (width <= 0 || height <= 0) throw new Error("Rectangle width and height must be positive.");
          if (child.hasAttribute("rx") || child.hasAttribute("ry")) {
            addIssue(warning("SVG_ROUNDED_RECT_FLATTENED", "Rounded rectangle corners were flattened.", elementRef));
          }
          addPolylines(child, "rect", [{
            closed: true,
            points: [
              { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
            ],
          }], matrix);
        } else if (tag === "line") {
          addPolylines(child, "line", [{
            closed: false,
            points: [
              { x: numericAttribute(child, "x1", 0), y: numericAttribute(child, "y1", 0) },
              { x: numericAttribute(child, "x2", 0), y: numericAttribute(child, "y2", 0) },
            ],
          }], matrix);
        }
      } catch (error) {
        addIssue(warning(
          "SVG_GEOMETRY_INVALID",
          error instanceof Error ? error.message : "SVG geometry is invalid.",
          elementRef,
        ));
      }
    }
  };

  if (root.hasAttribute("transform")) {
    addIssue(warning("SVG_ROOT_TRANSFORM_UNSUPPORTED", "A transform on the root SVG element was ignored.", "svg"));
  }
  visit(root, IDENTITY_MATRIX);
  if (issuesTruncated) {
    issues.push(warning("SVG_ISSUES_TRUNCATED", `Only the first ${MAX_ISSUES} import warnings are retained.`));
  }
  if (entities.length === 0) {
    throw new SvgFloorplanImportError("SVG_NO_SUPPORTED_GEOMETRY", "SVG contains no valid supported floorplan geometry.");
  }

  return {
    schemaVersion: FLOORPLAN_IMPORT_SCHEMA_VERSION,
    format: "SVG",
    canonicalFrameId: configuration.canonicalFrameId,
    units: Object.freeze({ length: "m", angle: "rad" }),
    source: {
      mediaType: "image/svg+xml",
      bytes: sourceBytes.byteLength,
      sha256: await sha256Hex(sourceBytes),
    },
    configuration: {
      sha256: configurationSha256,
      ...effectiveConfiguration,
    },
    sourceSpace: {
      viewBox,
      rootWidth,
      rootHeight,
    },
    bounds: calculateBounds(entities),
    summary: {
      entityCount: entities.length,
      pointCount,
      warningCount: issues.length,
      shapeCounts,
    },
    issues,
    entities,
  };
}

function assertSafeElement(element: Element): void {
  const tag = element.localName.toLowerCase();
  if (element.namespaceURI !== SVG_NAMESPACE) {
    throw new SvgFloorplanImportError("SVG_FOREIGN_NAMESPACE_FORBIDDEN", `Foreign namespace element <${tag}> is forbidden.`);
  }
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (name.startsWith("on")) {
      throw new SvgFloorplanImportError("SVG_EVENT_HANDLER_FORBIDDEN", `SVG event attribute ${attribute.name} is forbidden.`);
    }
    if (name === "href" || name.endsWith(":href") || name === "src") {
      throw new SvgFloorplanImportError("SVG_REFERENCE_FORBIDDEN", `SVG reference attribute ${attribute.name} is forbidden.`);
    }
    if (/url\s*\(/i.test(value) || /@import\b/i.test(value)) {
      throw new SvgFloorplanImportError("SVG_URL_FORBIDDEN", `SVG URL-bearing attribute ${attribute.name} is forbidden.`);
    }
  }
  if (FORBIDDEN_ELEMENTS.has(tag)) {
    throw new SvgFloorplanImportError("SVG_ACTIVE_CONTENT_FORBIDDEN", `SVG <${tag}> content is forbidden.`);
  }
}

function parseViewBox(value: string | null): FloorplanImportReport["sourceSpace"]["viewBox"] {
  if (!value) throw new SvgFloorplanImportError("SVG_VIEWBOX_REQUIRED", "A four-number viewBox is required.");
  const numbers = parseNumberList(value, "viewBox");
  if (numbers.length !== 4 || numbers.some((number) => !Number.isFinite(number))) {
    throw new SvgFloorplanImportError("SVG_VIEWBOX_INVALID", "viewBox must contain exactly four finite numbers.");
  }
  const [minX = 0, minY = 0, width = 0, height = 0] = numbers;
  if (width <= 0 || height <= 0) {
    throw new SvgFloorplanImportError("SVG_VIEWBOX_INVALID", "viewBox width and height must be positive.");
  }
  return { minX, minY, width, height };
}

function resolveScale(
  viewBox: FloorplanImportReport["sourceSpace"]["viewBox"],
  rootWidth: string | null,
  rootHeight: string | null,
  configuration: SvgFloorplanImportConfiguration,
  addIssue: (issue: FloorplanImportIssue) => void,
): EffectiveScale {
  const pixelsPerInch = validPixelsPerInch(configuration.pixelsPerInch);
  if (configuration.sourceUnit) {
    if (rootWidth || rootHeight) {
      addIssue(warning("SVG_UNIT_OVERRIDE_APPLIED", "Configured sourceUnit overrides root SVG dimensions.", "svg"));
    }
    return {
      sourceUnit: configuration.sourceUnit,
      metresPerUserUnit: unitToMetres(configuration.sourceUnit, pixelsPerInch),
    };
  }

  const width = parsePhysicalLength(rootWidth);
  const height = parsePhysicalLength(rootHeight);
  if (!width && !height) {
    throw new SvgFloorplanImportError(
      "SVG_UNIT_UNRESOLVED",
      "Use physical root dimensions (mm, cm, m, in, ft) or provide sourceUnit explicitly.",
    );
  }
  const xScale = width ? width.metres / viewBox.width : null;
  const yScale = height ? height.metres / viewBox.height : null;
  if (xScale && yScale) {
    const relativeDifference = Math.abs(xScale - yScale) / Math.max(xScale, yScale);
    if (relativeDifference > 0.001) {
      throw new SvgFloorplanImportError(
        "SVG_NON_UNIFORM_SCALE",
        "Root dimensions and viewBox imply different X and Y metre scales.",
      );
    }
  } else {
    addIssue(warning(
      "SVG_SINGLE_AXIS_UNIT_INFERENCE",
      "Metre scale was inferred from only one physical root dimension.",
      "svg",
    ));
  }
  return { sourceUnit: "ROOT_DIMENSIONS", metresPerUserUnit: xScale ?? yScale ?? 0 };
}

function parsePhysicalLength(value: string | null): { metres: number; unit: SvgSourceUnit } | null {
  if (!value) return null;
  const match = value.trim().match(new RegExp(`^(${NUMBER_PATTERN})(mm|cm|m|in|ft)$`, "i"));
  if (!match) return null;
  const numeric = Number(match[1]);
  const unit = match[2]?.toLowerCase() as SvgSourceUnit;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { metres: numeric * unitToMetres(unit, 96), unit };
}

function unitToMetres(unit: SvgSourceUnit, pixelsPerInch: number): number {
  const factors: Record<Exclude<SvgSourceUnit, "px">, number> = {
    mm: 0.001,
    cm: 0.01,
    m: 1,
    in: 0.0254,
    ft: 0.3048,
  };
  return unit === "px" ? 0.0254 / pixelsPerInch : factors[unit];
}

function validPixelsPerInch(value: number | undefined): number {
  const normalized = value ?? 96;
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > 10_000) {
    throw new SvgFloorplanImportError("SVG_PIXEL_DENSITY_INVALID", "pixelsPerInch must be between 1 and 10000.");
  }
  return normalized;
}

function normalizeOrigin(value: Vector3Value | undefined): Vector3Value {
  const origin = value ?? { x: 0, y: 0, z: 0 };
  if (![origin.x, origin.y, origin.z].every(Number.isFinite)) {
    throw new SvgFloorplanImportError("SVG_ORIGIN_INVALID", "originMetres must contain finite X, Y, and Z values.");
  }
  return { x: round(origin.x), y: round(origin.y), z: round(origin.z) };
}

function parsePointList(value: string | null): Point2D[] {
  if (!value) throw new Error("A points attribute is required.");
  const numbers = parseNumberList(value, "points");
  if (numbers.length < 4 || numbers.length % 2 !== 0) {
    throw new Error("Points must contain at least two coordinate pairs.");
  }
  const points: Point2D[] = [];
  for (let index = 0; index < numbers.length; index += 2) {
    points.push({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
  }
  return points;
}

function parsePath(value: string | null): { polylines: SourcePolyline[]; unsupportedCommand?: string } {
  if (!value) throw new Error("A path d attribute is required.");
  const tokens = tokenizeStrict(value, PATH_TOKEN, "path");
  const unsupported = tokens.find((token) => /^[AaCcQqSsTt]$/.test(token));
  if (unsupported) return { polylines: [], unsupportedCommand: unsupported };
  const polylines: SourcePolyline[] = [];
  let current: SourcePolyline | null = null;
  let cursor = { x: 0, y: 0 };
  let command: string | null = null;
  let index = 0;

  const finishCurrent = (): void => {
    if (current) polylines.push(current);
    current = null;
  };
  const numberAt = (): number => {
    const token = tokens[index];
    if (token === undefined || /^[A-Za-z]$/.test(token)) throw new Error("Path command has missing numeric arguments.");
    index += 1;
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error("Path contains a non-finite coordinate.");
    return number;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (token && /^[A-Za-z]$/.test(token)) {
      command = token;
      index += 1;
      if (command.toLowerCase() === "z") {
        if (!current) throw new Error("Close-path command appears before a move command.");
        current.closed = true;
        cursor = { ...current.points[0] };
        command = null;
        continue;
      }
    }
    if (!command) throw new Error("Path data must begin with a command.");
    const isRelative: boolean = command === command.toLowerCase();
    const normalized = command.toUpperCase();
    if (normalized === "M" || normalized === "L") {
      const x = numberAt();
      const y = numberAt();
      cursor = { x: isRelative ? cursor.x + x : x, y: isRelative ? cursor.y + y : y };
      if (normalized === "M") {
        finishCurrent();
        current = { points: [{ ...cursor }], closed: false };
        command = isRelative ? "l" : "L";
      } else {
        if (!current) throw new Error("Line command appears before a move command.");
        current.points.push({ ...cursor });
      }
    } else if (normalized === "H") {
      const x = numberAt();
      cursor = { ...cursor, x: isRelative ? cursor.x + x : x };
      if (!current) throw new Error("Horizontal line command appears before a move command.");
      current.points.push({ ...cursor });
    } else if (normalized === "V") {
      const y = numberAt();
      cursor = { ...cursor, y: isRelative ? cursor.y + y : y };
      if (!current) throw new Error("Vertical line command appears before a move command.");
      current.points.push({ ...cursor });
    } else {
      throw new Error(`Unsupported path command ${command}.`);
    }
  }
  finishCurrent();
  return { polylines };
}

function parseTransform(
  value: string | null,
  elementRef: string,
  addIssue: (issue: FloorplanImportIssue) => void,
): Matrix2D | null {
  if (!value?.trim()) return IDENTITY_MATRIX;
  const functionPattern = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  const matches = Array.from(value.matchAll(functionPattern));
  const residue = value.replace(functionPattern, "").replace(/[\s,]+/g, "");
  if (matches.length === 0 || residue !== "") {
    addIssue(warning("SVG_TRANSFORM_INVALID", "Malformed transform was ignored with its geometry.", elementRef));
    return null;
  }
  let result = IDENTITY_MATRIX;
  for (const match of matches) {
    const operation = match[1]?.toLowerCase();
    const values = parseNumberList(match[2] ?? "", "transform");
    let matrix: Matrix2D | null = null;
    if (operation === "matrix" && values.length === 6) {
      matrix = { a: values[0]!, b: values[1]!, c: values[2]!, d: values[3]!, e: values[4]!, f: values[5]! };
    } else if (operation === "translate" && (values.length === 1 || values.length === 2)) {
      matrix = { a: 1, b: 0, c: 0, d: 1, e: values[0]!, f: values[1] ?? 0 };
    } else if (operation === "scale" && (values.length === 1 || values.length === 2)) {
      matrix = { a: values[0]!, b: 0, c: 0, d: values[1] ?? values[0]!, e: 0, f: 0 };
    } else if (operation === "rotate" && (values.length === 1 || values.length === 3)) {
      const angle = (values[0]! * Math.PI) / 180;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const rotation = { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
      if (values.length === 3) {
        const cx = values[1]!;
        const cy = values[2]!;
        matrix = multiplyMatrices(
          multiplyMatrices({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, rotation),
          { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy },
        );
      } else matrix = rotation;
    }
    if (!matrix) {
      addIssue(warning(
        "SVG_TRANSFORM_UNSUPPORTED",
        `Unsupported or invalid ${match[1]} transform was ignored with its geometry.`,
        elementRef,
      ));
      return null;
    }
    result = multiplyMatrices(result, matrix);
  }
  return result;
}

function multiplyMatrices(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function applyMatrix(matrix: Matrix2D, point: Point2D): Point2D {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

function canonicalPoint(
  point: Point2D,
  viewBox: FloorplanImportReport["sourceSpace"]["viewBox"],
  scale: number,
  flipY: boolean,
  origin: Vector3Value,
): Vector3Value {
  const centerX = viewBox.minX + viewBox.width / 2;
  const centerY = viewBox.minY + viewBox.height / 2;
  return {
    x: round((point.x - centerX) * scale + origin.x),
    y: round((flipY ? centerY - point.y : point.y - centerY) * scale + origin.y),
    z: round(origin.z),
  };
}

function calculateBounds(entities: WorldEntity[]): FloorplanBounds {
  const points = entities.flatMap((entity) => entity.geometry.type === "POLYLINE" ? entity.geometry.points : []);
  return {
    minimum: {
      x: round(Math.min(...points.map((point) => point.x))),
      y: round(Math.min(...points.map((point) => point.y))),
      z: round(Math.min(...points.map((point) => point.z))),
    },
    maximum: {
      x: round(Math.max(...points.map((point) => point.x))),
      y: round(Math.max(...points.map((point) => point.y))),
      z: round(Math.max(...points.map((point) => point.z))),
    },
  };
}

function parseNumberList(value: string, label: string): number[] {
  return tokenizeStrict(value, NUMBER_TOKEN, label).map((token) => Number(token));
}

function tokenizeStrict(value: string, pattern: RegExp, label: string): string[] {
  pattern.lastIndex = 0;
  const matches = Array.from(value.matchAll(pattern));
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    if (!/^[\s,]*$/.test(value.slice(cursor, index))) throw new Error(`${label} contains unsupported syntax.`);
    cursor = index + match[0].length;
  }
  if (!/^[\s,]*$/.test(value.slice(cursor))) throw new Error(`${label} contains unsupported syntax.`);
  return matches.map((match) => match[0]);
}

function numericAttribute(element: Element, name: string, fallback?: number): number {
  const value = element.getAttribute(name);
  if (value === null && fallback !== undefined) return fallback;
  if (value === null || !new RegExp(`^${NUMBER_PATTERN}$`).test(value.trim())) {
    throw new Error(`${name} must be a finite unitless number.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be finite.`);
  return number;
}

function elementReference(element: Element, fallback: string): string {
  const id = element.getAttribute("id")?.trim();
  return id ? `#${id}` : `<${fallback}>`;
}

function warning(code: string, message: string, elementRef?: string): FloorplanImportIssue {
  return elementRef ? { severity: "WARNING", code, message, elementRef } : { severity: "WARNING", code, message };
}

function safeId(value: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniqueEntityId(candidate: string, ids: Set<string>): string {
  let value = candidate;
  let suffix = 2;
  while (ids.has(value)) {
    value = `${candidate}-${suffix}`;
    suffix += 1;
  }
  ids.add(value);
  return value;
}

function requiredIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/.test(value)) {
    throw new SvgFloorplanImportError("SVG_CONFIGURATION_INVALID", `${field} must be a safe non-empty identifier.`);
  }
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return sha256Fallback(bytes);
}

function sha256Fallback(bytes: Uint8Array): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!;
      const previous2 = words[index - 2]!;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + constants[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0; d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}
