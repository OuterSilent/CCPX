"use client";

import {
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  applyStamp,
  compositeProject,
  floodFill,
  linePoints,
  movePixelSelection,
  parsePixelKey,
  projectColorMap,
  selectionRectFromPoints,
  stampCoordinates,
  type Point,
  type ProjectFile,
  type SelectionRect,
  type Tool,
} from "../editor-core";

export interface CanvasStageProps {
  project: ProjectFile;
  setProject: Dispatch<SetStateAction<ProjectFile | null>>;
  activeLayerId: string | null;
  /** `colorId` is the current public prop; the alias keeps existing callers compatible. */
  colorId?: string | null;
  activeColorId?: string | null;
  tool: Tool;
  eraserMode: boolean;
  brushSize: number;
  spraySize: number;
  spraySpread: number;
  fitToken: number;
  selectionResetToken: number;
  onBeforeProjectChange: () => void;
  onNotice: (tone: "ok" | "error", text: string) => void;
}

const MIN_ZOOM = 0.0001;
const MAX_ZOOM = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}


export default function CanvasStage({
  project,
  setProject,
  activeLayerId,
  colorId,
  activeColorId,
  tool,
  eraserMode,
  brushSize,
  spraySize,
  spraySpread,
  selectionResetToken,
  onBeforeProjectChange,
  fitToken,
  onNotice,
}: CanvasStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ pointerId: number; point: Point; erase: boolean } | null>(null);
  const panningRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [view, setView] = useState({ zoom: 12, panX: 0, panY: 0 });
  const selectingRef = useRef<{ pointerId: number; start: Point } | null>(null);
  const movingRef = useRef<{ pointerId: number; start: Point; selection: SelectionRect; dx: number; dy: number } | null>(null);
  const currentColorId = colorId ?? activeColorId ?? null;

  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [storedSelection, setStoredSelection] = useState<{
    rect: SelectionRect;
    layerId: string | null;
    resetToken: number;
  } | null>(null);
  const selection =
    storedSelection?.layerId === activeLayerId &&
    storedSelection.resetToken === selectionResetToken
      ? storedSelection.rect
      : null;
  const setSelection = useCallback(
    (next: SelectionRect | null) => {
      setStoredSelection(
        next
          ? {
              rect: next,
              layerId: activeLayerId,
              resetToken: selectionResetToken,
            }
          : null,
      );
    },
    [activeLayerId, selectionResetToken],
  );
  const [movePreview, setMovePreview] = useState<Point | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const fit = useCallback(() => {

    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const padding = 36;
    const zoom = clamp(Math.min((rect.width - padding * 2) / project.width, (rect.height - padding * 2) / project.height), MIN_ZOOM, MAX_ZOOM);
    setView({ zoom, panX: (rect.width - project.width * zoom) / 2, panY: (rect.height - project.height * zoom) / 2 });
  }, [project.height, project.width]);

  useEffect(() => { fit(); }, [fit, fitToken]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);
  useEffect(() => {
    selectingRef.current = null;
    movingRef.current = null;
  }, [activeLayerId, selectionResetToken]);

  useEffect(() => {
    const reset = () => {
      drawingRef.current = null;
      panningRef.current = null;
      selectingRef.current = null;
      movingRef.current = null;
      setMovePreview(null);
      setIsPanning(false);
    };
    window.addEventListener("blur", reset);

    return () => window.removeEventListener("blur", reset);
  }, []);
  useEffect(() => {
    let composite = compositeRef.current;
    if (!composite) { composite = document.createElement("canvas"); compositeRef.current = composite; }
    if (composite.width !== project.width || composite.height !== project.height) { composite.width = project.width; composite.height = project.height; }
    const offscreen = composite.getContext("2d");
    if (!offscreen) return;
    offscreen.clearRect(0, 0, project.width, project.height); offscreen.imageSmoothingEnabled = false;
    const colors = projectColorMap(project);
    for (const [key, id] of Object.entries(compositeProject(project))) {
      const point = parsePixelKey(key), fill = colors.get(id);
      if (point && fill) { offscreen.fillStyle = fill; offscreen.fillRect(point.x, point.y, 1, 1); }
    }
  }, [project]);


  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    const { zoom, panX, panY } = view;
    const documentWidth = project.width * zoom, documentHeight = project.height * zoom;
    context.save(); context.beginPath(); context.rect(panX, panY, documentWidth, documentHeight); context.clip();
    const visibleLeft = Math.max(0, panX);
    const visibleTop = Math.max(0, panY);
    const visibleRight = Math.min(rect.width, panX + documentWidth);
    const visibleBottom = Math.min(rect.height, panY + documentHeight);
    if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
      context.fillStyle = "#f7f8fa";
      context.fillRect(visibleLeft, visibleTop, visibleRight - visibleLeft, visibleBottom - visibleTop);
      const stripeSpacing = 6;
      const stripeOrigin = panX + panY;
      const firstStripe = stripeOrigin + Math.floor((visibleLeft + visibleTop - stripeOrigin) / stripeSpacing) * stripeSpacing;
      context.beginPath();
      for (let diagonal = firstStripe; diagonal <= visibleRight + visibleBottom; diagonal += stripeSpacing) {
        context.moveTo(diagonal - visibleBottom, visibleBottom);
        context.lineTo(diagonal - visibleTop, visibleTop);
      }
      context.strokeStyle = "rgba(184, 190, 200, .38)";
      context.lineWidth = 1;
      context.stroke();
    }
    const composite = compositeRef.current;
    if (composite) {
      context.imageSmoothingEnabled = false;
      context.drawImage(composite, panX, panY, documentWidth, documentHeight);
    }
    if (zoom >= 8) {
      context.strokeStyle = "rgba(34, 39, 49, .2)"; context.lineWidth = 1;
      const firstColumn = clamp(Math.ceil((visibleLeft - panX) / zoom), 0, project.width);
      const lastColumn = clamp(Math.floor((visibleRight - panX) / zoom), 0, project.width);
      const firstRow = clamp(Math.ceil((visibleTop - panY) / zoom), 0, project.height);
      const lastRow = clamp(Math.floor((visibleBottom - panY) / zoom), 0, project.height);
      for (let x = firstColumn; x <= lastColumn; x++) { const p = panX + x * zoom; context.beginPath(); context.moveTo(p, visibleTop); context.lineTo(p, visibleBottom); context.stroke(); }
      for (let y = firstRow; y <= lastRow; y++) { const p = panY + y * zoom; context.beginPath(); context.moveTo(visibleLeft, p); context.lineTo(visibleRight, p); context.stroke(); }
    }
    if (hoverPoint && (tool === "square" || tool === "circle")) {
      const preview = stampCoordinates(tool, hoverPoint, { size: brushSize }).filter(
        ({ x, y }) => x >= 0 && y >= 0 && x < project.width && y < project.height,
      );
      const footprint = new Set(preview.map(({ x, y }) => `${x},${y}`));
      const has = (x: number, y: number) => footprint.has(`${x},${y}`);
      context.beginPath();
      for (const { x, y } of preview) {
        const left = panX + x * zoom;
        const top = panY + y * zoom;
        const right = left + zoom;
        const bottom = top + zoom;
        if (!has(x, y - 1)) { context.moveTo(left, top); context.lineTo(right, top); }
        if (!has(x + 1, y)) { context.moveTo(right, top); context.lineTo(right, bottom); }
        if (!has(x, y + 1)) { context.moveTo(right, bottom); context.lineTo(left, bottom); }
        if (!has(x - 1, y)) { context.moveTo(left, bottom); context.lineTo(left, top); }
      }
      context.setLineDash([4, 3]);
      context.lineWidth = 1.5;
      context.strokeStyle = "rgba(16, 20, 27, .9)";
      context.stroke();
      context.setLineDash([]);
    }
    if (selection) {
      const dx = movePreview?.x ?? 0;
      const dy = movePreview?.y ?? 0;
      const left = panX + (selection.x + dx) * zoom;
      const top = panY + (selection.y + dy) * zoom;
      const width = selection.width * zoom;
      const height = selection.height * zoom;
      if (movePreview) {
        context.setLineDash([3, 3]);
        context.lineWidth = 1;
        context.strokeStyle = "rgba(17, 24, 39, .35)";
        context.strokeRect(panX + selection.x * zoom, panY + selection.y * zoom, width, height);
        context.fillStyle = "rgba(59, 130, 246, .08)";
        context.fillRect(left, top, width, height);
      }
      context.setLineDash([6, 4]);
      context.lineWidth = 1.5;
      context.strokeStyle = "rgba(17, 24, 39, .95)";
      context.strokeRect(left, top, width, height);
      context.setLineDash([]);
    }
    context.restore(); context.strokeStyle = "rgba(15, 18, 25, .45)"; context.strokeRect(panX + .5, panY + .5, documentWidth - 1, documentHeight - 1);
  }, [brushSize, hoverPoint, movePreview, project, selection, tool, view]);

  useEffect(() => { render(); }, [render]);

  const pointAt = useCallback((event: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: Math.floor((event.clientX - rect.left - view.panX) / view.zoom), y: Math.floor((event.clientY - rect.top - view.panY) / view.zoom) };
  }, [view]);
  const paint = useCallback((points: readonly Point[], erase: boolean) => {
    if (!activeLayerId || (!erase && !currentColorId)) { onNotice("error", "Seleziona un livello e un colore prima di disegnare."); return; }
    setProject((current) => {
      if (!current) return current;
      const layer = current.layers.find((item) => item.id === activeLayerId);
      if (!layer) return current;
      const coordinates = points.flatMap((point) => stampCoordinates(tool, point, { size: tool === "spray" ? spraySize : brushSize, spread: spraySpread }));
      return { ...current, layers: current.layers.map((item) => item.id === activeLayerId ? { ...item, pixels: applyStamp(item.pixels, coordinates, { width: current.width, height: current.height, colorId: currentColorId, erase }) } : item) };
    });
  }, [activeLayerId, brushSize, currentColorId, onNotice, setProject, spraySize, spraySpread, tool]);

  const fillArea = useCallback((point: Point, erase: boolean) => {
    if (!activeLayerId || (!erase && !currentColorId)) {
      onNotice("error", "Seleziona un livello e un colore prima di riempire.");
      return;
    }
    if (point.x < 0 || point.y < 0 || point.x >= project.width || point.y >= project.height) return;
    const layer = project.layers.find((item) => item.id === activeLayerId);
    if (!layer) return;
    const key = `${point.x},${point.y}`;
    const target = Object.prototype.hasOwnProperty.call(layer.pixels, key) ? layer.pixels[key] : null;
    const replacement = erase ? null : currentColorId;
    if (target === replacement) return;
    const pixels = floodFill(layer.pixels, point, {
      width: project.width,
      height: project.height,
      colorId: currentColorId,
      erase,
    });
    onBeforeProjectChange();
    setProject({
      ...project,
      layers: project.layers.map((item) => item.id === activeLayerId ? { ...item, pixels } : item),
    });
  }, [activeLayerId, currentColorId, onBeforeProjectChange, onNotice, project, setProject]);

  const commitMove = useCallback((gesture: NonNullable<typeof movingRef.current>) => {
    if (gesture.dx === 0 && gesture.dy === 0) return;
    const layer = project.layers.find((item) => item.id === activeLayerId);
    if (!layer) return;
    const result = movePixelSelection(
      layer.pixels,
      gesture.selection,
      gesture.dx,
      gesture.dy,
      project.width,
      project.height,
    );
    onBeforeProjectChange();
    setProject({
      ...project,
      layers: project.layers.map((item) => item.id === activeLayerId ? { ...item, pixels: result.pixels } : item),
    });
    setSelection(result.selection);
  }, [activeLayerId, onBeforeProjectChange, project, setProject, setSelection]);

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>, shouldCommitMove: boolean) {
    const move = movingRef.current;
    if (shouldCommitMove && move?.pointerId === event.pointerId) commitMove(move);
    drawingRef.current = null;
    panningRef.current = null;
    selectingRef.current = null;
    movingRef.current = null;
    setMovePreview(null);
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panningRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
      setHoverPoint(null);
      setIsPanning(true);
      return;
    }

    const point = pointAt(event);
    if (tool === "select") {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      selectingRef.current = { pointerId: event.pointerId, start: point };
      setMovePreview(null);
      setSelection(selectionRectFromPoints(point, point, project.width, project.height));
      return;
    }

    if (tool === "move") {
      if (event.button !== 0 || !selection) return;
      const isInside = point.x >= selection.x && point.y >= selection.y && point.x < selection.x + selection.width && point.y < selection.y + selection.height;
      if (!isInside) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      movingRef.current = { pointerId: event.pointerId, start: point, selection, dx: 0, dy: 0 };
      return;
    }

    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const erase = event.button === 2 || eraserMode;
    setHoverPoint(point);
    if (tool === "fill") {
      fillArea(point, erase);
      return;
    }
    if (!activeLayerId || (!erase && !currentColorId)) {
      paint([point], erase);
      return;
    }
    onBeforeProjectChange();
    drawingRef.current = { pointerId: event.pointerId, point, erase };
    paint([point], erase);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panningRef.current;
    if (pan?.pointerId === event.pointerId) {
      setHoverPoint(null);
      setView((current) => ({ ...current, panX: pan.panX + event.clientX - pan.x, panY: pan.panY + event.clientY - pan.y }));
      return;
    }

    const next = pointAt(event);
    setHoverPoint((current) => current?.x === next.x && current.y === next.y ? current : next);
    const selecting = selectingRef.current;
    if (selecting?.pointerId === event.pointerId) {
      setSelection(selectionRectFromPoints(selecting.start, next, project.width, project.height));
      return;
    }

    const moving = movingRef.current;
    if (moving?.pointerId === event.pointerId) {
      const dx = clamp(next.x - moving.start.x, -moving.selection.x, project.width - moving.selection.x - moving.selection.width);
      const dy = clamp(next.y - moving.start.y, -moving.selection.y, project.height - moving.selection.y - moving.selection.height);
      moving.dx = dx;
      moving.dy = dy;
      setMovePreview((current) => current?.x === dx && current.y === dy ? current : { x: dx, y: dy });
      return;
    }

    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    if (next.x === drawing.point.x && next.y === drawing.point.y) return;
    paint(linePoints(drawing.point, next), drawing.erase);
    drawing.point = next;
  }
  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top;
    setView((current) => { const zoom = clamp(current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_ZOOM, MAX_ZOOM); const scale = zoom / current.zoom; return { zoom, panX: x - (x - current.panX) * scale, panY: y - (y - current.panY) * scale }; });
  }

  const cursor = isPanning
    ? "grabbing"
    : tool === "move"
      ? "move"
      : eraserMode
        ? "cell"
        : "crosshair";

  return (
    <div
      ref={viewportRef}
      className="canvas-stage"
      style={{
        position: "relative",
        minHeight: 360,
        overflow: "hidden",
        touchAction: "none",
        cursor,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHoverPoint(null)}
      onPointerUp={(event) => finishPointer(event, true)}
      onPointerCancel={(event) => finishPointer(event, false)}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={onWheel}
    >
      <canvas ref={canvasRef} aria-label="Canvas pixel art" />
      <div
        className="canvas-overlay"
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          pointerEvents: "none",
        }}
      >
        {Math.round(view.zoom * 100)}% · Tasto centrale trascina · Rotella zoom
      </div>
    </div>
  );
}
