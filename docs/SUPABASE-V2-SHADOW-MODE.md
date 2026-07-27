# Supabase V2 em modo sombra

## Objetivo

Projetar pedidos sintéticos do staging para o Supabase V2 sem substituir o Durable Object e sem permitir que indisponibilidade externa interrompa a criação do pedido.

## Ordem de persistência

```text
1. Validar e recalcular o pedido no Worker.
2. Persistir atomicamente no Durable Object SQLite.
3. Responder ao cliente com CREATED ou REPLAY.
4. Executar a projeção do Supabase em waitUntil.
```

O Durable Object continua sendo a fonte principal desta fase.

A projeção do Supabase é:

- assíncrona;
- best-effort;
- idempotente;
- limitada por timeout;
- limitada a 64 KiB de resposta;
- incapaz de alterar a resposta já produzida pelo ledger;
- incapaz de marcar o outbox principal como entregue.

## Arquitetura

O entrypoint do Worker é:

```text
staging/site-v2-worker/src/index-shadow.js
```

O arquivo envolve o Worker consolidado em `index.js`, sem substituir suas rotas ou a implementação do Durable Object.

A montagem do contrato específico do staging fica em:

```text
staging/site-v2-worker/src/supabase-shadow-projector.js
```

O transporte HTTP é compartilhado com o adaptador Supabase V2 existente:

```text
src/v2/persistence/supabase-rpc-client.mjs
```

Esse cliente concentra HTTPS, headers privilegiados, timeout, limite de resposta e sanitização de erros.

RPC de projeção:

```text
public.armazem_v2_project_order_v1(jsonb)
```

RPCs usadas no smoke remoto:

```text
public.armazem_v2_projection_health_v1()
public.armazem_v2_list_orders_redacted_v1(integer)
```

Destino exclusivo do staging:

```text
https://kueklnkznwpbobqwugns.supabase.co
```

O endereço do projeto não é segredo. A credencial de serviço nunca é registrada no repositório.

## Payload projetado

O payload contém:

- contrato versão 1;
- evento determinístico por número de pedido;
- evento `order.created.v2`;
- pedido canônico já persistido no Durable Object;
- chave de idempotência derivada por SHA-256;
- fingerprint canônico;
- request ID e ator técnicos.

A chave bruta de idempotência não é enviada ao Supabase.

## Segurança

As RPCs permanecem executáveis apenas pelo papel `service_role`.

O frontend não recebe:

- chave de serviço;
- chave de idempotência derivada;
- dados técnicos do outbox;
- acesso direto às tabelas privadas.

Os logs registram somente códigos técnicos, request ID sanitizado, número do pedido, ação e latência.

Nome, telefone, WhatsApp, corpo integral do pedido e credencial não são registrados.

## Estado de ativação do staging

A configuração proposta para o staging é:

```json
"SUPABASE_SHADOW_ENABLED": "true"
```

A escrita continua limitada ao catálogo sintético e a rota técnica de baixo nível permanece desativada:

```json
"STAGING_WRITE_ENABLED": "true"
"STAGING_LOW_LEVEL_LEDGER_ENABLED": "false"
```

O endpoint `/health` deve informar:

```json
{
  "supabaseShadow": {
    "enabled": true,
    "configured": true,
    "mode": "best-effort",
    "target": "supabase-v2-staging"
  }
}
```

O deploy não pode prosseguir quando `enabled` estiver ativo e `configured` não puder ser obtido pela credencial protegida.

## Credencial obrigatória

O ambiente protegido `site-v2-staging` do GitHub precisa conter:

```text
SUPABASE_V2_STAGING_SERVICE_ROLE_KEY
```

O valor deve ser obtido diretamente no painel do projeto `Armazem V2 Staging` e inserido no GitHub. Ele não deve ser enviado pelo chat, por commit ou por arquivo.

A integração disponível nesta conversa não possui permissão para ler ou gravar secrets do GitHub, e o conector do Supabase não expõe a chave de serviço.

## Validações anteriores ao deploy

O workflow exige:

- credenciais Cloudflare do staging;
- token interno do Worker;
- credencial de serviço do Supabase V2 Staging;
- URL exata do projeto de staging;
- ledger técnico desativado;
- testes locais;
- bundle ativo sem publicação;
- bundle de rollback sem publicação.

## Smoke remoto após o deploy

O primeiro smoke valida:

1. estabilidade do Worker;
2. pedido sintético criado;
3. replay com o mesmo número;
4. cálculo do servidor;
5. painel somente leitura;
6. cliente redigido;
7. low-level ledger bloqueado.

O segundo smoke valida diretamente no Supabase:

1. `enabled=true` e `configured=true` no health do Worker;
2. health privilegiado da projeção;
3. pedido sintético exclusivo criado pelo Worker;
4. replay com o mesmo número;
5. pedido visível na RPC redigida;
6. total e item preservados;
7. nome e WhatsApp ausentes da resposta;
8. exatamente uma ocorrência do pedido após o replay.

## Rollback

Qualquer falha após a publicação aciona um bundle separado que troca:

```text
STAGING_WRITE_ENABLED=true   -> false
SUPABASE_SHADOW_ENABLED=true -> false
```

O rollback não altera produção, domínio público, Supabase antigo ou dados reais.

## Limites desta fase

- somente catálogo sintético;
- somente staging isolado;
- Durable Object ainda é a fonte principal;
- painel administrativo ainda lê o ledger do staging;
- nenhuma rota de produção;
- nenhum pedido real.
