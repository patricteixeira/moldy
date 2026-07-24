import { expect, test } from "@playwright/test"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"

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

function validateOutput(
  kind: "png" | "png-4x5" | "pdf" | "pptx" | "docx",
  file: string,
): void {
  execFileSync(
    enginePython(),
    [path.join(here, "fixtures", "validate_output.py"), kind, file],
    { stdio: "inherit" },
  )
}

test("walking skeleton v0.2: configurar → escolher → editar → exportar", async ({
  page,
}) => {
  await page.goto("/")
  const intake = page.getByTestId("wizard-file-input")
  await intake.setInputFiles(path.join(PKG, "assets", "logos", "logo.svg"))
  await intake.setInputFiles(path.join(PKG, "manual.pdf"))
  await intake.setInputFiles(path.join(PKG, "fonts", "fixture-sans-bold.ttf"))
  await expect(page.getByText("arquivos escolhidos", { exact: false })).toContainText(
    "3 arquivos escolhidos",
  )
  await page.getByTestId("wizard-enviar").click()

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

  await expect(page).toHaveURL(/\/marcas\/brandrev_[0-9a-f]+\/criar/)
  await page.getByRole("radio", { name: /Explicar ou ensinar/ }).check()
  await page.getByRole("radio", { name: /Peça individual/ }).check()
  await page.getByRole("button", { name: "Escolher formato" }).click()
  await page.getByRole("button", { name: "Definir conteúdo" }).click()
  await page.getByRole("button", { name: "Ver modelos" }).click()

  await expect(page).toHaveURL(/\/marcas\/brandrev_[0-9a-f]+\/kit\?/)
  await expect.poll(async () => page.getByTestId("kit-card").count()).toBeGreaterThanOrEqual(8)
  await expect(
    page.locator(
      '[data-testid="kit-card"][data-layout-id="ritmo-editorial-closing-post-4x5"]',
    ),
  ).toBeVisible()
  const kitUrl = page.url()
  const kitBaseUrl = kitUrl.split("?")[0]

  await page.getByRole("button", { name: /Todos os modelos/ }).click()
  await expect.poll(async () => page.getByTestId("kit-card").count()).toBeGreaterThan(13)

  await page.locator('[data-testid="kit-card"][data-layout-id="quote-post-4x5"]').click()
  await expect(page.getByRole("heading", { name: "Ainda não há uma sugestão" })).toBeVisible()
  await page.getByRole("button", { name: "Ver todas as 20 texturas" }).click()
  await page
    .getByTestId("surface-option")
    .filter({ hasText: "Curvas de nível" })
    .last()
    .click()
  await expect(page.getByText("Ajustar Curvas de nível")).toBeVisible()
  await expect(page.locator('.preview-canvas [data-surface-kind="topographic"]')).toBeVisible()

  await page.getByRole("button", { name: "Citação", exact: true }).click()
  const quoteSelection = page.getByTestId("canvas-selection")
  const quoteBox = await quoteSelection.boundingBox()
  if (!quoteBox) throw new Error("Seleção da citação não recebeu geometria visível.")
  const quoteX = page.getByRole("spinbutton", { name: "X", exact: true })
  const initialQuoteX = Number(await quoteX.inputValue())
  await page.mouse.move(quoteBox.x + quoteBox.width / 2, quoteBox.y + quoteBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(quoteBox.x + quoteBox.width / 2 + 48, quoteBox.y + quoteBox.height / 2 + 24)
  await page.mouse.up()
  await expect.poll(async () => Number(await quoteX.inputValue())).not.toBe(initialQuoteX)

  await page.getByRole("button", { name: "Logo", exact: true }).click()
  await page.getByRole("spinbutton", { name: "X", exact: true }).fill("-180")
  await page.getByRole("spinbutton", { name: "Y", exact: true }).fill("760")
  await page.getByRole("spinbutton", { name: "L", exact: true }).fill("1600")
  await page.getByRole("spinbutton", { name: "A", exact: true }).fill("900")
  await expect(page.getByTestId("canvas-selection")).toHaveAttribute("data-layer", "logo")
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toHaveValue("-180")
  await expect(page.getByRole("spinbutton", { name: "L", exact: true })).toHaveValue("1600")

  await page.getByRole("button", { name: "Citação", exact: true }).click()
  await page.getByTestId("slot-input-quote").fill("A".repeat(200))
  await expect(page.getByTestId("char-counter-quote")).toHaveAttribute("data-over", "true")
  await page.getByRole("button", { name: "Foto", exact: true }).click()
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

  await page.getByRole("button", { name: "Citação", exact: true }).click()
  await page.getByTestId("slot-input-quote").fill("Menos é mais.")
  await page.getByRole("button", { name: "Foto", exact: true }).click()
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
  validateOutput("png-4x5", pngPath)

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

  await expect(page.getByText("Confira o arquivo editado")).toBeVisible()
  await page.getByTestId("roundtrip-file").setInputFiles(pptxPath)
  await page.getByTestId("roundtrip-analyze").click()
  await expect(page.getByText("Nenhum problema encontrado. O arquivo pode ser usado.")).toBeVisible({
    timeout: 120_000,
  })

  await page.goto(kitBaseUrl)
  await page.getByRole("button", { name: /Todos os modelos/ }).click()
  await page.locator('[data-testid="kit-card"][data-layout-id="one-pager-doc-a4"]').click()
  await page.getByTestId("slot-input-title").fill("Relatório do mês")
  await page.getByRole("button", { name: "Texto", exact: true }).click()
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

  await page.goto(kitBaseUrl)
  await page.getByRole("link", { name: "Carrossel" }).click()
  await expect(page.getByRole("heading", { name: "Crie um carrossel." })).toBeVisible()
  await page.getByLabel("Nome do carrossel").fill("Autonomia em três atos")
  await page.getByRole("combobox", { name: /Quantidade de slides/ }).selectOption("3")
  await page.getByLabel("Texto da assinatura").fill("@acme")

  await page.getByLabel("Título principal").fill("Sistemas que devolvem autonomia")
  await page.getByRole("button", { name: /02 Conteúdo/ }).click()
  await page.getByLabel("Título principal").fill("Clareza antes da ferramenta")
  await page.getByRole("button", { name: "+ Adicionar bloco" }).click()
  await page
    .getByLabel("Bloco 1")
    .fill("A marca organiza decisões para que cada peça continue reconhecível.")
  await page.getByRole("button", { name: /03 Fechamento/ }).click()
  await page.getByLabel("Mensagem final").fill("Construa com intenção")

  await page.getByRole("button", { name: "Gerar 3 slides" }).click()
  await expect(page.getByRole("heading", { name: "Autonomia em três atos" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Editar slide/ })).toHaveCount(3)
  await expect(page.getByText("Escolha inteligente")).toHaveCount(3)
  const carouselUrl = page.url()

  await page.getByRole("link", { name: /Editar slide 01/ }).click()
  await expect(page.getByLabel("Slide 1 de 3")).toBeVisible()
  const editorTextareas = page.locator('textarea[data-testid^="slot-input-"]')
  const editorTextareaCount = await editorTextareas.count()
  expect(editorTextareaCount).toBeGreaterThan(0)
  const firstEditorTextarea = editorTextareas.first()
  const originalSlideText = await firstEditorTextarea.inputValue()
  await firstEditorTextarea.fill(`${originalSlideText} — revisada`)
  await page.locator(".editor-carousel-save").click()
  await expect(page.locator(".editor-carousel-save")).toHaveText("Salvo no carrossel")

  await page.goto(carouselUrl)
  await expect(page.getByRole("heading", { name: "Autonomia em três atos" })).toBeVisible()
  await page.getByRole("link", { name: /Editar slide 01/ }).click()
  await expect(page.locator('textarea[data-testid^="slot-input-"]').first()).toHaveValue(
    /— revisada/,
  )

  await page.goto(carouselUrl)
  await page.getByRole("button", { name: "Exportar todos em PNG" }).click()
  const zipLink = page.getByRole("link", { name: /Baixar .*\.zip/ })
  await expect(zipLink).toBeVisible({ timeout: 120_000 })
  const zipDownload = page.waitForEvent("download")
  await zipLink.click()
  const zipPath = path.join(FIX, "out-carousel.zip")
  await (await zipDownload).saveAs(zipPath)

  const archive = await JSZip.loadAsync(fs.readFileSync(zipPath))
  const slideNames = Object.keys(archive.files)
    .filter((name) => /^\d{2}\.png$/.test(name))
    .sort()
  expect(slideNames).toEqual(["01.png", "02.png", "03.png"])
  for (const [index, name] of slideNames.entries()) {
    const slidePath = path.join(FIX, `out-carousel-${index + 1}.png`)
    fs.writeFileSync(slidePath, await archive.file(name)!.async("nodebuffer"))
    validateOutput("png-4x5", slidePath)
  }
})
