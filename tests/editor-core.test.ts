import { describe, expect, it } from "vitest";
import {
  applyStamp,
  compositeProject,
  floodFill,
  linePoints,
  parsePixelKey,
  parseProjectJson,
  pixelKey,
  projectColorMap,
  projectToSvg,
  serializeProject,
  stampCoordinates,
  validateProjectFile,
  type ProjectFile,
} from "../app/editor-core";

function projectFixture(): ProjectFile {
  return {
    version: 1,
    width: 4,
    height: 3,
    palettes: [
      {
        id: "main",
        name: "Principale",
        colors: [
          { id: "red", value: "#FF0000" },
          { id: "blue", value: "#0000FF" },
        ],
      },
    ],
    layers: [
      {
        id: "top",
        name: "Superiore",
        visible: true,
        pixels: { "1,1": "red" },
      },
      {
        id: "bottom",
        name: "Inferiore",
        visible: true,
        pixels: { "0,0": "blue", "1,1": "blue" },
      },
    ],
  };
}

describe("coordinate e geometrie", () => {
  it("converte le chiavi pixel in entrambe le direzioni", () => {
    expect(pixelKey(12, 7)).toBe("12,7");
    expect(parsePixelKey("-2,15")).toEqual({ x: -2, y: 15 });
    expect(parsePixelKey("2:15")).toBeNull();
    expect(parsePixelKey("2.5,15")).toBeNull();
  });

  it("genera una linea intera inclusiva e continua", () => {
    expect(linePoints({ x: 0, y: 0 }, { x: 4, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 2 },
    ]);
    expect(linePoints({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([
      { x: 2, y: 2 },
    ]);
  });

  it("genera punto, quadrato e cerchio pieni", () => {
    expect(stampCoordinates("point", { x: 3, y: 4 }, { size: 8 })).toEqual([
      { x: 3, y: 4 },
    ]);

    const square = stampCoordinates("square", { x: 1, y: 1 }, { size: 3 });
    expect(square).toHaveLength(9);
    expect(square).toContainEqual({ x: 0, y: 0 });
    expect(square).toContainEqual({ x: 2, y: 2 });

    expect(
      stampCoordinates("circle", { x: 1, y: 1 }, { size: 3 }),
    ).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ]);
  });

  it("rende lo spray deterministico tramite RNG iniettabile", () => {
    const values = [0.1, 0.9, 0.1, 0.9, 0.1];
    let index = 0;
    const points = stampCoordinates("spray", { x: 1, y: 1 }, {
      size: 3,
      spread: 50,
      random: () => values[index++],
    });

    expect(points).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ]);
    expect(
      stampCoordinates("spray", { x: 1, y: 1 }, { size: 3, spread: 0 }),
    ).toEqual([]);
  });
});

describe("disegno e compositing", () => {
  it("dipinge nei bounds senza mutare i pixel iniziali", () => {
    const initial = { "0,0": "blue" };
    const result = applyStamp(
      initial,
      [
        { x: -1, y: 0 },
        { x: 1, y: 1 },
        { x: 4, y: 2 },
      ],
      { width: 4, height: 3, colorId: "red" },
    );

    expect(initial).toEqual({ "0,0": "blue" });
    expect(result).toEqual({ "0,0": "blue", "1,1": "red" });
  });

  it("cancella con erase o con colorId null", () => {
    const pixels = { "0,0": "red", "1,1": "blue" };
    const erased = applyStamp(pixels, [{ x: 0, y: 0 }], {
      width: 2,
      height: 2,
      colorId: "red",
      erase: true,
    });
    const erasedWithNull = applyStamp(erased, [{ x: 1, y: 1 }], {
      width: 2,
      height: 2,
      colorId: null,
    });

    expect(erasedWithNull).toEqual({});
  });

  it("considera il primo livello come quello superiore", () => {
    expect(compositeProject(projectFixture())).toEqual({
      "0,0": "blue",
      "1,1": "red",
    });
  });

  it("mantiene nei pixel il colorId e risolve il valore corrente della palette", () => {
    const project = projectFixture();
    expect(compositeProject(project)["1,1"]).toBe("red");
    expect(projectColorMap(project).get("red")).toBe("#FF0000");

    project.palettes[0].colors[0].value = "#00FF00";
    expect(compositeProject(project)["1,1"]).toBe("red");
    expect(projectColorMap(project).get("red")).toBe("#00FF00");
  });

  it("ignora i livelli nascosti durante il compositing", () => {
    const project = projectFixture();
    project.layers[0].visible = false;
    expect(compositeProject(project)).toEqual({
      "0,0": "blue",
      "1,1": "blue",
    });
  });

  it("riempie solo la regione ortogonale senza mutare i pixel iniziali", () => {
    const initial = {
      "0,0": "red",
      "1,0": "red",
      "1,1": "blue",
      "2,1": "red",
    };
    const result = floodFill(initial, { x: 0, y: 0 }, {
      width: 3,
      height: 2,
      colorId: "blue",
    });

    expect(initial).toEqual({
      "0,0": "red",
      "1,0": "red",
      "1,1": "blue",
      "2,1": "red",
    });
    expect(result).toEqual({
      "0,0": "blue",
      "1,0": "blue",
      "1,1": "blue",
      "2,1": "red",
    });
  });

  it("riempie il trasparente e cancella una regione contigua", () => {
    const divided = { "1,0": "blue", "1,1": "blue", "1,2": "blue" };
    const filled = floodFill(divided, { x: 0, y: 0 }, {
      width: 3,
      height: 3,
      colorId: "red",
    });
    expect(filled).toMatchObject({
      "0,0": "red",
      "0,1": "red",
      "0,2": "red",
    });
    expect(filled["2,0"]).toBeUndefined();

    const erased = floodFill(
      { "0,0": "red", "1,0": "red", "2,0": "blue", "2,1": "red" },
      { x: 0, y: 0 },
      { width: 3, height: 2, colorId: null },
    );
    expect(erased).toEqual({ "2,0": "blue", "2,1": "red" });
  });
});

