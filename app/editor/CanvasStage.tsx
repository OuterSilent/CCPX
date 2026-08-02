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
  parsePixelKey,
  projectColorMap,
  stampCoordinates,
  type Point,
  type ProjectFile,
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
  onNotice: (tone: "ok" | "error", text: string) => void;
}

const MIN_ZOOM = 0.0001;
const MAX_ZOOM = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable='true'], [contenteditable='']",
      ),
    )
  );
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
  fitToken,
  onNotice,
}: CanvasStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ pointerId: number; point: Point; erase: boolean } | null>(null);
  const panningRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const spaceRef = useRef(false);
  const [view, setView] = useState({ zoom: 12, panX: 0, panY: 0 });
  const currentColorId = colorId ?? activeColorId ?? null;

  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const fit = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const padding = 36;
    const zoom = clamp(Math.min((rect.width - padding * 2) / project.width, (rect.height - padding * 2) / project.height), MIN_ZOOM, MAX_ZOOM);
    setView({ zoom, panX: (rect.width - project.width * zoom) / 2, panY: (rect.height - project.height * zoom) / 2 });
  }, [project.height, project.width]);

  const [spaceHeld, setSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  useEffect(() => { fit(); }, [fit, fitToken]);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditableTarget(event.target)) return;
      event.preventDefault();
      spaceRef.current = true;
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (!isEditableTarget(event.target)) event.preventDefault();
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    const reset = () => {
      spaceRef.current = false;
      drawingRef.current = null;
      panningRef.current = null;
      setSpaceHeld(false);
      setIsPanning(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", reset); };
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
    const check = 6;
    const checkerStartX = panX + Math.floor((visibleLeft - panX) / check) * check;
    const checkerStartY = panY + Math.floor((visibleTop - panY) / check) * check;
    for (let y = checkerStartY; y < visibleBottom; y += check) for (let x = checkerStartX; x < visibleRight; x += check) {
      const odd = (Math.floor((x - panX) / check) + Math.floor((y - panY) / check)) % 2;
      context.fillStyle = odd ? "#d9dbe0" : "#f5f5f6"; context.fillRect(x, y, check, check);
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
    context.restore(); context.strokeStyle = "rgba(15, 18, 25, .45)"; context.strokeRect(panX + .5, panY + .5, documentWidth - 1, documentHeight - 1);
  }, [brushSize, hoverPoint, project, tool, view]);

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
    if (!activeLayerId || (!erase && !currentColorId)) { onNotice("error", "Seleziona un livello e un colore prima di riempire."); return; }
    setProject((current) => {
      if (!current || point.x < 0 || point.y < 0 || point.x >= current.width || point.y >= current.height) return current;
      return {
        ...current,
        layers: current.layers.map((layer) => layer.id === activeLayerId ? {
          ...layer,
          pixels: floodFill(layer.pixels, point, {
            width: current.width,
            height: current.height,
            colorId: currentColorId,
            erase,
          }),
        } : layer),
      };
    });
  }, [activeLayerId, currentColorId, onNotice, setProject]);

  function release(event: ReactPointerEvent<HTMLDivElement>) { drawingRef.current = null; panningRef.current = null; setIsPanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = spaceRef.current && event.button === 0;
    if (pan) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panningRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
      setIsPanning(true);
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const erase = event.button === 2 || eraserMode, point = pointAt(event);
    setHoverPoint(point);
    if (tool === "fill") { fillArea(point, erase); return; }
    drawingRef.current = { pointerId: event.pointerId, point, erase }; paint([point], erase);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panningRef.current;
    if (pan?.pointerId === event.pointerId) { setHoverPoint(null); setView((current) => ({ ...current, panX: pan.panX + event.clientX - pan.x, panY: pan.panY + event.clientY - pan.y })); return; }
    const next = pointAt(event);
    setHoverPoint((current) => current?.x === next.x && current.y === next.y ? current : next);
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    if (next.x === drawing.point.x && next.y === drawing.point.y) return;
    paint(linePoints(drawing.point, next), drawing.erase); drawing.point = next;
  }
  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top;
    setView((current) => { const zoom = clamp(current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_ZOOM, MAX_ZOOM); const scale = zoom / current.zoom; return { zoom, panX: x - (x - current.panX) * scale, panY: y - (y - current.panY) * scale }; });
  }

  return <div ref={viewportRef} className="canvas-stage" style={{ position: "relative", minHeight: 360, overflow: "hidden", touchAction: "none", cursor: isPanning ? "grabbing" : spaceHeld ? "grab" : eraserMode ? "cell" : "crosshair" }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => setHoverPoint(null)} onPointerUp={release} onPointerCancel={release} onContextMenu={(event) => event.preventDefault()} onWheel={onWheel}>
    <canvas ref={canvasRef} aria-label="Canvas pixel art" />
    <div className="canvas-overlay" aria-hidden="true" style={{ position: "absolute", right: 12, bottom: 12, pointerEvents: "none" }}>{Math.round(view.zoom * 100)}% · Spazio trascina · Rotella zoom</div>
  </div>;
}
