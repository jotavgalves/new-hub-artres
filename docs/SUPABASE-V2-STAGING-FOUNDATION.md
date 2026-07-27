# Fundação do Supabase para o Armazem V2 Staging

## Estado desta etapa

Este bloco apenas versiona a estrutura proposta no GitHub.

Não executa migration, não cria tabela remota, não grava pedido e não altera nenhum projeto anterior.

Projeto destinado à futura aplicação controlada:

```text
Armazem V2 Staging
Região: sa-east-1
```

O identificador concreto do projeto não é registrado no repositório.

## Arquivos

```text
supabase/migrations/20260727193000_armazem_v2_projection_foundation.sql
supabase/migrations/20260727193100_armazem_v2_rpc_role_guard.sql
supabase/contracts/order-projection-v1.schema.json
tests/v2/supabase-v2-schema.test.mjs
tests/v2/supabase-v2-rpc-role-guard.test.mjs
```

## Modelo de segurança

### Dados fora do schema público

As tabelas ficam em:

```text
armazem_v2_private
```

O schema não deve ser adicionado à lista de schemas expostos pelo PostgREST.

A comunicação do Worker com o banco ocorrerá exclusivamente por RPCs públicas restritas ao `service_role`.

### Bloqueios

Todas as tabelas possuem:

- RLS habilitada;
- RLS forçada;
- nenhuma policy para `anon`;
- nenhuma policy para `authenticated`;
- privilégios revogados de `public`, `anon` e `authenticated`.

O frontend não recebe chave de serviço e não consulta o Supabase diretamente.

### Contexto das RPCs

As três RPCs são executáveis somente por `service_role`. A migration complementar fixa o contexto interno usado pelo guard das funções, sem conceder acesso a tabelas ou a outros papéis.

Esse ajuste evita dependência do formato histórico de propagação individual das claims pelo PostgREST.

### Dados pessoais

Nome, telefone e WhatsApp ficam em tabela privada separada:

```text
armazem_v2_private.order_customers
```

A função administrativa de leitura não consulta essa tabela e devolve apenas:

```json
{"customer":{"redacted":true}}
```

## Tabelas propostas

### `orders`

Cabeçalho canônico do pedido V2, preço recalculado, versões de integridade, origem, fingerprint e datas.

### `order_customers`

Dados pessoais isolados por número de pedido.

### `order_items`

Itens inequívocos por `itemId`, `driveFileId`, produto, variante, tamanho e posição.

### `idempotency_keys`

Somente chave derivada no formato:

```text
idempotency:v2:<SHA-256 em hexadecimal>
```

A chave bruta recebida do cliente nunca deve chegar ao Supabase.

### `outbox_events`

Espelho do evento `order.created.v2` para futura integração com produção e demais consumidores.

## RPCs propostas

### `armazem_v2_project_order_v1`

Projeção transacional e idempotente. Valida:

- versão do contrato;
- número de pedido;
- chave derivada e fingerprint;
- quantidade dos itens;
- subtotal de cada item;
- subtotal, desconto e total do pedido;
- moeda BRL;
- replay e conflito de idempotência;
- concorrência por advisory lock transacional.

### `armazem_v2_list_orders_redacted_v1`

Lista até 100 pedidos sem consultar ou expor a tabela de clientes.

### `armazem_v2_projection_health_v1`

Retorna somente contagens técnicas da projeção.

## Contrato

O JSON Schema `order-projection-v1.schema.json` acompanha o pedido canônico já usado pelo Worker:

- `schemaVersion: 2`;
- `currency: BRL`;
- até 200 itens;
- número no formato anual `PED`;
- arte identificada por `driveFileId`;
- identidade completa por produto, variante e tamanho;
- preço com duas casas decimais;
- chave de idempotência previamente derivada.

## Aplicação futura

As migrations só deverão ser aplicadas depois de:

1. PR aprovado e mesclado;
2. revisão do SQL final;
3. confirmação explícita para modificar o projeto `Armazem V2 Staging`;
4. execução controlada das migrations em ordem;
5. advisors de segurança e performance;
6. testes de acesso anônimo, autenticado e service role;
7. inserção exclusivamente sintética;
8. plano de remoção do fixture sintético.

## Produção

Esta fundação não cria nem configura o projeto de produção. O projeto definitivo será criado somente após o staging ser validado integralmente.
