import JSZip from "jszip"
import { expect, it } from "vitest"
import { buildPackageZip } from "./zipPackage"

it("monta o ZIP na convenção do pacote do engine", async () => {
  const blob = await buildPackageZip([
    new File(["%PDF"], "manual.pdf"),
    new File(["<svg/>"], "logo.svg"),
    new File(["png"], "simbolo.png"),
    new File(["ttf"], "titulos.ttf"),
    new File(["{}"], "tokens.json"),
  ])
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const paths = Object.values(zip.files)
    .filter((file) => !file.dir)
    .map((file) => file.name)
    .sort()
  expect(paths).toEqual([
    "assets/logos/logo.svg",
    "assets/logos/simbolo.png",
    "fonts/titulos.ttf",
    "manual.pdf",
    "tokens.json",
  ])
  expect(await zip.files["manual.pdf"].async("string")).toBe("%PDF")
})

it("recusa nomes hostis e colisões entre plataformas", async () => {
  await expect(buildPackageZip([new File(["x"], "../logo.svg")])).rejects.toThrow(
    "nome inválido",
  )
  await expect(
    buildPackageZip([new File(["a"], "Logo.svg"), new File(["b"], "logo.SVG")]),
  ).rejects.toThrow("mesmo destino")
})
