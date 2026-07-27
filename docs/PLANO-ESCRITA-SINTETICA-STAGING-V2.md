# Plano de escrita sintética do Site V2 Staging

## Objetivo

Permitir que o Worker remoto de staging grave somente pedidos produzidos pelo catálogo sintético interno, sem conexão com o catálogo real, Drive, KV, Supabase, painel administrativo ou site público atual.

## Alteração de configuração

A única escrita habilitada será a rota comercial protegida:

```text
POST /internal/v2/orders/submit
```

Configuração proposta:

```text
STAGING_WRITE_ENABLED=true
STAGING_LOW_LEVEL_LEDGER_ENABLED=false
```

A rota técnica abaixo continuará bloqueada:

```text
POST /internal/v2/ledger/submit
```

Mesmo com token válido, ela deverá responder:

```text
HTTP 503
LOW_LEVEL_LEDGER_DISABLED
```

## Limites do catálogo

O Worker continuará carregando exclusivamente o fixture:

```text
staging/site-v2-worker/src/staging-catalog-fixture.js
```

Identificadores permitidos no teste remoto:

```text
staging-artwork-2657
staging-artwork-2656
```

As imagens continuam apontando para `example.invalid`.

O teste usa:

```text
Produto: 50x50
Preço do servidor: R$ 9,75
Quantidade: 6
Total: R$ 58,50
Catálogo: versão 9001
```

Valores adulterados enviados pelo cliente, como R$ 0,01, devem ser ignorados e recalculados pelo servidor.

## Publicação manual

O workflow permanece exclusivamente manual e passa a exigir a frase:

```text
PUBLICAR STAGING SINTETICO
```

Antes da publicação, o workflow:

1. valida os três secrets do environment;
2. cria um arquivo de secret temporário com permissão restrita;
3. gera uma configuração temporária de rollback com escrita desativada;
4. executa todos os testes V2;
5. faz dry-run do bundle ativo;
6. faz dry-run do bundle de rollback;
7. somente então publica o Worker.

## Smoke test remoto obrigatório

Depois do deploy, o workflow executa um pedido sintético único e valida:

1. `/health` com `writesEnabled=true`;
2. `lowLevelLedgerEnabled=false`;
3. catálogo `synthetic-staging-only` versão 9001;
4. criação com HTTP 201 e ação `CREATED`;
5. total recalculado para R$ 58,50;
6. replay com HTTP 200 e ação `REPLAY`;
7. mesmo número de pedido no replay;
8. consulta do pedido com cliente redigido;
9. existência de um evento `order.created.v2` na outbox;
10. bloqueio da rota técnica com HTTP 503.

O teste não usa nome, telefone, arte ou pedido real.

## Rollback automático

Se qualquer verificação remota falhar depois do deploy, o próprio workflow publica imediatamente a configuração temporária com:

```text
STAGING_WRITE_ENABLED=false
STAGING_LOW_LEVEL_LEDGER_ENABLED=false
```

Tag do rollback:

```text
staging-writes-disabled-automatic-rollback
```

O workflow termina com falha para tornar o incidente visível, mas tenta restaurar a escrita desativada antes de encerrar.

## Isolamento preservado

Esta etapa não altera:

- domínio de produção;
- Cloudflare Pages atual;
- arquivos de runtime do site público;
- catálogo real;
- Google Drive;
- KV atual;
- Supabase;
- pedidos existentes;
- branch de segurança.

## Condição para merge

O PR deve permanecer sem merge até:

1. CI completo aprovado;
2. revisão do diff;
3. autorização explícita do proprietário;
4. confirmação de que o environment `site-v2-staging` mantém os secrets cadastrados.

Após o merge, ainda será necessária uma segunda ação manual no GitHub Actions para efetivamente publicar a configuração.
