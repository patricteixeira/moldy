import { expect, it } from "vitest";
import { parsePayload } from "../src/payload";
import { fixturePayload } from "./fixtures";

function compositionPayload() {
  const payload = fixturePayload();
  payload.brandIr.schemaVersion = "0.3.0";
  payload.brandIr.colors["color.paper"] = { value: "#FCFBF8" };
  payload.brandIr.colors["color.graphite"] = { value: "#1F232A" };
  payload.brandIr.colors["color.accent"] = { value: "#CA6B0B" };
  payload.brandIr.assets["logo.inverse"] = { path: "assets/logos/logo-inverse.svg" };
  payload.brandIr.assets["motif.signature"] = { path: "assets/motifs/signature.svg" };
  payload.brandIr.compositionRules = {
    modes: {
      light: {
        backgroundColorToken: "color.paper",
        foregroundColorToken: "color.graphite",
        logoAssetToken: "logo.primary",
      },
      dark: {
        backgroundColorToken: "color.graphite",
        foregroundColorToken: "color.paper",
        logoAssetToken: "logo.inverse",
      },
    },
    colorRatios: [
      { colorToken: "color.graphite", ratio: 0.7 },
      { colorToken: "color.accent", ratio: 0.1 },
    ],
    accent: { colorToken: "color.accent", maxRatio: 0.15 },
    motifs: [{ kind: "diagonal-lines" }],
    numbering: { style: "zero-padded", minDigits: 2 },
  };
  payload.layoutSpec.background = { kind: "color", colorToken: "color.graphite" };
  payload.layoutSpec.compositionMode = "dark";
  payload.layoutSpec.lockedLayers = [
    {
      id: "field",
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
      id: "mark",
      kind: "asset",
      assetToken: "motif.signature",
      area: [800, 800, 200, 200],
      fit: "contain",
      opacity: 0.8,
      zIndex: 2,
    },
  ];
  Object.assign(payload.layoutSpec.slots[0], {
    colorToken: "color.paper",
    zIndex: 10,
    opacity: 0.95,
    textAlign: "center" as const,
    textTransform: "uppercase" as const,
    letterSpacingEm: -0.04,
    fillMode: "stroke" as const,
    strokeColorToken: "color.paper",
    strokeWidthPx: 2.5,
    emphasisColorToken: "color.accent",
    textFormat: "zero-padded" as const,
  });
  payload.layoutSpec.slots[1].assetToken = "logo.inverse";
  return payload;
}

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

it("aceita composição 0.3 fechada com aliases, layers e propriedades editoriais", () => {
  const payload = compositionPayload();
  payload.contentSpec.values.headline = {
    kind: "text",
    text: "Intenção antes de automação",
    emphasis: "Intenção",
  };
  expect(parsePayload(payload)).toBe(payload);
});

it("aceita legado sem schemaVersion, mas vincula compositionRules à revisão 0.3", () => {
  const legacy = fixturePayload();
  expect(parsePayload(legacy)).toBe(legacy);

  const missing = compositionPayload();
  delete missing.brandIr.schemaVersion;
  expect(() => parsePayload(missing)).toThrowError(/compositionRules exige schemaVersion 0\.3\.0/i);

  const old = compositionPayload();
  old.brandIr.schemaVersion = "0.2.0";
  expect(() => parsePayload(old)).toThrowError(/compositionRules exige schemaVersion 0\.3\.0/i);
});

it("aceita defaults públicos omitidos em compositionRules sem mutar o payload", () => {
  const payload = fixturePayload();
  payload.brandIr.schemaVersion = "0.3.0";
  payload.brandIr.compositionRules = {};
  const original = JSON.stringify(payload);

  expect(parsePayload(payload)).toBe(payload);
  expect(JSON.stringify(payload)).toBe(original);

  payload.brandIr.compositionRules = {
    numbering: { style: "zero-padded" },
  };
  expect(parsePayload(payload)).toBe(payload);
  expect(payload.brandIr.compositionRules.numbering!.minDigits).toBeUndefined();
});

it("exige logo.primary mesmo quando o modo usa outro alias", () => {
  const payload = compositionPayload();
  delete payload.brandIr.assets["logo.primary"];
  expect(() => parsePayload(payload)).toThrowError(/logo\.primary.*ausente/i);
});

it("valida todos os tokens e aliases das regras de composição", () => {
  const mode = compositionPayload();
  mode.brandIr.compositionRules!.modes!.dark!.foregroundColorToken = "color.missing";
  expect(() => parsePayload(mode)).toThrowError(/foregroundColorToken.*desconhecido/i);

  const ratio = compositionPayload();
  ratio.brandIr.compositionRules!.colorRatios![0].ratio = 0;
  expect(() => parsePayload(ratio)).toThrowError(/ratio.*0 < ratio <= 1/i);

  const logo = compositionPayload();
  logo.brandIr.compositionRules!.modes!.dark!.logoAssetToken = "logo.missing";
  expect(() => parsePayload(logo)).toThrowError(/logoAssetToken.*desconhecido/i);
});

it("aceita evidence somente nos modelos de regra que o BrandIR define", () => {
  const payload = compositionPayload();
  const rules = payload.brandIr.compositionRules!;
  rules.modes!.light!.evidence = [];
  rules.modes!.dark!.evidence = [];
  rules.colorRatios![0].evidence = [];
  rules.accent!.evidence = [];
  rules.motifs![0].evidence = [];
  rules.numbering!.evidence = [];
  expect(parsePayload(payload)).toBe(payload);
});

