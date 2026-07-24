import { beforeEach, expect, it } from "vitest";
import { renderDocument } from "../src/render";
import { SURFACE_KINDS } from "../src/types";
import { fixturePayload } from "./fixtures";

function editorialPayload() {
  const payload = fixturePayload();
  payload.brandIr.schemaVersion = "0.3.0";
  Object.assign(payload.brandIr.colors, {
    "color.paper": { value: "#FCFBF8" },
    "color.graphite": { value: "#1F232A" },
    "color.accent": { value: "#CA6B0B" },
  });
  Object.assign(payload.brandIr.assets, {
    "logo.inverse": { path: "assets/logos/logo-inverse.svg" },
    "motif.signature": { path: "assets/motifs/signature.svg" },
  });
  payload.brandIr.compositionRules = {
    modes: {
      dark: {
        backgroundColorToken: "color.graphite",
        foregroundColorToken: "color.paper",
        logoAssetToken: "logo.inverse",
      },
    },
    colorRatios: [],
    accent: { colorToken: "color.accent", maxRatio: 0.15 },
    motifs: [{ kind: "diagonal-lines" }],
    numbering: { style: "zero-padded", minDigits: 2 },
  };
  payload.layoutSpec.background = { kind: "color", colorToken: "color.graphite" };
  payload.layoutSpec.compositionMode = "dark";
  payload.layoutSpec.lockedLayers = [
    {
      id: "frame",
      kind: "shape",
      shape: "circle",
      area: [20, 20, 80, 80],
      colorToken: "color.accent",
      opacity: 0.5,
      zIndex: 1,
    },
    {
      id: "diagonal-field",
      kind: "motif",
      motif: "diagonal-lines",
      area: [720, 0, 360, 520],
      colorToken: "color.paper",
      opacity: 0.1,
      strokeWidthPx: 2,
      spacingPx: 24,
      zIndex: 0,
    },
    {
      id: "signature-mark",
      kind: "asset",
      assetToken: "motif.signature",
      area: [800, 800, 200, 200],
      fit: "contain",
      opacity: 0.75,
      zIndex: 2,
    },
  ];
  Object.assign(payload.layoutSpec.slots[0], {
    zIndex: 10,
    opacity: 0.9,
    textAlign: "center" as const,
    textTransform: "uppercase" as const,
    letterSpacingEm: -0.04,
    fillMode: "stroke" as const,
    strokeColorToken: "color.paper",
    strokeWidthPx: 2.5,
    emphasisColorToken: "color.accent",
  });
  payload.contentSpec.values.headline = {
    kind: "text",
    text: "INTENÇÃO pede INTENÇÃO",
    emphasis: "INTENÇÃO",
  };
  return payload;
}

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

it("aplica tipografia autoral do template antes dos valores semânticos da role", () => {
  const payload = fixturePayload();
  Object.assign(payload.layoutSpec.slots[0], {
    fit: "fixed" as const,
    fontSizePx: 144,
    fontWeight: 800,
    fontStyle: "italic" as const,
    lineHeight: 0.88,
  });

  renderDocument(container, payload);

  const content = container.querySelector<HTMLElement>(
    '[data-slot-id="headline"] [data-slot-content]',
  )!;
  expect(content.style.fontSize).toBe("144px");
  expect(content.style.fontWeight).toBe("800");
  expect(content.style.fontStyle).toBe("italic");
  expect(content.style.lineHeight).toBe("0.88");
});

it("canvas 1:1 px com fundo do token", () => {
  renderDocument(container, fixturePayload());
  expect(container.style.width).toBe("1080px");
  expect(container.style.height).toBe("1080px");
  expect(container.style.position).toBe("relative");
  const background = container.style.backgroundColor.toLowerCase().replaceAll(" ", "");
  expect(["#ffffff", "#fff", "rgb(255,255,255)"]).toContain(background);
});

