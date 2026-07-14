export const SLOT_LABELS: Record<string, string> = {
  kicker: "Frase de apoio",
  headline: "Frase principal",
  index: "Número",
  signature: "Assinatura",
  title: "Título",
  quote: "Citação",
  author: "Autor(a)",
  body: "Texto",
  photo: "Foto",
}

export function slotLabel(slotId: string): string {
  return SLOT_LABELS[slotId] ?? `${slotId.charAt(0).toLocaleUpperCase("pt-BR")}${slotId.slice(1)}`
}
