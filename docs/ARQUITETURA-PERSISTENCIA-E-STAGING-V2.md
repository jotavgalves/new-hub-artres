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
- `STAGING_API_TOKEN` declarado como secret obrigatório;
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
POST /internal/v2/orders/submit
POST /internal/v2/ledger/submit
GET  /internal/v2/ledger/order
GET  /internal/v2/ledger/outbox
```

Todas exigem `X-Staging-Token`.

A rota comercial utiliza exclusivamente catálogo sintético e também exige `Idempotency-Key`.

A escrita exige:

```text
STAGING_WRITE_ENABLED=true
```

Não existe rota pública `/api/orders/v2` neste estágio.

## Catálogo sintético

O staging contém duas artes sem vínculo com Drive real:

```text
staging-artwork-2657
staging-artwork-2656
```

As imagens apontam para `example.invalid` e não podem buscar conteúdo real.

As regras sintéticas reproduzem somente o contrato comercial já confirmado:

```text
Preço unitário: R$ 9,75
Quantidade mínima: 6
Incremento: 2
Desconto: 0%
```

## Smoke test local real

O workflow inicia o Worker com Wrangler em modo local e um banco descartável.

O teste executa:

1. `/health`;
2. envio de preço adulterado de R$ 0,01;
3. recálculo do servidor para R$ 58,50;
4. criação de `PED2600001A`;
5. repetição da mesma chave;
6. retorno `REPLAY` sem nova sequência;
7. leitura do pedido diretamente no ledger;
8. confirmação de um único evento `order.created.v2` na outbox;
9. remoção de `.dev.vars` e do estado local.

O teste não utiliza Cloudflare remoto nem dados reais.

## Deploy protegido

O workflow manual:

```text
.github/workflows/deploy-site-v2-staging.yml
```

exige:

- frase exata `PUBLICAR STAGING`;
- environment `site-v2-staging`;
- três segredos separados;
- testes completos;
- dry-run com `--strict`;
- secret enviado junto com o deploy por `--secrets-file`;
- escrita desligada;
- nenhuma rota de domínio.

O arquivo temporário de secret é criado com `umask 077` em `/tmp` e removido em etapa executada mesmo quando ocorre falha.

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

## Projeção Supabase preparada

O adapter:

```text
src/v2/persistence/supabase-order-projection.mjs
```

foi implementado sem binding ativa.

Ele:

- exige HTTPS;
- exige chave secreta somente no servidor;
- usa uma RPC por evento;
- cria chave idempotente global;
- separa criação e alteração de status;
- remove o segredo de mensagens remotas de erro;
- não faz chamadas externas no health padrão;
- permanece desligado enquanto o projeto correto não existir.

## Segurança do Supabase futuro

Quando o projeto correto estiver disponível:

- tabelas expostas deverão usar RLS;
- grants e policies serão tratados separadamente;
- service role ou secret key permanecerá somente no servidor;
- o browser não acessará pedidos diretamente;
- funções privilegiadas terão execução revogada de `public`, `anon` e `authenticated`;
- migrations serão criadas pelo fluxo oficial da CLI;
- advisors de segurança e desempenho serão executados depois das alterações;
- a projeção aceitará replay de eventos sem duplicação.

## Validação automatizada

O workflow `Site V2 Baseline` executa:

1. todos os testes Node da V2;
2. verificação de sintaxe dos arquivos do Worker;
3. criação de secret sintético temporário;
4. `wrangler deploy --dry-run --strict` com versão fixada;
5. geração de bundle sem publicação;
6. remoção do secret temporário;
7. Worker local com Durable Object SQLite;
8. smoke test de criação, replay, consulta e outbox.

O dry-run e o smoke test não utilizam credenciais do Cloudflare e não criam Worker, namespace ou rota remota.

## O que ainda não foi criado remotamente

- Worker no Cloudflare;
- namespace do Durable Object remoto;
- secret remoto `STAGING_API_TOKEN`;
- URL `workers.dev` de staging;
- Supabase correto;
- tabelas de projeção;
- dispatcher agendado;
- integração com o frontend V2.

Esses recursos só serão criados depois que o acesso ao Cloudflare estiver disponível e o PR for revisado.

## Procedimento de ativação futura

1. confirmar a conta Cloudflare correta;
2. configurar o environment GitHub e seus reviewers;
3. adicionar os três segredos do staging;
4. incorporar o workflow na branch padrão;
5. executar manualmente com a frase exata;
6. validar `/health` remoto;
7. manter escrita desabilitada;
8. testar somente a presença do Worker e do Durable Object;
9. criar PR separado para habilitar escrita sintética;
10. confirmar replay e conflito de idempotência;
11. testar a outbox;
12. conectar a projeção Supabase correta;
13. testar falha e recuperação da projeção;
14. somente então preparar uma rota pública V2.

## Rollback do staging

Como o Worker é separado, o rollback não exige alteração na Atual Versão de Segurança.

Em falha:

1. manter ou restaurar `STAGING_WRITE_ENABLED=false`;
2. reverter somente o Worker `new-hub-artres-v2-staging`;
3. preservar o ledger para diagnóstico;
4. corrigir a branch;
5. repetir o dry-run e o smoke local;
6. publicar nova versão no staging.

A `main`, o Pages público, `CONFIG_KV`, o Supabase atual e o aplicativo de produção permanecem fora desse processo.

## Referências técnicas consultadas

- Cloudflare Workers Best Practices, atualizado em junho de 2026;
- Rules of Durable Objects, atualizado em julho de 2026;
- SQLite-backed Durable Object Storage, atualizado em julho de 2026;
- Wrangler GitHub Actions e secrets, consultados em julho de 2026;
- Supabase Data API Security e Database Functions, consultados em julho de 2026.
