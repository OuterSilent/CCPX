"use client";

import { FormEvent, useState } from "react";

import type { Palette, ProjectFile } from "../editor-core";

export interface SetupScreenProps {
  onCreate: (project: ProjectFile) => void;
  onImport: () => void;
  notice: { tone: "ok" | "error"; text: string } | null;
}

const DEFAULT_COLORS = [
  "#17191f",
  "#f4f1ea",
  "#ff5d73",
  "#ffd166",
  "#53d8fb",
];

let fallbackId = 0;

function createId(prefix: string): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  fallbackId += 1;
  return `${prefix}_${Date.now().toString(36)}_${fallbackId.toString(36)}`;
}

function createPalette(): Palette {
  return {
    id: createId("palette"),
    name: "Palette",
    colors: DEFAULT_COLORS.map((value) => ({
      id: createId("color"),
      value,
      alpha: 1,
    })),
  };
}

function isPositiveSafeInteger(value: string): boolean {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

export default function SetupScreen({
  onCreate,
  onImport,
  notice,
}: SetupScreenProps) {
  const [width, setWidth] = useState("32");
  const [height, setHeight] = useState("32");
  const [palettes, setPalettes] = useState<Palette[]>(() => [
    createPalette(),
  ]);
  const [validationError, setValidationError] = useState<string | null>(null);

  function updateColor(
    paletteId: string,
    colorId: string,
    value: string,
  ) {
    setPalettes((current) =>
      current.map((palette) =>
        palette.id === paletteId
          ? {
              ...palette,
              colors: palette.colors.map((color) =>
                color.id === colorId ? { ...color, value } : color,
              ),
            }
          : palette,
      ),
    );
  }


  function addColor(paletteId: string) {
    setPalettes((current) =>
      current.map((palette) =>
        palette.id === paletteId
          ? {
              ...palette,
              colors: [
                ...palette.colors,
                { id: createId("color"), value: "#000000", alpha: 1 },
              ],
            }
          : palette,
      ),
    );
  }

  function removeColor(paletteId: string, colorId: string) {
    setPalettes((current) =>
      current.map((palette) =>
        palette.id === paletteId && palette.colors.length > 1
          ? {
              ...palette,
              colors: palette.colors.filter((color) => color.id !== colorId),
            }
          : palette,
      ),
    );
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    if (!isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) {
      setValidationError(
        "Width and height must be positive integers.",
      );
      return;
    }

    const project: ProjectFile = {
      version: 1,
      width: Number(width),
      height: Number(height),
      palettes: palettes.map((palette) => ({
        ...palette,
        name: palette.name.trim(),
        colors: palette.colors.map((color) => ({ ...color })),
      })),
      layers: [
        {
          id: createId("layer"),
          name: "Layer 1",
          visible: true,
          pixels: {},
        },
      ],
    };

    onCreate(project);
  }

  const activeNotice = validationError
    ? { tone: "error" as const, text: validationError }
    : notice;

  return (
    <section className="setup-screen" aria-labelledby="setup-title">
      <div className="setup-card">
        <header className="setup-header">
          <p className="setup-eyebrow">CCPX Pixel Editor · v1.03</p>
          <h1 id="setup-title">New project</h1>
          <p className="setup-description">
            Choose the canvas dimensions and prepare your colors before
            you begin.
          </p>
        </header>

        {activeNotice ? (
          <p
            className={`setup-notice setup-notice--${activeNotice.tone}`}
            role={activeNotice.tone === "error" ? "alert" : "status"}
          >
            {activeNotice.text}
          </p>
        ) : null}

        <form className="setup-form" onSubmit={createProject} noValidate>
          <fieldset className="setup-section setup-dimensions">
            <legend>Dimensions</legend>
            <div className="setup-dimension-grid">
              <label className="setup-field">
                <span>Width</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                  aria-invalid={!isPositiveSafeInteger(width)}
                  required
                />
              </label>

              <span className="setup-dimension-separator" aria-hidden="true">
                ×
              </span>

              <label className="setup-field">
                <span>Height</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={height}
                  onChange={(event) => setHeight(event.target.value)}
                  aria-invalid={!isPositiveSafeInteger(height)}
                  required
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="setup-section setup-palettes">
            <legend>Palette</legend>


            <div className="setup-palette-list">
              {palettes.map((palette) => (
                <article className="setup-palette" key={palette.id}>
                  <div
                    className="setup-color-list"
                    aria-label="Palette colors"
                  >
                    {palette.colors.map((color, colorIndex) => (
                      <div className="setup-color" key={color.id}>
                        <label className="setup-color-picker">
                          <span>Color {colorIndex + 1}</span>
                          <input
                            type="color"
                            value={color.value}
                            onChange={(event) =>
                              updateColor(
                                palette.id,
                                color.id,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <span className="setup-color-value">
                          {color.value.toUpperCase()}
                        </span>
                        <button
                          className="setup-color-remove"
                          type="button"
                          onClick={() => removeColor(palette.id, color.id)}
                          disabled={palette.colors.length === 1}
                          aria-label={`Remove color ${colorIndex + 1} from the palette`}
                          title={
                            palette.colors.length === 1
                              ? "At least one color is required"
                              : "Remove color"
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    <button
                      className="setup-add-color"
                      type="button"
                      onClick={() => addColor(palette.id)}
                    >
                      + Color
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </fieldset>

          <div className="setup-actions">
            <button
              className="setup-secondary-button setup-import-button"
              type="button"
              onClick={onImport}
            >
              Import JSON
            </button>
            <button className="setup-primary-button" type="submit">
              Create canvas
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}






