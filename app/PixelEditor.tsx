"use client";

import {
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useCallback,
  useEffect,

  useRef,
  useState,
} from "react";
import {
  mergeProjectLayers,
  parsePixelKey,
  parseProjectJson,
  projectColorAlphaMap,
  projectColorMap,
  projectToSvg,
  resizeProject,
  serializeProject,
  type ProjectFile,
  type ResizeBounds,
  type Tool,
} from "./editor-core";
import CanvasStage from "./editor/CanvasStage";
import SetupScreen from "./editor/SetupScreen";

type NoticeTone = "ok" | "error";

const APP_VERSION = "1.03";
const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DEFAULT_GRID_COLOR = "#222731";
const DEFAULT_TRANSPARENCY_LINE_OPACITY = 50;


interface Notice {
  tone: NoticeTone;
  text: string;
}

type DropPosition = "before" | "after";

interface DropTarget {
  id: string;
  position: DropPosition;
}

type LayerDropIntent = DropPosition | "merge";

interface LayerDropTarget {
  id: string;
  position: LayerDropIntent;
}

const TOOLS: Array<{
  id: Tool;
  name: string;
  key: string;
  symbol: string;
}> = [
  { id: "point", name: "Point", key: "1", symbol: "·" },
  { id: "square", name: "Square", key: "2", symbol: "■" },
  { id: "circle", name: "Circle", key: "3", symbol: "●" },
  { id: "spray", name: "Spray", key: "4", symbol: "⁙" },
  { id: "fill", name: "Fill", key: "5", symbol: "" },
  { id: "select", name: "Selection", key: "6", symbol: "" },
  { id: "move", name: "Move selection", key: "7", symbol: "" },
];

type EditorIconName = "fill" | "select" | "move" | "eraser" | "resize";

function EditorIcon({ name }: { name: EditorIconName }) {
  if (name === "fill") {
    return (
      <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 13 8-8 7 7-8 8H5Z" />
        <path d="m9 9 7 7" />
        <path d="M19 16s2 2.2 2 3.2a2 2 0 0 1-4 0C17 18.2 19 16 19 16Z" />
      </svg>
    );
  }
  if (name === "select") {
    return (
      <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="1" strokeDasharray="3 2" />
      </svg>
    );
  }
  if (name === "move") {
    return (
      <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v18M3 12h18M12 3 9 6m3-3 3 3M21 12l-3-3m3 3-3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3" />
      </svg>
    );
  }
  if (name === "resize") {
    return (
      <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" />
        <path d="M9 3H3v6m12 12h6v-6M3 9l6-6m6 18 6-6" />
      </svg>
    );
  }
  return (
    <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 15 9-10 7 6-8 9H7Z" />
      <path d="m9 10 7 6M7 20h13" />
    </svg>
  );
}

function HistoryIcon({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg className="history-icon" viewBox="0 0 20 20" aria-hidden="true">
      <g transform={direction === "forward" ? "translate(20 0) scale(-1 1)" : undefined}>
        <path d="m8 4-5 5 5 5" />
        <path d="M4 9h7a5 5 0 0 1 5 5v1" />
      </g>
    </svg>
  );
}

function LayerVisibilityIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg className="layer-eye-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
        <circle cx="10" cy="10" r="2.2" />
      </svg>
    );
  }
  return (
    <svg className="layer-eye-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 12c2-2.7 4.3-4 7-4s5 1.3 7 4" />
      <path d="m5 13-1.3 2M10 13v2.5M15 13l1.3 2" />
    </svg>
  );
}

let idCounter = 0;

function createId(prefix: string): string {
  idCounter += 1;
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable='']",
    ),
  );
}

function dropPositionFor(event: DragEvent<HTMLElement>): DropPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function layerDropIntentFor(event: DragEvent<HTMLElement>): LayerDropIntent {
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - bounds.top) / bounds.height;
  if (ratio < 0.3) return "before";
  if (ratio > 0.7) return "after";
  return "merge";
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(
              new Error(
                "The browser cannot generate an image at these dimensions.",
              ),
            );
          }
        },
        type,
        type === "image/jpeg" ? 0.92 : undefined,
      );
    } catch {
      reject(
        new Error(
          "The browser cannot generate an image at these dimensions.",
        ),
      );
    }
  });
}

async function renderRaster(
  project: ProjectFile,
  multiplier: number,
  format: "png" | "jpg",
): Promise<Blob> {
  const width = project.width * multiplier;
  const height = project.height * multiplier;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new Error(
      "The requested dimensions exceed the browser's numeric capacity.",
    );
  }

  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
  } catch {
    throw new Error(
      "The browser cannot allocate an image at these dimensions.",
    );
  }

  if (canvas.width !== width || canvas.height !== height) {
    throw new Error(
      "The browser cannot allocate an image at these dimensions.",
    );
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is unavailable for export.");
  }

  context.imageSmoothingEnabled = false;
  if (format === "jpg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  const colors = projectColorMap(project);
  const alphas = projectColorAlphaMap(project);
  for (const layer of [...project.layers].reverse()) {
    if (layer.visible === false) continue;
    for (const [key, colorId] of Object.entries(layer.pixels)) {
      const point = parsePixelKey(key);
      const fill = colors.get(colorId);
      if (!point || !fill) {
        continue;
      }
      context.globalAlpha = alphas.get(colorId) ?? 1;
      context.fillStyle = fill;
      context.fillRect(
        point.x * multiplier,
        point.y * multiplier,
        multiplier,
        multiplier,
      );
    }
  }

  context.globalAlpha = 1;
  return canvasBlob(canvas, format === "png" ? "image/png" : "image/jpeg");
}

