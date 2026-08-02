export type Tool = "point" | "square" | "circle" | "spray" | "fill" | "select" | "move";

export type PixelMap = Record<string, string>;

export interface Point {
  x: number;
  y: number;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MoveSelectionResult {
  pixels: PixelMap;
  selection: SelectionRect;
  dx: number;
  dy: number;
}

export interface PaletteColor {
  id: string;
  value: string;
}

export interface Palette {
  id: string;
  name: string;
  colors: PaletteColor[];
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  pixels: PixelMap;
}

/**
 * Layers are stored from top to bottom. Pixels keep a palette color ID rather
 * than a color value so palette edits are reflected everywhere immediately.
 */
export interface ProjectFile {
  version: 1;
  width: number;
  height: number;
  palettes: Palette[];
  layers: Layer[];
}

export interface StampOptions {
  size?: number;
  spread?: number;
  random?: () => number;
}

export interface ApplyStampOptions {
  width: number;
  height: number;
  colorId?: string | null;
  erase?: boolean;
}

export interface FloodFillOptions {
  width: number;
  height: number;
  colorId?: string | null;
  erase?: boolean;
}

const PIXEL_KEY_PATTERN = /^(-?\d+),(-?\d+)$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function pixelKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parsePixelKey(key: string): Point | null {
  const match = PIXEL_KEY_PATTERN.exec(key);
  if (!match) {
    return null;
  }

  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return null;
  }

  return { x, y };
}

/**
 * Creates an inclusive rectangular selection. The drag may end outside the
 * grid, but it must start inside it.
 */
export function selectionRectFromPoints(
  start: Point,
  end: Point,
  width: number,
  height: number,
): SelectionRect | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return null;
  }

  const startX = Math.round(start.x);
  const startY = Math.round(start.y);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return null;
  }

  const endX = Math.min(width - 1, Math.max(0, Math.round(end.x)));
  const endY = Math.min(height - 1, Math.max(0, Math.round(end.y)));
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);

  return {
    x,
    y,
    width: Math.abs(endX - startX) + 1,
    height: Math.abs(endY - startY) + 1,
  };
}

function pointInsideSelection(point: Point, selection: SelectionRect): boolean {
  return (
    point.x >= selection.x &&
    point.y >= selection.y &&
    point.x < selection.x + selection.width &&
    point.y < selection.y + selection.height
  );
}

/**
 * Cuts a rectangular region from one layer and pastes it at a clamped offset.
 * Empty cells are moved too, so they clear matching cells at the destination.
 */
export function movePixelSelection(
  pixels: Readonly<PixelMap>,
  selection: SelectionRect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): MoveSelectionResult {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(selection.x) ||
    !Number.isInteger(selection.y) ||
    !Number.isInteger(selection.width) ||
    !Number.isInteger(selection.height) ||
    selection.width <= 0 ||
    selection.height <= 0 ||
    selection.x < 0 ||
    selection.y < 0 ||
    selection.x + selection.width > width ||
    selection.y + selection.height > height
  ) {
    throw new Error("Selezione non valida.");
  }

  const requestedX = Number.isFinite(dx) ? Math.round(dx) : 0;
  const requestedY = Number.isFinite(dy) ? Math.round(dy) : 0;
  const actualX = Math.min(
    width - selection.x - selection.width,
    Math.max(-selection.x, requestedX),
  );
  const actualY = Math.min(
    height - selection.y - selection.height,
    Math.max(-selection.y, requestedY),
  );
  const destination: SelectionRect = {
    ...selection,
    x: selection.x + actualX,
    y: selection.y + actualY,
  };

  const selectedPixels = Object.entries(pixels)
    .map(([key, colorId]) => ({ point: parsePixelKey(key), colorId }))
    .filter(
      (entry): entry is { point: Point; colorId: string } =>
        entry.point !== null && pointInsideSelection(entry.point, selection),
    );
  const result: PixelMap = { ...pixels };

  for (const key of Object.keys(result)) {
    const point = parsePixelKey(key);
    if (
      point &&
      (pointInsideSelection(point, selection) ||
        pointInsideSelection(point, destination))
    ) {
      delete result[key];
    }
  }

  for (const { point, colorId } of selectedPixels) {
    result[pixelKey(point.x + actualX, point.y + actualY)] = colorId;
  }

  return {
    pixels: result,
    selection: destination,
    dx: actualX,
    dy: actualY,
  };
}

/**
 * Integer Bresenham line, inclusive of both endpoints.
 */
