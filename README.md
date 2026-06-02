# Hub de Artes Armazém — Cloudflare Pages

Versão atualizada para ler as artes pelo Google Drive, usando o fluxo:

1. Escolher tema
2. Escolher produto
3. Selecionar artes
4. Enviar para Ana ou Dayane pelo WhatsApp

## Estrutura esperada no Drive

A pasta principal deve conter pastas de temas. Dentro de cada tema, crie as pastas de produto.

Exemplo:

```txt
Pasta principal
├── Safari
│   ├── 50x50
│   ├── Painel 150x150
│   ├── Cilindros
│   └── Kit + Romano
├── Princesa
│   ├── 50x50
│   └── Kit + Romano
```

O site usa a pasta do produto para classificar a arte. O nome do arquivo da imagem não é usado para definir produto.

## Variável necessária no Cloudflare

Em Cloudflare Pages > Settings > Variables and Secrets > Production:

```txt
GOOGLE_API_KEY = sua chave da Google Drive API
```

Depois de salvar a variável, faça um novo deploy.

## Testes da API

```txt
/api/drive?mode=themes
/api/drive?mode=products&folderId=ID_DA_PASTA_DO_TEMA
/api/drive?mode=items&folderId=ID_DA_PASTA_DO_PRODUTO&theme=Safari&product=50x50
```

## Regras comerciais

- 50x50: mínimo 6 artes por R$ 58,90; extras por R$ 9,90 cada; depois de 6 precisa fechar em par.
- Painel 150x150: R$ 59,90 cada.
- Kit + Romano / Kit completo / Kit com romano: R$ 210,00.
- Cilindros / Trio de cilindros: R$ 99,00.
- Romano: R$ 78,00.
- Kit Painel + Cilindros: R$ 158,90.
- Desconto de 10% aplicado em toda compra feita pelo hub.
