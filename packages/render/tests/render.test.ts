import { beforeEach, expect, it } from "vitest";
import { renderDocument } from "../src/render";
import { fixturePayload } from "./fixtures";

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
});

it("canvas 1:1 px com fundo do token", () => {
  renderDocument(container, fixturePayload());
  expect(container.style.width).toBe("1080px");
  expect(container.style.height).toBe("1080px");
  expect(container.style.position).toBe("relative");
  const background = container.style.backgroundColor.toLowerCase().replaceAll(" ", "");
  expect(["#ffffff", "#fff", "rgb(255,255,255)"]).toContain(background);
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