export function linePoints(from: Point, to: Point): Point[] {
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const endX = Math.round(to.x);
  const endY = Math.round(to.y);
  const deltaX = Math.abs(endX - x);
  const deltaY = Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = deltaX - deltaY;
  const points: Point[] = [];

  while (true) {
    points.push({ x, y });
    if (x === endX && y === endY) {
      return points;
    }

    const doubledError = error * 2;
    if (doubledError > -deltaY) {
      error -= deltaY;
      x += stepX;
    }
    if (doubledError < deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function normalizedSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function squareCoordinates(center: Point, size: number): Point[] {
  const startX = center.x - Math.floor((size - 1) / 2);
  const startY = center.y - Math.floor((size - 1) / 2);
  const points: Point[] = [];

  for (let y = startY; y < startY + size; y += 1) {
    for (let x = startX; x < startX + size; x += 1) {
      points.push({ x, y });
    }
  }

  return points;
}

function circleCoordinates(center: Point, size: number): Point[] {
  const square = squareCoordinates(center, size);
  const startX = center.x - Math.floor((size - 1) / 2);
  const startY = center.y - Math.floor((size - 1) / 2);
  const geometricCenterX = startX + (size - 1) / 2;
  const geometricCenterY = startY + (size - 1) / 2;
  // The quarter-pixel inset gives small raster circles useful footprints:
  // size 1 is one pixel, size 2 is 2x2, and size 3 is a five-pixel cross.
  const radius = Math.max(0.25, size / 2 - 0.25);
  const radiusSquared = radius * radius;

  return square.filter(({ x, y }) => {
    const deltaX = x - geometricCenterX;
    const deltaY = y - geometricCenterY;
    return deltaX * deltaX + deltaY * deltaY <= radiusSquared;
  });
}

/**
 * Produces one brush footprint at an integer grid coordinate.
 *
 * Spray spread is a density percentage. At 100 it fills its circular footprint;
 * at 0 it emits no pixels. Supplying an RNG makes spray behavior deterministic
 * in tests and repeatable callers.
 */
export function stampCoordinates(
  tool: Tool,
  center: Point,
  options: StampOptions = {},
): Point[] {
  const integerCenter = {
    x: Math.round(center.x),
    y: Math.round(center.y),
  };

  if (tool === "point" || tool === "fill" || tool === "select" || tool === "move") {
    return [integerCenter];
  }

  const size = normalizedSize(options.size);
  if (tool === "square") {
    return squareCoordinates(integerCenter, size);
  }

  const circle = circleCoordinates(integerCenter, size);
  if (tool === "circle") {
    return circle;
  }

  const spread = Math.min(100, Math.max(0, options.spread ?? 100));
  if (spread === 0) {
    return [];
  }
  if (spread === 100) {
    return circle;
  }

  const random = options.random ?? Math.random;
  const probability = spread / 100;
  return circle.filter(() => random() < probability);
}

/**
 * Applies coordinates without mutating the existing layer. Out-of-bounds
 * coordinates are ignored. `erase` (or a null color ID) removes pixels.
 */
export function applyStamp(
  pixels: Readonly<PixelMap>,
  coordinates: readonly Point[],
  options: ApplyStampOptions,
): PixelMap {
  const result: PixelMap = { ...pixels };
  const erase = options.erase === true || options.colorId === null;

  if (!erase && (!options.colorId || typeof options.colorId !== "string")) {
    throw new Error("Serve un colorId per disegnare.");
  }

  for (const point of coordinates) {
    if (
      !Number.isInteger(point.x) ||
      !Number.isInteger(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= options.width ||
      point.y >= options.height
    ) {
      continue;
    }

    const key = pixelKey(point.x, point.y);
    if (erase) {
      delete result[key];
    } else {
      result[key] = options.colorId as string;
    }
  }

  return result;
}

/**
 * Replaces one four-directionally connected region in a single layer.
 * Transparent cells are represented by missing keys and can be filled too.
 */
export function floodFill(
  pixels: Readonly<PixelMap>,
  start: Point,
  options: FloodFillOptions,
): PixelMap {
  const result: PixelMap = { ...pixels };
  if (
    !Number.isInteger(start.x) ||
    !Number.isInteger(start.y) ||
    start.x < 0 ||
    start.y < 0 ||
    start.x >= options.width ||
    start.y >= options.height
  ) {
    return result;
  }

  let replacement: string | null;
  if (options.erase === true || options.colorId === null) {
    replacement = null;
  } else if (typeof options.colorId === "string" && options.colorId.length > 0) {
    replacement = options.colorId;
  } else {
    throw new Error("Serve un colorId per riempire.");
  }

  const startKey = pixelKey(start.x, start.y);
  const target = Object.prototype.hasOwnProperty.call(result, startKey)
    ? result[startKey]
    : null;
  if (target === replacement) {
    return result;
  }

  const colorAt = (key: string): string | null =>
    Object.prototype.hasOwnProperty.call(result, key) ? result[key] : null;
  const replaceAt = (key: string): void => {
    if (replacement === null) {
      delete result[key];
    } else {
      result[key] = replacement;
    }
  };

  const stack: Point[] = [{ x: start.x, y: start.y }];
  replaceAt(startKey);

  while (stack.length > 0) {
    const point = stack.pop() as Point;
    const neighbors = [
      { x: point.x - 1, y: point.y },
      { x: point.x + 1, y: point.y },
      { x: point.x, y: point.y - 1 },
      { x: point.x, y: point.y + 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x < 0 ||
        neighbor.y < 0 ||
        neighbor.x >= options.width ||
        neighbor.y >= options.height
      ) {
        continue;
      }
      const key = pixelKey(neighbor.x, neighbor.y);
      if (colorAt(key) !== target) {
        continue;
      }
      replaceAt(key);
      stack.push(neighbor);
    }
  }

  return result;
}

/**
 * Composites layers stored top-first, preserving the first encountered pixel.
 */
export function compositeLayers(layers: readonly Layer[]): PixelMap {
  const result: PixelMap = {};

  for (const layer of layers) {
    if (layer.visible === false) {
      continue;
    }
    for (const [key, colorId] of Object.entries(layer.pixels)) {
      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = colorId;
      }
    }
  }

  return result;
}

export function compositeProject(project: ProjectFile): PixelMap {
  return compositeLayers(project.layers);
}

export function projectColorMap(
  project: Pick<ProjectFile, "palettes">,
): Map<string, string> {
  return new Map(
    project.palettes.flatMap((palette) =>
      palette.colors.map((color) => [color.id, color.value] as const),
    ),
  );
}

function projectData(project: ProjectFile): ProjectFile {
  return {
    version: 1,
    width: project.width,
    height: project.height,
    palettes: project.palettes.map((palette) => ({
      id: palette.id,
      name: palette.name,
      colors: palette.colors.map((color) => ({
        id: color.id,
        value: color.value,
      })),
    })),
    layers: project.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible !== false,
      pixels: Object.fromEntries(Object.entries(layer.pixels)),
    })),
  };
}

