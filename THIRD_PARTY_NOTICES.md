# Avisos de terceiros

## Modelo inglês → português do Brasil

O build self-hosted do Molda inclui o pacote `translate-en_pb-1_9`, distribuído
pelo projeto Argos Translate. O modelo deriva do OPUS-MT e é licenciado sob
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

- autores: Jörg Tiedemann e Santhosh Thottingal;
- trabalho: “OPUS-MT — Building open translation services for the World”;
- publicação: Proceedings of the 22nd Annual Conference of the European
  Association for Machine Translation (EAMT), Lisboa, 2020;
- pacote: English - Portuguese (Brazil), versão 1.9;
- origem: `https://argos-net.com/v1/translate-en_pb-1_9.argosmodel`;
- SHA-256: `1d1cd5e9540c6b38c258bed002a42d3b311b8a189acb74feaa311ef30d175c5b`.

O runtime usa CTranslate2 (MIT) e SentencePiece (Apache-2.0) para executar o
modelo localmente. Os textos do manual não são enviados a esses projetos nem a
qualquer serviço remoto.

## OCR de PDFs achatados

O build self-hosted inclui Tesseract OCR e os dados de idioma `por` e `eng`,
distribuídos sob Apache-2.0. O OCR é executado localmente apenas quando uma
página não contém texto digital suficiente. As imagens e os textos reconhecidos
não são enviados a qualquer serviço remoto.
