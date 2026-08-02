"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,

  useRef,
  useState,
} from "react";
import {
  parsePixelKey,
  parseProjectJson,
  projectColorMap,
  projectToSvg,
  serializeProject,
  type ProjectFile,
  type Tool,
} from "./editor-core";
import CanvasStage from "./editor/CanvasStage";
import SetupScreen from "./editor/SetupScreen";

type NoticeTone = "ok" | "error";


interface Notice {
  tone: NoticeTone;
  text: string;
}

const TOOLS: Array<{
  id: Tool;
  name: string;
  key: string;
  symbol: string;
}> = [
  { id: "point", name: "Punto", key: "1", symbol: "·" },
  { id: "square", name: "Quadrato", key: "2", symbol: "■" },
  { id: "circle", name: "Cerchio", key: "3", symbol: "●" },
  { id: "spray", name: "Spray", key: "4", symbol: "⁙" },
  { id: "fill", name: "Riempi", key: "5", symbol: "F" },
];

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
                "Il browser non riesce a generare un'immagine di queste dimensioni.",
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
          "Il browser non riesce a generare un'immagine di queste dimensioni.",
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
      "Le dimensioni richieste superano la capacità numerica del browser.",
    );
  }

  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
  } catch {
    throw new Error(
      "Il browser non riesce ad allocare un'immagine di queste dimensioni.",
    );
  }

  if (canvas.width !== width || canvas.height !== height) {
    throw new Error(
      "Il browser non riesce ad allocare un'immagine di queste dimensioni.",
    );
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas non disponibile per l'esportazione.");
  }

  context.imageSmoothingEnabled = false;
  if (format === "jpg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  } else {
    context.clearRect(0, 0, width, height);
  }

  const colors = projectColorMap(project);
  for (const layer of [...project.layers].reverse()) {
    if (layer.visible === false) continue;
    for (const [key, colorId] of Object.entries(layer.pixels)) {
      const point = parsePixelKey(key);
      const fill = colors.get(colorId);
      if (!point || !fill) {
        continue;
      }
      context.fillStyle = fill;
      context.fillRect(
        point.x * multiplier,
        point.y * multiplier,
        multiplier,
        multiplier,
      );
    }
  }

  return canvasBlob(canvas, format === "png" ? "image/png" : "image/jpeg");
}

