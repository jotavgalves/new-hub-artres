# Auditoria técnica completa — New Hub Artes

A versão integral desta auditoria foi gerada em 19/08/2026. Este arquivo registra a auditoria no repositório sem alterar código de produção.

## Resumo executivo

A arquitetura atual possui boas proteções recentes — reconciliação de carrinho no servidor, validação de preço server-side, catálogo V2 versionado, sincronização automática, Service Worker melhorado, staging e rollback — mas ainda mantém duas gerações de arquitetura simultaneamente.

Os riscos principais são:

1. pedidos gravados em Supabase e KV sem transação única;
2. pedido e itens persistidos no Supabase em etapas separadas;
3. idempotência de produção baseada em consulta/gravação posterior em KV, sem reserva atômica;
4. checkout V2 ainda delegando persistência ao endpoint legado `orders.js`;
5. aliases genéricos de Supabase capazes de confundir catálogo e pedidos;
6. ausência de `artwork_id` de negócio estável;
7. product registry e raízes do Drive duplicados em vários arquivos;
8. fallback de produto desconhecido para `painel-150` em `_catalog_index.js`;
9. defaults comerciais divergentes entre módulos;
10. cache do catálogo versionado por `ui.cacheVersion`, não necessariamente pela versão aceita do catálogo;
11. múltiplos monkey patches globais de `window.fetch` e `Storage.prototype`;
12. HTML reescrito por regex em runtime em `functions/[[path]].js`;
13. grande acúmulo de scripts `fix`, `compat`, `override`, `safe` e `v2`;
14. `MAX_ROWS = 5000` em `catalog-v2.js` sem sinal explícito de truncamento;
15. autenticação administrativa usando `ADMIN_SECRET_KEY` como senha do admin e chave HMAC de sessão;
16. login sem rate limit explícito e política de senha permissiva;
17. API de produção capaz de fazer varredura completa do KV para localizar pedidos;
18. staging V2 ainda apresentando smoke `STAGING_PAINEL_150_CATALOG_EMPTY` no último relatório observado;
19. `_accepted_catalog.js` possuir fallback hardcoded para o projeto Supabase de staging quando a URL não é informada;
20. histórico de pedido ainda depender, em partes, de resolver a arte pelo código no catálogo atual.

## Arquitetura-alvo

```text
Google Drive / upload
        ↓
Catalog Ingestor
        ↓
Canonical Catalog DB
  artworks + products + themes
        ↓
build version N+1
        ↓
Accepted Catalog Version
        ↓
Catalog API → Web/PWA

Web/PWA
   ↓ POST checkout
Checkout API
   ↓ validação server-side
DB transaction
  orders + items + customer + idempotency + outbox
   ↓ commit
consumidores assíncronos
  produção + notificações + analytics
```

## Findings prioritários

### AUD-001 — Dual-write de pedidos não transacional — ALTO

`functions/api/orders.js` tenta Supabase e KV de forma independente e aceita sucesso se qualquer um dos dois gravar. Isso produz divergência entre fontes. O próximo sistema deve possuir um banco primário único e tratar KV apenas como cache/projeção.

### AUD-002 — Pedido e itens Supabase não são atômicos — ALTO

`functions/api/_supabase.js` faz upsert do pedido, apaga `order_items` e depois recria os itens. Falha após o DELETE pode deixar um pedido sem itens. Implementar RPC/transação única.

### AUD-003 — Idempotência não é atomicamente reservada — ALTO

`orders-v2.js` consulta a chave no KV antes de criar e grava o replay depois. Requisições concorrentes podem ambas passar pela primeira consulta. Usar tabela `idempotency_keys` com PK/unique dentro da mesma transação do pedido.

### AUD-004 — Supabases podem ser confundidos por aliases — ALTO

Catálogo e pedidos aceitam `SUPABASE_REST_URL` e/ou `SUPABASE_SERVICE_ROLE_KEY` genéricos. Usar nomes explícitos e validar project refs por ambiente.

### AUD-005 — Checkout V2 usa persistência legada — ALTO

`orders-v2.js` importa e chama o POST de `orders.js`. A validação nova termina em storage antigo. Separar um serviço transacional de pedidos.

### AUD-006 — Sem `artwork_id` estável — ALTO

`drive_id` é identidade operacional. O novo sistema deve ter UUID/ULID imutável e armazenar Drive ID como referência externa/versionável.

### AUD-007 — Snapshot legado perde identidade exata da arte — ALTO

O V2 conhece `driveFileId`, `catalogRootDriveId` e tamanho, mas `orders.js` reduz itens a código/tema/produto/nome/quantidade/imagem. Persistir snapshot completo.

