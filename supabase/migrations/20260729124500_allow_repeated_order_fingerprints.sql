-- Pedidos distintos podem ter o mesmo conteúdo comercial e, portanto, o mesmo
-- fingerprint canônico. A identidade de replay permanece vinculada à chave de
-- idempotência; número, código e display do pedido continuam únicos.

alter table armazem_v2_private.orders
  drop constraint if exists orders_fingerprint_key;

create index if not exists orders_fingerprint_idx
  on armazem_v2_private.orders(fingerprint);