it("usa o fundo efetivo para escolher a variante de logo e respeita binding manual", () => {
  const payload = fixturePayload();
  payload.brandIr.colors["color.night"] = { value: "#101820" };
  Object.assign(payload.brandIr.assets, {
    "logo.onLight": { path: "assets/logos/logo-on-light.svg" },
    "logo.onDark": { path: "assets/logos/logo-on-dark.svg" },
  });

  payload.contentSpec.backgroundColorToken = "color.background";
  renderDocument(container, payload);
  expect(container.querySelector<HTMLImageElement>('[data-slot-id="logo"] img')!.src).toContain(
    "logo-on-light.svg",
  );

  payload.contentSpec.backgroundColorToken = "color.night";
  renderDocument(container, payload);
  expect(container.style.backgroundColor.toLowerCase().replaceAll(" ", "")).toMatch(
    /#101820|rgb\(16,24,32\)/,
  );
  expect(container.querySelector<HTMLImageElement>('[data-slot-id="logo"] img')!.src).toContain(
    "logo-on-dark.svg",
  );

  payload.contentSpec.assetBindings = { logo: "logo.primary" };
  renderDocument(container, payload);
  expect(container.querySelector<HTMLImageElement>('[data-slot-id="logo"] img')!.src).toContain(
    "logo.svg",
  );
});

it("troca também a variante de uma logo estrutural editável", () => {
  const payload = fixturePayload();
  Object.assign(payload.brandIr.assets, {
    "logo.onLight": { path: "assets/logos/logo-on-light.svg" },
    "logo.onDark": { path: "assets/logos/logo-on-dark.svg" },
  });
  payload.layoutSpec.slots = payload.layoutSpec.slots.filter((slot) => slot.kind !== "logo");
  payload.layoutSpec.lockedLayers = [
    {
      id: "brand-mark",
      kind: "asset",
      assetToken: "logo.onDark",
      area: [902, 902, 130, 130],
      fit: "contain",
      opacity: 1,
      zIndex: 3,
    },
  ];
  payload.contentSpec.backgroundColorToken = "color.background";
  payload.contentSpec.assetBindings = { "brand-mark": "logo.onDark" };

  renderDocument(container, payload);

  expect(
    container.querySelector<HTMLImageElement>('[data-layer-id="brand-mark"] img')!.src,
  ).toContain("logo-on-dark.svg");
});

it("fundo image-slot limpa uma cor de render anterior", () => {
  renderDocument(container, fixturePayload());
  const payload = fixturePayload();
  payload.layoutSpec.background = { kind: "image-slot" };
  renderDocument(container, payload);
  expect(container.style.backgroundColor).toBe("");
});

it("slot de texto absoluto com estilos do role e texto integral", () => {
  const payload = fixturePayload();
  payload.contentSpec.values.headline = { kind: "text", text: "Olá\nmarca" };
  renderDocument(container, payload);
  const slot = container.querySelector<HTMLElement>('[data-slot-id="headline"]')!;
  expect(slot.style.position).toBe("absolute");
  expect(slot.style.left).toBe("48px");
  expect(slot.style.top).toBe("324px");
  expect(slot.style.width).toBe("984px");
  expect(slot.style.height).toBe("432px");
  expect(slot.style.zIndex).toBe("2");
  expect(slot.style.overflow).toBe("hidden");
  const content = slot.querySelector<HTMLElement>("[data-slot-content]")!;
  expect(content.textContent).toBe("Olá\nmarca");
  expect(content.style.whiteSpace).toBe("pre-wrap");
  expect(content.style.fontFamily).toContain("br-font-heading");
  expect(content.style.fontWeight).toBe("700");
  expect(content.style.lineHeight).toBe("1.1");
});

