# Contrato de pedido atual e proposta V2

## Finalidade

Descrever o caminho atual do pedido e fixar o contrato que a V2 deverá preservar antes de alterar `/api/orders`.

Nenhum pedido real foi lido, criado ou modificado para produzir este documento.

## Fluxo atual

```text
Carrinho no navegador
  -> confirm-modal.js cria o botão de confirmação
  -> customer-checkout.js coleta identificação do cliente
  -> customer-checkout.js cria snapshot reduzido
  -> POST /api/orders
  -> backend normaliza parcialmente
  -> grava no Supabase, no KV ou nos dois
  -> abre WhatsApp
  -> aplicativo de produção busca o pedido pelo número
```

## Snapshot atual do navegador

Cada item enviado pelo checkout preserva:

```text
code
theme
product
productName
qty
image
```

Dados que podem existir no carrinho, mas não são preservados nesse snapshot:

```text
item.id
driveFileId
productFolderId
originalName
subtheme
variantKey
sizeKey
details
medidas personalizadas
estado de personalização
```

## Normalização atual no backend

O endpoint público aceita:

```text
seller
customer
totals
items
qty
checkoutSnapshotVersion
userAgent
```

Os itens são reduzidos novamente a:

```text
code
theme
product
productName
qty
image
```

A chave de agrupamento atual é:

```text
code + theme + product + productName
```

Quando itens repetidos possuem a mesma chave, o backend mantém a maior quantidade, não a soma.

## Dados confiados ao navegador

O backend atual recebe sem recomputar integralmente:

```text
seller
customer
totals
product
productName
code
qty
```

Ele limita quantidade e tamanho de texto, mas não confirma:

- existência da arte;
- relação entre arte e produto;
- relação entre arte e tema;
- preço vigente;
- quantidade mínima;
- incremento permitido;
- desconto vigente;
- variante;
- tamanho;
- medidas.

## Persistência atual

### KV

```text
ORDER:<orderNumber>
```

O pedido integral é salvo como JSON.

### Supabase

Tabelas usadas:

```text
orders
order_items
customers
```

O pedido também é duplicado no campo `orders.raw`.

### Gravação dupla

Supabase e KV são atualizados separadamente. O endpoint aceita sucesso parcial quando pelo menos um destino é gravado.

Consequências:

- um pedido pode existir em apenas um armazenamento;
- o painel precisa mesclar fontes;
- atualizações podem divergir;
- não há transação distribuída.

## Numeração atual

Prioridade:

1. RPC Supabase `next_order_number`;
2. fallback KV `ORDER_COUNTER:<ano>`.

O fallback KV executa leitura e escrita separadas. Não há incremento atômico garantido.

## Aplicativo de produção atual

O payload de produção agrupa por código numérico.

Isso pode unir:

```text
Bolinhas #195
Sacolinha #195
Painel #195
```

Depois, o nome do arquivo é localizado no índice usando o código e uma pontuação heurística de tema e produto.

A V2 não poderá usar código visual como identidade interna.

# Contrato de pedido V2

## Estrutura principal

```json
{
  "schemaVersion": 2,
  "orderNumber": "PED2600001A",
  "createdAt": "2026-07-26T18:00:00.000Z",
  "updatedAt": "2026-07-26T18:00:00.000Z",
  "status": "Novo",
  "seller": {},
  "customer": {},
  "items": [],
  "pricing": {},
  "integrity": {},
  "source": "catalog-v2"
}
```

## Item V2

```json
{
  "itemId": "drive-file-id:50x50:default:50x50",
  "driveFileId": "drive-file-id",
  "code": "2657",
  "originalName": "2657_TEMA_50X50.jpg",
  "theme": "1 ANO",
  "subtheme": "",
  "productKey": "50x50",
  "productName": "Bolinhas 50x50",
  "variantKey": "default",
  "sizeKey": "50x50",
  "quantity": 6,
  "unitPrice": 9.75,
  "lineSubtotal": 58.50,
  "details": {}
}
```

## Identidade

A identidade interna mínima será:

```text
driveFileId:productKey:variantKey:sizeKey
```

O código visual continuará aparecendo ao cliente, mas não será chave primária.

## Regras obrigatórias do servidor

Para cada item, o servidor deverá:

1. localizar `driveFileId` no catálogo;
2. confirmar que a arte não está excluída ou bloqueada;
3. confirmar `code` usando o registro do catálogo;
4. confirmar `productKey` permitido para aquela arte;
5. confirmar variante e tamanho;
6. carregar preço do registro de produtos;
7. validar quantidade mínima e incremento;
8. descartar preço e subtotal enviados pelo navegador;
9. recalcular linha, subtotal, desconto e total;
10. preservar detalhes autorizados.

## Pricing V2

```json
{
  "currency": "BRL",
  "subtotal": 58.50,
  "discountPercent": 0,
  "discountAmount": 0,
  "total": 58.50,
  "calculationVersion": 1
}
```

Valores monetários serão arredondados em centavos pelo servidor.

## Integrity V2

```json
{
  "catalogVersion": 49,
  "configVersion": 3,
  "productRegistryVersion": 1,
  "requestItemCount": 1,
  "canonicalItemCount": 1
}
```

Esse bloco permitirá saber com quais regras o pedido foi calculado.

## Medidas e variantes

O campo `details` poderá conter apenas estruturas conhecidas pelo produto.

Exemplos:

```json
{
  "diameterCm": 150
}
```

```json
{
  "widthCm": 100,
  "heightCm": 200
}
```

```json
{
  "size": "P",
  "dimensionsCm": {
    "width": 15,
    "height": 20
  }
}
```

Chaves desconhecidas serão rejeitadas ou removidas conforme o contrato do produto.

## Compatibilidade

Durante a migração:

- pedidos antigos continuam legíveis;
- pedidos V2 são gravados com `schemaVersion: 2`;
- o painel administrativo identifica as duas versões;
- o aplicativo de produção recebe adaptadores separados;
- pedidos antigos não serão regravados automaticamente;
- nenhuma migration destrutiva ocorrerá antes de backup e validação.

## Critérios antes de ativar o endpoint V2

- staging isolado;
- Supabase correto confirmado;
- tabelas V2 ou colunas de compatibilidade definidas;
- cálculo de preços testado;
- mínimo e incremento testados;
- códigos repetidos testados;
- variantes testadas;
- medidas testadas;
- idempotência de criação definida;
- rate limit e proteção contra spam;
- rollback do endpoint;
- aplicativo de produção compatível.