/**
 * Serializes only persistent project fields; view and tool state passed as
 * excess runtime properties cannot leak into the file.
 */
export function serializeProject(
  project: ProjectFile,
  indentation: number | string = 2,
): string {
  return JSON.stringify(projectData(project), null, indentation);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function expectRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${context} deve essere un oggetto.`);
  }
  return value;
}

function expectNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} deve essere una stringa non vuota.`);
  }
  return value;
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`${context} deve essere una stringa.`);
  }
  return value;
}

function expectArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} deve essere un array.`);
  }
  return value;
}

function assertUnique(
  id: string,
  seen: Set<string>,
  context: string,
): void {
  if (seen.has(id)) {
    throw new Error(`${context}: ID duplicato "${id}".`);
  }
  seen.add(id);
}

/**
 * Validates and clones unknown input into the exact persisted v1 shape.
 */
export function validateProjectFile(value: unknown): ProjectFile {
  const root = expectRecord(value, "Il progetto");
  if (root.version !== 1) {
    throw new Error("Versione progetto non supportata: è richiesta la versione 1.");
  }
  if (!Number.isSafeInteger(root.width) || (root.width as number) <= 0) {
    throw new Error("La larghezza deve essere un intero positivo.");
  }
  if (!Number.isSafeInteger(root.height) || (root.height as number) <= 0) {
    throw new Error("L'altezza deve essere un intero positivo.");
  }

  const rawPalettes = expectArray(root.palettes, "palettes");
  if (rawPalettes.length === 0) {
    throw new Error("Il progetto deve contenere almeno una palette.");
  }

  const paletteIds = new Set<string>();
  const colorIds = new Set<string>();
  const palettes: Palette[] = rawPalettes.map((rawPalette, paletteIndex) => {
    const context = `Palette ${paletteIndex + 1}`;
    const palette = expectRecord(rawPalette, context);
    const id = expectNonEmptyString(palette.id, `${context}.id`);
    assertUnique(id, paletteIds, context);
    const name = expectString(palette.name, `${context}.name`);
    const rawColors = expectArray(palette.colors, `${context}.colors`);

    const colors: PaletteColor[] = rawColors.map((rawColor, colorIndex) => {
      const colorContext = `${context}, colore ${colorIndex + 1}`;
      const color = expectRecord(rawColor, colorContext);
      const colorId = expectNonEmptyString(color.id, `${colorContext}.id`);
      assertUnique(colorId, colorIds, colorContext);
      const colorValue = expectString(color.value, `${colorContext}.value`);
      if (!HEX_COLOR_PATTERN.test(colorValue)) {
        throw new Error(
          `${colorContext}.value deve usare il formato #RRGGBB.`,
        );
      }
      return { id: colorId, value: colorValue };
    });

    return { id, name, colors };
  });

  const rawLayers = expectArray(root.layers, "layers");
  if (rawLayers.length === 0) {
    throw new Error("Il progetto deve contenere almeno un livello.");
  }

  const layerIds = new Set<string>();
  const width = root.width as number;
  const height = root.height as number;
  const layers: Layer[] = rawLayers.map((rawLayer, layerIndex) => {
    const context = `Livello ${layerIndex + 1}`;
    const layer = expectRecord(rawLayer, context);
    const id = expectNonEmptyString(layer.id, `${context}.id`);
    assertUnique(id, layerIds, context);
    const name = expectString(layer.name, `${context}.name`);
    let visible = true;
    if (Object.prototype.hasOwnProperty.call(layer, "visible")) {
      if (typeof layer.visible !== "boolean") {
        throw new Error(`${context}.visible deve essere un booleano.`);
      }
      visible = layer.visible;
    }
    const rawPixels = expectRecord(layer.pixels, `${context}.pixels`);
    const pixels: PixelMap = {};

    for (const [key, rawColorId] of Object.entries(rawPixels)) {
      const point = parsePixelKey(key);
      if (
        !point ||
        key !== pixelKey(point.x, point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x >= width ||
        point.y >= height
      ) {
        throw new Error(`${context}: coordinata pixel non valida "${key}".`);
      }
      if (typeof rawColorId !== "string" || !colorIds.has(rawColorId)) {
        throw new Error(
          `${context}: il pixel "${key}" usa un colorId inesistente.`,
        );
      }
      pixels[key] = rawColorId;
    }

    return { id, name, visible, pixels };
  });

  return {
    version: 1,
    width,
    height,
    palettes,
    layers,
  };
}