it("isola canvas, slots e conteúdo dos estilos herdados pelo app", () => {
  container.style.letterSpacing = "99px";
  container.style.textTransform = "uppercase";
  renderDocument(container, fixturePayload());

  const slot = container.querySelector<HTMLElement>('[data-slot-id="headline"]')!;
  const content = slot.querySelector<HTMLElement>("[data-slot-content]")!;
  const image = container.querySelector<HTMLImageElement>("img")!;
  expect(container.style.all).toBe("initial");
  expect(slot.style.all).toBe("initial");
  expect(content.style.all).toBe("initial");
  expect(content.style.letterSpacing).toBe("normal");
  expect(content.style.textTransform).toBe("none");
  expect(image.style.all).toBe("initial");
});

it("fitting escolhe o maior tamanho que cabe via measureText injetado", () => {
  const report = renderDocument(container, fixturePayload(), {
    measureText: (_element, size) => size * 10,
  });
  const content = container.querySelector<HTMLElement>("[data-slot-content]")!;
  expect(content.style.fontSize).toBe("43px");
  expect(report.overflows).toEqual([]);
});

it("usa o tamanho autoral como teto quando o slot permite ajuste", () => {
  const payload = fixturePayload();
  payload.layoutSpec.slots[0].fontSizePx = 64;
  payload.layoutSpec.slots[0].area = [48, 324, 984, 300];
  renderDocument(container, payload, {
    measureText: (_element, size) => size * 5,
  });

  const content = container.querySelector<HTMLElement>("[data-slot-content]")!;
  expect(content.style.fontSize).toBe("60px");
});

it("overflow é reportado quando nem o mínimo cabe", () => {
  const report = renderDocument(container, fixturePayload(), { measureText: () => 1000 });
  const content = container.querySelector<HTMLElement>("[data-slot-content]")!;
  expect(content.style.fontSize).toBe("40px");
  expect(report.overflows).toEqual([{ slotId: "headline", contentPx: 1000, boxPx: 432 }]);
});

it("logo sempre renderiza a partir do IR, acima do resto", () => {
  renderDocument(container, fixturePayload());
  const box = container.querySelector<HTMLElement>('[data-slot-id="logo"]')!;
  const image = box.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("/pkg/assets/logos/logo.svg");
  expect(image.style.objectFit).toBe("contain");
  expect(box.style.zIndex).toBe("3");
});

it("slot image sem valor fica fora do DOM; com valor vira img cover", () => {
  const payload = fixturePayload();
  payload.layoutSpec.slots.unshift({
    id: "photo",
    kind: "image",
    minResolution: [1080, 1080],
    area: [0, 0, 1080, 1080],
    fit: "fixed",
    required: true,
  });
  renderDocument(container, payload);
  expect(container.querySelector('[data-slot-id="photo"]')).toBeNull();
  payload.contentSpec.values.photo = { kind: "image", path: "fotos/praia grande.png" };
  renderDocument(container, payload);
  const image = container.querySelector<HTMLImageElement>('[data-slot-id="photo"] img')!;
  expect(image.getAttribute("src")).toBe("/pkg/fotos/praia%20grande.png");
  expect(image.style.objectFit).toBe("cover");
  expect(image.parentElement!.style.zIndex).toBe("1");
});

it("path data PNG é usado verbatim para thumbnails", () => {
  const payload = fixturePayload();
  payload.layoutSpec.slots.unshift({
    id: "photo",
    kind: "image",
    area: [0, 0, 10, 10],
    fit: "fixed",
    required: false,
  });
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  payload.contentSpec.values.photo = { kind: "image", path: png };
  renderDocument(container, payload);
  expect(
    container.querySelector<HTMLImageElement>('[data-slot-id="photo"] img')!.getAttribute("src"),
  ).toBe(png);
});

it("re-render é idempotente e não reporta fallback de token não usado", () => {
  renderDocument(container, fixturePayload());
  const report = renderDocument(container, fixturePayload());
  expect(container.querySelectorAll('[data-slot-id="headline"]')).toHaveLength(1);
  expect(report.fontFallbacks).toEqual([]);
});

