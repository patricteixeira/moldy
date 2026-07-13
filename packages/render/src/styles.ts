import type { BrandIr } from "./types";

export interface TextStyle {
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  lineHeight: string;
  minSizePx: number;
  maxSizePx: number;
}

export function roleStyle(
  ir: BrandIr,
  roleName: string,
  families: Record<string, string>,
): TextStyle {
  const role = ir.roles[roleName];
  if (!role) throw new Error(`Papel tipográfico desconhecido: ${roleName}.`);
  const font = ir.fonts[role.font];
  if (!font) throw new Error(`Token de fonte desconhecido: ${role.font}.`);
  const color = ir.colors[role.color];
  if (!color) throw new Error(`Token de cor desconhecido: ${role.color}.`);
  const fontFamily = families[role.font];
  if (!fontFamily) throw new Error(`Família de fonte desconhecida: ${role.font}.`);
  return {
    fontFamily,
    fontWeight: String(font.weight),
    fontStyle: font.style,
    color: color.value,
    lineHeight: String(role.lineHeight),
    minSizePx: role.minSizePx,
    maxSizePx: role.maxSizePx,
  };
}