/**
 * Parses a project file or throws a readable Error without mutating any state.
 */
export function parseProjectJson(json: string): ProjectFile {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("JSON non valido: impossibile leggere il file.");
  }

  return validateProjectFile(value);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sortedPixelEntries(pixels: PixelMap): [Point, string][] {
  return Object.entries(pixels)
    .map(([key, colorId]) => [parsePixelKey(key), colorId] as const)
    .filter((entry): entry is readonly [Point, string] => entry[0] !== null)
    .sort(([first], [second]) => first.y - second.y || first.x - second.x)
    .map(([point, colorId]) => [point, colorId]);
}

/**
 * Exports all layers as groups. The project stores them top-first, while SVG
 * paints later elements on top, so groups are emitted bottom-first.
 */
export function projectToSvg(project: ProjectFile): string {
  const validProject = validateProjectFile(project);
  const colors = projectColorMap(validProject);
  const groups = [...validProject.layers]
    .filter((layer) => layer.visible)
    .reverse()
    .map((layer) => {
      const rects = sortedPixelEntries(layer.pixels)
        .map(([point, colorId]) => {
          const fill = colors.get(colorId);
          // Validation guarantees this branch cannot be reached.
          if (!fill) {
            throw new Error(`Colore inesistente "${colorId}".`);
          }
          return `    <rect x="${point.x}" y="${point.y}" width="1" height="1" fill="${fill}" />`;
        })
        .join("\n");
      const title = `    <title>${escapeXml(layer.name)}</title>`;
      const content = rects ? `${title}\n${rects}` : title;
      return `  <g id="layer-${escapeXml(layer.id)}" data-layer-id="${escapeXml(layer.id)}">\n${content}\n  </g>`;
    })
    .join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${validProject.width} ${validProject.height}" width="${validProject.width}" height="${validProject.height}" shape-rendering="crispEdges">`,
    groups,
    "</svg>",
  ].join("\n");
}
