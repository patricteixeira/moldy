import { expect, it } from "vitest";
import { parsePayload } from "../src/payload";
import { fixturePayload } from "./fixtures";

it("aceita payload válido e devolve a mesma referência", () => {
  const payload = fixturePayload();
  expect(parsePayload(payload)).toBe(payload);
});

it("aceita base root-relative e loopback com porta explícita", () => {
  const root = fixturePayload();
  root.assetsBaseUrl = "/api/brands/marca/assets/";
  expect(parsePayload(root)).toBe(root);
  const loopback = fixturePayload();
  loopback.assetsBaseUrl = "http://127.0.0.1:49152/pkg";
  expect(parsePayload(loopback)).toBe(loopback);
});

it("rejeita traversal codificado no pathname da base", () => {
  for (const base of [
    "http://127.0.0.1:49152/pkg/%252e%252e/segredo",
    "http://127.0.0.1:49152/pkg/%252fsegredo",
    "/api/%252e%252e/segredo",
  ]) {
    const payload = fixturePayload();
    payload.assetsBaseUrl = base;
    expect(() => parsePayload(payload)).toThrowError(/assetsBaseUrl/i);
  }
});

it("rejeita base capaz de escapar da string CSS", () => {
  for (const base of [
    '/x");}body{background-image:url(https:evil.example)}',
    'http://127.0.0.1:49152/x");}body{color:red}',
  ]) {
    const payload = fixturePayload();
    payload.assetsBaseUrl = base;
    expect(() => parsePayload(payload)).toThrowError(/assetsBaseUrl/i);
  }
});

it("rejeita não-objeto e raiz incompleta", () => {
  expect(() => parsePayload("x")).toThrowError(/Payload inválido/);
  const payload = fixturePayload() as unknown as Record<string, unknown>;
  delete payload.assetsBaseUrl;
  expect(() => parsePayload(payload)).toThrowError(/Payload inválido: .*assetsBaseUrl/);
});

it("rejeita canvas divergente do perfil", () => {
  const payload = fixturePayload();
  payload.layoutSpec.canvas.widthPx = 1079;
  expect(() => parsePayload(payload)).toThrowError(/canvas\.widthPx.*perfil/i);
});

it("rejeita slots inválidos, duplicados ou fora do canvas", () => {
  const notArray = fixturePayload();
  (notArray.layoutSpec as unknown as Record<string, unknown>).slots = {};
  expect(() => parsePayload(notArray)).toThrowError(/slots.*array/i);

  const duplicate = fixturePayload();
  duplicate.layoutSpec.slots[1].id = "headline";
  expect(() => parsePayload(duplicate)).toThrowError(/duplicado/i);

  const outside = fixturePayload();
  outside.layoutSpec.slots[0].area = [1000, 0, 100, 10];
  expect(() => parsePayload(outside)).toThrowError(/dentro do canvas/i);
});

it("rejeita referências quebradas e divergência de revisão", () => {
  const payload = fixturePayload();
  payload.layoutSpec.slots[0].role = "nao-existe";
  expect(() => parsePayload(payload)).toThrowError(/role|papel/i);
  payload.layoutSpec.slots[0].role = "heading";
  payload.contentSpec.brandRevisionId = "brandrev_outra";
  expect(() => parsePayload(payload)).toThrowError(/revisão/i);
});

it("não aceita propriedades herdadas como tokens ou perfis", () => {
  const font = fixturePayload();
  font.brandIr.roles.heading.font = "toString";
  expect(() => parsePayload(font)).toThrowError(/font.*token desconhecido/i);

  const color = fixturePayload();
  color.brandIr.roles.heading.color = "constructor";
  expect(() => parsePayload(color)).toThrowError(/color.*token desconhecido/i);

  const profile = fixturePayload();
  (profile.layoutSpec as unknown as Record<string, unknown>).profile = "toString";
  expect(() => parsePayload(profile)).toThrowError(/profile/i);
});

it("aceita token próprio chamado __proto__ sem confundi-lo com herança", () => {
  const payload = fixturePayload();
  Object.defineProperty(payload.brandIr.fonts, "__proto__", {
    value: { ...payload.brandIr.fonts["font.heading"] },
    enumerable: true,
    configurable: true,
  });
  payload.brandIr.roles.heading.font = "__proto__";

  expect(parsePayload(payload)).toBe(payload);
});

it("rejeita asset externo, traversal e fonte file sem sha válido", () => {
  const external = fixturePayload();
  external.assetsBaseUrl = "https://externo.example/assets";
  expect(() => parsePayload(external)).toThrowError(/assetsBaseUrl/i);
  const traversal = fixturePayload();
  traversal.brandIr.assets["logo.primary"].path = "../segredo.svg";
  expect(() => parsePayload(traversal)).toThrowError(/path/i);
  const font = fixturePayload();
  font.brandIr.fonts["font.heading"].fileSha256 = "abc";
  expect(() => parsePayload(font)).toThrowError(/sha256/i);
});

it("aceita somente data PNG pequeno e assinado no valor de imagem", () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const dataPng = fixturePayload();
  dataPng.layoutSpec.slots.unshift({
    id: "photo",
    kind: "image",
    area: [0, 0, 10, 10],
    fit: "fixed",
    required: false,
  });
  dataPng.contentSpec.values.photo = { kind: "image", path: png };
  expect(parsePayload(dataPng)).toBe(dataPng);
  dataPng.contentSpec.values.photo = { kind: "image", path: "data:image/svg+xml;base64,PHN2Zz4=" };
  expect(() => parsePayload(dataPng)).toThrowError(/path/i);

  dataPng.contentSpec.values.photo = {
    kind: "image",
    path: `data:image/png;base64,iVBORw0KGgo${"A".repeat(16_384)}`,
  };
  expect(() => parsePayload(dataPng)).toThrowError(/path/i);

  const mismatch = fixturePayload();
  mismatch.contentSpec.values.headline = { kind: "image", path: "foto.png" };
  expect(() => parsePayload(mismatch)).toThrowError(/incompatível/i);
});

it("background image-slot exige slot de imagem", () => {
  const payload = fixturePayload();
  payload.layoutSpec.background = { kind: "image-slot" };
  expect(() => parsePayload(payload)).toThrowError(/image-slot.*slot image/i);
});
