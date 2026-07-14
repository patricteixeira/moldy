import { expect, test } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(here, ".fixtures")
const PKG = path.join(FIX, "acme-package")

function enginePython(): string {
  const candidates = [
    process.env.ENGINE_PYTHON,
    path.resolve(here, "../../../packages/engine/.venv/Scripts/python.exe"),
    path.resolve(here, "../../../packages/engine/.venv/bin/python"),
  ].filter((candidate): candidate is string => Boolean(candidate))
  const executable = candidates.find((candidate) => fs.existsSync(candidate))
  if (!executable) throw new Error("Python do engine não encontrado para validar o export.")
  return executable
}

function validateOutput(kind: "png" | "pdf" | "pptx" | "docx", file: string): void {
  execFileSync(
    enginePython(),
    [path.join(here, "fixtures", "validate_output.py"), kind, file],
    { stdio: "inherit" },
  )
}

test("walking skeleton M1/M2: instalar → confirmar → kit → slots → guard → exportar", async ({
  page,
}) => {
  await page.goto("/")
  const intake = page.getByTestId("wizard-file-input")
  await intake.setInputFiles(path.join(PKG, "assets", "logos", "logo.svg"))
  await intake.setInputFiles(path.join(PKG, "manual.pdf"))
  await intake.setInputFiles(path.join(PKG, "fonts", "fixture-sans-bold.ttf"))
  await expect(page.getByText("materiais reunidos", { exact: false })).toContainText(
    "3 materiais reunidos",
  )
  await page.getByTestId("wizard-enviar").click()

  await expect(page.getByTestId("wizard-question")).toContainText(
    "Qual destas é a cor principal da marca?",
  )
  for (let index = 0; index < 8; index += 1) {
    const visible = await page
      .getByTestId("wizard-question")
      .isVisible()
      .catch(() => false)
    if (!visible) break
    await page.getByTestId("candidate-option").first().click()
    await page.getByTestId("wizard-confirmar").click()
  }
  await expect(page.getByTestId("wizard-question")).not.toBeVisible()

  await page.getByTestId("wizard-brand-name").fill("ACME")
  await page.getByTestId("wizard-publicar").click()

  await expect(page).toHaveURL(/\/marcas\/brandrev_[0-9a-f]+\/kit/)
  await expect(page.getByTestId("kit-card")).toHaveCount(10)
  const kitUrl = page.url()

  await page.locator('[data-testid="kit-card"][data-layout-id="quote-post-1x1"]').click()
  await page.getByTestId("slot-input-quote").fill("A".repeat(200))
  await expect(page.getByTestId("char-counter-quote")).toHaveAttribute("data-over", "true")
  const lowUpload = page.waitForResponse(
    (response) => response.url().endsWith("/v1/assets") && response.request().method() === "POST",
  )
  await page.getByTestId("slot-image-input-photo").setInputFiles(path.join(FIX, "photos", "low.png"))
  await lowUpload
  await expect(page.getByText("Foto pronta.")).toBeVisible()
  await page.getByTestId("exportar-png").click()
  await expect(
    page.locator('[data-testid="guard-item"][data-check-id="text-length"]'),
  ).toBeVisible()
  await expect(
    page.locator('[data-testid="guard-item"][data-check-id="image-resolution"]'),
  ).toBeVisible()

  await page.getByTestId("slot-input-quote").fill("Menos é mais.")
  const okUpload = page.waitForResponse(
    (response) => response.url().endsWith("/v1/assets") && response.request().method() === "POST",
  )
  await page.getByTestId("slot-image-input-photo").setInputFiles(path.join(FIX, "photos", "ok.png"))
  await okUpload
  await expect(page.getByText("Foto pronta.")).toBeVisible()
  await page.getByTestId("exportar-png").click()
  const pngLink = page.getByTestId("download-link")
  await expect(pngLink).toBeVisible({ timeout: 120_000 })
  const pngDownload = page.waitForEvent("download")
  await pngLink.click()
  const pngPath = path.join(FIX, "out-post.png")
  await (await pngDownload).saveAs(pngPath)
  validateOutput("png", pngPath)

  await page.getByTestId("exportar-pptx").click()
  await expect(page.getByTestId("export-status")).toContainText("PPTX pronto", {
    timeout: 120_000,
  })
  const pptxLink = page.getByTestId("download-link")
  await expect(pptxLink).toHaveAttribute("download", /\.pptx$/)
  const pptxDownload = page.waitForEvent("download")
  await pptxLink.click()
  const pptxPath = path.join(FIX, "out-post.pptx")
  await (await pptxDownload).saveAs(pptxPath)
  validateOutput("pptx", pptxPath)

  await page.goto(kitUrl)
  await page.locator('[data-testid="kit-card"][data-layout-id="one-pager-doc-a4"]').click()
  await page.getByTestId("slot-input-title").fill("Relatório do mês")
  await page
    .getByTestId("slot-input-body")
    .fill("Um documento simples produzido dentro dos trilhos da marca.")
  await page.getByTestId("exportar-pdf").click()
  const pdfLink = page.getByTestId("download-link")
  await expect(pdfLink).toBeVisible({ timeout: 120_000 })
  const pdfDownload = page.waitForEvent("download")
  await pdfLink.click()
  const pdfPath = path.join(FIX, "out-doc.pdf")
  await (await pdfDownload).saveAs(pdfPath)
  validateOutput("pdf", pdfPath)

  await page.getByTestId("exportar-docx").click()
  await expect(page.getByTestId("export-status")).toContainText("DOCX pronto", {
    timeout: 120_000,
  })
  const docxLink = page.getByTestId("download-link")
  await expect(docxLink).toHaveAttribute("download", /\.docx$/)
  const docxDownload = page.waitForEvent("download")
  await docxLink.click()
  const docxPath = path.join(FIX, "out-doc.docx")
  await (await docxDownload).saveAs(docxPath)
  validateOutput("docx", docxPath)
})
