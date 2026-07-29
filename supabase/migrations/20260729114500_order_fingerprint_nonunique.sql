begin;

-- O fingerprint descreve o conteúdo canônico do pedido, não a identidade da
-- submissão. Pedidos distintos e legítimos podem possuir o mesmo conteúdo.
-- A idempotência permanece protegida por idempotency_keys.idempotency_key e
-- pelos conflitos explícitos da RPC para a mesma chave ou número de pedido.
alter table armazem_v2_private.orders
  drop constraint if exists orders_fingerprint_key;

create index if not exists armazem_v2_orders_fingerprint_idx
  on armazem_v2_private.orders (fingerprint);

commit;
