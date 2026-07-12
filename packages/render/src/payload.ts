import type {
  Background,
  BrandIr,
  Canvas,
  ContentSpec,
  LayoutSpec,
  Payload,
  Profile,
  Slot,
  SlotValue,
} from "./types";

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

function validateBrandIr(raw: unknown): BrandIr {
  const ir = record(raw, "brandIr");
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

function validateSlot(raw: unknown, index: number, canvas: Canvas, ir: BrandIr): Slot {
  const prefix = `layoutSpec.slots[${index}]`;
  const slot = record(raw, prefix);
  nonEmptyString(slot.id, `${prefix}.id`);
  if (slot.kind !== "text" && slot.kind !== "image" && slot.kind !== "logo") {
    invalid(`${prefix}.kind é inválido.`);
  }
  if (slot.fit !== "shrink-within-role-range" && slot.fit !== "fixed") {
    invalid(`${prefix}.fit é inválido.`);
  }
  if (typeof slot.required !== "boolean") invalid(`${prefix}.required deve ser booleano.`);
  if (!Array.isArray(slot.area) || slot.area.length !== 4) {
    invalid(`${prefix}.area deve conter quatro inteiros.`);
  }
  const [x, y, width, height] = slot.area.map((value, item) =>
    integer(value, `${prefix}.area[${item}]`),
  );
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > canvas.widthPx ||
    y + height > canvas.heightPx
  ) {
    invalid(`${prefix}.area deve ser positiva e permanecer dentro do canvas.`);
  }

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
  if (!Array.isArray(layout.slots)) invalid("layoutSpec.slots deve ser um array.");
  const ids = new Set<string>();
  layout.slots.forEach((rawSlot, index) => {
    const slot = validateSlot(rawSlot, index, expected, ir);
    if (ids.has(slot.id)) invalid(`layoutSpec.slots contém id duplicado: ${slot.id}.`);
    ids.add(slot.id);
  });
  if (background.kind === "image-slot" && !layout.slots.some((slot) => slot.kind === "image")) {
    invalid("layoutSpec.background image-slot exige ao menos um slot image.");
  }
  return raw as LayoutSpec;
}

function validateSlotValue(raw: unknown, field: string): SlotValue {
  const value = record(raw, field);
  if (value.kind === "text") {
    if (typeof value.text !== "string") invalid(`${field}.text deve ser uma string.`);
    return raw as SlotValue;
  }
  if (value.kind === "image") {
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

function validateContent(raw: unknown, layout: LayoutSpec, ir: BrandIr): ContentSpec {
  const content = record(raw, "contentSpec");
  const layoutId = nonEmptyString(content.layoutId, "contentSpec.layoutId");
  if (layoutId !== layout.id) invalid("contentSpec.layoutId diverge de layoutSpec.id.");
  const revision = nonEmptyString(content.brandRevisionId, "contentSpec.brandRevisionId");
  if (revision !== ir.revision.id)
    invalid("contentSpec.brandRevisionId diverge da revisão da marca.");
  const values = record(content.values, "contentSpec.values");
  const slots = new Map(layout.slots.map((slot) => [slot.id, slot]));
  for (const id of Object.keys(values).sort()) {
    const slot = slots.get(id);
    if (!slot) invalid(`contentSpec.values.${id} referencia slot desconhecido.`);
    const value = validateSlotValue(values[id], `contentSpec.values.${id}`);
    if (slot.kind === "logo" || value.kind !== slot.kind) {
      invalid(`contentSpec.values.${id}.kind é incompatível com o slot ${slot.kind}.`);
    }
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
