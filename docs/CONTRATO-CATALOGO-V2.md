# Contrato do catálogo V2

## Finalidade

Definir como linhas do índice de artes serão convertidas em temas, pastas, produtos e itens sem depender das heurísticas da Atual Versão de Segurança.

Este contrato ainda não está conectado a nenhuma Pages Function.

## Problemas do contrato atual

### Produto forçado

A API pública usa a configuração de bolinhas como produto dominante em vários fluxos.

### Fallback silencioso

A função legada de produto retorna `painel-150` quando não reconhece o nome.

Consequência:

```text
produto desconhecido -> painel-150
```

Isso pode gerar preço, medida, carrinho e produção incorretos sem erro aparente.

### Identidade baseada em código

O código visual é utilizado em pesquisas e no payload de produção como se identificasse uma arte de forma inequívoca.

### Mistura entre raízes

Consultas de pastas e produtos podem não aplicar `root_drive_id` em todas as etapas.

Quando houver mais de um Drive, temas e produtos diferentes podem aparecer misturados.

### Heurística de nome

O produto é inferido por palavras como:

```text
50
bolinha
sacolinha
cilindro
romano
painel
redondo
lateral
retangular
```

A V2 não utilizará essa heurística para autorizar regras comerciais.

## Princípios da V2

1. todo Drive ativo possui uma raiz registrada;
2. toda raiz aponta para um produto conhecido;
3. toda consulta informa ou resolve uma raiz;
4. toda linha deve pertencer à raiz consultada;
5. produto desconhecido gera erro explícito;
6. `drive_id` identifica a pasta ou arte;
7. código é metadado visual, não identidade;
8. linha excluída não entra no catálogo;
9. bloqueios são aplicados antes da resposta pública;
10. resposta inclui versão do catálogo.

## Registro de raízes

Exemplo conceitual:

```json
{
  "root-drive-bolinhas": {
    "driveId": "bolinhas",
    "productKey": "50x50",
    "structure": "theme-or-subtheme-images",
    "active": true
  }
}
```

O valor real de `root_drive_id` não será codificado em múltiplos arquivos. Ele virá do registro de produtos e Drives.

## Linha de índice esperada

```json
{
  "drive_id": "arquivo-ou-pasta",
  "parent_drive_id": "pasta-pai",
  "root_drive_id": "raiz-do-drive",
  "type": "artwork",
  "name": "2657_1-ANO_50X50.jpg",
  "mime_type": "image/jpeg",
  "path": "1 ANO/2657_1-ANO_50X50.jpg",
  "path_parts": ["1 ANO", "2657_1-ANO_50X50.jpg"],
  "depth": 1,
  "theme": "1 ANO",
  "subtheme": "",
  "product": "Bolinhas",
  "size": "50x50",
  "code": "2657",
  "extension": "jpg",
  "drive_url": "",
  "thumbnail_url": "",
  "search_text": "",
  "indexed_at": "",
  "deleted_at": null
}
```

## Arte pública V2

```json
{
  "id": "arquivo-ou-pasta",
  "driveFileId": "arquivo-ou-pasta",
  "rootDriveId": "raiz-do-drive",
  "parentDriveId": "pasta-pai",
  "code": "2657",
  "originalName": "2657_1-ANO_50X50.jpg",
  "theme": "1 ANO",
  "subtheme": "",
  "productKey": "50x50",
  "productName": "Bolinhas 50x50",
  "sizeKey": "50x50",
  "mimeType": "image/jpeg",
  "image": "",
  "driveUrl": "",
  "path": "1 ANO/2657_1-ANO_50X50.jpg"
}
```

## Pasta pública V2

```json
{
  "id": "pasta",
  "parentId": "pasta-pai",
  "rootDriveId": "raiz-do-drive",
  "name": "1 ANO",
  "kind": "folder",
  "theme": "1 ANO",
  "subtheme": "",
  "productKey": "50x50",
  "productName": "Bolinhas 50x50",
  "depth": 1,
  "path": "1 ANO"
}
```

## Validações obrigatórias

Uma linha será rejeitada quando:

```text
DRIVE_ID_MISSING
ROOT_DRIVE_ID_MISSING
ROOT_DRIVE_NOT_CONFIGURED
ROW_OUTSIDE_REQUESTED_ROOT
PRODUCT_NOT_CONFIGURED
PRODUCT_ROOT_MISMATCH
ROW_DELETED
ROW_TYPE_INVALID
ARTWORK_CODE_MISSING
```

## Regra de produto

Prioridade:

1. produto configurado para a raiz;
2. produto explícito da linha somente para validação de consistência;
3. nunca usar fallback.

Se a raiz disser `50x50` e a linha declarar um produto reconhecido diferente, a V2 deverá registrar conflito e não publicar a arte automaticamente.

## Endpoints planejados

```text
GET /api/catalog/v2/meta
GET /api/catalog/v2/themes
GET /api/catalog/v2/folders
GET /api/catalog/v2/products
GET /api/catalog/v2/items
GET /api/catalog/v2/search
```

Eles não serão criados antes do staging isolado.

## Resposta versionada

```json
{
  "ok": true,
  "schemaVersion": 2,
  "catalogVersion": 49,
  "rootDriveId": "raiz-do-drive",
  "items": []
}
```

## Modo sombra

No staging:

1. a interface continua usando a API atual;
2. a V2 recebe a mesma navegação em paralelo;
3. sua resposta não controla a tela;
4. diferenças são registradas sem dados de cliente;
5. temas, pastas, códigos e imagens são comparados;
6. somente depois da equivalência a V2 assume a interface.

## Comparações mínimas

```text
quantidade de temas
nomes de temas
pastas por tema
produtos por pasta
artes por produto
códigos
Drive IDs
root_drive_id
imagens
bloqueios
ordenação
```

## Limites

A V2 deverá possuir paginação explícita e informar truncamento.

Não será permitido retornar silenciosamente apenas as primeiras 5.000 linhas ou depender de um limite fixo sem cursor.

## Segurança

A chave service role permanece somente no servidor.

A resposta pública não deverá expor:

```text
service key
configurações privadas
metadados internos desnecessários
caminhos de banco
linhas excluídas
regras administrativas completas
```

## Critérios antes de criar endpoints

- Supabase correto identificado;
- tabela `catalog_index` confirmada;
- roots ativos confirmados;
- staging isolado;
- contrato passivo testado;
- bloqueios testados;
- paginação definida;
- comparação sombra preparada;
- observabilidade configurada;
- nenhuma dependência de `painel-150` como fallback.
