# Guia de publicação protegida do staging V2

## Situação atual

O código do staging está preparado e validado localmente, mas nenhum recurso foi publicado no Cloudflare.

A publicação é deliberadamente separada da Atual Versão de Segurança.

```text
Produção atual: Cloudflare Pages existente
Staging V2: Worker independente new-hub-artres-v2-staging
```

O primeiro deployment mantém:

```text
STAGING_WRITE_ENABLED=false
```

Assim, mesmo depois da publicação, nenhuma rota poderá gravar pedidos até uma ativação posterior e explícita.

## Workflow preparado

```text
.github/workflows/deploy-site-v2-staging.yml
```

Características:

1. somente `workflow_dispatch`;
2. nenhuma execução em push;
3. nenhuma execução em pull request;
4. nenhuma agenda automática;
5. confirmação textual `PUBLICAR STAGING`;
6. ambiente GitHub `site-v2-staging`;
7. concorrência exclusiva;
8. testes completos antes do deploy;
9. dry-run do Wrangler antes do deploy;
10. Worker publicado com escrita desligada;
11. secret configurado depois da primeira publicação.

## Condição para o botão manual aparecer

O GitHub normalmente disponibiliza `workflow_dispatch` a partir do workflow presente na branch padrão.

Portanto, este workflow não deve ser usado enquanto estiver somente no PR rascunho. Primeiro a fundação deverá ser revisada e incorporada de maneira consciente.

Isso não significa ativar a V2 no site. A incorporação adicionará apenas infraestrutura isolada, documentação, testes e o workflow manual.

## Ambiente GitHub obrigatório

Criar o environment:

```text
site-v2-staging
```

Configurações recomendadas:

- required reviewer;
- impedir autoaprovação, quando o plano do GitHub permitir;
- limitar deployment à branch autorizada;
- não permitir bypass administrativo, quando disponível;
- manter todos os segredos dentro do environment, não no repositório.

O uso do environment no YAML não cria sozinho uma aprovação humana obrigatória. As protection rules precisam ser configuradas nas definições do repositório.

## Segredos necessários no environment

### `CLOUDFLARE_ACCOUNT_ID`

ID da conta Cloudflare correta.

### `CLOUDFLARE_API_TOKEN`

Token restrito à conta correta e com permissão para editar Workers.

O token deve possuir o menor escopo possível. Não usar Global API Key.

### `SITE_V2_STAGING_API_TOKEN`

Token exclusivo das rotas internas do staging.

Requisitos recomendados:

- valor aleatório;
- no mínimo 32 bytes;
- diferente de qualquer token de produção;
- não reutilizar `ADMIN_SECRET_KEY`;
- não reutilizar token do aplicativo desktop;
- armazenar somente como secret.

O workflow envia esse valor ao Wrangler por entrada padrão e o grava como:

```text
STAGING_API_TOKEN
```

O valor não aparece no arquivo de configuração.

## Publicação inicial

Depois da revisão e da configuração dos segredos:

1. abrir Actions;
2. escolher `Publicar Site V2 Staging`;
3. selecionar a branch autorizada;
4. digitar exatamente `PUBLICAR STAGING`;
5. iniciar o workflow;
6. aprovar o environment, quando configurado;
7. acompanhar testes e dry-run;
8. confirmar que o Worker publicado se chama `new-hub-artres-v2-staging`.

## Estado esperado depois da publicação

```text
Worker criado: sim
Durable Object namespace criado: sim
Rota workers.dev: sim
Rota em domínio de produção: não
Escrita habilitada: não
Catálogo real: não
Supabase real: não
CONFIG_KV de produção: não
Aplicativo de produção: não
```

## Smoke test remoto inicial

Apenas `/health` deve ser testado antes de habilitar escrita.

Resposta esperada:

```json
{
  "ok": true,
  "service": "new-hub-artres-v2-staging",
  "environment": "staging",
  "writesEnabled": false,
  "persistence": "durable-object-sqlite",
  "catalog": "synthetic-staging-only",
  "catalogVersion": 9001
}
```

Não publicar a URL em anúncios, site, catálogo ou mecanismos de busca.

## Ativação posterior de escrita

A escrita não será ligada pelo mesmo workflow inicial.

Ela exigirá outro ciclo:

1. confirmar `/health` remoto;
2. confirmar que não existe rota de domínio;
3. confirmar token exclusivo;
4. revisar logs do primeiro deploy;
5. criar PR específico alterando somente o estado de escrita do staging;
6. rodar novamente todos os testes;
7. publicar;
8. enviar pedido exclusivamente sintético;
9. repetir a mesma chave;
10. confirmar replay;
11. consultar pedido e outbox;
12. desligar escrita em qualquer divergência.

## Dados permitidos no staging inicial

Somente dados sintéticos:

```text
staging-artwork-2657
staging-artwork-2656
Cliente Sintético
telefones não reais reservados para teste
imagens example.invalid
```

Proibido no primeiro ciclo remoto:

- nome de cliente real;
- telefone real;
- pedido real;
- arte real do Drive;
- vendedora vinculada operacionalmente;
- Supabase de produção;
- KV de produção;
- WhatsApp;
- aplicativo desktop de produção.

## Rollback do staging

O staging é um Worker separado. Seu rollback não exige alterar o Pages público.

Procedimento:

1. manter `STAGING_WRITE_ENABLED=false`;
2. usar `wrangler versions list` para identificar versões;
3. executar rollback somente no Worker `new-hub-artres-v2-staging`;
4. validar `/health`;
5. nunca apontar o domínio público para o Worker durante diagnóstico.

## Critérios para avançar

O staging só poderá receber catálogo ou Supabase reais depois que:

- Worker remoto estiver saudável;
- Durable Object responder corretamente;
- replay estiver comprovado;
- conflito de chave estiver comprovado;
- outbox estiver comprovada;
- logs não contiverem dados pessoais;
- projeto Supabase correto estiver identificado;
- projeção Supabase estiver idempotente;
- rollback remoto estiver ensaiado;
- Atual Versão de Segurança continuar sem alteração.

## Referências operacionais

A configuração utiliza variáveis de autenticação esperadas pelo Wrangler em CI:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

O token deve ser criado pela opção de edição de Cloudflare Workers e restrito à conta necessária.

Os environment secrets do GitHub só ficam disponíveis ao job que referencia o environment. Quando required reviewers estão configurados, o job não recebe os segredos antes da aprovação.
