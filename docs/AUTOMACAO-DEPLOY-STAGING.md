# Automação do deploy do staging V2

## Objetivo

Eliminar a necessidade de abrir o GitHub Actions e executar manualmente o workflow a cada alteração aprovada do staging.

## Fluxo normal

1. uma mudança V2 é preparada em branch isolada;
2. o PR executa o baseline sem publicar;
3. o merge na `main` depende de autorização explícita do proprietário;
4. após o merge, o GitHub Actions detecta a alteração nos arquivos do runtime V2;
5. o staging é testado, empacotado, publicado e validado automaticamente;
6. em caso de falha posterior ao deploy, a escrita é desativada automaticamente.

O proprietário não precisa clicar em `Run workflow` no fluxo normal.

## Arquivos que acionam o deploy automático

O gatilho é restrito à branch `main` e aos seguintes caminhos:

```text
src/v2/**
staging/site-v2-worker/**
wrangler.site-v2-staging.jsonc
tests/v2/run-staging-synthetic-remote-smoke.mjs
.github/workflows/deploy-site-v2-staging.yml
```

Alterações em documentação, site público legado ou arquivos sem relação com a V2 não acionam o deploy.

## Validações anteriores à publicação

Antes do deploy real, o workflow:

- valida os três secrets obrigatórios;
- executa todos os testes isolados da V2;
- executa dry-run do bundle ativo;
- executa dry-run da configuração de rollback;
- confirma que a rota técnica do ledger permanece desativada.

## Validações posteriores à publicação

Depois do deploy, o smoke remoto confirma:

- três respostas consecutivas do `/health` com o staging ativo;
- catálogo exclusivamente sintético na versão 9001;
- criação de um pedido sintético;
- preço recalculado pelo servidor em R$ 58,50;
- replay idempotente com o mesmo número;
- uma única outbox;
- dados pessoais removidos das respostas;
- carregamento do painel `/admin`;
- API administrativa marcada como somente leitura;
- rejeição de `POST` na rota administrativa;
- bloqueio da rota técnica do ledger.

## Rollback

Se o Worker for publicado, mas qualquer validação remota falhar, o workflow republica automaticamente uma configuração com:

```text
STAGING_WRITE_ENABLED=false
STAGING_LOW_LEVEL_LEDGER_ENABLED=false
```

Falhas ocorridas antes do deploy não alteram o Worker remoto.

## Contingência manual

O `workflow_dispatch` permanece disponível para recuperação ou repetição deliberada. Nesse modo, continua sendo exigida a frase:

```text
PUBLICAR STAGING SINTETICO
```

## Limites

Esta automação:

- não publica o site público;
- não cria rota de produção;
- não acessa Supabase, Drive ou KV reais;
- não habilita a rota técnica do ledger;
- não elimina a exigência de autorização explícita antes de cada merge relevante;
- não automatiza uma futura publicação de produção.
