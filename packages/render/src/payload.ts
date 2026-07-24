import type {
  Background,
  BrandIr,
  Canvas,
  ContentSpec,
  LayerOverride,
  LayoutSpec,
  LockedLayer,
  Payload,
  Profile,
  SceneGraph,
  Slot,
  SlotValue,
  TemplateRef,
} from "./types";
import { SURFACE_KINDS } from "./types";

const PROFILES: Record<Profile, Canvas> = {
  "post-1x1": { widthPx: 1080, heightPx: 1080, safeAreaPx: 48 },
  "post-4x5": { widthPx: 1080, heightPx: 1350, safeAreaPx: 48 },
  "story-9x16": { widthPx: 1080, heightPx: 1920, safeAreaPx: 64 },
  "doc-a4": { widthPx: 794, heightPx: 1123, safeAreaPx: 76 },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const DATA_PNG_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE_BASE64 = "iVBORw0KGgo";
const MAX_INLINE_PNG_BASE64_LENGTH = 16_384;
const BASE_PATH_SEGMENT = /^[a-z\d._~-]+$/i;
const MAX_Z_INDEX = 20;
const MAX_STROKE_WIDTH_PX = 20;
const MAX_LAYER_SPACING_PX = 256;
const MAX_EDITOR_AREA_PX = 32_768;
const MIN_LAYER_ROTATION_DEG = -180;
const MAX_LAYER_ROTATION_DEG = 180;
const MAX_SCENE_GROUPS = 64;
const SURFACE_KIND_SET = new Set<string>(SURFACE_KINDS);
const MIN_LETTER_SPACING_EM = -0.1;
const MAX_LETTER_SPACING_EM = 0.5;
const MIN_EDITOR_LETTER_SPACING_EM = -0.25;
const MAX_EDITOR_LETTER_SPACING_EM = 1;

function invalid(detail: string): never {
  throw new Error(`Payload inválido: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${field} deve ser um objeto.`);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${field} deve ser uma string não vazia.`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`${field} deve ser um número finito.`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  const parsed = finiteNumber(value, field);
  if (!Number.isInteger(parsed)) invalid(`${field} deve ser um número inteiro.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  if (integer(value, field) <= 0) invalid(`${field} deve ser maior que zero.`);
}

function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = finiteNumber(value, field);
  if (parsed < minimum || parsed > maximum) {
    invalid(`${field} deve estar entre ${minimum} e ${maximum}.`);
  }
  return parsed;
}

function knownKey(value: unknown, field: string, source: object, kind: string): string {
  const key = nonEmptyString(value, field);
  if (!hasOwn(source, key)) invalid(`${field} referencia ${kind} desconhecido.`);
  return key;
}

function onlyFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).find((key) => !allowedSet.has(key));
  if (extra) invalid(`${field}.${extra} não pertence ao contrato.`);
}

function validateArea(
  raw: unknown,
  field: string,
  canvas: Canvas,
): [number, number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 4) {
    invalid(`${field} deve conter quatro inteiros.`);
  }
  const [x, y, width, height] = raw.map((value, item) => integer(value, `${field}[${item}]`));
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > canvas.widthPx ||
    y + height > canvas.heightPx
  ) {
    invalid(`${field} deve ser positiva e permanecer dentro do canvas.`);
  }
  return [x, y, width, height];
}

function validateEditorArea(raw: unknown, field: string): [number, number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 4) {
    invalid(`${field} deve conter quatro inteiros.`);
  }
  const [x, y, width, height] = raw.map((value, item) => integer(value, `${field}[${item}]`));
  if (
    x < -MAX_EDITOR_AREA_PX ||
    x > MAX_EDITOR_AREA_PX ||
    y < -MAX_EDITOR_AREA_PX ||
    y > MAX_EDITOR_AREA_PX ||
    width <= 0 ||
    width > MAX_EDITOR_AREA_PX ||
    height <= 0 ||
    height > MAX_EDITOR_AREA_PX
  ) {
    invalid(
      `${field} deve usar posições entre -${MAX_EDITOR_AREA_PX} e ${MAX_EDITOR_AREA_PX} ` +
        `e dimensões entre 1 e ${MAX_EDITOR_AREA_PX}.`,
    );
  }
  return [x, y, width, height];
}

function isSmallSignedPngDataUri(path: string): boolean {
  if (!path.startsWith(`${DATA_PNG_PREFIX}${PNG_SIGNATURE_BASE64}`)) return false;
  const encoded = path.slice(DATA_PNG_PREFIX.length);
  return (
    encoded.length <= MAX_INLINE_PNG_BASE64_LENGTH &&
    encoded.length % 4 === 0 &&
    /^[a-z\d+/]+={0,2}$/i.test(encoded)
  );
}

