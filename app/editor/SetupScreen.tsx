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

function createPalette(number: number): Palette {
  return {
    id: createId("palette"),
    name: `Palette ${number}`,
    colors: DEFAULT_COLORS.map((value) => ({
      id: createId("color"),
      value,
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
    createPalette(1),
  ]);
  const [validationError, setValidationError] = useState<string | null>(null);

  function updatePaletteName(paletteId: string, name: string) {
    setPalettes((current) =>
      current.map((palette) =>
        palette.id === paletteId ? { ...palette, name } : palette,
      ),
    );
  }

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

  function addPalette() {
    setPalettes((current) => [
      ...current,
      createPalette(current.length + 1),
    ]);
  }

  function removePalette(paletteId: string) {
    setPalettes((current) =>
      current.length > 1
        ? current.filter((palette) => palette.id !== paletteId)
        : current,
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
                { id: createId("color"), value: "#000000" },
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
        "Larghezza e altezza devono essere numeri interi positivi.",
      );
      return;
    }

    if (palettes.some((palette) => palette.name.trim().length === 0)) {
      setValidationError("Assegna un nome a ogni palette.");
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
          name: "Livello 1",
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
          <p className="setup-eyebrow">CCPX Pixel Editor</p>
          <h1 id="setup-title">Nuovo progetto</h1>
          <p className="setup-description">
            Scegli le dimensioni del canvas e prepara i colori prima di
            iniziare.
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
            <legend>Dimensioni</legend>
            <div className="setup-dimension-grid">
              <label className="setup-field">
                <span>Larghezza</span>
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
                <span>Altezza</span>
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
            <div className="setup-section-heading">
              <legend>Palette</legend>
              <button
                className="setup-secondary-button"
                type="button"
                onClick={addPalette}
              >
                + Aggiungi palette
              </button>
            </div>

            <div className="setup-palette-list">
              {palettes.map((palette, paletteIndex) => (
                <article className="setup-palette" key={palette.id}>
                  <div className="setup-palette-heading">
                    <label className="setup-field setup-palette-name">
                      <span>Nome palette {paletteIndex + 1}</span>
                      <input
                        type="text"
                        value={palette.name}
                        onChange={(event) =>
                          updatePaletteName(palette.id, event.target.value)
                        }
                        aria-invalid={palette.name.trim().length === 0}
                        required
                      />
                    </label>
                    <button
                      className="setup-icon-button"
                      type="button"
                      onClick={() => removePalette(palette.id)}
                      disabled={palettes.length === 1}
                      aria-label={`Rimuovi ${palette.name || `palette ${paletteIndex + 1}`}`}
                      title={
                        palettes.length === 1
                          ? "Serve almeno una palette"
                          : "Rimuovi palette"
                      }
                    >
                      Rimuovi
                    </button>
                  </div>

                  <div
                    className="setup-color-list"
                    aria-label={`Colori di ${palette.name || `palette ${paletteIndex + 1}`}`}
                  >
                    {palette.colors.map((color, colorIndex) => (
                      <div className="setup-color" key={color.id}>
                        <label className="setup-color-picker">
                          <span>Colore {colorIndex + 1}</span>
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
                          aria-label={`Rimuovi colore ${colorIndex + 1} da ${palette.name || `palette ${paletteIndex + 1}`}`}
                          title={
                            palette.colors.length === 1
                              ? "Serve almeno un colore"
                              : "Rimuovi colore"
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
                      + Colore
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
              Importa JSON
            </button>
            <button className="setup-primary-button" type="submit">
              Crea canvas
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}






