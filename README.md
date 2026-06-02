# Hub de Artes Armazém - Cloudflare Pages

Projeto sem painel admin.

## Arquivos

- `index.html`: tela pública do Hub de Artes.
- `functions/api/drive.js`: Function Cloudflare que lê as artes da pasta do Google Drive.

## Drive usado

https://drive.google.com/drive/folders/11cU5yMWafopC0JfMHotRxThpkgbQl-RW

## Como publicar no Cloudflare Pages

1. Suba estes arquivos em um repositório GitHub.
2. Conecte o repositório no Cloudflare Pages.
3. Build command: deixe vazio.
4. Build output directory: `/` ou deixe padrão.
5. Em Settings > Environment variables, crie:

```txt
GOOGLE_API_KEY = sua_chave_do_google_cloud
```

6. A pasta do Drive e os arquivos de imagem precisam estar públicos ou acessíveis pela chave/API.

## Estrutura esperada no Drive

O app foi feito para funcionar bem com:

```txt
Tema/
  Produto/
    ARTE-195.png
    ARTE-196.jpg
```

Ele também tenta corrigir nomes equivalentes:

- `Painel 50`, `50`, `50x50`, `bolinha` => 50x50
- `Painel 150`, `150`, `150x150` => Painel 150x150
- `Cilindros`, `Trio de cilindros` => Cilindros
- `Kit completo`, `Kit com romano`, `Kit + Romano` => Kit + Romano
- `Kit painel e cilindros`, `Kit painel + cilindros` => Kit Painel + Cilindros

## Preços configurados

- 50x50: 6 unidades = R$ 58,90. Extras: R$ 9,90 cada, sempre em pares depois de 6.
- Painel 150x150: R$ 59,90.
- Kit + Romano: R$ 210,00.
- Cilindros: R$ 99,00.
- Romano: R$ 78,00.
- Kit Painel + Cilindros: R$ 158,90.