### AUD-008 — Product registry duplicado — ALTO

Produtos e raízes aparecem em `_config.js`, `_catalog_index.js`, `commercial-config.js`, `catalog-v2.js`, `_accepted_catalog.js`, `orders-v2.js`, indexers e workflows. Centralizar em registry canônico.

### AUD-009 — Produto desconhecido vira painel — ALTO

`_catalog_index.productKey()` termina retornando `painel-150`. Produto desconhecido deve gerar `PRODUCT_UNKNOWN`.

### AUD-010 — Defaults comerciais divergentes — ALTO

Há fallback de bolinhas em 9,75 em `_config.js` e 9,90 em outros módulos. Configuração comercial ausente deve falhar fechada, não escolher defaults diferentes.

### AUD-011 — GET pode migrar/escrever configuração — MÉDIO/ALTO

`commercial-config.js` e `loadConfig()` podem criar/migrar configuração durante leitura. Migrations devem ser explícitas.

### AUD-012 — Config inválida pode cair para defaults — ALTO

Um `APP_CONFIG` inválido pode resultar em fallback silencioso. Regras comerciais devem `fail closed`.

### AUD-013 — Cache version não é a versão real do catálogo — ALTO

`catalog-cache-bust.js` usa `/api/catalog-meta`, que devolve `ui.cacheVersion/config.version`, não necessariamente `accepted catalog version`. A versão de cache deve vir da projeção aceita.

### AUD-014 — Múltiplos monkey patches de fetch — ALTO

`catalog-cache-bust.js` e `cart-reconcile-v1.js` substituem `window.fetch`. A ordem de carregamento passa a ser parte da regra de negócio. Criar clients explícitos.

### AUD-015 — Monkey patch de Storage — ALTO

`catalog-cache-bust.js` altera `Storage.prototype.getItem/setItem/removeItem`. Remover e usar um `CatalogCache` isolado.

### AUD-016 — HTML modificado por regex no edge — MÉDIO/ALTO

`functions/[[path]].js` lê HTML e injeta/remove scripts por regex. Migrar para build determinístico.

### AUD-017 — Patch accretion no frontend — MÉDIO/ALTO

Há vários scripts `fix/compat/override/safe/v2` simultâneos. Consolidar entrypoints e remover versões antigas após janela de migração.

### AUD-018 — Lista manual de assets críticos do Service Worker — MÉDIO

Scripts novos podem cair em stale-while-revalidate por esquecimento. Usar assets com hash de conteúdo e HTML no-cache.

### AUD-019 — Duas fontes de catálogo no mesmo endpoint — MÉDIO/ALTO

`catalog-v2.js` pode usar accepted catalog ou índice legado, além de fallback live do Drive para Painel. Depois do cutover deve existir uma única fonte pública.

### AUD-020 — Estratégias diferentes para Painel e Bolinhas — MÉDIO

`painel-150` possui leitura live complementar; `50x50` é mais dependente de índice. Uniformizar via configuração de estrutura.

### AUD-021 — Limite silencioso de 5.000 linhas — MÉDIO/ALTO

`allRows()` percorre até `MAX_ROWS=5000`. Implementar cursor e `hasMore`.

### AUD-022 — Full scan a cada 10 min não escala indefinidamente — MÉDIO

A automação atual é correta para frescor, mas deve evoluir para delta sync + reconciliação total periódica em escala grande.

### AUD-023 — Dois indexadores usam autenticação diferente — MÉDIO/ALTO

Legado usa API key; V2 usa service account. Eles podem enxergar conjuntos diferentes. Uma única identidade deve alimentar a fonte canônica.

### AUD-024 — Timeouts ausentes em caminhos legados — MÉDIO

Padronizar HTTP client com timeout, retry/backoff, request ID e observabilidade.

### AUD-025 — CONFIG_KV sobrecarregado — MÉDIO/ALTO

Configuração, pedidos, deletados, counters, idempotência e referências compartilham namespace. Separar responsabilidades.

### AUD-026 — Listagem KV administrativa não pagina completamente — MÉDIO

`orders.js` usa um `KV.list` limitado sem cursor para continuar. Pode omitir pedidos.

### AUD-027 — API de produção pode full-scan do KV — ALTO EM ESCALA

`production/_helpers.js` pagina chaves e faz GET item por item como fallback. Trocar por índices no banco.

### AUD-028 — Token estático + CORS wildcard — MÉDIO

A API de produção aceita aliases de bearer token e responde `Access-Control-Allow-Origin: *`. Usar credencial por cliente, rotação e escopo.

