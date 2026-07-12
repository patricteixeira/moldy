import { parsePayload } from "./payload";
import { renderDocumentStable } from "./stable";

declare global {
  interface Window {
    __PREVIEW_DONE__?: boolean;
    __PREVIEW_ERROR__?: string;
  }
}

export async function bootstrapPreviewPage(): Promise<void> {
  delete window.__PREVIEW_DONE__;
  delete window.__PREVIEW_ERROR__;
  if (window.__PAYLOAD__ === undefined) {
    window.__PREVIEW_ERROR__ =
      "window.__PAYLOAD__ ausente — o payload deve ser injetado antes do script.";
    return;
  }
  try {
    const payload = parsePayload(window.__PAYLOAD__);
    const canvas = document.getElementById("canvas");
    if (!canvas) {
      window.__PREVIEW_ERROR__ = "elemento #canvas ausente na página de preview.";
      return;
    }
    window.__GUARD_REPORT__ = await renderDocumentStable(canvas, payload);
    window.__PREVIEW_DONE__ = true;
  } catch (error) {
    window.__PREVIEW_ERROR__ = error instanceof Error ? error.message : String(error);
  }
}