export default function PixelEditor() {
  const [project, setProject] = useState<ProjectFile | null>(null);
  const [tool, setTool] = useState<Tool>("point");
  const [eraserMode, setEraserMode] = useState(false);
  const [brushSize, setBrushSize] = useState(3);
  const [spraySize, setSpraySize] = useState(9);
  const [spraySpread, setSpraySpread] = useState(45);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeColorId, setActiveColorId] = useState<string | null>(null);
  const [multiplierText, setMultiplierText] = useState("1");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showNotice = useCallback((tone: NoticeTone, text: string) => {
    setNotice({ tone, text });
  }, []);

  const openProject = useCallback((nextProject: ProjectFile) => {
    setProject(nextProject);
    setActiveLayerId(nextProject.layers[0]?.id ?? null);
    setActiveColorId(nextProject.palettes.flatMap((palette) => palette.colors)[0]?.id ?? null);
    setTool("point");
    setEraserMode(false);
    setNotice(null);
    setFitToken((value) => value + 1);
  }, []);

  const importFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const imported = parseProjectJson(text);
        openProject(imported);
        showNotice("ok", "Progetto importato.");
      } catch (error) {
        showNotice(
          "error",
          errorText(error, "Impossibile importare il progetto."),
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
    if (!project) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const toolForCode: Partial<Record<KeyboardEvent["code"], Tool>> = {
        Digit1: "point",
        Digit2: "square",
        Digit3: "circle",
        Digit4: "spray",
        Digit5: "fill",
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
  }, [project]);

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
      showNotice("ok", "Progetto JSON esportato.");
    } catch (error) {
      showNotice(
        "error",
        errorText(error, "Impossibile esportare il progetto."),
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
      showNotice("ok", "SVG esportato.");
    } catch (error) {
      showNotice("error", errorText(error, "Impossibile esportare l'SVG."));
    }
  }, [project, showNotice]);

  const exportRaster = useCallback(
    async (format: "png" | "jpg") => {
      if (!project || exporting) {
        return;
      }
      const multiplier = Number(multiplierText);
      if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
        showNotice("error", "Il moltiplicatore deve essere un intero positivo.");
        return;
      }

      setExporting(true);
      try {
        const blob = await renderRaster(project, multiplier, format);
        triggerDownload(blob, `pixel-art.${format}`);
        showNotice("ok", `${format.toUpperCase()} esportato.`);
      } catch (error) {
        showNotice(
          "error",
          errorText(error, "Impossibile esportare l'immagine."),
        );
      } finally {
        setExporting(false);
      }
    },
    [exporting, multiplierText, project, showNotice],
  );

  const addPaletteColor = useCallback((paletteId: string) => { const id = createId("color"); setProject((current) => current ? { ...current, palettes: current.palettes.map((palette) => palette.id === paletteId ? { ...palette, colors: [...palette.colors, { id, value: "#ffffff" }] } : palette) } : current); setActiveColorId(id); }, []);
  const removePaletteColor = useCallback((paletteId: string, colorId: string) => { if (!project) return; const palette = project.palettes.find((item) => item.id === paletteId); if (!palette || !window.confirm("Rimuovere questo colore e tutti i pixel associati?")) return; setProject((current) => current ? { ...current, palettes: current.palettes.map((item) => item.id === paletteId ? { ...item, colors: item.colors.filter((color) => color.id !== colorId) } : item), layers: current.layers.map((layer) => ({ ...layer, pixels: Object.fromEntries(Object.entries(layer.pixels).filter(([, id]) => id !== colorId)) })) } : current); if (activeColorId === colorId) setActiveColorId(project.palettes.flatMap((item) => item.colors).find((color) => color.id !== colorId)?.id ?? null); }, [activeColorId, project]);

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
    [],
  );

  const addLayer = useCallback(() => {
    const id = createId("layer");
    setProject((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        layers: [
          { id, name: `Livello ${current.layers.length + 1}`, visible: true, pixels: {} },
          ...current.layers,
        ],
      };
    });
    setActiveLayerId(id);
  }, []);

  const deleteLayer = useCallback(
    (layerId: string) => {
      if (!project || project.layers.length <= 1) {
        return;
      }
      const remaining = project.layers.filter((layer) => layer.id !== layerId);
      setProject({ ...project, layers: remaining });
      if (activeLayerId === layerId) {
        setActiveLayerId(remaining[0]?.id ?? null);
      }
    },
    [activeLayerId, project],
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
  }, []);

  const handleLayerDrop = useCallback(
    (event: DragEvent<HTMLElement>, targetId: string) => {
      event.preventDefault();
      const sourceId =
        draggedLayerId || event.dataTransfer.getData("text/plain");
      setDraggedLayerId(null);
      setDragOverLayerId(null);
      if (!sourceId || sourceId === targetId) {
        return;
      }
      setProject((current) => {
        if (!current) {
          return current;
        }
        const sourceIndex = current.layers.findIndex(
          (layer) => layer.id === sourceId,
        );
        const targetIndex = current.layers.findIndex(
          (layer) => layer.id === targetId,
        );
        if (sourceIndex < 0 || targetIndex < 0) {
          return current;
        }
        const reordered = [...current.layers];
        const [moved] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, moved);
        return { ...current, layers: reordered };
      });
    },
    [draggedLayerId],
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

  return (
    <main className="editor-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <div>
            <strong>CCPX</strong>
            <span>
              {project.width} × {project.height}
            </span>
          </div>
        </div>

        <div className="topbar-actions" aria-label="File ed esportazione">
          <div className="toolbar-group">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => fileInputRef.current?.click()}
            >
              Importa JSON
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={exportJson}
            >
              Esporta JSON
            </button>
          </div>

          <div className="toolbar-divider" aria-hidden="true" />

          <div className="toolbar-group export-group">
            <label className="multiplier-field">
              <span>Scala</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={multiplierText}
                onChange={(event) => setMultiplierText(event.target.value)}
                aria-label="Moltiplicatore esportazione"
              />
              <span>×</span>
            </label>
            <button
              type="button"
              className="button button-quiet"
              disabled={exporting}
              onClick={() => void exportRaster("png")}
            >
              PNG
            </button>
            <button
              type="button"
              className="button button-quiet"
              disabled={exporting}
              onClick={() => void exportRaster("jpg")}
            >
              JPG
            </button>
            <button
              type="button"
              className="button button-quiet"
              disabled={exporting}
              onClick={exportSvg}
            >
              SVG
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={handleFileInput}
          tabIndex={-1}
        />
      </header>

      {notice ? (
        <div
          className={`notice notice-${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="Chiudi messaggio"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="editor-workspace">
        <aside className="side-panel tools-panel" aria-label="Strumenti e palette">
          <section className="panel-section">
            <div className="section-title">
              <h2>Strumenti</h2>
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
                    {item.symbol}
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
              <span aria-hidden="true">◇</span>
              <span>Gomma</span>
              <kbd>E</kbd>
            </button>

            {tool !== "point" && tool !== "fill" ? (
              <label className="range-control">
                <span>
                  Dimensione
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
                  Dispersione
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

            <p className="interaction-hint">
              <span>Click destro</span> cancella
              <br />
              <span>Spazio + trascina</span> sposta
              <br />
              <span>Rotella</span> zoom
            </p>
          </section>

          <section className="panel-section palette-section">
            <div className="section-title">
              <h2>Palette</h2>
              <span>Colori globali</span>
            </div>
            <div className="palette-list">
              {project.palettes.map((palette) => (
                <div className="palette-card" key={palette.id}>
                  <h3>{palette.name || "Senza nome"}</h3>
                  <div className="palette-colors">
                    {palette.colors.map((color) => (
                      <div
                        className={`palette-color ${activeColorId === color.id ? "is-active" : ""}`}
                        key={color.id}
                      >
                        <button
                          type="button"
                          className="color-select"
                          aria-label={`Seleziona ${color.value}`}
                          aria-pressed={activeColorId === color.id}
                          onClick={() => setActiveColorId(color.id)}
                        >
                          <span
                            className="color-chip"
                            style={{ backgroundColor: color.value }}
                          />
                          <code>{color.value.toUpperCase()}</code>
                        </button>
                        <label className="color-edit">
                          <span className="visually-hidden">
                            Modifica {color.value}
                          </span>
                          <input
                            type="color"
                            value={color.value}
                            onChange={(event) =>
                              updatePaletteColor(
                                palette.id,
                                color.id,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <button type="button" className="remove-color" onClick={() => removePaletteColor(palette.id, color.id)} aria-label={`Rimuovi ${color.value}`}>×</button>
                      </div>
                    ))}
                    <button type="button" className="palette-add-color" onClick={() => addPaletteColor(palette.id)}>+ Colore</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="canvas-column" aria-label="Area di disegno">
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
            fitToken={fitToken}
            onNotice={showNotice}
          />
        </section>

        <aside className="side-panel layers-panel" aria-label="Livelli">
          <section className="panel-section layers-section">
            <div className="section-title layers-title">
              <div>
                <h2>Livelli</h2>
                <span>In alto davanti</span>
              </div>
              <button
                type="button"
                className="square-button"
                aria-label="Aggiungi livello"
                title="Aggiungi livello"
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
                    dragOverLayerId === layer.id ? "is-drag-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setActiveLayerId(layer.id)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverLayerId(layer.id);
                  }}
                  onDragLeave={() =>
                    setDragOverLayerId((current) =>
                      current === layer.id ? null : current,
                    )
                  }
                  onDrop={(event) => handleLayerDrop(event, layer.id)}
                >
                  <button type="button" className="layer-visibility" onClick={(event) => { event.stopPropagation(); setProject((current) => current ? { ...current, layers: current.layers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item) } : current); }} aria-label={`${layer.visible ? "Nascondi" : "Mostra"} ${layer.name || "livello"}`}>{layer.visible ? "●" : "○"}</button>
                  <button
                    type="button"
                    className="drag-handle"
                    draggable
                    aria-label={`Trascina ${layer.name || "livello"}`}
                    title="Trascina per riordinare"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", layer.id);
                      setDraggedLayerId(layer.id);
                    }}
                    onDragEnd={() => {
                      setDraggedLayerId(null);
                      setDragOverLayerId(null);
                    }}
                  >
                    ⠿
                  </button>
                  <input
                    className="layer-name"
                    value={layer.name}
                    aria-label="Nome livello"
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => setActiveLayerId(layer.id)}
                    onChange={(event) =>
                      renameLayer(layer.id, event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="delete-layer"
                    disabled={project.layers.length === 1}
                    aria-label={`Elimina ${layer.name || "livello"}`}
                    title={
                      project.layers.length === 1
                        ? "L'ultimo livello non può essere eliminato"
                        : "Elimina livello"
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
        </aside>
      </div>
    </main>
  );
}












