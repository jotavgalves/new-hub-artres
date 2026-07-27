# Catálogo real V2 em modo somente leitura

## Objetivo

Preparar a leitura do índice real de artes sem alterar o catálogo atual, sem cadastrar produtos e sem reutilizar credenciais genéricas do banco de pedidos.

## Estado desta etapa

A implementação adiciona apenas uma fonte HTTP passiva para a tabela:

```text
public.catalog_index
```

Ela não é conectada ao Worker de staging, ao frontend ou à produção nesta etapa.

Nenhuma raiz real do Google Drive foi registrada no repositório.

## Credenciais permitidas

A fonte aceita exclusivamente:

```text
ARTS_SUPABASE_URL
ARTS_SUPABASE_SERVICE_KEY
```

Os aliases genéricos abaixo não são aceitos pelo adaptador V2:

```text
SUPABASE_REST_URL
SUPABASE_SERVICE_ROLE_KEY
```

Isso impede que o catálogo seja ligado acidentalmente ao projeto de pedidos.

## Consulta

A fonte realiza apenas `GET` em:

```text
/rest/v1/catalog_index
```

Cada consulta é obrigatoriamente filtrada por:

```text
root_drive_id=eq.<raiz-confirmada>
deleted_at=is.null
```

As linhas são ordenadas por profundidade, nome e ID do Drive.

A paginação possui limites explícitos e a resposta HTTP é limitada em bytes antes da conversão para JSON.

## Colunas lidas

```text
drive_id
parent_drive_id
root_drive_id
type
name
mime_type
path
path_parts
depth
theme
subtheme
product
size
code
extension
drive_url
thumbnail_url
search_text
indexed_at
deleted_at
```

## Conversão para o contrato V2

As linhas são processadas pelo contrato já existente em:

```text
src/v2/catalog/schema.mjs
```

O contrato:

- exige uma raiz previamente configurada;
- associa a raiz a um produto registrado;
- rejeita linhas fora da raiz solicitada;
- rejeita produtos incompatíveis com a raiz;
- separa pastas e artes;
- usa `drive_id` como `driveFileId` inequívoco;
- ignora registros marcados como excluídos;
- não cria fallback silencioso para produto desconhecido.

## Proteções

A fonte:

- aceita somente URL HTTPS;
- não inclui a chave na URL;
- envia a chave somente nos headers privilegiados;
- nunca devolve URL ou chave no status público;
- usa timeout com `AbortController`;
- limita o tamanho de cada resposta;
- sanitiza falhas HTTP e JSON;
- não implementa `POST`, `PUT`, `PATCH` ou `DELETE`;
- não registra corpo remoto ou credencial em erros.

## Estado de ativação

O status é controlado por:

```text
CATALOG_V2_READ_ENABLED
```

Nenhuma configuração do Worker foi alterada neste PR. Portanto, mesmo que este código seja incorporado, ele não consulta o catálogo até uma integração posterior e explícita.

## Dados ainda necessários

Antes de conectar o staging, é obrigatório confirmar fora do código:

1. projeto Supabase que contém `catalog_index`;
2. URL específica desse projeto;
3. credencial de leitura ou serviço adequada;
4. IDs das raízes reais do Drive;
5. produto associado a cada raiz;
6. versão inicial do catálogo;
7. volume aproximado de linhas por raiz;
8. política de atualização e exclusão do índice.

Os valores secretos e IDs reais não devem ser inseridos em documentação pública ou mensagens de PR.

## Próxima validação

Quando as raízes forem confirmadas, um PR separado deverá:

1. cadastrar as referências em configuração protegida de staging;
2. ativar leitura somente no staging;
3. comparar a resposta atual e a resposta V2 em modo sombra;
4. registrar apenas contagens e diferenças, sem expor credenciais;
5. manter o catálogo atual como fonte principal;
6. possuir rollback que desative `CATALOG_V2_READ_ENABLED`.
