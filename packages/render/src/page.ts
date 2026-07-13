import { parsePayload } from "./payload";
import { renderDocumentStable } from "./stable";
import type { GuardReport } from "./types";

declare global {
  interface Window {
    __PAYLOAD__?: unknown;
    __RENDER_DONE__?: boolean;
    __GUARD_REPORT__?: GuardReport;
    __RENDER_ERROR__?: string;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function bootstrapRenderPage(): Promise<void> {
  delete window.__RENDER_DONE__;
  delete window.__GUARD_REPORT__;
  delete window.__RENDER_ERROR__;
  if (window.__PAYLOAD__ === undefined) {
    window.__RENDER_ERROR__ =
      "window.__PAYLOAD__ ausente — o payload deve ser injetado antes do script.";
    return;
  }

  try {
    const payload = parsePayload(window.__PAYLOAD__);
    const canvas = document.getElementById("canvas");
    if (!canvas) {
      window.__RENDER_ERROR__ = "elemento #canvas ausente na página de render.";
      return;
    }
    const report = await renderDocumentStable(canvas, payload);
    window.__GUARD_REPORT__ = report;
    window.__RENDER_DONE__ = true;
  } catch (error) {
    window.__RENDER_ERROR__ = errorMessage(error);
  }
}

export type { StableRenderOptions } from "./stable";
export { renderDocumentStable } from "./stable";
