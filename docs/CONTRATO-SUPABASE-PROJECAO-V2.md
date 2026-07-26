# Contrato Supabase de projeção V2

## Estado

```text
Contrato definido: sim
Adapter implementado: sim
Testes com transporte simulado: sim
Projeto Supabase correto identificado: não
Migration criada: não
SQL aplicado: não
Dados alterados: não
```

O projeto Supabase acessível nesta sessão pertence a outro sistema. Por isso, nenhuma tabela ou função da V2 foi criada nele.

## Papel do Supabase

O Supabase será uma projeção operacional do `OrderLedger`.

Ele não será responsável por:

- gerar número do pedido;
- decidir idempotência da submissão pública;
- confirmar a existência autoritativa do pedido;
- substituir o Durable Object durante falhas de projeção.

O Durable Object confirma o pedido e cria o evento da outbox na mesma transação. Depois, o dispatcher envia esse evento ao Supabase.

## Adapter implementado

```text
src/v2/persistence/supabase-order-projection.mjs
```

Operações:

```text
projectOrderCreated
projectOrderStatusChanged
health
```

Cada operação usa uma única RPC Postgres.

Não são realizadas sequências REST como:

```text
insert order
apagar itens
insert itens
insert evento
```

Esse padrão poderia produzir projeção parcial. A RPC futura deverá executar tudo em uma transação Postgres.

## Autenticação

O adapter exige:

```text
HTTPS
URL do projeto correto
secret key ou service role exclusivamente no servidor
```

Headers utilizados:

```text
apikey
Authorization: Bearer
Content-Type: application/json
Content-Profile
```

A chave nunca será enviada ao navegador.

Erros remotos são limitados e têm o segredo removido antes de serem anexados a exceções locais.

## Identidade global do evento

O `id` da outbox é local ao Durable Object. O mesmo número pode existir em anos diferentes.

Por isso, a identidade global será:

```text
eventType:orderNumber:eventId
```

Exemplos:

```text
order.created.v2:PED2600001A:1
order.created.v2:PED2700001A:1
```

Essas chaves são diferentes e podem coexistir.

## RPCs esperadas

### `project_order_created_v2`

Parâmetros:

```text
p_event_key text
p_event_id bigint
p_event_type text
p_order_number text
p_order jsonb
p_event_created_at timestamptz
```

Resultado mínimo:

```json
{
  "action": "PROJECTED",
  "order_number": "PED2600001A"
}
```

Em replay:

```json
{
  "action": "REPLAY",
  "order_number": "PED2600001A"
}
```

### `project_order_status_changed_v2`

Parâmetros:

```text
p_event_key text
p_event_id bigint
p_event_type text
p_order_number text
p_status text
p_updated_at timestamptz
p_event jsonb
```

### `order_projection_health_v2`

Deverá retornar somente informações técnicas não sensíveis:

```json
{
  "ok": true,
  "schema_version": 1
}
```

## Tabelas propostas

Os nomes ainda serão confirmados no projeto correto.

### `order_projection_events_v2`

Finalidade:

- registrar eventos já aplicados;
- garantir replay idempotente;
- permitir auditoria técnica.

Campos mínimos:

```text
event_key text primary key
event_id bigint not null
event_type text not null
order_number text not null
payload jsonb not null
projected_at timestamptz not null
```

### `orders_v2`

Campos mínimos:

```text
order_number text primary key
schema_version smallint not null
status text not null
seller jsonb not null
customer jsonb not null
pricing jsonb not null
integrity jsonb not null
raw jsonb not null
created_at timestamptz not null
updated_at timestamptz not null
```

### `order_items_v2`

Campos mínimos:

```text
order_number text not null
item_id text not null
drive_file_id text not null
code text not null
product_key text not null
product_name text not null
variant_key text not null
size_key text not null
quantity integer not null
unit_price numeric not null
line_subtotal numeric not null
details jsonb not null
primary key (order_number, item_id)
```

## Regras transacionais da criação

A futura RPC deverá:

1. validar o formato do pedido;
2. confirmar que `p_order_number` corresponde ao JSON;
3. tentar inserir `p_event_key`;
4. retornar `REPLAY` se a chave já existir para o mesmo pedido;
5. falhar se a chave existente apontar para outro pedido ou tipo;
6. inserir ou confirmar `orders_v2`;
7. inserir todos os itens;
8. verificar quantidade de itens;
9. retornar `PROJECTED`;
10. confirmar tudo em uma única transação.

## Segurança Postgres

Quando a migration for criada:

- ativar RLS nas tabelas expostas;
- não criar policies para `anon` ou `authenticated` neste primeiro estágio;
- revogar privilégios públicos;
- conceder somente o necessário ao papel servidor;
- revogar execução das RPCs de `public`, `anon` e `authenticated`;
- conceder execução somente ao papel servidor apropriado;
- preferir `security invoker`;
- se `security definer` for indispensável, usar `set search_path = ''` e nomes de schema explícitos;
- manter grants, RLS, funções e índices na mesma migration;
- executar advisors de segurança e desempenho depois da migration.

## Índices esperados

```text
orders_v2(created_at desc)
orders_v2(status, created_at desc)
order_projection_events_v2(order_number, projected_at desc)
order_items_v2(drive_file_id)
order_items_v2(code)
```

A necessidade de cada índice deverá ser confirmada por consultas reais e `EXPLAIN`, não apenas por suposição.

## Política de dados pessoais

O Supabase poderá armazenar nome e telefone porque será a projeção operacional dos pedidos.

Restrições:

- nenhuma chave secreta no JSON do pedido;
- nenhum IP integral em logs de aplicação;
- nenhuma `Idempotency-Key` original;
- nenhum token do aplicativo desktop;
- nenhum header de autorização;
- nenhuma resposta bruta de erro com credencial;
- acesso administrativo autenticado e auditável.

## Processo obrigatório quando o projeto correto aparecer

1. confirmar referência e proprietário do projeto;
2. confirmar região e finalidade;
3. listar schemas, tabelas, funções e policies;
4. confirmar que não é o projeto jurídico já acessível;
5. executar `supabase migration new` pelo fluxo oficial;
6. adicionar o SQL revisado à migration gerada;
7. validar localmente;
8. aplicar somente no staging;
9. executar advisors;
10. testar RPC de saúde;
11. projetar um pedido sintético;
12. repetir o mesmo evento;
13. confirmar `REPLAY` sem duplicação;
14. simular falha e recuperação da outbox;
15. somente depois conectar o dispatcher remoto.

## Bloqueio atual

```text
SUPABASE_PROJECTION_ENABLED=false
```

Nenhuma binding ou variável do Worker de staging aponta para Supabase neste momento.
