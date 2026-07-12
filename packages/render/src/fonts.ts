import type { BrandIr } from "./types";

export const FALLBACK_FAMILY = "sans-serif";

const DATA_PNG = /^data:image\/png;base64,iVBORw0KGgo[a-z\d+/]*={0,2}$/i;
const MAX_INLINE_PNG_LENGTH = "data:image/png;base64,".length + 16_384;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

export function internalFamily(token: string): string {
  return `br-${token.replaceAll(".", "-").replace(/[^a-z\d_-]/gi, "-")}`;
}

export function joinUrl(base: string, path: string): string {
  const inlineData = path.slice("data:image/png;base64,".length);
  if (path.length <= MAX_INLINE_PNG_LENGTH && inlineData.length % 4 === 0 && DATA_PNG.test(path)) {
    return path;
  }
  if (SCHEME.test(path) || path.startsWith("/") || path.startsWith("//")) {
    throw new Error("URL de asset externa não é permitida.");
  }
  if (path.includes("\\")) throw new Error("Path de asset inválido: barra invertida.");
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Path de asset inválido.");
  }
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${base.replace(/\/+$/, "")}/${encoded}`;
}

export interface FontFaceBuild {
  css: string;
  families: Record<string, string>;
  fallbacks: Array<{
    token: string;
    family: string;
    reason: "referenced-only" | "configured-fallback";
  }>;
}

export function buildFontFaces(ir: BrandIr, assetsBaseUrl: string): FontFaceBuild {
  const blocks: string[] = [];
  const families = Object.create(null) as Record<string, string>;
  const fallbacks: FontFaceBuild["fallbacks"] = [];
  const internalNames = new Map<string, string>();
  for (const token of Object.keys(ir.fonts).sort()) {
    const font = ir.fonts[token];
    if (font.source === "file" && font.fileSha256) {
      const family = internalFamily(token);
      const previous = internalNames.get(family);
      if (previous && previous !== token) {
        throw new Error(
          `Tokens de fonte ${previous} e ${token} geram a mesma família interna: ${family}.`,
        );
      }
      internalNames.set(family, token);
      blocks.push(
        [
          "@font-face {",
          `  font-family: "${family}";`,
          `  src: url("${joinUrl(assetsBaseUrl, `fonts/${font.fileSha256}`)}");`,
          `  font-weight: ${font.weight};`,
          `  font-style: ${font.style};`,
          "  font-display: block;",
          "}",
        ].join("\n"),
      );
      families[token] = `"${family}", ${FALLBACK_FAMILY}`;
      continue;
    }

    families[token] = FALLBACK_FAMILY;
    fallbacks.push({
      token,
      family: font.family,
      reason: font.source === "referenced-only" ? "referenced-only" : "configured-fallback",
    });
  }
  return { css: blocks.join("\n\n"), families, fallbacks };
}

export function fontLoadSpecs(ir: BrandIr): string[] {
  return Object.keys(ir.fonts)
    .sort()
    .filter((token) => ir.fonts[token].source === "file")
    .map((token) => {
      const font = ir.fonts[token];
      const italic = font.style === "italic" ? "italic " : "";
      return `${italic}${font.weight} 16px "${internalFamily(token)}"`;
    });
}