it("fallback é por slot usado e load-failed só surge após status confirmado", () => {
  const payload = fixturePayload();
  payload.layoutSpec.slots[0].role = "body";
  const configured = renderDocument(container, payload);
  expect(configured.fontFallbacks).toEqual([
    {
      slotId: "headline",
      token: "font.body",
      family: "Helvetica",
      reason: "referenced-only",
    },
  ]);
  payload.layoutSpec.slots[0].role = "heading";
  const failed = renderDocument(container, payload, {
    fontLoadStatus: new Map([["font.heading", false]]),
  });
  expect(failed.fontFallbacks).toEqual([
    {
      slotId: "headline",
      token: "font.heading",
      family: "Fixture Sans",
      reason: "load-failed",
    },
  ]);
});

it("compositionMode aplica fundo, foreground e alias de logo do modo", () => {
  const payload = editorialPayload();
  renderDocument(container, payload);

  const background = container.style.backgroundColor.toLowerCase().replaceAll(" ", "");
  expect(["#1f232a", "rgb(31,35,42)"]).toContain(background);
  const content = container.querySelector<HTMLElement>("[data-slot-content]")!;
  expect(content.style.getPropertyValue("-webkit-text-stroke")).toContain("#FCFBF8");
  expect(
    container.querySelector<HTMLImageElement>('[data-slot-id="logo"] img')!.getAttribute("src"),
  ).toBe("/pkg/assets/logos/logo-inverse.svg");
});