export default function PixelEditor() {
  const [project, setProjectState] = useState<ProjectFile | null>(null);
  const [tool, setTool] = useState<Tool>("point");
  const [eraserMode, setEraserMode] = useState(false);
  const [resizeBounds, setResizeBounds] = useState<ResizeBounds | null>(null);
  const [brushSize, setBrushSize] = useState(3);
  const [spraySize, setSpraySize] = useState(9);
  const [spraySpread, setSpraySpread] = useState(45);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeColorId, setActiveColorId] = useState<string | null>(null);
  const [multiplierText, setMultiplierText] = useState("1");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutTab, setAboutTab] = useState<"about" | "tutorial" | "creator">("about");
  const [fitToken, setFitToken] = useState(0);
  const [selectionResetToken, setSelectionResetToken] = useState(0);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayer, setDragOverLayer] = useState<LayerDropTarget | null>(null);
  const [draggedColorId, setDraggedColorId] = useState<string | null>(null);
  const [dragOverColor, setDragOverColor] = useState<DropTarget | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [exporting, setExporting] = useState(false);
  const [openColorId, setOpenColorId] = useState<string | null>(null);
  const [paletteColorDrafts, setPaletteColorDrafts] = useState<Record<string, string>>({});
  const [showGrid, setShowGrid] = useState(true);
  const [gridColor, setGridColor] = useState(DEFAULT_GRID_COLOR);
  const [transparencyLineOpacity, setTransparencyLineOpacity] = useState(
    DEFAULT_TRANSPARENCY_LINE_OPACITY,
  );
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<ProjectFile | null>(null);
  const historyRef = useRef<ProjectFile[]>([]);
  const redoRef = useRef<ProjectFile[]>([]);
  const paletteColorCommitTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const syncHistoryAvailability = useCallback(() => {
    setHistoryAvailability({
      canUndo: historyRef.current.length > 0,
      canRedo: redoRef.current.length > 0,
    });
  }, []);

  const setProject: Dispatch<SetStateAction<ProjectFile | null>> = useCallback(
    (action) => {
      setProjectState((current) => {
        const next = typeof action === "function" ? action(current) : action;
        projectRef.current = next;
        return next;
      });
    },
    [],
  );

  const checkpoint = useCallback(() => {
    const current = projectRef.current;
    if (!current) return;
    historyRef.current = [...historyRef.current.slice(-99), current];
    redoRef.current = [];
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);

  const restoreHistoryProject = useCallback(
    (snapshot: ProjectFile) => {
      setProject(snapshot);
      setActiveLayerId((current) =>
        snapshot.layers.some((layer) => layer.id === current)
          ? current
          : (snapshot.layers[0]?.id ?? null),
      );
      setActiveColorId((current) =>
        snapshot.palettes.some((palette) =>
          palette.colors.some((color) => color.id === current),
        )
          ? current
          : (snapshot.palettes.flatMap((palette) => palette.colors)[0]?.id ?? null),
      );
      setSelectionResetToken((value) => value + 1);
    },
    [setProject],
  );

  const undo = useCallback(() => {
    const current = projectRef.current;
    const previous = historyRef.current.pop();
    if (!current || !previous) return;
    redoRef.current = [...redoRef.current.slice(-99), current];
    syncHistoryAvailability();
    restoreHistoryProject(previous);
  }, [restoreHistoryProject, syncHistoryAvailability]);

  const redo = useCallback(() => {
    const current = projectRef.current;
    const next = redoRef.current.pop();
    if (!current || !next) return;
    historyRef.current = [...historyRef.current.slice(-99), current];
    syncHistoryAvailability();
    restoreHistoryProject(next);
  }, [restoreHistoryProject, syncHistoryAvailability]);

  const showNotice = useCallback((tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
  }, []);

  const openProject = useCallback((nextProject: ProjectFile) => {
    historyRef.current = [];
    redoRef.current = [];
    paletteColorCommitTimersRef.current.forEach((timer) => clearTimeout(timer));
    paletteColorCommitTimersRef.current.clear();
    setPaletteColorDrafts({});
    syncHistoryAvailability();
    projectRef.current = nextProject;
    setProject(nextProject);
    setActiveLayerId(nextProject.layers[0]?.id ?? null);
    setActiveColorId(nextProject.palettes.flatMap((palette) => palette.colors)[0]?.id ?? null);
    setTool("point");
    setEraserMode(false);
    setResizeBounds(null);
    setOpenColorId(null);
    setNotice(null);
    setFitToken((value) => value + 1);
    setSelectionResetToken((value) => value + 1);
  }, [setProject, syncHistoryAvailability]);

  const importFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const imported = parseProjectJson(text);
        openProject(imported);
        showNotice("ok", "Project imported.");
      } catch (error) {
        showNotice(
          "error",
          errorText(error, "Unable to import the project."),
        );
      }
    },
    [openProject, showNotice],
  );

  const handleFileInput = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        await importFile(file);
      }
      event.target.value = "";
    },
    [importFile],
  );

  useEffect(() => {
    if (!openColorId) return;

    const closeColorPopover = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setOpenColorId(null);
        return;
      }
      const owner = target.closest<HTMLElement>("[data-palette-color-id]");
      if (owner?.dataset.paletteColorId !== openColorId) {
        setOpenColorId(null);
      }
    };

    document.addEventListener("pointerdown", closeColorPopover);
    return () => document.removeEventListener("pointerdown", closeColorPopover);
  }, [openColorId]);

  useEffect(() => {
    if (!project || aboutOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
        event.preventDefault();
        if (resizeBounds) {
          setResizeBounds(null);
        } else if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      const toolForCode: Partial<Record<KeyboardEvent["code"], Tool>> = {
        Digit1: "point",
        Digit2: "square",
        Digit3: "circle",
        Digit4: "spray",
        Digit5: "fill",
        Digit6: "select",
        Digit7: "move",
      };
      const nextTool = toolForCode[event.code];
      if (nextTool) {
        event.preventDefault();
        setTool(nextTool);
        return;
      }
      if (event.code === "KeyE" && !event.repeat) {
        event.preventDefault();
        setEraserMode((value) => !value);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen, project, redo, resizeBounds, undo]);

  const newProject = useCallback(() => {
    historyRef.current = [];
    redoRef.current = [];
    paletteColorCommitTimersRef.current.forEach((timer) => clearTimeout(timer));
    paletteColorCommitTimersRef.current.clear();
    setPaletteColorDrafts({});
    syncHistoryAvailability();
    projectRef.current = null;
    setProject(null);
    setActiveLayerId(null);
    setActiveColorId(null);
    setTool("point");
    setEraserMode(false);
    setResizeBounds(null);
    setOpenColorId(null);
    setShowGrid(true);
    setGridColor(DEFAULT_GRID_COLOR);
    setTransparencyLineOpacity(DEFAULT_TRANSPARENCY_LINE_OPACITY);
    setNotice(null);
    setSelectionResetToken((value) => value + 1);
  }, [setProject, syncHistoryAvailability]);

  const toggleResizeMode = useCallback(() => {
    if (!project) return;

    if (!resizeBounds) {
      setResizeBounds({
        left: 0,
        top: 0,
        right: project.width,
        bottom: project.height,
      });
      setOpenColorId(null);
      return;
    }

    const changed =
      resizeBounds.left !== 0 ||
      resizeBounds.top !== 0 ||
      resizeBounds.right !== project.width ||
      resizeBounds.bottom !== project.height;

    if (changed) {
      checkpoint();
      setProject(resizeProject(project, resizeBounds));
      setSelectionResetToken((value) => value + 1);
      setFitToken((value) => value + 1);
    }
    setResizeBounds(null);
  }, [checkpoint, project, resizeBounds, setProject]);

  useEffect(() => {
    if (!project || aboutOpen) return;

    const handleResizeShortcut = (event: KeyboardEvent) => {
      if (
        isEditableTarget(event.target) ||
        event.code !== "KeyR" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat
      ) {
        return;
      }
      event.preventDefault();
      toggleResizeMode();
    };

    window.addEventListener("keydown", handleResizeShortcut);
    return () => window.removeEventListener("keydown", handleResizeShortcut);
  }, [aboutOpen, project, toggleResizeMode]);

  const exportJson = useCallback(() => {
    if (!project) {
      return;
    }
    try {
      triggerDownload(
        new Blob([serializeProject(project)], {
          type: "application/json;charset=utf-8",
        }),
        "pixel-project.json",
      );
      showNotice("ok", "JSON project exported.");
    } catch (error) {
      showNotice(
        "error",
        errorText(error, "Unable to export the project."),
      );
    }
  }, [project, showNotice]);

  const exportSvg = useCallback(() => {
    if (!project) {
      return;
    }
    try {
      triggerDownload(
        new Blob([projectToSvg(project)], {
          type: "image/svg+xml;charset=utf-8",
        }),
        "pixel-art.svg",
      );
      showNotice("ok", "SVG exported.");
    } catch (error) {
      showNotice("error", errorText(error, "Unable to export the SVG."));
    }
  }, [project, showNotice]);

  const exportRaster = useCallback(
    async (format: "png" | "jpg") => {
      if (!project || exporting) {
        return;
      }
      const multiplier = Number(multiplierText);
      if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
        showNotice("error", "The multiplier must be a positive integer.");
        return;
      }

      setExporting(true);
      try {
        const blob = await renderRaster(project, multiplier, format);
        triggerDownload(blob, `pixel-art.${format}`);
        showNotice("ok", `${format.toUpperCase()} exported.`);
      } catch (error) {
        showNotice(
          "error",
          errorText(error, "Unable to export the image."),
        );
      } finally {
        setExporting(false);
      }
    },
    [exporting, multiplierText, project, showNotice],
  );

  const addPaletteColor = useCallback((paletteId: string) => {
    const id = createId("color");
    checkpoint();
    setProject((current) => current ? {
      ...current,
      palettes: current.palettes.map((palette) =>
        palette.id === paletteId
          ? { ...palette, colors: [...palette.colors, { id, value: "#ffffff", alpha: 1 }] }
          : palette,
      ),
    } : current);
    setActiveColorId(id);
  }, [checkpoint, setProject]);
  const removePaletteColor = useCallback((paletteId: string, colorId: string) => {
    if (!project) return;
    const palette = project.palettes.find((item) => item.id === paletteId);
    if (!palette || !window.confirm("Remove this color and every pixel that uses it?")) return;
    checkpoint();
    setProject((current) => current ? {
      ...current,
      palettes: current.palettes.map((item) => item.id === paletteId ? { ...item, colors: item.colors.filter((color) => color.id !== colorId) } : item),
      layers: current.layers.map((layer) => ({ ...layer, pixels: Object.fromEntries(Object.entries(layer.pixels).filter(([, id]) => id !== colorId)) })),
    } : current);
    if (activeColorId === colorId) setActiveColorId(project.palettes.flatMap((item) => item.colors).find((color) => color.id !== colorId)?.id ?? null);
    if (openColorId === colorId) setOpenColorId(null);
  }, [activeColorId, checkpoint, openColorId, project, setProject]);

  const updatePaletteColor = useCallback(
    (paletteId: string, colorId: string, value: string) => {
      setProject((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          palettes: current.palettes.map((palette) =>
            palette.id === paletteId
              ? {
                  ...palette,
                  colors: palette.colors.map((color) =>
                    color.id === colorId ? { ...color, value } : color,
                  ),
                }
              : palette,
          ),
        };
      });
      setActiveColorId(colorId);
    },
    [setProject],
  );

  const queuePaletteColorUpdate = useCallback(
    (paletteId: string, colorId: string, value: string) => {
      setPaletteColorDrafts((current) =>
        current[colorId] === value ? current : { ...current, [colorId]: value },
      );

      const pendingTimer = paletteColorCommitTimersRef.current.get(colorId);
      if (pendingTimer) clearTimeout(pendingTimer);

      const timer = setTimeout(() => {
        paletteColorCommitTimersRef.current.delete(colorId);
        updatePaletteColor(paletteId, colorId, value);
        setPaletteColorDrafts((current) => {
          if (!(colorId in current)) return current;
          const next = { ...current };
          delete next[colorId];
          return next;
        });
      }, 120);
      paletteColorCommitTimersRef.current.set(colorId, timer);
    },
    [updatePaletteColor],
  );

  useEffect(
    () => () => {
      paletteColorCommitTimersRef.current.forEach((timer) => clearTimeout(timer));
      paletteColorCommitTimersRef.current.clear();
    },
    [],
  );
  const updatePaletteAlpha = useCallback(
    (paletteId: string, colorId: string, alpha: number) => {
      setProject((current) => current ? {
        ...current,
        palettes: current.palettes.map((palette) =>
          palette.id === paletteId
            ? {
                ...palette,
                colors: palette.colors.map((color) =>
                  color.id === colorId ? { ...color, alpha } : color,
                ),
              }
            : palette,
        ),
      } : current);
      setActiveColorId(colorId);
    },
    [setProject],
  );

  const handleColorDrop = useCallback(
    (event: DragEvent<HTMLElement>, paletteId: string, targetId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId =
        draggedColorId || event.dataTransfer.getData("application/x-ccpx-color");
      const position = dropPositionFor(event);
      setDraggedColorId(null);
      setDragOverColor(null);
      if (!sourceId || sourceId === targetId) return;

      checkpoint();
      setProject((current) => {
        if (!current) return current;
        return {
          ...current,
          palettes: current.palettes.map((palette) => {
            if (palette.id !== paletteId) return palette;
            const sourceIndex = palette.colors.findIndex(
              (color) => color.id === sourceId,
            );
            if (sourceIndex < 0) return palette;
            const colors = [...palette.colors];
            const [moved] = colors.splice(sourceIndex, 1);
            const targetIndex = colors.findIndex((color) => color.id === targetId);
            if (targetIndex < 0) return palette;
            colors.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, moved);
            return { ...palette, colors };
          }),
        };
      });
    },
    [checkpoint, draggedColorId, setProject],
  );
  const addLayer = useCallback(() => {
    const id = createId("layer");
    checkpoint();
    setProject((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        layers: [
          { id, name: `Layer ${current.layers.length + 1}`, visible: true, pixels: {} },
          ...current.layers,
        ],
      };
    });
    setActiveLayerId(id);
  }, [checkpoint, setProject]);

  const deleteLayer = useCallback(
    (layerId: string) => {
      if (!project || project.layers.length <= 1) {
        return;
      }
      const remaining = project.layers.filter((layer) => layer.id !== layerId);
      checkpoint();
      setProject({ ...project, layers: remaining });
      if (activeLayerId === layerId) {
        setActiveLayerId(remaining[0]?.id ?? null);
      }
    },
    [activeLayerId, checkpoint, project, setProject],
  );

  const renameLayer = useCallback((layerId: string, name: string) => {
    setProject((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        layers: current.layers.map((layer) =>
          layer.id === layerId ? { ...layer, name } : layer,
        ),
      };
    });
  }, [setProject]);

  const handleLayerDrop = useCallback(
    (event: DragEvent<HTMLElement>, targetId: string) => {
      event.preventDefault();
      const sourceId =
        draggedLayerId || event.dataTransfer.getData("text/plain");
      const intent = layerDropIntentFor(event);
      setDraggedLayerId(null);
      setDragOverLayer(null);
      if (!sourceId || sourceId === targetId) return;

      checkpoint();
      setProject((current) => {
        if (!current) return current;
        if (intent === "merge") {
          return mergeProjectLayers(current, sourceId, targetId);
        }

        const sourceIndex = current.layers.findIndex(
          (layer) => layer.id === sourceId,
        );
        if (sourceIndex < 0) return current;
        const reordered = [...current.layers];
        const [moved] = reordered.splice(sourceIndex, 1);
        const targetIndex = reordered.findIndex((layer) => layer.id === targetId);
        if (targetIndex < 0) return current;
        reordered.splice(intent === "after" ? targetIndex + 1 : targetIndex, 0, moved);
        return { ...current, layers: reordered };
      });
      if (intent === "merge") setActiveLayerId(targetId);
    },
    [checkpoint, draggedLayerId, setProject],
  );
  if (!project) {
    return (
      <>
        <SetupScreen
          onCreate={openProject}
          onImport={() => fileInputRef.current?.click()}
          notice={notice}
        />
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={handleFileInput}
          tabIndex={-1}
        />
      </>
    );
  }

  const selectedTool = TOOLS.find((item) => item.id === tool);
  const currentSize = tool === "spray" ? spraySize : brushSize;
  const displayedWidth = resizeBounds
    ? resizeBounds.right - resizeBounds.left
    : project.width;
  const displayedHeight = resizeBounds
    ? resizeBounds.bottom - resizeBounds.top
    : project.height;

  return (
    <main className="editor-app">
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        onChange={handleFileInput}
        tabIndex={-1}
      />

      {notice ? (
        <div
          className={`notice notice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="Close message"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="editor-workspace" inert={aboutOpen} aria-hidden={aboutOpen}>
        <aside className="side-panel tools-panel" aria-label="Tools and palette">
          <div className="side-brand">
            <img className="brand-mark" src={`${PUBLIC_BASE_PATH}/logo.png`} alt="" />
            <div>
              <div className="brand-title">
                <strong>CCPX</strong>
              </div>
              <span className="version-badge">Version {APP_VERSION}</span>
            </div>
          </div>


          <section className="panel-section">
            <div className="section-title">
              <h2>Tools</h2>
              <span>{selectedTool?.name}</span>
            </div>
            <div className="tool-grid">
              {TOOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`tool-button ${tool === item.id ? "is-active" : ""}`}
                  aria-pressed={tool === item.id}
                  onClick={() => setTool(item.id)}
                >
                  <span className="tool-symbol" aria-hidden="true">
                    {item.id === "fill" || item.id === "select" || item.id === "move" ? (
                      <EditorIcon name={item.id} />
                    ) : (
                      item.symbol
                    )}
                  </span>
                  <span>{item.name}</span>
                  <kbd>{item.key}</kbd>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`eraser-button ${eraserMode ? "is-active" : ""}`}
              aria-pressed={eraserMode}
              onClick={() => setEraserMode((value) => !value)}
            >
              <span className="tool-symbol" aria-hidden="true">
                <EditorIcon name="eraser" />
              </span>
              <span>Eraser mode</span>
              <kbd>E</kbd>
            </button>
            <button
              type="button"
              className={`resize-button ${resizeBounds ? "is-active" : ""}`}
              aria-pressed={Boolean(resizeBounds)}
              onClick={toggleResizeMode}
            >
              <span className="tool-symbol" aria-hidden="true">
                <EditorIcon name="resize" />
              </span>
              <span>{resizeBounds ? "Apply resize" : "Resize canvas"}</span>
              <kbd>R</kbd>
            </button>
            <div className="history-buttons" aria-label="History controls">
              <button
                type="button"
                className="history-button"
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                disabled={!historyAvailability.canUndo}
                onClick={() => {
                  setResizeBounds(null);
                  undo();
                }}
              >
                <HistoryIcon direction="back" />
              </button>
              <button
                type="button"
                className="history-button"
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                disabled={!historyAvailability.canRedo}
                onClick={() => {
                  setResizeBounds(null);
                  redo();
                }}
              >
                <HistoryIcon direction="forward" />
              </button>
            </div>


            {tool !== "point" && tool !== "fill" && tool !== "select" && tool !== "move" ? (
              <label className="range-control">
                <span>
                  Size
                  <output>{currentSize} px</output>
                </span>
                <input
                  type="range"
                  min="1"
                  max="64"
                  step="1"
                  value={currentSize}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (tool === "spray") {
                      setSpraySize(value);
                    } else {
                      setBrushSize(value);
                    }
                  }}
                />
              </label>
            ) : null}

            {tool === "spray" ? (
              <label className="range-control">
                <span>
                  Spread
                  <output>{spraySpread}%</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={spraySpread}
                  onChange={(event) =>
                    setSpraySpread(Number(event.target.value))
                  }
                />
              </label>
            ) : null}

          </section>

          <section className="panel-section palette-section">
            <div className="section-title">
              <h2>Palette</h2>
              <span>Global colors</span>
            </div>
            <div className="palette-list">
              {project.palettes.map((palette) => (
                <div className="palette-card" key={palette.id}>
                  <div className="palette-colors">
                    {palette.colors.map((color) => (
                      <div
                        className={[
                          "palette-color",
                          activeColorId === color.id ? "is-active" : "",
                          draggedColorId === color.id ? "is-dragging" : "",
                          dragOverColor?.id === color.id
                            ? `is-drop-${dragOverColor.position}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={color.id}
                        data-palette-color-id={color.id}
                        draggable
                        title="Drag to reorder"
                        onClick={() => setActiveColorId(color.id)}
                        onDragStart={(event) => {
                          const target = event.target;
                          if (
                            target instanceof Element &&
                            target.closest(".color-popover, .remove-color")
                          ) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/x-ccpx-color",
                            color.id,
                          );
                          setDraggedColorId(color.id);
                          setOpenColorId(null);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          if (draggedColorId === color.id) {
                            setDragOverColor(null);
                            return;
                          }
                          const position = dropPositionFor(event);
                          setDragOverColor((current) =>
                            current?.id === color.id && current.position === position
                              ? current
                              : { id: color.id, position },
                          );
                        }}
                        onDragLeave={() =>
                          setDragOverColor((current) =>
                            current?.id === color.id ? null : current,
                          )
                        }
                        onDrop={(event) =>
                          handleColorDrop(event, palette.id, color.id)
                        }
                        onDragEnd={() => {
                          setDraggedColorId(null);
                          setDragOverColor(null);
                        }}
                      >
                        <button
                          type="button"
                          className="color-swatch-button"
                          aria-label={"Select and edit " + color.value}
                          aria-pressed={activeColorId === color.id}
                          aria-expanded={openColorId === color.id}
                          onClick={() => {
                            setActiveColorId(color.id);
                            setOpenColorId((current) =>
                              current === color.id ? null : color.id,
                            );
                          }}
                        >
                          <span
                            className="color-swatch-fill"
                            style={{
                              backgroundColor: paletteColorDrafts[color.id] ?? color.value,
                              opacity: color.alpha ?? 1,
                            }}
                          />
                        </button>
                        <div className="color-summary">
                          <code>{(paletteColorDrafts[color.id] ?? color.value).toUpperCase()}</code>
                          <span>{Math.round((1 - (color.alpha ?? 1)) * 100)}% tr.</span>
                        </div>
                        <button
                          type="button"
                          className="remove-color"
                          onClick={(event) => {
                            event.stopPropagation();
                            removePaletteColor(palette.id, color.id);
                          }}
                          aria-label={"Remove " + color.value}
                        >
                          ×
                        </button>
                        {openColorId === color.id ? (
                          <div
                            className="color-popover"
                            role="dialog"
                            aria-label={"Edit color " + color.value}
                          >
                            <label className="color-popover-field">
                              <span>Color</span>
                              <input
                                type="color"
                                value={paletteColorDrafts[color.id] ?? color.value}
                                onFocus={checkpoint}
                                onChange={(event) =>
                                  queuePaletteColorUpdate(
                                    palette.id,
                                    color.id,
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                            <label className="color-popover-field">
                              <span>
                                Transparency
                                <output>{Math.round((1 - (color.alpha ?? 1)) * 100)}%</output>
                              </span>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={Math.round((1 - (color.alpha ?? 1)) * 100)}
                                onFocus={checkpoint}
                                onChange={(event) =>
                                  updatePaletteAlpha(
                                    palette.id,
                                    color.id,
                                    1 - Number(event.target.value) / 100,
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <button type="button" className="palette-add-color" onClick={() => addPaletteColor(palette.id)}>+ Color</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="canvas-column" aria-label="Drawing area">
          <CanvasStage
            project={project}
            setProject={setProject}
            activeLayerId={activeLayerId}
            activeColorId={activeColorId}
            tool={tool}
            eraserMode={eraserMode}
            brushSize={brushSize}
            spraySize={spraySize}
            spraySpread={spraySpread}
            showGrid={showGrid}
            gridColor={gridColor}
            transparencyLineOpacity={transparencyLineOpacity / 100}
            resizeBounds={resizeBounds}
            onResizeBoundsChange={setResizeBounds}
            fitToken={fitToken}
            selectionResetToken={selectionResetToken}
            onBeforeProjectChange={checkpoint}
            onNotice={showNotice}
            onZoomChange={setZoomPercent}
          />
        </section>

        <aside className="side-panel layers-panel" aria-label="Layers and export">
          <section className="panel-section project-section">
            <div className="section-title">
              <h2>Project</h2>
            </div>
            <div className="side-button-grid">
              <button type="button" className="button" onClick={newProject}>
                New
              </button>
              <button
                type="button"
                className="button"
                onClick={() => fileInputRef.current?.click()}
              >
                Import JSON
              </button>
              <button type="button" className="button" onClick={exportJson}>
                Export JSON
              </button>
            </div>
            <button
              type="button"
              className="button about-button"
              onClick={() => {
                setAboutTab("about");
                setAboutOpen(true);
              }}
            >
              About this software
            </button>
          </section>
          <section className="panel-section export-section">
            <div className="section-title">
              <h2>Export</h2>
            </div>
            <label className="multiplier-field">
              <span>Scale</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={multiplierText}
                onChange={(event) => setMultiplierText(event.target.value)}
                aria-label="Export multiplier"
              />
              <span>×</span>
            </label>
            <div className="export-buttons">
              <button type="button" className="button" disabled={exporting} onClick={() => void exportRaster("png")}>PNG</button>
              <button type="button" className="button" disabled={exporting} onClick={() => void exportRaster("jpg")}>JPG</button>
              <button type="button" className="button" disabled={exporting} onClick={exportSvg}>SVG</button>
            </div>
          </section>

          <section className="panel-section view-section">
            <div className="section-title">
              <h2>View</h2>
            </div>
            <div className="grid-controls-row">
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(event) => setShowGrid(event.target.checked)}
                />
                <span>Show grid</span>
              </label>
              <label className="grid-color-control">
                <span>Grid color</span>
                <input
                  type="color"
                  value={gridColor}
                  onChange={(event) => setGridColor(event.target.value)}
                  disabled={!showGrid}
                />
              </label>
            </div>
            <label className="transparency-opacity-control">
              <span>
                Transparency lines
                <output>{transparencyLineOpacity}%</output>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={transparencyLineOpacity}
                onChange={(event) =>
                  setTransparencyLineOpacity(Number(event.target.value))
                }
                aria-label="Transparency line opacity"
              />
            </label>
          </section>

          <section className="panel-section layers-section">
            <div className="section-title layers-title">
              <h2>Layers</h2>
              <button
                type="button"
                className="square-button"
                aria-label="Add layer"
                title="Add layer"
                onClick={addLayer}
              >
                +
              </button>
            </div>

            <ol className="layer-list">
              {project.layers.map((layer) => (
                <li
                  key={layer.id}
                  className={[
                    "layer-row",
                    activeLayerId === layer.id ? "is-active" : "",
                    draggedLayerId === layer.id ? "is-dragging" : "",
                    dragOverLayer?.id === layer.id
                      ? `is-drop-${dragOverLayer.position}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setActiveLayerId(layer.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (draggedLayerId === layer.id) {
                      setDragOverLayer(null);
                      return;
                    }
                    const position = layerDropIntentFor(event);
                    setDragOverLayer((current) =>
                      current?.id === layer.id && current.position === position
                        ? current
                        : { id: layer.id, position },
                    );
                  }}
                  onDragLeave={() =>
                    setDragOverLayer((current) =>
                      current?.id === layer.id ? null : current,
                    )
                  }
                  onDrop={(event) => handleLayerDrop(event, layer.id)}
                >
                  <button
                    type="button"
                    className="layer-visibility"
                    onClick={(event) => {
                      event.stopPropagation();
                      checkpoint();
                      setProject((current) =>
                        current
                          ? {
                              ...current,
                              layers: current.layers.map((item) =>
                                item.id === layer.id
                                  ? { ...item, visible: !item.visible }
                                  : item,
                              ),
                            }
                          : current,
                      );
                    }}
                    aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name || "layer"}`}
                    title={layer.visible ? "Hide layer" : "Show layer"}
                    aria-pressed={layer.visible}
                  >
                    <LayerVisibilityIcon visible={layer.visible} />
                  </button>
                  <button
                    type="button"
                    className="drag-handle"
                    draggable
                    aria-label={`Drag ${layer.name || "layer"}`}
                    title="Drag to reorder"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", layer.id);
                      setDraggedLayerId(layer.id);
                    }}
                    onDragEnd={() => {
                      setDraggedLayerId(null);
                      setDragOverLayer(null);
                    }}
                  >
                    ⠿
                  </button>
                  <input
                    className="layer-name"
                    value={layer.name}
                    aria-label="Layer name"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => {
                      checkpoint();
                      setActiveLayerId(layer.id);
                    }}
                    onChange={(event) =>
                      renameLayer(layer.id, event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="delete-layer"
                    disabled={project.layers.length === 1}
                    aria-label={`Delete ${layer.name || "layer"}`}
                    title={
                      project.layers.length === 1
                        ? "The last layer cannot be deleted"
                        : "Delete layer"
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteLayer(layer.id);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <div className="view-readouts">
            <div
              className="canvas-size-readout"
              aria-label={`Canvas size: ${displayedWidth} by ${displayedHeight}`}
            >
              Canvas size: {displayedWidth} × {displayedHeight}
            </div>
            <div className="zoom-readout" aria-label={`Zoom level: ${zoomPercent}%`}>
              Zoom level: {zoomPercent}%
            </div>
          </div>
        </aside>
      </div>

      {aboutOpen ? (
        <div
          className="about-overlay"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setAboutOpen(false);
          }}
        >
          <section
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <button
              type="button"
              className="about-close"
              aria-label="Close About this software"
              onClick={() => setAboutOpen(false)}
              autoFocus
            >
              ×
            </button>
            <header className="about-header">
              <span>CCPX · Version {APP_VERSION}</span>
              <h2 id="about-title">About this software</h2>
              <p>A lightweight pixel-art editor built around palettes, layers and exact pixels.</p>
            </header>

            <div className="about-tabs" role="tablist" aria-label="About sections">
              <button type="button" className={`about-tab ${aboutTab === "about" ? "is-active" : ""}`} role="tab" id="about-tab" aria-selected={aboutTab === "about"} aria-controls="about-panel" onClick={() => setAboutTab("about")}>
                About
              </button>
              <button type="button" className={`about-tab ${aboutTab === "tutorial" ? "is-active" : ""}`} role="tab" id="tutorial-tab" aria-selected={aboutTab === "tutorial"} aria-controls="tutorial-panel" onClick={() => setAboutTab("tutorial")}>
                Tutorial
              </button>
              <button type="button" className={`about-tab ${aboutTab === "creator" ? "is-active" : ""}`} role="tab" id="creator-tab" aria-selected={aboutTab === "creator"} aria-controls="creator-panel" onClick={() => setAboutTab("creator")}>
                Creator
              </button>
            </div>

            {aboutTab === "about" ? (
              <div className="about-project" id="about-panel" role="tabpanel" aria-labelledby="about-tab">
                <section className="about-project-copy">
                  <h3>Simple pixel art, without distractions.</h3>
                  <p>CCPX is free and always will be. It is designed as a small, essential editor that gets you from an idea to finished pixel art quickly.</p>
                  <p>The project deliberately favors speed and ease of use over the large collections of tools and advanced features found in more complex pixel-art software.</p>
                </section>

                <ul className="about-principles">
                  <li><strong>Free forever</strong><span>No subscriptions, trials or paid feature tiers.</span></li>
                  <li><strong>No data collection</strong><span>No personal, usage or project data is collected.</span></li>
                  <li><strong>Public source code</strong><span>The code is open for anyone to inspect and learn from.</span></li>
                  <li><strong>No account required</strong><span>Open the editor and start drawing immediately.</span></li>
                </ul>

                <a className="about-donate" href="https://ko-fi.com/outertales" target="_blank" rel="noreferrer">
                  <span className="about-donate-copy">
                    <strong>Support CCPX on Ko-fi</strong>
                    <span>If you find this software useful or fun, consider donating to help keep the project active.</span>
                  </span>
                  <img className="kofi-logo" src={`${PUBLIC_BASE_PATH}/kofi-logo.png`} alt="" aria-hidden="true" />
                </a>
              </div>
            ) : aboutTab === "tutorial" ? (
              <div className="about-content" id="tutorial-panel" role="tabpanel" aria-labelledby="tutorial-tab">
                <section>
                  <h3>Start here</h3>
                  <ol>
                    <li>Create a canvas and prepare the initial palette.</li>
                    <li>Select a layer and a palette color.</li>
                    <li>Choose a tool, then draw with the left mouse button.</li>
                  </ol>
                </section>

                <section>
                  <h3>Drawing and navigation</h3>
                  <ul>
                    <li>Right click temporarily uses the current shape as an eraser.</li>
                    <li><kbd>E</kbd> toggles Eraser mode. <kbd>1</kbd>–<kbd>7</kbd> select the tools.</li>
                    <li>Square and Circle show their footprint before drawing; Size changes it.</li>
                    <li>Spray uses Size and Spread. Fill replaces a connected area.</li>
                    <li>Middle-mouse drag pans; the mouse wheel zooms around the pointer.</li>
                  </ul>
                </section>

                <section>
                  <h3>Selection and canvas size</h3>
                  <ul>
                    <li>Selection creates a rectangular area; Move selection repositions it.</li>
                    <li>Right click cancels a selection in either selection tool.</li>
                    <li><kbd>R</kbd> enters Resize canvas. Drag a yellow side arrow, then press <kbd>R</kbd> again to apply.</li>
                    <li>Resizing never stretches the art: expansion adds space and reduction crops it.</li>
                  </ul>
                </section>

                <section>
                  <h3>Palette and layers</h3>
                  <ul>
                    <li>Pixels reference palette colors. Editing a color or its opacity updates every linked pixel.</li>
                    <li>Colors can be added, removed and reordered. Removing one also removes its pixels.</li>
                    <li>Layers are composited from bottom to top; use the eye icon to hide them.</li>
                    <li>Drag near a layer edge to reorder. Drop in its center when the <strong>+</strong> appears to merge; the higher layer wins.</li>
                  </ul>
                </section>

                <section>
                  <h3>History, view and files</h3>
                  <ul>
                    <li><kbd>Ctrl+Z</kbd> undoes; <kbd>Ctrl+Shift+Z</kbd> redoes. The arrow buttons show availability.</li>
                    <li>Grid visibility, grid color and transparency-line strength affect only the editor view.</li>
                    <li>Export/import JSON to preserve the project. View position and active tools are not stored.</li>
                    <li>PNG keeps transparency, JPG replaces it with white, and SVG preserves layers as groups.</li>
                  </ul>
                </section>
              </div>
            ) : (
              <div className="about-creator" id="creator-panel" role="tabpanel" aria-labelledby="creator-tab">
                <div className="creator-logo-frame">
                  <img className="creator-logo" src={`${PUBLIC_BASE_PATH}/outer-logo.png`} alt="OuterTales logo" />
                </div>
                <section className="creator-profile">
                  <span className="creator-eyebrow">Creator of CCPX</span>
                  <h3>OuterTales</h3>
                  <p>Artist and developer from Italy.</p>
                  <div className="creator-links">
                    <a className="creator-link" href="https://outertales.com" target="_blank" rel="noreferrer">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M3 12h18M12 3c2.6 2.5 4 5.5 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.5-4-9s1.4-6.5 4-9Z" />
                      </svg>
                      <span>outertales.com</span>
                    </a>
                    <a className="creator-link" href="https://instagram.com/outertales" target="_blank" rel="noreferrer">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="5" />
                        <circle cx="12" cy="12" r="4" />
                        <circle className="creator-icon-dot" cx="17.4" cy="6.7" r="1" />
                      </svg>
                      <span>instagram.com/outertales</span>
                    </a>
                  </div>
                </section>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
