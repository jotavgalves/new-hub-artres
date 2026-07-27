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

O entrypoint do Worker passa a ser:

```text
staging/site-v2-worker/src/index-shadow.js
```

Esse arquivo envolve o Worker consolidado em `index.js`, mas não substitui suas rotas ou sua implementação do Durable Object.

A comunicação HTTP com o Supabase fica isolada em:

```text
staging/site-v2-worker/src/supabase-shadow-projector.js
```

RPC utilizada:

```text
public.armazem_v2_project_order_v1(jsonb)
```

Destino de staging:

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

A RPC permanece executável apenas pelo papel `service_role`.

O frontend não recebe:

- URL de RPC privilegiada;
- chave de serviço;
- chave de idempotência derivada;
- dados técnicos do outbox.

Os logs do modo sombra registram somente:

- código de erro público;
- request ID sanitizado;
- número do pedido;
- ação CREATED ou REPLAY;
- latência.

Nome, telefone, WhatsApp, corpo do pedido e credencial não são registrados.

## Estado inicial

O recurso entra versionado com:

```json
"SUPABASE_SHADOW_ENABLED": "false"
```

Portanto, o merge e o deploy não enviam pedidos ao Supabase.

O endpoint `/health` informa o estado usando:

```json
{
  "supabaseShadow": {
    "enabled": false,
    "configured": false,
    "mode": "best-effort",
    "target": "supabase-v2-staging"
  }
}
```

O campo `configured` poderá ficar `true` quando a credencial existir, mesmo que a flag continue desativada.

## Credencial necessária para ativação

Será necessário cadastrar uma única vez no ambiente protegido `site-v2-staging` do GitHub:

```text
SUPABASE_V2_STAGING_SERVICE_ROLE_KEY
```

O valor deve ser obtido diretamente no painel do projeto `Armazem V2 Staging` e inserido no GitHub sem ser enviado pelo chat, por commit ou por arquivo.

A integração disponível nesta conversa não possui permissão para ler ou gravar segredos do GitHub, e o conector do Supabase não expõe chaves de serviço.

## Ativação futura

Depois da credencial cadastrada, a ativação será feita em PR separado alterando somente:

```json
"SUPABASE_SHADOW_ENABLED": "true"
```

Antes do deploy, o workflow exige:

- credencial com tamanho mínimo;
- URL exata do Supabase V2 Staging;
- ledger técnico desativado;
- testes locais;
- bundle ativo e bundle de rollback.

O rollback troca automaticamente:

```text
STAGING_WRITE_ENABLED=true  -> false
SUPABASE_SHADOW_ENABLED=true -> false
```

## Critério de validação quando ativado

O smoke remoto deverá confirmar:

1. pedido sintético criado no Durable Object;
2. replay com o mesmo número;
3. pedido projetado no Supabase;
4. cliente redigido na leitura administrativa;
5. nenhuma duplicação no Supabase;
6. falha simulada do Supabase sem alterar a resposta do ledger;
7. produção pública inalterada.
