import JSZip from "jszip"
import { expect, it } from "vitest"
import { buildPackageZip } from "./zipPackage"

it("monta o ZIP na convenção do pacote do engine", async () => {
  const progress: number[] = []
  const blob = await buildPackageZip([
    new File(["%PDF"], "manual.pdf"),
    new File(["<svg/>"], "logo.svg"),
    new File(["png"], "simbolo.png"),
    new File(["ttf"], "titulos.ttf"),
    new File(["{}"], "tokens.json"),
  ], (percent) => progress.push(percent))
  const archiveBytes = await blob.arrayBuffer()
  const firstHeader = new DataView(archiveBytes)
  expect(firstHeader.getUint32(0, true)).toBe(0x04034b50)
  expect(firstHeader.getUint16(8, true)).toBe(0)
  expect(progress.at(-1)).toBe(100)
  const zip = await JSZip.loadAsync(archiveBytes)
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
