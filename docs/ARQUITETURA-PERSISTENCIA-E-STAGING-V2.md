# Arquitetura de persistência e staging V2

## Decisão

A primeira infraestrutura ativa da V2 será um Worker independente chamado:

```text
new-hub-artres-v2-staging
```

Ele não substitui o Pages atual, não possui rota no domínio público e não importa nenhuma Pages Function da Atual Versão de Segurança.

A escrita autoritativa de pedidos será realizada por um Durable Object SQLite chamado `OrderLedger`.

## Motivo da escolha

O fluxo atual pode gravar o pedido no Supabase, no KV ou nos dois. Essas gravações não formam uma transação única. Uma falha intermediária pode deixar fontes divergentes.

A V2 precisa tratar como uma única operação:

1. verificar a chave de idempotência;
2. impedir reutilização da chave com conteúdo diferente;
3. gerar a sequência do pedido;
4. definir o número visível;
5. salvar o pedido integral;
6. salvar a conclusão da idempotência;
7. registrar o evento da outbox.

No `OrderLedger`, essas etapas são executadas dentro de `ctx.storage.transactionSync()` usando SQL síncrono.

Se qualquer etapa falhar, nenhuma delas é confirmada.

## Unidade de coordenação

Será utilizado um Durable Object por ano:

```text
orders:26
orders:27
orders:28
```

A data de submissão faz parte do comando e precisa permanecer idêntica nos reenvios da mesma tentativa.

Essa divisão preserva:

- sequência anual;
- idempotência do pedido;
- isolamento por período;
- ausência de um único objeto global para todos os anos.

O volume do negócio atual é compatível com uma unidade de coordenação anual. Caso o volume futuro exija particionamento adicional, a regra de numeração precisará ser redesenhada antes do sharding.

## Fonte de verdade

### Staging V2

```text
OrderLedger Durable Object SQLite
```

Ele será a fonte autoritativa para:

- número do pedido;
- payload canônico;
- idempotência;
- estado inicial;
- eventos pendentes de projeção.

### Supabase

O Supabase será inicialmente uma projeção para:

- painel administrativo;
- consultas e relatórios;
- clientes;
- itens normalizados;
- busca operacional.

Falha no Supabase não desfaz o pedido confirmado no ledger.

### KV legado

O KV atual poderá receber uma projeção de compatibilidade durante a migração.

Ele não será utilizado para coordenar a idempotência V2 nem para gerar o número V2.

## Outbox

A tabela `outbox` é gravada na mesma transação do pedido.

Exemplo:

```text
order.created.v2
```

Depois da confirmação:

1. um dispatcher lê eventos pendentes;
2. envia para a projeção configurada;
3. marca como entregue apenas depois de sucesso;
4. mantém pendente em caso de falha;
5. permite reexecução idempotente.

Isso impede a perda do pedido quando Supabase ou outra integração estiver indisponível.

## Tabelas do Durable Object

### `meta`

Armazena:

```text
schema_version
year_code
```

### `counters`

Armazena a próxima sequência anual.

### `orders`

Armazena o pedido V2 integral como JSON, junto com campos mínimos de consulta.

### `idempotency`

Relaciona:

```text
idempotency_key
fingerprint
order_number
response_json
```

### `outbox`

Armazena eventos a serem projetados.

## Regras do Worker de staging

O arquivo de configuração é:

```text
wrangler.site-v2-staging.jsonc
```

Características:

- nome contendo `staging`;
- sem rotas de domínio;
- `workers_dev` habilitado;
- `STAGING_WRITE_ENABLED` igual a `false` por padrão;
- token `STAGING_API_TOKEN` somente como secret;
- Durable Object SQLite com migration explícita;
- observabilidade habilitada;
- data de compatibilidade fixada;
- `nodejs_compat` habilitado;
- nenhum ID de KV, D1, R2 ou Supabase de produção.

## Rotas preparadas

### Pública de diagnóstico

```text
GET /health
```

Não retorna segredos nem dados de cliente.

### Internas de staging

```text
POST /internal/v2/ledger/submit
GET  /internal/v2/ledger/order
GET  /internal/v2/ledger/outbox
```

Todas exigem `X-Staging-Token`.

A escrita também exige:

```text
STAGING_WRITE_ENABLED=true
```

Não existe rota pública `/api/orders/v2` neste estágio.

## Estado do Supabase

O único projeto Supabase acessível nesta sessão possui tabelas de outro sistema, relacionadas a conteúdo jurídico e equipe.

Não possui os contratos esperados:

```text
catalog_index
orders
order_items
customers
staff_users
next_order_number
```

Conclusão:

```text
SUPABASE_CORRETO_NAO_IDENTIFICADO
```

Nenhuma migration, tabela, policy, função ou dado foi alterado.

Não será criada uma estrutura V2 nesse projeto por conveniência, pois isso misturaria sistemas independentes.

## Segurança do Supabase futuro

Quando o projeto correto estiver disponível:

- tabelas expostas deverão usar RLS;
- grants e policies serão tratados separadamente;
- service role permanecerá somente no servidor;
- o browser não acessará pedidos diretamente;
- funções privilegiadas não ficarão públicas;
- migrations serão criadas pelo fluxo oficial da CLI;
- advisors de segurança e desempenho serão executados depois das alterações;
- a projeção aceitará replay de eventos sem duplicação.

## Validação automatizada

O workflow `Site V2 Baseline` executa:

1. todos os testes Node da V2;
2. verificação de sintaxe dos arquivos do Worker;
3. `wrangler deploy --dry-run` com versão fixada;
4. geração de bundle sem publicação.

O dry-run não utiliza credenciais do Cloudflare e não cria Worker, Durable Object, namespace ou rota.

## O que ainda não foi criado remotamente

- Worker no Cloudflare;
- namespace do Durable Object;
- secret `STAGING_API_TOKEN`;
- URL `workers.dev` de staging;
- Supabase correto;
- tabelas de projeção;
- dispatcher agendado;
- integração com o frontend V2.

Esses recursos só serão criados depois que o acesso ao Cloudflare estiver disponível e o dry-run estiver verde.

## Procedimento de ativação futura

1. confirmar a conta Cloudflare correta;
2. configurar `STAGING_API_TOKEN` como secret;
3. publicar usando explicitamente o arquivo de staging;
4. validar `/health`;
5. manter escrita desabilitada;
6. testar o ledger com comando sintético;
7. habilitar escrita somente no staging;
8. confirmar replay e conflito de idempotência;
9. testar a outbox;
10. conectar a projeção Supabase correta;
11. testar falha e recuperação da projeção;
12. somente então preparar a rota pública V2.

## Rollback do staging

Como o Worker é separado, o rollback não exige alteração na Atual Versão de Segurança.

Em falha:

1. desabilitar escrita;
2. reverter ou remover o Worker de staging;
3. preservar o ledger para diagnóstico;
4. corrigir a branch;
5. repetir o dry-run;
6. publicar nova versão no staging.

A `main`, o Pages público, `CONFIG_KV`, o Supabase atual e o aplicativo de produção permanecem fora desse processo.

## Referências técnicas consultadas

- Cloudflare Workers Best Practices, atualizado em junho de 2026;
- Cloudflare Durable Objects Best Practices, atualizado em abril de 2026;
- SQLite-backed Durable Object Storage, atualizado em maio de 2026;
- Supabase Row Level Security e Securing your API, consultados em julho de 2026.
