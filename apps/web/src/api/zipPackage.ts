import JSZip from "jszip"

const PACKAGE_DIRECTORIES: Record<string, string> = {
  ".svg": "assets/logos",
  ".png": "assets/logos",
  ".ttf": "fonts",
  ".otf": "fonts",
}

export async function buildPackageZip(files: File[]): Promise<Blob> {
  const zip = new JSZip()
  const destinations = new Set<string>()
  for (const file of files) {
    const name = file.name.normalize("NFC")
    if (
      name.length === 0 ||
      /[\\/:\u0000-\u001f]/.test(name) ||
      name.endsWith(".") ||
      name.endsWith(" ")
    ) {
      throw new Error("Um arquivo escolhido tem nome inválido.")
    }
    const dot = name.lastIndexOf(".")
    const extension = dot >= 0 ? name.slice(dot).toLocaleLowerCase("en-US") : ""
    const directory = PACKAGE_DIRECTORIES[extension]
    const path = directory ? `${directory}/${name}` : name
    const key = path.normalize("NFC").toLocaleLowerCase("en-US")
    if (destinations.has(key)) {
      throw new Error("Há arquivos com o mesmo destino no pacote da marca.")
    }
    destinations.add(key)
    zip.file(path, file)
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" })
}