it("renderiza layers fechadas na ordem antes dos slots e sem recurso externo", () => {
  renderDocument(container, editorialPayload());
  const layers = [...container.querySelectorAll<HTMLElement>("[data-locked-layer-index]")];
  expect(layers.map((layer) => layer.dataset.layerId)).toEqual([
    "frame",
    "diagonal-field",
    "signature-mark",
  ]);
  expect(layers[0].style.borderRadius).toBe("50%");
  expect(layers[0].style.zIndex).toBe("1");
  expect(layers[0].style.opacity).toBe("0.5");
  expect(layers[1].style.backgroundImage).toContain("repeating-linear-gradient");
  expect(layers[1].style.backgroundImage).not.toContain("url(");
  const asset = layers[2].querySelector<HTMLImageElement>("img")!;
  expect(asset.getAttribute("src")).toBe("/pkg/assets/motifs/signature.svg");
  expect(asset.style.objectFit).toBe("contain");
  expect(layers[2].style.opacity).toBe("0.75");

  const headline = container.querySelector<HTMLElement>('[data-slot-id="headline"]')!;
  expect(
    layers[2].compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("materializa defaults omitidos das layers somente no render", () => {
  const payload = editorialPayload();
  for (const layer of payload.layoutSpec.lockedLayers!) {
    delete layer.opacity;
    delete layer.zIndex;
    if (layer.kind === "asset") delete layer.fit;
  }
  renderDocument(container, payload);

  const layers = [...container.querySelectorAll<HTMLElement>("[data-locked-layer-index]")];
  expect(layers.every((layer) => layer.style.opacity === "1")).toBe(true);
  expect(layers.every((layer) => layer.style.zIndex === "0")).toBe(true);
  expect(layers[2].querySelector<HTMLImageElement>("img")!.style.objectFit).toBe("contain");
  const asset = payload.layoutSpec.lockedLayers![2];
  if (asset.kind !== "asset") throw new Error("fixture inválida");
  expect(asset.fit).toBeUndefined();
});

it("aplica propriedades editoriais de slot e stroke determinístico", () => {
  renderDocument(container, editorialPayload());
  const slot = container.querySelector<HTMLElement>('[data-slot-id="headline"]')!;
  const content = slot.querySelector<HTMLElement>("[data-slot-content]")!;
  expect(slot.style.zIndex).toBe("10");
  expect(slot.style.opacity).toBe("0.9");
  expect(content.style.textAlign).toBe("center");
  expect(content.style.textTransform).toBe("uppercase");
  expect(content.style.letterSpacing).toBe("-0.04em");
  expect(content.style.color).toBe("transparent");
  expect(content.style.getPropertyValue("-webkit-text-stroke")).toBe("2.5px #FCFBF8");
});

it("aplica overrides visuais em texto e camadas estruturais", () => {
  const payload = editorialPayload();
  payload.contentSpec.overrides = {
    headline: {
      area: [120, 600, 700, 240],
      rotationDeg: -12,
      opacity: 0.55,
      zIndex: 14,
      colorToken: "color.accent",
      fontToken: "font.body",
      fontSizePx: 64,
      fontWeight: 500,
      fontStyle: "italic",
      lineHeight: 1.2,
      letterSpacingEm: 0.03,
      textAlign: "right",
      textTransform: "none",
      fillMode: "fill",
    },
    "diagonal-field": {
      area: [0, 100, 1080, 900],
      rotationDeg: 18,
      opacity: 0.2,
      zIndex: 4,
      colorToken: "color.accent",
      strokeWidthPx: 4,
      spacingPx: 40,
    },
    "signature-mark": { hidden: true, fit: "cover" },
  };

  renderDocument(container, payload);

  const slot = container.querySelector<HTMLElement>('[data-slot-id="headline"]')!;
  const content = slot.querySelector<HTMLElement>("[data-slot-content]")!;
  expect([slot.style.left, slot.style.top, slot.style.width, slot.style.height]).toEqual([
    "120px",
    "600px",
    "700px",
    "240px",
  ]);
  expect(slot.style.opacity).toBe("0.55");
  expect(slot.style.zIndex).toBe("14");
  expect(slot.style.transform).toBe("rotate(-12deg)");
  expect(slot.style.transformOrigin).toBe("center");
  expect(content.style.fontFamily).toBe("sans-serif");
  expect(content.style.fontFamily).not.toContain("br-font-heading");
  expect(content.style.fontSize).toBe("64px");
  expect(content.style.fontWeight).toBe("500");
  expect(content.style.fontStyle).toBe("italic");
  expect(content.style.lineHeight).toBe("1.2");
  expect(content.style.letterSpacing).toBe("0.03em");
  expect(content.style.textAlign).toBe("right");
  expect(content.style.textTransform).toBe("none");
  expect(content.style.color.toLowerCase().replaceAll(" ", "")).toMatch(
    /#ca6b0b|rgb\(202,107,11\)/,
  );
  expect(content.style.getPropertyValue("-webkit-text-stroke")).toBe("");

  const motif = container.querySelector<HTMLElement>('[data-layer-id="diagonal-field"]')!;
  expect([motif.style.left, motif.style.top, motif.style.width, motif.style.height]).toEqual([
    "0px",
    "100px",
    "1080px",
    "900px",
  ]);
  expect(motif.style.opacity).toBe("0.2");
  expect(motif.style.zIndex).toBe("4");
  expect(motif.style.transform).toBe("rotate(18deg)");
  expect(motif.style.backgroundImage).toContain("#CA6B0B 4px");
  expect(motif.style.backgroundImage).toContain("transparent 40px");

  const asset = container.querySelector<HTMLElement>('[data-layer-id="signature-mark"]')!;
  expect(asset.style.display).toBe("none");
  expect(asset.querySelector<HTMLImageElement>("img")!.style.objectFit).toBe("cover");
});

it("divide somente a primeira ocorrência exata da ênfase sem innerHTML", () => {
  renderDocument(container, editorialPayload());
  const content = container.querySelector<HTMLElement>("[data-slot-content]")!;
  const emphasis = content.querySelectorAll<HTMLElement>("[data-emphasis]");
  expect(emphasis).toHaveLength(1);
  expect(emphasis[0].textContent).toBe("INTENÇÃO");
  expect(emphasis[0].style.all).toBe("unset");
  expect(emphasis[0].style.color.toLowerCase().replaceAll(" ", "")).toMatch(
    /#ca6b0b|rgb\(202,107,11\)/,
  );
  expect(content.childNodes).toHaveLength(3);
  expect(content.childNodes[2].textContent).toBe(" pede INTENÇÃO");
  expect(content.textContent).toBe("INTENÇÃO pede INTENÇÃO");
});

it("ênfase temporariamente fora do texto não cria span nem perde conteúdo", () => {
  const payload = editorialPayload();
  payload.contentSpec.values.headline = {
    kind: "text",
    text: "Frase ainda sendo editada",
    emphasis: "trecho anterior",
  };
  renderDocument(container, payload);
  const content = container.querySelector<HTMLElement>("[data-slot-content]")!;
  expect(content.querySelector("[data-emphasis]")).toBeNull();
  expect(content.textContent).toBe("Frase ainda sendo editada");
});

it("textFormat zero-padded usa minDigits das regras de numeração", () => {
  const payload = editorialPayload();
  payload.brandIr.compositionRules!.numbering = { style: "zero-padded", minDigits: 3 };
  payload.layoutSpec.slots[0].textFormat = "zero-padded";
  payload.layoutSpec.slots[0].emphasisColorToken = null;
  payload.contentSpec.values.headline = { kind: "text", text: "7" };
  renderDocument(container, payload);
  expect(container.querySelector("[data-slot-content]")!.textContent).toBe("007");
});

it("textFormat zero-padded usa dois dígitos quando minDigits é omitido", () => {
  const payload = editorialPayload();
  payload.brandIr.compositionRules!.numbering = { style: "zero-padded" };
  payload.layoutSpec.slots[0].textFormat = "zero-padded";
  payload.layoutSpec.slots[0].emphasisColorToken = null;
  payload.contentSpec.values.headline = { kind: "text", text: "7" };
  renderDocument(container, payload);
  expect(container.querySelector("[data-slot-content]")!.textContent).toBe("07");
  expect(payload.brandIr.compositionRules!.numbering.minDigits).toBeUndefined();
});

it("textFormat zero-padded normaliza a fração legada do carrossel", () => {
  const payload = editorialPayload();
  payload.layoutSpec.slots[0].textFormat = "zero-padded";
  payload.layoutSpec.slots[0].emphasisColorToken = null;
  payload.contentSpec.values.headline = { kind: "text", text: "02 / 03" };
  renderDocument(container, payload);
  expect(container.querySelector("[data-slot-content]")!.textContent).toBe("02");
});

it("renderiza a superfície procedural atrás das camadas e recortada pelo canvas", () => {
  const payload = fixturePayload();
  payload.contentSpec.surface = {
    kind: "technical-grid",
    colorToken: "color.primary",
    opacity: 0.14,
    scalePx: 48,
    weightPx: 1.5,
    angleDeg: 0,
  };
  renderDocument(container, payload);

  const surface = container.querySelector<HTMLElement>('[data-surface-kind="technical-grid"]')!;
  expect(surface).not.toBeNull();
  expect(surface.style.opacity).toBe("0.14");
  expect(surface.style.backgroundImage).toContain("repeating-linear-gradient");
  expect(surface.style.backgroundImage).toContain("48px");
  expect(surface.style.zIndex).toBe("0");
  expect(container.style.overflow).toBe("hidden");
});

it("renderiza todo o catálogo portátil de superfícies", () => {
  for (const kind of SURFACE_KINDS) {
    const payload = fixturePayload();
    payload.contentSpec.surface = {
      kind,
      colorToken: "color.primary",
      opacity: 0.12,
      scalePx: 48,
      weightPx: 1.5,
      angleDeg: 18,
    };
    renderDocument(container, payload);
    const surface = container.querySelector<HTMLElement>(`[data-surface-kind="${kind}"]`);
    expect(surface?.style.backgroundImage, kind).toBeTruthy();
    container.replaceChildren();
  }
});
