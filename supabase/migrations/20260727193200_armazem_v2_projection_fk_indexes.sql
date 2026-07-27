begin;

create index if not exists armazem_v2_idempotency_order_number_idx
  on armazem_v2_private.idempotency_keys (order_number);

create index if not exists armazem_v2_outbox_aggregate_id_idx
  on armazem_v2_private.outbox_events (aggregate_id);

commit;
