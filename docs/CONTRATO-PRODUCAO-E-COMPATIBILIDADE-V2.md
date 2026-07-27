# Contrato de produção e compatibilidade V2

## Finalidade

Definir como o aplicativo de produção deverá receber pedidos novos e antigos sem agrupar artes diferentes apenas pelo código visual.

Nenhum endpoint atual é alterado por este documento.

## Contrato atual do aplicativo

O endpoint atual retorna, essencialmente:

```json
{
  "ok": true,
  "orderNumber": "PED2600001A",
  "customerName": "Cliente",
  "createdAt": "2026-07-26T18:00:00.000Z",
  "createdAtFormatted": "26/07/2026 15:00:00",
  "sellerName": "Ana",
  "items": [
    {
      "id": "2657",
      "name": "2657_1-ANO_50X50.jpg",
      "quantity": 6
    }
  ]
}
```

O campo `items[].id` é apenas o código visual.

## Problemas confirmados

### Agrupamento por código

A normalização atual usa somente o código como chave.

Assim, estes itens podem ser unidos:

```text
Bolinhas #2657
Sacolinha #2657
Painel #2657
```

### Localização heurística do arquivo

Quando o pedido não possui o nome original, a API consulta todas as linhas do índice com aquele código e escolhe uma por pontuação de tema e produto.

A escolha pode ser ambígua.

### Perda de informações

O payload atual não preserva de forma estruturada:

```text
driveFileId
rootDriveId
productKey
variantKey
sizeKey
details
medidas
subtheme
lineSubtotal
schemaVersion
```

### Atualização de status com efeito colateral

Uma simples consulta pode alterar o status quando `statusOnFetch` estiver configurado.

A V2 deverá separar leitura de pedido e transição de status.

# Contrato de produção V2

## Envelope

```json
{
  "ok": true,
  "schemaVersion": 2,
  "payloadVersion": 2,
  "compatibilityMode": "native-v2",
  "order": {},
  "items": [],
  "warnings": []
}
```

## Pedido

```json
{
  "orderNumber": "PED2600001A",
  "status": "Novo",
  "createdAt": "2026-07-26T18:00:00.000Z",
  "createdAtFormatted": "26/07/2026 15:00:00",
  "seller": {
    "id": "ana",
    "name": "Ana"
  },
  "customer": {
    "name": "Cliente"
  },
  "pricing": {
    "currency": "BRL",
    "total": 58.50
  }
}
```

A exposição do cliente e dos totais continuará respeitando a configuração da API de produção.

## Item nativo V2

```json
{
  "itemId": "drive-file-2657:50x50:default:50x50",
  "identityStatus": "verified",
  "driveFileId": "drive-file-2657",
  "code": "2657",
  "fileName": "2657_1-ANO_50X50.jpg",
  "theme": "1 ANO",
  "subtheme": "",
  "productKey": "50x50",
  "productName": "Bolinhas 50x50",
  "variantKey": "default",
  "sizeKey": "50x50",
  "quantity": 6,
  "details": {}
}
```

## Item antigo adaptado

Pedidos antigos podem não possuir `driveFileId`.

Eles serão entregues assim:

```json
{
  "itemId": "legacy-7b88c8e5",
  "identityStatus": "unresolved-legacy",
  "driveFileId": "",
  "code": "2657",
  "fileName": "",
  "theme": "1 ANO",
  "productKey": "50x50",
  "productName": "Bolinhas 50x50",
  "variantKey": "default",
  "sizeKey": "50x50",
  "quantity": 6,
  "details": {},
  "warnings": [
    "DRIVE_FILE_ID_MISSING"
  ]
}
```

O adaptador não fingirá que um código é um Drive ID.

## Chave de agrupamento

A produção V2 nunca agrupará apenas por código.

A chave será:

```text
itemId
```

Para pedidos antigos sem identidade, será utilizado um identificador determinístico baseado em:

```text
code
theme
productKey
productName
variantKey
sizeKey
fileName
```

Esse identificador serve somente para estabilidade de compatibilidade. Ele não comprova a identidade do arquivo.

## Compatibilidade

Modos previstos:

```text
native-v2
adapted-legacy
mixed
```

### `native-v2`

Todos os itens possuem identidade completa e verificável.

### `adapted-legacy`

O pedido inteiro usa o contrato antigo e foi normalizado sem alterar o registro armazenado.

### `mixed`

O pedido possui itens novos e antigos.

## Resolução de nomes antigos

A localização heurística poderá permanecer temporariamente somente como enriquecimento opcional.

Regras:

1. nunca substituir uma identidade V2 verificada;
2. nunca unir dois itens porque possuem o mesmo código;
3. registrar `FILE_NAME_HEURISTIC` quando a heurística for utilizada;
4. retornar múltiplos candidatos como ambiguidade, não escolher silenciosamente;
5. permitir que o operador selecione o arquivo correto no staging.

## Status

A V2 separará:

```text
GET pedido
POST transição de status
```

Uma consulta não deverá alterar o pedido por padrão.

Cada transição terá:

```json
{
  "eventId": "uuid",
  "at": "2026-07-26T18:00:00.000Z",
  "actor": "Armazem",
  "from": "Novo",
  "to": "Em produção",
  "message": ""
}
```

## Segurança

O contrato V2 deverá:

- comparar tokens em tempo constante;
- restringir origens autorizadas;
- não aceitar token por query string;
- aplicar rate limit;
- registrar tentativas inválidas sem incluir o token;
- utilizar token exclusivo por ambiente;
- permitir rotação de credencial;
- diferenciar leitura e alteração de status.

## Critérios para ativação

- aplicativo de produção atualizado para ler payloadVersion 2;
- fallback para payload antigo testado;
- pedidos antigos reais testados em cópia sanitizada;
- códigos repetidos testados;
- variantes e medidas testadas;
- consulta sem alteração de status testada;
- status idempotente testado;
- staging com token exclusivo;
- rollback documentado.
