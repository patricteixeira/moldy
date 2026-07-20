# ADR 0018 — OCR local de PDFs achatados

## Contexto

Alguns manuais de marca visualmente completos são exportados com todo o texto
convertido em contornos ou imagens. Para um extrator de texto, essas páginas
parecem vazias, embora contenham manifesto, paleta, tipografia e regras de uso.

## Decisão

- Preservar a camada textual nativa sempre que ela contiver conteúdo suficiente.
- Quando uma página tiver menos de 24 caracteres alfanuméricos, renderizá-la a
  150 DPI e executar Tesseract local com os idiomas `por+eng`.
- Manter texto e blocos reconhecidos numa cache por caminho, tamanho e data de
  modificação, evitando repetir OCR entre os extratores do mesmo import.
- Reaproveitar a leitura em identidade, cores declaradas, fontes declaradas e
  composição.
- Se Tesseract não estiver disponível, manter o comportamento anterior sem
  interromper a importação.

## Consequências

O contêiner da API cresce cerca de 107 MiB instalados e o import de um manual
achatado é mais lento. Dentro do mesmo import, os vários extratores reutilizam a
leitura; PDFs com texto nativo não pagam o custo de OCR. Nenhum conteúdo sai da
máquina.