it("rejeita campos extras em todos os níveis fechados de compositionRules", () => {
  const targets: Array<[string, (payload: ReturnType<typeof compositionPayload>) => object]> = [
    ["rules", (payload) => payload.brandIr.compositionRules!],
    ["modes", (payload) => payload.brandIr.compositionRules!.modes!],
    ["mode", (payload) => payload.brandIr.compositionRules!.modes!.dark!],
    ["ratio", (payload) => payload.brandIr.compositionRules!.colorRatios![0]],
    ["accent", (payload) => payload.brandIr.compositionRules!.accent!],
    ["motif", (payload) => payload.brandIr.compositionRules!.motifs![0]],
    ["numbering", (payload) => payload.brandIr.compositionRules!.numbering!],
  ];

  for (const [name, target] of targets) {
    const payload = compositionPayload();
    Object.assign(target(payload), { campoSurpresa: name });
    expect(() => parsePayload(payload), name).toThrowError(/campoSurpresa.*não pertence/i);
  }
});

it("compositionMode exige modo publicado e o mesmo token de fundo", () => {
  const absent = compositionPayload();
  absent.brandIr.compositionRules!.modes!.dark = null;
  expect(() => parsePayload(absent)).toThrowError(/compositionMode.*não está definido/i);

  const mismatch = compositionPayload();
  mismatch.layoutSpec.background = { kind: "color", colorToken: "color.paper" };
  expect(() => parsePayload(mismatch)).toThrowError(/background.*coincidir/i);
});

it("rejeita layers fora do vocabulário, sem permissão ou com limites inválidos", () => {
  const motif = compositionPayload();
  motif.brandIr.compositionRules!.motifs = [];
  expect(() => parsePayload(motif)).toThrowError(/motif.*não está permitido/i);

  const spacing = compositionPayload();
  const layer = spacing.layoutSpec.lockedLayers![0];
  if (layer.kind !== "motif") throw new Error("fixture inválida");
  layer.spacingPx = 257;
  expect(() => parsePayload(spacing)).toThrowError(/spacingPx.*256/i);

  const duplicate = compositionPayload();
  duplicate.layoutSpec.lockedLayers![0].id = "headline";
  expect(() => parsePayload(duplicate)).toThrowError(/id duplicado.*headline/i);

  const mixedUnion = compositionPayload();
  (mixedUnion.layoutSpec.lockedLayers![0] as unknown as Record<string, unknown>).assetToken =
    "logo.primary";
  expect(() => parsePayload(mixedUnion)).toThrowError(/assetToken.*não pertence ao contrato/i);
});

it("aceita defaults omitidos das layers e valida valores quando presentes", () => {
  const payload = compositionPayload();
  const motif = payload.layoutSpec.lockedLayers![0];
  const asset = payload.layoutSpec.lockedLayers![1];
  delete motif.opacity;
  delete motif.zIndex;
  delete asset.opacity;
  delete asset.zIndex;
  if (asset.kind !== "asset") throw new Error("fixture inválida");
  delete asset.fit;
  expect(parsePayload(payload)).toBe(payload);

  const badOpacity = compositionPayload();
  (badOpacity.layoutSpec.lockedLayers![0] as unknown as Record<string, unknown>).opacity = null;
  expect(() => parsePayload(badOpacity)).toThrowError(/opacity.*número finito/i);

  const badFit = compositionPayload();
  (badFit.layoutSpec.lockedLayers![1] as unknown as Record<string, unknown>).fit = "stretch";
  expect(() => parsePayload(badFit)).toThrowError(/fit.*inválido/i);

  const badDigits = compositionPayload();
  (badDigits.brandIr.compositionRules!.numbering as unknown as Record<string, unknown>).minDigits =
    null;
  expect(() => parsePayload(badDigits)).toThrowError(/minDigits.*número finito/i);
});

it("alinha limites e combinações de slot ao contrato do engine", () => {
  const zIndex = compositionPayload();
  zIndex.layoutSpec.slots[0].zIndex = 21;
  expect(() => parsePayload(zIndex)).toThrowError(/zIndex.*0 e 20/i);

  const transform = compositionPayload();
  (transform.layoutSpec.slots[0] as unknown as Record<string, unknown>).textTransform = "lowercase";
  expect(() => parsePayload(transform)).toThrowError(/textTransform.*inválido/i);

  const stroke = compositionPayload();
  stroke.layoutSpec.slots[0].strokeWidthPx = null;
  expect(() => parsePayload(stroke)).toThrowError(/fillMode stroke exige/i);

  const asset = compositionPayload();
  asset.layoutSpec.slots[0].assetToken = "logo.inverse";
  expect(() => parsePayload(asset)).toThrowError(/assetToken só é permitido.*logo/i);
});

it("ênfase vazia ou sem binding é inválida, mas texto em edição pode não contê-la", () => {
  const empty = compositionPayload();
  empty.contentSpec.values.headline = { kind: "text", text: "Frase", emphasis: "   " };
  expect(() => parsePayload(empty)).toThrowError(/emphasis.*não vazia/i);

  const unbound = compositionPayload();
  unbound.layoutSpec.slots[0].emphasisColorToken = null;
  unbound.contentSpec.values.headline = { kind: "text", text: "Frase", emphasis: "Frase" };
  expect(() => parsePayload(unbound)).toThrowError(/emphasis exige emphasisColorToken/i);

  const editing = compositionPayload();
  editing.contentSpec.values.headline = {
    kind: "text",
    text: "Nova frase ainda incompleta",
    emphasis: "trecho anterior",
  };
  expect(parsePayload(editing)).toBe(editing);
});
