# Contratos públicos efetivos da Atual Versão de Segurança

## Finalidade

Registrar, de forma sanitizada, os contratos efetivamente expostos pela produção pública em 26 de julho de 2026.

Este documento diferencia três fontes que atualmente não são idênticas:

1. código estático preservado no GitHub;
2. configuração efetiva carregada do KV;
3. HTML e scripts realmente entregues pelo deployment público.

Nenhum segredo, telefone, token ou identificador completo de pasta foi registrado.

## Evidência automatizada

O workflow `Atual Versão de Segurança Baseline` consultou, somente por leitura:

```text
GET /api/config
GET /api/catalog-meta
GET /api/catalog-rules
```

A execução foi concluída com sucesso:

```text
Run: 30213304107
Artifact: atual-versao-de-seguranca-baseline
Artifact id: 8635086721
```

Os testes também verificaram que o JSON público não possuía chaves com nomes sensíveis como `password`, `token`, `secret`, `apiKey`, `serviceRoleKey` e `privateKey`.

## `/api/config`

### Estado geral

```text
ok: true
source: kv
storageReady: true
version: 3
```

Isso confirma que a produção não está utilizando apenas `DEFAULT_CONFIG`. Há uma configuração persistida em `CONFIG_KV`.

### Vendedoras

Foram observados dois perfis ativos:

```text
Ana
Dayane
```

Os dois possuem telefone configurado, mas os números não foram persistidos nos artifacts sanitizados.

### Produtos

A configuração efetiva contém somente um produto normalizado:

```text
Chave interna: bolinhas
productKey: 50x50
Nome: Bolinhas
Preço unitário: R$ 9,75
Quantidade mínima: 6
Incremento: 2
disableCustomization: true
skipProductsStep: true
```

### Catálogo de produtos

O `productCatalog` efetivo também contém somente:

```text
Bolinhas
productKey: 50x50
active: true
editable: true
```

Portanto, a produção atual não comprova suporte de backend genérico aos diversos produtos declarados no `PRODUCT_CONFIG` estático do frontend.

### Drive

Foi observado um Drive ativo:

```text
id: bolinhas
name: Drive Bolinhas
type: bolinhas
productKey: 50x50
structure: theme-or-subtheme-images
filenamePattern: ID_TEMA_PRODUTO_DIMENSAO
```

O identificador da pasta existe e possui 33 caracteres. Seu valor não foi registrado neste documento.

### Interface e campanha

```text
ui.discountPercent: 0
ui.confirmModal: true
ui.cacheVersion: 49
campaign.active: false
campaign.discountPercent: 10
campaign.applyTo: all
maintenance.active: false
```

Consequências confirmadas:

- a campanha de 10% está desativada;
- o desconto efetivo atual é 0%;
- o cache público está na versão 49;
- o modal de confirmação está habilitado;
- o site não está em manutenção.

### Pedidos

```text
saveOrders: true
defaultStatus: Novo
statuses:
  - Novo
  - Em atendimento
  - Fechado
  - Cancelado
keepLast: 300
```

### API de produção

```text
enabled: true
allowStatusUpdate: true
statusOnComplete: Separado
actorName: Armazem
exposeCustomer: true
exposeTotals: false
```

### Conteúdo efetivo

O KV contém:

```text
Hero: Vamos montar a sua festa?
```

O conteúdo promocional retornado pelo KV ainda utiliza textos parametrizados de desconto. Contudo, a interface pública renderiza um estado alternativo chamado `Pedido organizado`, coerente com desconto zero e campanha inativa.

A camada responsável por essa transformação ainda precisa ser identificada formalmente.

## `/api/catalog-meta`

O contrato público observado contém as chaves:

```text
catalogVersion
confirmModal
discountPercent
maintenance
ok
updatedAt
```

Valores relevantes:

```text
catalogVersion: 49
discountPercent: 0
confirmModal: true
```

O campo `updatedAt` é gerado na resposta e não deve ser utilizado como versão estável do catálogo.

## `/api/catalog-rules`

O contrato público observado contém:

```text
artBlocks
catalogVersion
hiddenArtCodes
hiddenProducts
hiddenThemeKeys
hiddenThemes
ok
rulesHash
themeBlocks
```

Estado observado:

```text
themeBlocks: 0
artBlocks: 3
catalogVersion: 49
```

Os códigos bloqueados não foram registrados no artifact sanitizado. Somente a quantidade foi preservada.

## Divergência entre o GitHub e o deployment público

O deployment público carrega:

```text
/assets/confirm-modal.js?v=2
/assets/order-capture.js?v=1
```

Essas tags não aparecem no `index.html` da `main` nem são injetadas pela versão de `functions/[[path]].js` preservada no commit de segurança.

Também há divergência de conteúdo e preço entre o HTML estático e a configuração efetiva.

Isso indica que pelo menos uma destas situações existe:

1. o deployment público não corresponde exatamente ao commit atual da `main`;
2. há uma camada de transformação externa não registrada no repositório;
3. o deployment preserva ativos de uma versão anterior;
4. existe configuração de build ou publicação ainda não inventariada.

Não será escolhida uma causa sem confirmação no painel do Cloudflare ou nos metadados do deployment.

## Supabase conectado nesta sessão

O único projeto Supabase acessível nesta sessão possui tabelas relacionadas a outro sistema, como perfis, artigos, áreas de atuação e equipe.

Não foram encontradas nele as tabelas esperadas pelo código deste repositório:

```text
catalog_index
orders
```

Conclusão operacional:

```text
PROJETO_SUPABASE_NAO_CONFIRMADO
```

Nenhuma consulta de linhas, alteração de esquema, migration ou escrita foi realizada nesse projeto.

A V2 somente poderá acessar Supabase depois que o projeto correspondente às bindings reais do Cloudflare for identificado de forma inequívoca.

## Autoridade provisória durante a compatibilidade

Enquanto a arquitetura não estiver centralizada, a ordem provisória será:

1. configuração efetiva do KV para regras comerciais em vigor;
2. índice real utilizado pela API para existência e localização de artes;
3. pedidos reais para validar compatibilidade histórica;
4. código estático apenas como implementação legada, não como fonte comercial autoritativa;
5. README apenas como documentação histórica até ser atualizado.

## Regras que já podem ser fixadas na V2

```text
Produto atual: 50x50
Preço unitário efetivo: R$ 9,75
Quantidade mínima: 6
Incremento: 2
Desconto efetivo: 0%
Campanha de 10%: desativada
Cache público: versão 49
Produto desconhecido: deve falhar, nunca virar painel ou bolinha
```

## Pendências antes de integrar a V2

1. confirmar o deployment e o commit efetivamente publicados;
2. confirmar branch de produção no Cloudflare;
3. confirmar todas as bindings por ambiente;
4. identificar o Supabase correto;
5. identificar o KV de configuração e o KV de pedidos;
6. confirmar de onde vêm `confirm-modal.js` e `order-capture.js` no HTML público;
7. capturar contratos de pedidos sem acessar dados de clientes;
8. confirmar se o catálogo usa um ou mais `root_drive_id`;
9. confirmar como o administrativo atual salva a configuração;
10. criar staging antes de qualquer endpoint V2 ativo.
