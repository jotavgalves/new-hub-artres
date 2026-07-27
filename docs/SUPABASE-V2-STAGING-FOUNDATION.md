# Fundação do Supabase para o Armazem V2 Staging

## Estado atual

A fundação foi aplicada e validada no projeto isolado `Armazem V2 Staging`, na região `sa-east-1`.

O identificador concreto do projeto, chaves e segredos permanecem fora do repositório.

Migrations aplicadas no staging:

```text
armazem_v2_projection_foundation
armazem_v2_rpc_role_guard
armazem_v2_projection_fk_indexes
```

Nenhum pedido de teste permaneceu gravado. A validação sintética foi executada em subtransação e revertida integralmente.

## Arquivos versionados

```text
supabase/migrations/20260727193000_armazem_v2_projection_foundation.sql
supabase/migrations/20260727193100_armazem_v2_rpc_role_guard.sql
supabase/migrations/20260727193200_armazem_v2_projection_fk_indexes.sql
supabase/contracts/order-projection-v1.schema.json
tests/v2/supabase-v2-schema.test.mjs
tests/v2/supabase-v2-rpc-role-guard.test.mjs
tests/v2/supabase-v2-fk-indexes.test.mjs
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

Todas as cinco tabelas possuem:

- RLS habilitada;
- RLS forçada;
- nenhuma policy para `anon`;
- nenhuma policy para `authenticated`;
- privilégios revogados de `public`, `anon` e `authenticated`.

O frontend não recebe chave de serviço e não consulta o Supabase diretamente.

### Contexto das RPCs

As três RPCs são executáveis somente por `service_role`.

O guard interno lê primeiro a claim consolidada:

```text
request.jwt.claims
```

A claim histórica individual permanece apenas como fallback compatível:

```text
request.jwt.claim.role
```

A migration não tenta configurar GUC protegido e não amplia permissões.

### Dados pessoais

Nome, telefone e WhatsApp ficam em tabela privada separada:

```text
armazem_v2_private.order_customers
```

A leitura administrativa não consulta essa tabela e devolve somente:

```json
{"customer":{"redacted":true}}
```

## Tabelas

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

## RPCs

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

## Índices

Além das chaves e índices de consulta, existem índices de cobertura para as chaves estrangeiras:

```text
armazem_v2_idempotency_order_number_idx
armazem_v2_outbox_aggregate_id_idx
```

## Validação realizada

O teste sintético confirmou:

- criação com ação `CREATED`;
- replay com ação `REPLAY`;
- total de R$ 58,50 calculado e persistido durante a subtransação;
- cliente redigido na RPC administrativa;
- uma ordem, um item e um evento pendente durante o teste;
- zero pedidos, clientes, itens, chaves e eventos após o rollback.

As ACLs confirmaram:

```text
anon: sem EXECUTE
authenticated: sem EXECUTE
service_role: EXECUTE permitido
```

## Advisors

Os advisors de segurança retornam somente avisos informativos de RLS sem policies, comportamento intencional para tabelas privadas e bloqueadas.

Os avisos de chaves estrangeiras sem índice foram corrigidos. Avisos de índices ainda não utilizados são esperados enquanto o banco permanece sem tráfego real.

## Próxima etapa

Conectar o Worker de staging ao Supabase em modo sombra:

1. Durable Object continua como fonte principal;
2. Supabase recebe somente projeções sintéticas;
3. falha no Supabase não interrompe o pedido sintético;
4. métricas comparam ledger e projeção;
5. nenhuma ativação de produção.

## Produção

Esta fundação não cria nem configura o projeto de produção. O projeto definitivo será criado somente após o staging ser validado integralmente.