function decodePathSegment(segment: string): string | null {
  let decoded = segment;
  try {
    for (let pass = 0; pass <= segment.length; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }
  return decoded;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function safePathSegments(path: string, allowTrailingSlash = false): boolean {
  const segments = path.split("/");
  return segments.every((segment, index) => {
    if (segment === "" && allowTrailingSlash && index === segments.length - 1) return true;
    const decoded = decodePathSegment(segment);
    return (
      decoded !== null &&
      decoded.length > 0 &&
      decoded !== "." &&
      decoded !== ".." &&
      !decoded.includes("/") &&
      !decoded.includes("\\") &&
      !hasControlCharacter(decoded)
    );
  });
}

function safeBasePathSegments(path: string, allowTrailingSlash = false): boolean {
  const segments = path.split("/");
  return segments.every((segment, index) => {
    if (segment === "" && allowTrailingSlash && index === segments.length - 1) return true;
    return BASE_PATH_SEGMENT.test(segment);
  });
}

function isSafeRelativePath(path: string, allowDataPng: boolean): boolean {
  if (allowDataPng && isSmallSignedPngDataUri(path)) return true;
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    SCHEME.test(path)
  ) {
    return false;
  }
  return safePathSegments(path);
}

function safePath(value: unknown, field: string, allowDataPng = false): string {
  const path = nonEmptyString(value, field);
  if (!isSafeRelativePath(path, allowDataPng)) {
    invalid(`${field} contém um path inseguro ou externo.`);
  }
  return path;
}

function validateAssetsBaseUrl(value: unknown): void {
  const base = nonEmptyString(value, "assetsBaseUrl");
  if (base.includes("\\") || /[?#]/.test(base)) {
    invalid("assetsBaseUrl contém caracteres inválidos.");
  }

  if (base.startsWith("/") && !base.startsWith("//")) {
    const path = base.slice(1);
    if (path === "") return;
    if (!safeBasePathSegments(path, true)) {
      invalid("assetsBaseUrl root-relative é inválida.");
    }
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    invalid("assetsBaseUrl deve ser root-relative ou loopback HTTP.");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.port === "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    invalid("assetsBaseUrl deve apontar apenas para 127.0.0.1 com porta explícita.");
  }
  const rawMatch = base.match(/^http:\/\/127\.0\.0\.1:\d+(\/[^?#]*)?$/i);
  if (!rawMatch) invalid("assetsBaseUrl loopback não está em formato canônico.");
  const rawPath = rawMatch[1] ?? "/";
  const relativePath = rawPath.slice(1);
  if (relativePath !== "" && !safeBasePathSegments(relativePath, true)) {
    invalid("assetsBaseUrl contém pathname inseguro ou codificado.");
  }
}

function validateCompositionRules(raw: unknown, colors: object, assets: object): void {
  if (raw === undefined || raw === null) return;
  const rules = record(raw, "brandIr.compositionRules");
  onlyFields(
    rules,
    ["modes", "colorRatios", "accent", "motifs", "layoutStyle", "numbering"],
    "brandIr.compositionRules",
  );
  const modes =
    rules.modes === undefined
      ? (Object.create(null) as Record<string, unknown>)
      : record(rules.modes, "brandIr.compositionRules.modes");
  if (rules.modes !== undefined) {
    onlyFields(modes, ["light", "dark"], "brandIr.compositionRules.modes");
  }
  for (const name of ["light", "dark"] as const) {
    const rawMode = modes[name];
    if (rawMode === undefined || rawMode === null) continue;
    const prefix = `brandIr.compositionRules.modes.${name}`;
    const mode = record(rawMode, prefix);
    onlyFields(
      mode,
      ["backgroundColorToken", "foregroundColorToken", "logoAssetToken", "evidence"],
      prefix,
    );
    knownKey(
      mode.backgroundColorToken,
      `brandIr.compositionRules.modes.${name}.backgroundColorToken`,
      colors,
      "token de cor",
    );
    knownKey(
      mode.foregroundColorToken,
      `brandIr.compositionRules.modes.${name}.foregroundColorToken`,
      colors,
      "token de cor",
    );
    if (mode.logoAssetToken !== undefined && mode.logoAssetToken !== null) {
      knownKey(
        mode.logoAssetToken,
        `brandIr.compositionRules.modes.${name}.logoAssetToken`,
        assets,
        "asset",
      );
    }
  }

  if (rules.colorRatios !== undefined && !Array.isArray(rules.colorRatios)) {
    invalid("brandIr.compositionRules.colorRatios deve ser um array.");
  }
  const ratioTokens = new Set<string>();
  const colorRatios = rules.colorRatios ?? [];
  if (!Array.isArray(colorRatios)) invalid("brandIr.compositionRules.colorRatios é inválido.");
  colorRatios.forEach((rawRatio, index) => {
    const prefix = `brandIr.compositionRules.colorRatios[${index}]`;
    const ratio = record(rawRatio, prefix);
    onlyFields(ratio, ["colorToken", "ratio", "evidence"], prefix);
    const token = knownKey(ratio.colorToken, `${prefix}.colorToken`, colors, "token de cor");
    if (ratioTokens.has(token)) invalid(`${prefix}.colorToken está duplicado.`);
    ratioTokens.add(token);
    const value = finiteNumber(ratio.ratio, `${prefix}.ratio`);
    if (value <= 0 || value > 1) invalid(`${prefix}.ratio deve respeitar 0 < ratio <= 1.`);
  });

  if (rules.accent !== undefined && rules.accent !== null) {
    const accent = record(rules.accent, "brandIr.compositionRules.accent");
    onlyFields(accent, ["colorToken", "maxRatio", "evidence"], "brandIr.compositionRules.accent");
    knownKey(
      accent.colorToken,
      "brandIr.compositionRules.accent.colorToken",
      colors,
      "token de cor",
    );
    const maxRatio = finiteNumber(accent.maxRatio, "brandIr.compositionRules.accent.maxRatio");
    if (maxRatio <= 0 || maxRatio > 1) {
      invalid("brandIr.compositionRules.accent.maxRatio deve respeitar 0 < maxRatio <= 1.");
    }
  }

  if (rules.motifs !== undefined && !Array.isArray(rules.motifs)) {
    invalid("brandIr.compositionRules.motifs deve ser um array.");
  }
  let hasDiagonalLines = false;
  const motifs = rules.motifs ?? [];
  if (!Array.isArray(motifs)) invalid("brandIr.compositionRules.motifs é inválido.");
  motifs.forEach((rawMotif, index) => {
    const prefix = `brandIr.compositionRules.motifs[${index}]`;
    const motif = record(rawMotif, prefix);
    onlyFields(motif, ["kind", "evidence"], prefix);
    if (motif.kind !== "diagonal-lines") {
      invalid(`brandIr.compositionRules.motifs[${index}].kind é inválido.`);
    }
    if (hasDiagonalLines) invalid("brandIr.compositionRules.motifs contém kind duplicado.");
    hasDiagonalLines = true;
  });

  if (rules.layoutStyle !== undefined && rules.layoutStyle !== null) {
    const style = record(rules.layoutStyle, "brandIr.compositionRules.layoutStyle");
    onlyFields(style, ["kind", "evidence"], "brandIr.compositionRules.layoutStyle");
    if (style.kind !== "ornamental-divider" && style.kind !== "restrained-clinical-grid") {
      invalid("brandIr.compositionRules.layoutStyle.kind é inválido.");
    }
  }

  if (rules.numbering !== undefined && rules.numbering !== null) {
    const numbering = record(rules.numbering, "brandIr.compositionRules.numbering");
    onlyFields(numbering, ["style", "minDigits", "evidence"], "brandIr.compositionRules.numbering");
    if (numbering.style !== "zero-padded") {
      invalid("brandIr.compositionRules.numbering.style é inválido.");
    }
    if (numbering.minDigits !== undefined) {
      const minDigits = integer(
        numbering.minDigits,
        "brandIr.compositionRules.numbering.minDigits",
      );
      if (minDigits < 2 || minDigits > 8) {
        invalid("brandIr.compositionRules.numbering.minDigits deve estar entre 2 e 8.");
      }
    }
  }
}

function validateIdentityDirection(ir: Record<string, unknown>): void {
  if (ir.identity !== undefined && ir.identity !== null) {
    if (ir.schemaVersion !== "0.4.0") {
      invalid("brandIr.identity exige schemaVersion 0.4.0 explícita.");
    }
    const identity = record(ir.identity, "brandIr.identity");
    onlyFields(
      identity,
      ["essence", "personality", "voice", "avoid", "evidence"],
      "brandIr.identity",
    );
    nonEmptyString(identity.essence, "brandIr.identity.essence");
    for (const field of ["personality", "voice", "avoid"] as const) {
      if (identity[field] !== undefined && typeof identity[field] !== "string") {
        invalid(`brandIr.identity.${field} deve ser texto.`);
      }
    }
  }
  if (ir.creativeDirection === undefined || ir.creativeDirection === null) return;
  if (ir.schemaVersion !== "0.4.0" || ir.identity === undefined || ir.identity === null) {
    invalid("brandIr.creativeDirection exige identity no schemaVersion 0.4.0.");
  }
  const direction = record(ir.creativeDirection, "brandIr.creativeDirection");
  onlyFields(
    direction,
    [
      "energy",
      "geometry",
      "density",
      "formality",
      "materiality",
      "contrast",
      "composition",
      "surface",
      "scaleContrast",
      "negativeSpace",
      "bleed",
      "surfaceDensity",
      "rationalePt",
    ],
    "brandIr.creativeDirection",
  );
  for (const name of ["energy", "geometry", "density", "formality", "materiality", "contrast"]) {
    const axis = record(direction[name], `brandIr.creativeDirection.${name}`);
    onlyFields(axis, ["value", "confidence", "evidenceTerms"], `brandIr.creativeDirection.${name}`);
    boundedNumber(axis.value, `brandIr.creativeDirection.${name}.value`, -1, 1);
    boundedNumber(axis.confidence, `brandIr.creativeDirection.${name}.confidence`, 0, 1);
    if (axis.evidenceTerms !== undefined && !Array.isArray(axis.evidenceTerms)) {
      invalid(`brandIr.creativeDirection.${name}.evidenceTerms deve ser um array.`);
    }
  }
  if (
    direction.composition !== "contemplative" &&
    direction.composition !== "asymmetric" &&
    direction.composition !== "modular" &&
    direction.composition !== "expansive" &&
    direction.composition !== "layered"
  ) {
    invalid("brandIr.creativeDirection.composition é inválida.");
  }
  if (
    direction.surface !== "none" &&
    direction.surface !== "paper-grain" &&
    direction.surface !== "linear-rhythm" &&
    direction.surface !== "technical-grid" &&
    direction.surface !== "point-field" &&
    direction.surface !== "concentric-rings"
  ) {
    invalid("brandIr.creativeDirection.surface é inválida.");
  }
  for (const name of ["scaleContrast", "negativeSpace", "bleed", "surfaceDensity"]) {
    boundedNumber(direction[name], `brandIr.creativeDirection.${name}`, 0, 1);
  }
  if (!Array.isArray(direction.rationalePt) || direction.rationalePt.length === 0) {
    invalid("brandIr.creativeDirection.rationalePt deve conter justificativas.");
  }
}

function validateBrandIr(raw: unknown): BrandIr {
  const ir = record(raw, "brandIr");
  if (
    ir.schemaVersion !== undefined &&
    ir.schemaVersion !== "0.1.0" &&
    ir.schemaVersion !== "0.2.0" &&
    ir.schemaVersion !== "0.3.0" &&
    ir.schemaVersion !== "0.4.0"
  ) {
    invalid("brandIr.schemaVersion é inválida.");
  }
  if (ir.compositionRules !== undefined && ir.compositionRules !== null) {
    if (ir.schemaVersion !== "0.3.0" && ir.schemaVersion !== "0.4.0") {
      invalid("brandIr.compositionRules exige schemaVersion 0.3.0 ou 0.4.0 explícita.");
    }
  }
  validateIdentityDirection(ir);
  const revision = record(ir.revision, "brandIr.revision");
  nonEmptyString(revision.id, "brandIr.revision.id");

  const colors = record(ir.colors, "brandIr.colors");
  for (const token of Object.keys(colors).sort()) {
    nonEmptyString(token, "chave de brandIr.colors");
    const color = record(colors[token], `brandIr.colors.${token}`);
    const value = nonEmptyString(color.value, `brandIr.colors.${token}.value`);
    if (!HEX_COLOR.test(value)) {
      invalid(`brandIr.colors.${token}.value deve usar #RRGGBB.`);
    }
  }

  const fonts = record(ir.fonts, "brandIr.fonts");
  for (const token of Object.keys(fonts).sort()) {
    nonEmptyString(token, "chave de brandIr.fonts");
    const font = record(fonts[token], `brandIr.fonts.${token}`);
    nonEmptyString(font.family, `brandIr.fonts.${token}.family`);
    const weight = integer(font.weight, `brandIr.fonts.${token}.weight`);
    if (weight < 100 || weight > 900) {
      invalid(`brandIr.fonts.${token}.weight deve estar entre 100 e 900.`);
    }
    if (font.style !== "normal" && font.style !== "italic") {
      invalid(`brandIr.fonts.${token}.style é inválido.`);
    }
    if (font.source !== "file" && font.source !== "referenced-only" && font.source !== "fallback") {
      invalid(`brandIr.fonts.${token}.source é inválido.`);
    }
    if (
      font.source === "file" &&
      (typeof font.fileSha256 !== "string" || !SHA256.test(font.fileSha256))
    ) {
      invalid(`brandIr.fonts.${token}.fileSha256 deve ser um sha256 lowercase válido.`);
    }
    if (
      font.fileSha256 !== undefined &&
      font.fileSha256 !== null &&
      (typeof font.fileSha256 !== "string" || !SHA256.test(font.fileSha256))
    ) {
      invalid(`brandIr.fonts.${token}.fileSha256 deve ser um sha256 lowercase válido.`);
    }
  }

  const roles = record(ir.roles, "brandIr.roles");
  for (const name of Object.keys(roles).sort()) {
    nonEmptyString(name, "chave de brandIr.roles");
    const role = record(roles[name], `brandIr.roles.${name}`);
    const font = nonEmptyString(role.font, `brandIr.roles.${name}.font`);
    const color = nonEmptyString(role.color, `brandIr.roles.${name}.color`);
    if (!hasOwn(fonts, font)) invalid(`brandIr.roles.${name}.font referencia token desconhecido.`);
    if (!hasOwn(colors, color))
      invalid(`brandIr.roles.${name}.color referencia token desconhecido.`);
    const min = integer(role.minSizePx, `brandIr.roles.${name}.minSizePx`);
    const max = integer(role.maxSizePx, `brandIr.roles.${name}.maxSizePx`);
    if (min <= 0 || min > max) {
      invalid(`brandIr.roles.${name} exige 0 < minSizePx <= maxSizePx.`);
    }
    if (finiteNumber(role.lineHeight, `brandIr.roles.${name}.lineHeight`) <= 0) {
      invalid(`brandIr.roles.${name}.lineHeight deve ser positivo.`);
    }
  }

  const assets = record(ir.assets, "brandIr.assets");
  for (const name of Object.keys(assets).sort()) {
    nonEmptyString(name, "chave de brandIr.assets");
    const asset = record(assets[name], `brandIr.assets.${name}`);
    safePath(asset.path, `brandIr.assets.${name}.path`);
    if (asset.minWidthPx !== undefined) {
      optionalPositiveInteger(asset.minWidthPx, `brandIr.assets.${name}.minWidthPx`);
    }
  }
  const logo = assets["logo.primary"];
  if (!isRecord(logo)) invalid("brandIr.assets.logo.primary está ausente.");
  safePath(logo.path, "brandIr.assets.logo.primary.path");
  validateCompositionRules(ir.compositionRules, colors, assets);

  return raw as BrandIr;
}

function validateBackground(raw: unknown, colors: BrandIr["colors"]): Background {
  const background = record(raw, "layoutSpec.background");
  if (background.kind !== "color" && background.kind !== "image-slot") {
    invalid("layoutSpec.background.kind é inválido.");
  }
  if (background.kind === "color") {
    const token = nonEmptyString(background.colorToken, "layoutSpec.background.colorToken");
    if (!hasOwn(colors, token)) invalid("layoutSpec.background.colorToken é desconhecido.");
  } else if (background.colorToken !== undefined && background.colorToken !== null) {
    nonEmptyString(background.colorToken, "layoutSpec.background.colorToken");
  }
  return raw as Background;
}

function validateTemplateRef(raw: unknown): TemplateRef {
  const reference = record(raw, "layoutSpec.templateRef");
  onlyFields(
    reference,
    ["packageId", "version", "compositionId", "sceneSchemaVersion"],
    "layoutSpec.templateRef",
  );
  nonEmptyString(reference.packageId, "layoutSpec.templateRef.packageId");
  const version = nonEmptyString(reference.version, "layoutSpec.templateRef.version");
  if (!/^\d+\.\d+\.\d+$/.test(version)) invalid("layoutSpec.templateRef.version é inválida.");
  nonEmptyString(reference.compositionId, "layoutSpec.templateRef.compositionId");
  if (reference.sceneSchemaVersion !== "2.0.0") {
    invalid("layoutSpec.templateRef.sceneSchemaVersion é incompatível.");
  }
  return raw as TemplateRef;
}

function validateSceneGraph(raw: unknown, canvas: Canvas, elementIds: Set<string>): SceneGraph {
  const scene = record(raw, "layoutSpec.sceneGraph");
  onlyFields(scene, ["schemaVersion", "roots", "groups"], "layoutSpec.sceneGraph");
  if (scene.schemaVersion !== "2.0.0") invalid("layoutSpec.sceneGraph.schemaVersion é inválida.");
  if (!Array.isArray(scene.roots) || scene.roots.length === 0) {
    invalid("layoutSpec.sceneGraph.roots precisa conter ao menos uma raiz.");
  }
  if (!Array.isArray(scene.groups) || scene.groups.length === 0) {
    invalid("layoutSpec.sceneGraph.groups precisa conter ao menos um grupo.");
  }
  if (scene.groups.length > MAX_SCENE_GROUPS) {
    invalid(`layoutSpec.sceneGraph.groups excede ${MAX_SCENE_GROUPS} itens.`);
  }

  const groups = new Map<string, Record<string, unknown>>();
  for (const [index, rawGroup] of scene.groups.entries()) {
    const prefix = `layoutSpec.sceneGraph.groups[${index}]`;
    const group = record(rawGroup, prefix);
    onlyFields(
      group,
      ["id", "kind", "area", "children", "direction", "gapPx", "columns", "clip"],
      prefix,
    );
    const id = nonEmptyString(group.id, `${prefix}.id`);
    if (groups.has(id) || elementIds.has(id)) invalid(`${prefix}.id é duplicado.`);
    if (!["group", "frame", "stack", "grid"].includes(String(group.kind))) {
      invalid(`${prefix}.kind é inválido.`);
    }
    validateArea(group.area, `${prefix}.area`, canvas);
    if (!Array.isArray(group.children) || group.children.length === 0) {
      invalid(`${prefix}.children precisa conter ao menos um id.`);
    }
    const children = group.children.map((child, childIndex) =>
      nonEmptyString(child, `${prefix}.children[${childIndex}]`),
    );
    if (new Set(children).size !== children.length) invalid(`${prefix}.children repete ids.`);
    if (children.includes(id)) invalid(`${prefix} não pode conter a si mesmo.`);
    if (group.gapPx !== undefined) boundedNumber(group.gapPx, `${prefix}.gapPx`, 0, 2048);
    if (group.clip !== undefined && typeof group.clip !== "boolean") {
      invalid(`${prefix}.clip deve ser booleano.`);
    }
    if (group.kind === "stack") {
      if (group.direction !== "horizontal" && group.direction !== "vertical") {
        invalid(`${prefix}.direction é obrigatória em stack.`);
      }
    } else if (group.direction !== undefined && group.direction !== null) {
      invalid(`${prefix}.direction só pode ser usada em stack.`);
    }
    if (group.kind === "grid") {
      const columns = integer(group.columns, `${prefix}.columns`);
      if (columns < 1 || columns > 24) invalid(`${prefix}.columns deve estar entre 1 e 24.`);
    } else if (group.columns !== undefined && group.columns !== null) {
      invalid(`${prefix}.columns só pode ser usada em grid.`);
    }
    groups.set(id, group);
  }

  const roots = scene.roots.map((root, index) =>
    nonEmptyString(root, `layoutSpec.sceneGraph.roots[${index}]`),
  );
  if (new Set(roots).size !== roots.length) invalid("layoutSpec.sceneGraph.roots repete ids.");
  for (const root of roots) {
    if (!groups.has(root))
      invalid(`layoutSpec.sceneGraph.roots referencia grupo desconhecido: ${root}.`);
  }
  const knownIds = new Set([...elementIds, ...groups.keys()]);
  for (const [id, group] of groups) {
    for (const child of group.children as string[]) {
      if (!knownIds.has(child)) invalid(`O grupo ${id} referencia filho desconhecido: ${child}.`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) invalid("layoutSpec.sceneGraph não pode conter ciclos.");
    if (visited.has(id)) return;
    visiting.add(id);
    const group = groups.get(id);
    if (!group) invalid(`layoutSpec.sceneGraph referencia grupo desconhecido: ${id}.`);
    for (const child of group.children as string[]) {
      if (groups.has(child)) visit(child);
    }
    visiting.delete(id);
    visited.add(id);
  };
  roots.forEach(visit);
  if (visited.size !== groups.size) invalid("layoutSpec.sceneGraph contém grupos fora das raízes.");
  return raw as SceneGraph;
}

function validateLockedLayer(
  raw: unknown,
  index: number,
  canvas: Canvas,
  ir: BrandIr,
): LockedLayer {
  const prefix = `layoutSpec.lockedLayers[${index}]`;
  const layer = record(raw, prefix);
  nonEmptyString(layer.id, `${prefix}.id`);
  validateArea(layer.area, `${prefix}.area`, canvas);
  if (layer.zIndex !== undefined) {
    const zIndex = integer(layer.zIndex, `${prefix}.zIndex`);
    if (zIndex < 0 || zIndex > MAX_Z_INDEX) {
      invalid(`${prefix}.zIndex deve estar entre 0 e ${MAX_Z_INDEX}.`);
    }
  }

  if (layer.kind === "shape") {
    onlyFields(layer, ["id", "kind", "shape", "area", "colorToken", "opacity", "zIndex"], prefix);
    if (layer.shape !== "rectangle" && layer.shape !== "circle") {
      invalid(`${prefix}.shape é inválido.`);
    }
    knownKey(layer.colorToken, `${prefix}.colorToken`, ir.colors, "token de cor");
    if (layer.opacity !== undefined) {
      boundedNumber(layer.opacity, `${prefix}.opacity`, 0, 1);
    }
    return raw as LockedLayer;
  }

  if (layer.kind === "motif") {
    onlyFields(
      layer,
      [
        "id",
        "kind",
        "motif",
        "area",
        "colorToken",
        "opacity",
        "strokeWidthPx",
        "spacingPx",
        "zIndex",
      ],
      prefix,
    );
    if (layer.motif !== "diagonal-lines") invalid(`${prefix}.motif é inválido.`);
    if (!ir.compositionRules?.motifs?.some((motif) => motif.kind === layer.motif)) {
      invalid(`${prefix}.motif não está permitido em brandIr.compositionRules.motifs.`);
    }
    knownKey(layer.colorToken, `${prefix}.colorToken`, ir.colors, "token de cor");
    if (layer.opacity !== undefined) {
      boundedNumber(layer.opacity, `${prefix}.opacity`, 0, 1);
    }
    boundedNumber(
      layer.strokeWidthPx,
      `${prefix}.strokeWidthPx`,
      Number.EPSILON,
      MAX_STROKE_WIDTH_PX,
    );
    boundedNumber(layer.spacingPx, `${prefix}.spacingPx`, Number.EPSILON, MAX_LAYER_SPACING_PX);
    return raw as LockedLayer;
  }

  if (layer.kind === "asset") {
    onlyFields(layer, ["id", "kind", "assetToken", "area", "fit", "opacity", "zIndex"], prefix);
    knownKey(layer.assetToken, `${prefix}.assetToken`, ir.assets, "asset");
    if (layer.fit !== undefined && layer.fit !== "contain" && layer.fit !== "cover") {
      invalid(`${prefix}.fit é inválido.`);
    }
    if (layer.opacity !== undefined) {
      boundedNumber(layer.opacity, `${prefix}.opacity`, 0, 1);
    }
    return raw as LockedLayer;
  }

  invalid(`${prefix}.kind é inválido.`);
}

function validateSlot(raw: unknown, index: number, canvas: Canvas, ir: BrandIr): Slot {
  const prefix = `layoutSpec.slots[${index}]`;
  const slot = record(raw, prefix);
  onlyFields(
    slot,
    [
      "id",
      "kind",
      "role",
      "colorToken",
      "maxChars",
      "minResolution",
      "area",
      "fit",
      "required",
      "zIndex",
      "opacity",
      "textAlign",
      "textTransform",
      "letterSpacingEm",
      "fontSizePx",
      "fontWeight",
      "fontStyle",
      "lineHeight",
      "fillMode",
      "strokeColorToken",
      "strokeWidthPx",
      "assetToken",
      "emphasisColorToken",
      "textFormat",
    ],
    prefix,
  );
  nonEmptyString(slot.id, `${prefix}.id`);
  if (slot.kind !== "text" && slot.kind !== "image" && slot.kind !== "logo") {
    invalid(`${prefix}.kind é inválido.`);
  }
  if (slot.fit !== "shrink-within-role-range" && slot.fit !== "fixed") {
    invalid(`${prefix}.fit é inválido.`);
  }
  if (typeof slot.required !== "boolean") invalid(`${prefix}.required deve ser booleano.`);
  validateArea(slot.area, `${prefix}.area`, canvas);

  if (slot.kind === "text") {
    const role = nonEmptyString(slot.role, `${prefix}.role`);
    if (!hasOwn(ir.roles, role)) invalid(`${prefix}.role referencia papel desconhecido.`);
  } else if (slot.role !== undefined && slot.role !== null) {
    nonEmptyString(slot.role, `${prefix}.role`);
  }

  optionalPositiveInteger(slot.maxChars, `${prefix}.maxChars`);
  if (slot.minResolution !== undefined && slot.minResolution !== null) {
    if (!Array.isArray(slot.minResolution) || slot.minResolution.length !== 2) {
      invalid(`${prefix}.minResolution deve conter dois inteiros positivos.`);
    }
    slot.minResolution.forEach((value, item) => {
      if (integer(value, `${prefix}.minResolution[${item}]`) <= 0) {
        invalid(`${prefix}.minResolution deve conter dois inteiros positivos.`);
      }
    });
  }

  if (slot.colorToken !== undefined && slot.colorToken !== null) {
    knownKey(slot.colorToken, `${prefix}.colorToken`, ir.colors, "token de cor");
  }
  if (slot.zIndex !== undefined && slot.zIndex !== null) {
    const zIndex = integer(slot.zIndex, `${prefix}.zIndex`);
    if (zIndex < 0 || zIndex > MAX_Z_INDEX) {
      invalid(`${prefix}.zIndex deve estar entre 0 e ${MAX_Z_INDEX}.`);
    }
  }
  if (slot.opacity !== undefined && slot.opacity !== null) {
    boundedNumber(slot.opacity, `${prefix}.opacity`, 0, 1);
  }
  if (
    slot.textAlign !== undefined &&
    slot.textAlign !== null &&
    slot.textAlign !== "left" &&
    slot.textAlign !== "center" &&
    slot.textAlign !== "right"
  ) {
    invalid(`${prefix}.textAlign é inválido.`);
  }
  if (
    slot.textTransform !== undefined &&
    slot.textTransform !== null &&
    slot.textTransform !== "none" &&
    slot.textTransform !== "uppercase"
  ) {
    invalid(`${prefix}.textTransform é inválido.`);
  }
  if (slot.letterSpacingEm !== undefined && slot.letterSpacingEm !== null) {
    boundedNumber(
      slot.letterSpacingEm,
      `${prefix}.letterSpacingEm`,
      MIN_LETTER_SPACING_EM,
      MAX_LETTER_SPACING_EM,
    );
  }
  if (slot.fontSizePx !== undefined && slot.fontSizePx !== null) {
    boundedNumber(slot.fontSizePx, `${prefix}.fontSizePx`, 6, 1024);
  }
  if (slot.fontWeight !== undefined && slot.fontWeight !== null) {
    const weight = integer(slot.fontWeight, `${prefix}.fontWeight`);
    if (weight < 100 || weight > 900) invalid(`${prefix}.fontWeight é inválido.`);
  }
  if (
    slot.fontStyle !== undefined &&
    slot.fontStyle !== null &&
    slot.fontStyle !== "normal" &&
    slot.fontStyle !== "italic"
  ) {
    invalid(`${prefix}.fontStyle é inválido.`);
  }
  if (slot.lineHeight !== undefined && slot.lineHeight !== null) {
    boundedNumber(slot.lineHeight, `${prefix}.lineHeight`, 0.5, 3);
  }
  if (
    slot.fillMode !== undefined &&
    slot.fillMode !== null &&
    slot.fillMode !== "fill" &&
    slot.fillMode !== "stroke"
  ) {
    invalid(`${prefix}.fillMode é inválido.`);
  }
  if (slot.strokeColorToken !== undefined && slot.strokeColorToken !== null) {
    knownKey(slot.strokeColorToken, `${prefix}.strokeColorToken`, ir.colors, "token de cor");
  }
  if (slot.strokeWidthPx !== undefined && slot.strokeWidthPx !== null) {
    boundedNumber(
      slot.strokeWidthPx,
      `${prefix}.strokeWidthPx`,
      Number.EPSILON,
      MAX_STROKE_WIDTH_PX,
    );
  }
  if (slot.assetToken !== undefined && slot.assetToken !== null) {
    knownKey(slot.assetToken, `${prefix}.assetToken`, ir.assets, "asset");
  }
  if (slot.emphasisColorToken !== undefined && slot.emphasisColorToken !== null) {
    knownKey(slot.emphasisColorToken, `${prefix}.emphasisColorToken`, ir.colors, "token de cor");
  }
  if (
    slot.textFormat !== undefined &&
    slot.textFormat !== null &&
    slot.textFormat !== "plain" &&
    slot.textFormat !== "zero-padded"
  ) {
    invalid(`${prefix}.textFormat é inválido.`);
  }

  const hasTextPresentation =
    (slot.colorToken !== undefined && slot.colorToken !== null) ||
    (slot.emphasisColorToken !== undefined && slot.emphasisColorToken !== null) ||
    (slot.textFormat !== undefined && slot.textFormat !== null && slot.textFormat !== "plain") ||
    (slot.textAlign !== undefined && slot.textAlign !== null && slot.textAlign !== "left") ||
    (slot.textTransform !== undefined &&
      slot.textTransform !== null &&
      slot.textTransform !== "none") ||
    (slot.letterSpacingEm !== undefined &&
      slot.letterSpacingEm !== null &&
      slot.letterSpacingEm !== 0) ||
    (slot.fontSizePx !== undefined && slot.fontSizePx !== null) ||
    (slot.fontWeight !== undefined && slot.fontWeight !== null) ||
    (slot.fontStyle !== undefined && slot.fontStyle !== null) ||
    (slot.lineHeight !== undefined && slot.lineHeight !== null) ||
    (slot.fillMode !== undefined && slot.fillMode !== null && slot.fillMode !== "fill") ||
    (slot.strokeColorToken !== undefined && slot.strokeColorToken !== null) ||
    (slot.strokeWidthPx !== undefined && slot.strokeWidthPx !== null);
  if (slot.kind !== "text" && hasTextPresentation) {
    invalid(`${prefix} usa propriedades tipográficas em um slot ${slot.kind}.`);
  }
  if (slot.kind !== "logo" && slot.assetToken !== undefined && slot.assetToken !== null) {
    invalid(`${prefix}.assetToken só é permitido em slot logo.`);
  }
  if (
    slot.kind === "text" &&
    slot.fillMode === "stroke" &&
    (!slot.strokeColorToken || slot.strokeWidthPx === undefined || slot.strokeWidthPx === null)
  ) {
    invalid(`${prefix} com fillMode stroke exige strokeColorToken e strokeWidthPx.`);
  }
  if (
    slot.kind === "text" &&
    slot.fillMode !== "stroke" &&
    ((slot.strokeColorToken !== undefined && slot.strokeColorToken !== null) ||
      (slot.strokeWidthPx !== undefined && slot.strokeWidthPx !== null))
  ) {
    invalid(`${prefix} só pode definir strokeColorToken/strokeWidthPx com fillMode stroke.`);
  }
  return raw as Slot;
}

function validateLayout(raw: unknown, ir: BrandIr): LayoutSpec {
  const layout = record(raw, "layoutSpec");
  nonEmptyString(layout.id, "layoutSpec.id");
  nonEmptyString(layout.namePt, "layoutSpec.namePt");
  if (typeof layout.profile !== "string" || !hasOwn(PROFILES, layout.profile)) {
    invalid("layoutSpec.profile não pertence aos perfis canônicos.");
  }
  const profile = layout.profile as Profile;
  const canvas = record(layout.canvas, "layoutSpec.canvas");
  const expected = PROFILES[profile];
  for (const field of ["widthPx", "heightPx", "safeAreaPx"] as const) {
    const value = integer(canvas[field], `layoutSpec.canvas.${field}`);
    if (value !== expected[field]) {
      invalid(`layoutSpec.canvas.${field} diverge do perfil ${profile}.`);
    }
  }
  const background = validateBackground(layout.background, ir.colors);
  if (
    layout.compositionMode !== undefined &&
    layout.compositionMode !== null &&
    layout.compositionMode !== "light" &&
    layout.compositionMode !== "dark"
  ) {
    invalid("layoutSpec.compositionMode é inválido.");
  }
  const compositionMode =
    layout.compositionMode === "light" || layout.compositionMode === "dark"
      ? ir.compositionRules?.modes?.[layout.compositionMode]
      : null;
  if (
    (layout.compositionMode === "light" || layout.compositionMode === "dark") &&
    !compositionMode
  ) {
    invalid(`layoutSpec.compositionMode não está definido em brandIr.compositionRules.modes.`);
  }
  if (
    compositionMode &&
    (background.kind !== "color" || background.colorToken !== compositionMode.backgroundColorToken)
  ) {
    invalid(
      "layoutSpec.background.colorToken deve coincidir com o backgroundColorToken do compositionMode.",
    );
  }

  if (
    layout.lockedLayers !== undefined &&
    layout.lockedLayers !== null &&
    !Array.isArray(layout.lockedLayers)
  ) {
    invalid("layoutSpec.lockedLayers deve ser um array.");
  }
  const lockedLayers = Array.isArray(layout.lockedLayers)
    ? layout.lockedLayers.map((layer, index) => validateLockedLayer(layer, index, expected, ir))
    : [];

  if (!Array.isArray(layout.slots)) invalid("layoutSpec.slots deve ser um array.");
  const ids = new Set<string>();
  const slots = layout.slots.map((rawSlot, index) => {
    const slot = validateSlot(rawSlot, index, expected, ir);
    if (ids.has(slot.id)) invalid(`layoutSpec.slots contém id duplicado: ${slot.id}.`);
    ids.add(slot.id);
    return slot;
  });
  for (const layer of lockedLayers) {
    if (ids.has(layer.id)) {
      invalid(`layoutSpec contém id duplicado entre slots/camadas: ${layer.id}.`);
    }
    ids.add(layer.id);
  }
  if (layout.templateRef !== undefined && layout.templateRef !== null) {
    validateTemplateRef(layout.templateRef);
  }
  if (layout.sceneGraph !== undefined && layout.sceneGraph !== null) {
    validateSceneGraph(layout.sceneGraph, expected, ids);
  }
  if (background.kind === "image-slot" && !slots.some((slot) => slot.kind === "image")) {
    invalid("layoutSpec.background image-slot exige ao menos um slot image.");
  }
  for (const [index, slot] of slots.entries()) {
    if (slot.kind !== "logo") continue;
    const assetToken = slot.assetToken ?? compositionMode?.logoAssetToken ?? "logo.primary";
    if (!hasOwn(ir.assets, assetToken)) {
      invalid(`layoutSpec.slots[${index}] não consegue resolver o asset de logo ${assetToken}.`);
    }
  }
  return raw as LayoutSpec;
}

function validateSlotValue(raw: unknown, field: string): SlotValue {
  const value = record(raw, field);
  if (value.kind === "text") {
    onlyFields(value, ["kind", "text", "emphasis"], field);
    if (typeof value.text !== "string") invalid(`${field}.text deve ser uma string.`);
    if (value.emphasis !== undefined && value.emphasis !== null) {
      nonEmptyString(value.emphasis, `${field}.emphasis`);
    }
    return raw as SlotValue;
  }
  if (value.kind === "image") {
    if (hasOwn(value, "emphasis")) invalid(`${field}.emphasis só é permitido em texto.`);
    onlyFields(value, ["kind", "path", "sha256"], field);
    safePath(value.path, `${field}.path`, true);
    if (
      value.sha256 !== undefined &&
      value.sha256 !== null &&
      (typeof value.sha256 !== "string" || !SHA256.test(value.sha256))
    ) {
      invalid(`${field}.sha256 deve ser lowercase com 64 hexadecimais.`);
    }
    return raw as SlotValue;
  }
  invalid(`${field}.kind deve ser text ou image.`);
}

function validateLayerOverride(
  raw: unknown,
  field: string,
  element: Slot | LockedLayer,
  ir: BrandIr,
): LayerOverride {
  const override = record(raw, field);
  onlyFields(
    override,
    [
      "area",
      "rotationDeg",
      "opacity",
      "hidden",
      "zIndex",
      "colorToken",
      "fontToken",
      "fontSizePx",
      "fontWeight",
      "fontStyle",
      "lineHeight",
      "letterSpacingEm",
      "textAlign",
      "textTransform",
      "fillMode",
      "strokeColorToken",
      "strokeWidthPx",
      "fit",
      "spacingPx",
    ],
    field,
  );
  const present = (name: string): boolean =>
    override[name] !== undefined && override[name] !== null;

  if (present("area")) validateEditorArea(override.area, `${field}.area`);
  if (present("rotationDeg")) {
    boundedNumber(
      override.rotationDeg,
      `${field}.rotationDeg`,
      MIN_LAYER_ROTATION_DEG,
      MAX_LAYER_ROTATION_DEG,
    );
  }
  if (present("opacity")) boundedNumber(override.opacity, `${field}.opacity`, 0, 1);
  if (present("hidden") && typeof override.hidden !== "boolean") {
    invalid(`${field}.hidden deve ser booleano.`);
  }
  if (present("zIndex"))
    boundedNumber(integer(override.zIndex, `${field}.zIndex`), `${field}.zIndex`, 0, MAX_Z_INDEX);
  if (present("colorToken")) {
    knownKey(override.colorToken, `${field}.colorToken`, ir.colors, "cor");
  }
  if (present("fontToken")) {
    knownKey(override.fontToken, `${field}.fontToken`, ir.fonts, "fonte");
  }
  if (present("fontSizePx")) boundedNumber(override.fontSizePx, `${field}.fontSizePx`, 6, 1024);
  if (present("fontWeight")) {
    boundedNumber(
      integer(override.fontWeight, `${field}.fontWeight`),
      `${field}.fontWeight`,
      100,
      900,
    );
  }
  if (present("fontStyle") && override.fontStyle !== "normal" && override.fontStyle !== "italic") {
    invalid(`${field}.fontStyle é inválido.`);
  }
  if (present("lineHeight")) boundedNumber(override.lineHeight, `${field}.lineHeight`, 0.5, 3);
  if (present("letterSpacingEm")) {
    boundedNumber(
      override.letterSpacingEm,
      `${field}.letterSpacingEm`,
      MIN_EDITOR_LETTER_SPACING_EM,
      MAX_EDITOR_LETTER_SPACING_EM,
    );
  }
  if (
    present("textAlign") &&
    override.textAlign !== "left" &&
    override.textAlign !== "center" &&
    override.textAlign !== "right"
  ) {
    invalid(`${field}.textAlign é inválido.`);
  }
  if (
    present("textTransform") &&
    override.textTransform !== "none" &&
    override.textTransform !== "uppercase"
  ) {
    invalid(`${field}.textTransform é inválido.`);
  }
  if (present("fillMode") && override.fillMode !== "fill" && override.fillMode !== "stroke") {
    invalid(`${field}.fillMode é inválido.`);
  }
  if (present("strokeColorToken")) {
    knownKey(override.strokeColorToken, `${field}.strokeColorToken`, ir.colors, "cor");
  }
  if (present("strokeWidthPx")) {
    boundedNumber(override.strokeWidthPx, `${field}.strokeWidthPx`, Number.EPSILON, 20);
  }
  if (present("fit") && override.fit !== "contain" && override.fit !== "cover") {
    invalid(`${field}.fit é inválido.`);
  }
  if (present("spacingPx")) {
    boundedNumber(override.spacingPx, `${field}.spacingPx`, Number.EPSILON, 256);
  }

  const textOnly = [
    "fontToken",
    "fontSizePx",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacingEm",
    "textAlign",
    "textTransform",
    "fillMode",
    "strokeColorToken",
  ];
  if (element.kind !== "text" && textOnly.some(present)) {
    invalid(`${field} contém propriedades reservadas a texto.`);
  }
  if (present("strokeWidthPx") && element.kind !== "text" && element.kind !== "motif") {
    invalid(`${field}.strokeWidthPx só é aceito em texto ou motivo.`);
  }
  if (present("fit") && !["image", "logo", "asset"].includes(element.kind)) {
    invalid(`${field}.fit não é aceito nesta camada.`);
  }
  if (present("spacingPx") && element.kind !== "motif") {
    invalid(`${field}.spacingPx só é aceito em motivo.`);
  }
  if (present("colorToken") && !["text", "shape", "motif"].includes(element.kind)) {
    invalid(`${field}.colorToken não é aceito nesta camada.`);
  }
  if (element.kind === "text") {
    if (
      override.fillMode === "stroke" &&
      (!present("strokeColorToken") || !present("strokeWidthPx"))
    ) {
      invalid(`${field} exige cor e largura quando fillMode é stroke.`);
    }
    if (override.fillMode === "fill" && (present("strokeColorToken") || present("strokeWidthPx"))) {
      invalid(`${field} só aceita cor e largura de traço com fillMode stroke.`);
    }
  }
  return raw as LayerOverride;
}

function validateContent(raw: unknown, layout: LayoutSpec, ir: BrandIr): ContentSpec {
  const content = record(raw, "contentSpec");
  onlyFields(
    content,
    [
      "layoutId",
      "brandRevisionId",
      "values",
      "backgroundColorToken",
      "assetBindings",
      "overrides",
      "surface",
      "addedSlots",
      "addedLayers",
    ],
    "contentSpec",
  );
  const layoutId = nonEmptyString(content.layoutId, "contentSpec.layoutId");
  if (layoutId !== layout.id) invalid("contentSpec.layoutId diverge de layoutSpec.id.");
  const revision = nonEmptyString(content.brandRevisionId, "contentSpec.brandRevisionId");
  if (revision !== ir.revision.id)
    invalid("contentSpec.brandRevisionId diverge da revisão da marca.");
  const values = record(content.values, "contentSpec.values");
  const slots = new Map(layout.slots.map((slot) => [slot.id, slot]));
  if (content.backgroundColorToken !== undefined && content.backgroundColorToken !== null) {
    knownKey(
      content.backgroundColorToken,
      "contentSpec.backgroundColorToken",
      ir.colors,
      "token de cor",
    );
  }
  if (content.assetBindings !== undefined) {
    const bindings = record(content.assetBindings, "contentSpec.assetBindings");
    const bindableAssets = new Map<string, Slot | LockedLayer>([
      ...layout.slots
        .filter((slot) => slot.kind === "logo")
        .map((slot) => [slot.id, slot] as const),
      ...(layout.lockedLayers ?? [])
        .filter((layer) => layer.kind === "asset")
        .map((layer) => [layer.id, layer] as const),
    ]);
    for (const elementId of Object.keys(bindings).sort()) {
      const element = bindableAssets.get(elementId);
      if (!element) {
        invalid(
          `contentSpec.assetBindings.${elementId} referencia elemento de asset desconhecido.`,
        );
      }
      knownKey(bindings[elementId], `contentSpec.assetBindings.${elementId}`, ir.assets, "asset");
    }
  }
  for (const [field, expectedKind] of [
    ["addedSlots", "slot"],
    ["addedLayers", "layer"],
  ] as const) {
    const additions = content[field];
    if (additions === undefined) continue;
    if (!Array.isArray(additions)) invalid(`contentSpec.${field} deve ser um array.`);
    for (const [index, addition] of additions.entries()) {
      const item = record(addition, `contentSpec.${field}[${index}]`);
      const id = nonEmptyString(item.id, `contentSpec.${field}[${index}].id`);
      if (!id.startsWith("user-")) {
        invalid(`contentSpec.${field}[${index}].id precisa começar por user-.`);
      }
      const found =
        expectedKind === "slot"
          ? slots.has(id)
          : (layout.lockedLayers ?? []).some((layer) => layer.id === id);
      if (!found) invalid(`contentSpec.${field}[${index}] não está materializado no layout.`);
    }
  }
  for (const id of Object.keys(values).sort()) {
    const slot = slots.get(id);
    if (!slot) invalid(`contentSpec.values.${id} referencia slot desconhecido.`);
    const value = validateSlotValue(values[id], `contentSpec.values.${id}`);
    if (slot.kind === "logo" || value.kind !== slot.kind) {
      invalid(`contentSpec.values.${id}.kind é incompatível com o slot ${slot.kind}.`);
    }
    if (value.kind === "text" && value.emphasis !== undefined && value.emphasis !== null) {
      if (!slot.emphasisColorToken) {
        invalid(`contentSpec.values.${id}.emphasis exige emphasisColorToken no slot.`);
      }
    }
  }
  const elements = new Map<string, Slot | LockedLayer>([
    ...layout.slots.map((slot) => [slot.id, slot] as const),
    ...(layout.lockedLayers ?? []).map((layer) => [layer.id, layer] as const),
  ]);
  const overrides =
    content.overrides === undefined ? {} : record(content.overrides, "contentSpec.overrides");
  for (const id of Object.keys(overrides).sort()) {
    const element = elements.get(id);
    if (!element) invalid(`contentSpec.overrides.${id} referencia camada desconhecida.`);
    validateLayerOverride(overrides[id], `contentSpec.overrides.${id}`, element, ir);
  }
  if (content.surface !== undefined && content.surface !== null) {
    const surface = record(content.surface, "contentSpec.surface");
    onlyFields(
      surface,
      ["kind", "colorToken", "opacity", "scalePx", "weightPx", "angleDeg"],
      "contentSpec.surface",
    );
    if (typeof surface.kind !== "string" || !SURFACE_KIND_SET.has(surface.kind)) {
      invalid("contentSpec.surface.kind é inválido.");
    }
    knownKey(surface.colorToken, "contentSpec.surface.colorToken", ir.colors, "cor");
    boundedNumber(surface.opacity, "contentSpec.surface.opacity", 0, 1);
    boundedNumber(surface.scalePx, "contentSpec.surface.scalePx", 4, 512);
    boundedNumber(surface.weightPx, "contentSpec.surface.weightPx", Number.EPSILON, 32);
    boundedNumber(surface.angleDeg, "contentSpec.surface.angleDeg", -180, 180);
  }
  return raw as ContentSpec;
}

export function parsePayload(raw: unknown): Payload {
  const payload = record(raw, "raiz");
  const ir = validateBrandIr(payload.brandIr);
  const layout = validateLayout(payload.layoutSpec, ir);
  validateContent(payload.contentSpec, layout, ir);
  validateAssetsBaseUrl(payload.assetsBaseUrl);
  return raw as Payload;
}
