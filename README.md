# Hub de Artes Armazém - Cloudflare Pages

Estrutura:
- `index.html`: app público do hub.
- `functions/api/drive.js`: Function que lista o Google Drive por etapas.
- `assets/product-icons/*.svg`: ícones de produto centralizados e padronizados.

Variável necessária no Cloudflare Pages:
`GOOGLE_API_KEY`

Teste da API:
`/api/drive?mode=themes`

Fluxo:
1. Escolhe tema.
2. Escolhe produto.
3. Seleciona artes.
4. Envia para Ana ou Dayane no WhatsApp com 10% de desconto aplicado.