### AUD-029 — ADMIN_SECRET_KEY cumpre dois papéis — ALTO

É senha do admin e chave de assinatura. Separar credencial de usuário e `SESSION_SIGNING_KEY`.

### AUD-030 — Login sem rate limit explícito — ALTO

Adicionar rate limit, backoff, MFA e política de senha forte.

### AUD-031 — CSRF deve ser explicitamente modelado — BAIXO/MÉDIO

SameSite=Lax reduz risco, mas operações sensíveis devem validar Origin/Referer e usar CSRF token quando aplicável.

### AUD-032 — Security headers do repo são mínimos — MÉDIO

`_headers` não declara CSP, `frame-ancestors`, Permissions-Policy ou HSTS. Verificar edge e versionar política.

### AUD-033 — PII duplicada — MÉDIO

Cliente/pedido aparecem em campos normalizados, `raw`, metadata e KV. Definir minimização e retenção LGPD.

### AUD-034 — Staging Panel 150 smoke ainda falha — ALTO PARA CUTOVER

O último relatório observado tinha catálogo aceito e Worker publicado, mas smoke `STAGING_PAINEL_150_CATALOG_EMPTY`, seguido de rollback. Não promover até resolver.

### AUD-035 — Fallback de URL do accepted catalog aponta para staging — ALTO

`_accepted_catalog.js` defaulta para `kueklnkznwpbobqwugns.supabase.co`. Em produção a URL deve ser obrigatória e validada.

### AUD-036 — Ambiente ainda depende de muitas flags/aliases/defaults — MÉDIO/ALTO

Criar contrato de boot com `ENVIRONMENT` e project refs esperados.

### AUD-037 — Histórico depende do catálogo atual — ALTO

A API de produção resolve nomes por código no catálogo. Pedido histórico deve conter snapshot suficiente para nunca precisar reinterpretar catálogo atual.

### AUD-038 — Código visual participa demais da identidade — MÉDIO/ALTO

Código deve ser pesquisável, não chave primária.

### AUD-039 — E2E público ainda é limitado — MÉDIO

A suíte V2 é ampla em unit/contract/smoke, mas `tests/e2e` possui cobertura pequena. Adicionar browser/PWA/concurrency/network failure.

### AUD-040 — Falta health plane único — MÉDIO

Criar `/health/live`, `/health/ready` e dashboard interno com versão, sync age e dependências.

### AUD-041 — Alertas de sync não são uniformes — MÉDIO

Alertar por SLA, queda anômala de contagem e versão parada, não apenas por workflow vermelho.

### AUD-042 — Índice ainda pode validar Drive live em request — MÉDIO

Projeção aceita deve ser autossuficiente; Drive live deve ficar no sincronizador.

### AUD-043 — V2 de staging já contém o desenho de banco melhor — ARQUITETURAL

O schema V2 possui constraints fortes, idempotency table, outbox e catálogo versionado. Migrar essas garantias para o caminho efetivo de produção em vez de continuar fortalecendo o legado.

## Plano por fases

### Fase 0

- Orders DB canônico;
- transação de checkout;
- idempotência atômica;
- separar bancos/secrets;
- corrigir admin auth;
- remover fallback de produto;
- resolver staging Panel smoke.

### Fase 1

- registry único;
- artwork_id;
- snapshots;
- catálogo único;
- cache version = catalog version.

### Fase 2

- timeout/retry;
- health;
- metrics;
- alerts;
- outbox;
- reconciliation.

### Fase 3

- build determinístico;
- remover regex HTML injection;
- remover monkey patches;
- remover fix/compat;
- desligar APIs legadas.

### Fase 4

- delta sync;
- cursor;
- performance;
- CDN/imagens;
- load tests.

### Fase 5

- MFA/CSP/security headers;
- secret rotation;
- disaster recovery;
- LGPD;
- pentest periódico.

## Regra arquitetural final

> Cache não é banco. Índice não é fonte de verdade. Código de arte não é identidade. Drive ID não deve ser a única identidade comercial. Frontend não é autoridade comercial. Dois bancos não podem ser autoridades do mesmo pedido. Retry só é seguro com idempotência atômica. Uma versão de catálogo só existe depois de ser aceita por inteiro.

## Limitações desta auditoria

O Supabase legado de catálogo e o Supabase de pedidos de produção não estavam disponíveis como projetos conectados para inspeção direta. O domínio público também não pôde ser consultado diretamente pelo ambiente de auditoria. Por isso, a auditoria não afirma que configurações de edge ou secrets em produção foram verificadas. Esses itens devem ser validados antes de fechar a migração.
