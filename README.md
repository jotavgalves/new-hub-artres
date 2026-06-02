# Hub de Artes Armazém — Cloudflare Pages

Esta versão lê o Google Drive em modo preguiçoso para evitar o erro do Cloudflare:
`Too many subrequests by single Worker invocation`.

## Estrutura

- `index.html` — app público
- `functions/api/drive.js` — API Cloudflare para ler uma pasta por vez
- `_headers` — headers básicos

## Variável obrigatória

Em Cloudflare Pages > Settings > Variables and Secrets > Production:

```txt
GOOGLE_API_KEY = sua chave do Google Cloud
```

Depois faça um novo deploy.

## Permissões

A pasta do Drive e subpastas precisam estar como:

```txt
Qualquer pessoa com o link pode visualizar
```

## Organização esperada do Drive

```txt
Pasta raiz
├── Tema 1
│   ├── 50x50
│   ├── Painel 150
│   ├── Cilindros
│   └── Kit + Romano
├── Tema 2
│   ├── 50x50
│   └── Kit + Romano
```

O site agora carrega primeiro os temas, depois os produtos do tema, e só então as imagens daquele produto. Isso evita estourar o limite de subrequests do Cloudflare.

## Testes úteis

```txt
/api/drive?mode=themes
/api/drive?mode=children&folderId=ID_DA_PASTA_DO_TEMA
/api/drive?mode=items&folderId=ID_DA_PASTA_DO_PRODUTO&theme=Safari&product=50x50
```