describe("file progetto JSON v1", () => {
  it("esegue il round-trip senza includere stato UI", () => {
    const runtimeProject = {
      ...projectFixture(),
      zoom: 8,
      pan: { x: 20, y: -10 },
      activeTool: "circle",
    } as ProjectFile & {
      zoom: number;
      pan: { x: number; y: number };
      activeTool: string;
    };

    const json = serializeProject(runtimeProject);
    expect(json).not.toContain('"zoom"');
    expect(json).not.toContain('"pan"');
    expect(json).not.toContain('"activeTool"');
    expect(parseProjectJson(json)).toEqual(projectFixture());
  });

  it("accetta dimensioni positive senza un limite applicativo", () => {
    const project = projectFixture();
    project.width = 100_000;
    project.height = 100_000;
    expect(validateProjectFile(project).width).toBe(100_000);
  });

  it.each([
    ["versione", { version: 2 }],
    ["larghezza", { width: 0 }],
    ["palette mancanti", { palettes: [] }],
    [
      "colore non #RRGGBB",
      {
        palettes: [
          {
            id: "main",
            name: "Main",
            colors: [{ id: "red", value: "#F00" }],
          },
        ],
      },
    ],
    [
      "colorId duplicato",
      {
        palettes: [
          {
            id: "one",
            name: "One",
            colors: [{ id: "same", value: "#112233" }],
          },
          {
            id: "two",
            name: "Two",
            colors: [{ id: "same", value: "#445566" }],
          },
        ],
      },
    ],
    [
      "pixel fuori dai bounds",
      {
        layers: [{ id: "top", name: "Top", pixels: { "4,0": "red" } }],
      },
    ],
    [
      "coordinate pixel non canoniche",
      {
        layers: [{ id: "top", name: "Top", pixels: { "01,0": "red" } }],
      },
    ],
    [
      "colorId inesistente",
      {
        layers: [{ id: "top", name: "Top", pixels: { "0,0": "missing" } }],
      },
    ],
  ])("rifiuta %s senza produrre un progetto parziale", (_label, patch) => {
    expect(() =>
      validateProjectFile({ ...projectFixture(), ...patch }),
    ).toThrow(Error);
  });

  it("importa la visibilità legacy e rifiuta valori non booleani", () => {
    const legacy = JSON.parse(serializeProject(projectFixture())) as {
      layers: Array<Record<string, unknown>>;
    };
    for (const layer of legacy.layers) {
      delete layer.visible;
    }
    expect(validateProjectFile(legacy).layers.every((layer) => layer.visible)).toBe(true);

    legacy.layers[0].visible = "sì";
    expect(() => validateProjectFile(legacy)).toThrow("visible");
  });

  it("mantiene la visibilità dei livelli nel JSON", () => {
    const project = projectFixture();
    project.layers[0].visible = false;
    expect(parseProjectJson(serializeProject(project)).layers[0].visible).toBe(false);
  });

  it("accetta palette vuote solo se nessun pixel usa colori rimossi", () => {
    const project = projectFixture();
    project.palettes[0].colors = [];
    project.layers.forEach((layer) => {
      layer.pixels = {};
    });
    expect(parseProjectJson(serializeProject(project)).palettes[0].colors).toEqual([]);

    project.layers[0].pixels = { "0,0": "red" };
    expect(() => validateProjectFile(project)).toThrow("colorId inesistente");
  });
  it("restituisce un errore leggibile per sintassi JSON non valida", () => {
    expect(() => parseProjectJson("{oops")).toThrow("JSON non valido");
  });
});

describe("SVG", () => {
  it("esporta gruppi bottom-first, colori risolti e nomi escapati", () => {
    const project = projectFixture();
    project.layers[0].id = 'top"layer';
    project.layers[0].name = '<Top & "speciale">';
    const svg = projectToSvg(project);

    expect(svg).toContain('viewBox="0 0 4 3"');
    expect(svg).toContain('fill="#FF0000"');
    expect(svg).toContain('fill="#0000FF"');
    expect(svg).toContain(
      "<title>&lt;Top &amp; &quot;speciale&quot;&gt;</title>",
    );
    expect(svg).toContain('data-layer-id="top&quot;layer"');
    expect(svg.indexOf('data-layer-id="bottom"')).toBeLessThan(
      svg.indexOf('data-layer-id="top&quot;layer"'),
    );
    expect(svg).toContain(
      '<rect x="1" y="1" width="1" height="1" fill="#FF0000" />',
    );
  });

  it("omette i livelli nascosti", () => {
    const project = projectFixture();
    project.layers[0].visible = false;
    const svg = projectToSvg(project);
    expect(svg).not.toContain('data-layer-id="top"');
    expect(svg).toContain('data-layer-id="bottom"');
  });
});
