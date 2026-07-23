# Synapsis na edição oficial

Este diretório é o ponto de injeção dos arquivos web proprietários usados pela
edição oficial hospedada do Molda. Os arquivos `.woff2` são deliberadamente
ignorados pelo Git e não fazem parte da distribuição open source.

A licença é restrita: a Synapsis pode ser carregada e exibida exclusivamente na
instância oficial online do Molda operada pelo Digital Artisan. A transferência
técnica para o navegador, seu cache ou uma captura da interface não concede
direito de instalar, usar separadamente, modificar, converter, extrair,
redistribuir, sublicenciar ou incorporar a fonte em outro site, aplicativo,
documento ou produto.

Arquivos esperados:

- `synapsis-400.woff2`
- `synapsis-500.woff2`
- `synapsis-600.woff2`
- `synapsis-700.woff2`
- `synapsis-900.woff2`

Os arquivos oficiais preservam os 683 glifos presentes nos TTF originais. Não
há subset de caracteres: acentos, caracteres combinados, cirílico, símbolos,
setas e formas geométricas continuam disponíveis.

Para ativar a família em um build oficial, defina:

```dotenv
VITE_SYNAPSIS_FONT_BASE_URL=/fonts/synapsis
```

Também é possível informar a URL de um CDN. Nesse caso, o servidor de ativos
precisa permitir que a origem do aplicativo carregue os arquivos de fonte.

Sem essa variável, o aplicativo usa Archivo e não procura uma instalação local
da Synapsis. O build open source não gera requisições para arquivos
proprietários ausentes.

Synapsis é uma criação do Digital Artisan.

Copyright © 2026 Digital Artisan. Todos os direitos reservados.
