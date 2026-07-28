# Catálogo V2: ponte somente leitura

## Objetivo

Ler o catálogo real já exposto pela Atual Versão de Segurança, convertê-lo para o contrato V2 e comparar os dois formatos sem acessar credenciais do Supabase do catálogo e sem executar qualquer escrita.

## Fonte utilizada

A ponte consulta exclusivamente endpoints públicos e somente por `GET`:

```text
GET /api/drive
GET /api/catalog-meta
```

A origem deve ser uma URL HTTPS limpa. Não são aceitos usuário, senha, query string, fragmento ou caminho arbitrário na URL-base.

## Estado comercial confirmado

```text
Produto: 50x50
Nome: Bolinhas 50x50
Preço efetivo observado: R$ 9,75
Quantidade mínima: 6
Incremento: 2
Desconto efetivo: 0%
Root Drive observado no código legado: 193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae
```

O preço e as regras comerciais não são recalculados pela ponte. O módulo trata somente da leitura e normalização do catálogo.

## Controles de segurança

- somente método `GET`;
- origem HTTPS fixa;
- destino limitado a `/api/drive` e `/api/catalog-meta`;
- parâmetros de consulta em lista permitida;
- parâmetros desconhecidos, tokens e URLs externas são descartados;
- timeout limitado;
- resposta limitada a 2 MiB por padrão e no máximo 8 MiB;
- conteúdo precisa ser JSON;
- nenhuma credencial é recebida ou encaminhada;
- nenhuma escrita em Supabase, Drive, KV, Durable Object ou produção;
- comparação não expõe valores sensíveis.

## Contrato produzido

O módulo `src/v2/catalog/legacy-readonly-bridge.mjs`:

1. consulta a API pública atual;
2. obtém a versão em `/api/catalog-meta`;
3. transforma pastas e artes em linhas compatíveis com `catalog_index`;
4. aplica `createCatalogContext` e `buildCatalogResponseV2`;
5. executa `compareCatalogShadow`;
6. retorna contagens, rejeições e diferenças.

A resposta possui:

```text
readOnly: true
source: legacy-public-api
v2: contrato normalizado
comparison: comparação sombra
```

## Limitações desta etapa

- o Supabase real do catálogo ainda não está acessível na conta conectada;
- a ponte depende temporariamente da API pública atual;
- o módulo ainda não está ligado a uma rota do Worker de staging;
- nenhuma flag foi ativada;
- nenhuma publicação foi realizada;
- o frontend continua usando exclusivamente a Atual Versão de Segurança.

## Próximo bloco controlado

Depois da aprovação deste módulo:

1. adicionar uma rota interna protegida no staging;
2. manter a rota desativada por flag;
3. publicar o staging somente após autorização explícita;
4. executar comparação real de temas, pastas e artes;
5. registrar divergências sem alterar o design público.
