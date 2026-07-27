begin;

create schema if not exists armazem_v2_private;

revoke all on schema armazem_v2_private from public;
revoke all on schema armazem_v2_private from anon;
revoke all on schema armazem_v2_private from authenticated;

create table if not exists armazem_v2_private.orders (
  order_number text primary key,
  order_code text not null unique,
  display_id text not null unique,
  schema_version smallint not null,
  status text not null,
  seller_id text not null,
  seller_label text not null default '',
  qty integer not null,
  currency text not null,
  subtotal numeric(14,2) not null,
  discount_percent numeric(5,2) not null,
  discount_amount numeric(14,2) not null,
  total numeric(14,2) not null,
  calculation_version integer not null,
  catalog_version bigint not null,
  config_version bigint not null,
  product_registry_version bigint not null,
  request_item_count integer not null,
  canonical_item_count integer not null,
  source text not null,
  fingerprint text not null unique,
  request_id text not null default '',
  actor text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  projected_at timestamptz not null default now(),
  constraint armazem_v2_orders_number_format check (order_number ~ '^PED[0-9]{7}[A-Z]$'),
  constraint armazem_v2_orders_code_required check (length(order_code) between 1 and 80),
  constraint armazem_v2_orders_display_required check (length(display_id) between 1 and 80),
  constraint armazem_v2_orders_schema_v2 check (schema_version = 2),
  constraint armazem_v2_orders_status_required check (length(status) between 1 and 80),
  constraint armazem_v2_orders_seller_required check (length(seller_id) between 1 and 120),
  constraint armazem_v2_orders_qty_positive check (qty > 0),
  constraint armazem_v2_orders_currency_brl check (currency = 'BRL'),
  constraint armazem_v2_orders_subtotal_nonnegative check (subtotal >= 0),
  constraint armazem_v2_orders_discount_percent_range check (discount_percent between 0 and 100),
  constraint armazem_v2_orders_discount_nonnegative check (discount_amount >= 0),
  constraint armazem_v2_orders_total_nonnegative check (total >= 0),
  constraint armazem_v2_orders_total_consistent check (total = greatest(0::numeric, subtotal - discount_amount)),
  constraint armazem_v2_orders_calculation_version_positive check (calculation_version > 0),
  constraint armazem_v2_orders_catalog_version_positive check (catalog_version > 0),
  constraint armazem_v2_orders_config_version_positive check (config_version > 0),
  constraint armazem_v2_orders_registry_version_positive check (product_registry_version > 0),
  constraint armazem_v2_orders_request_count_nonnegative check (request_item_count >= 0),
  constraint armazem_v2_orders_canonical_count_positive check (canonical_item_count > 0),
  constraint armazem_v2_orders_source_required check (length(source) between 1 and 160),
  constraint armazem_v2_orders_fingerprint_format check (fingerprint ~ '^[a-f0-9]{64}$'),
  constraint armazem_v2_orders_dates_consistent check (updated_at >= created_at)
);

create table if not exists armazem_v2_private.order_customers (
  order_number text primary key references armazem_v2_private.orders(order_number) on delete cascade,
  customer_name text not null default '',
  customer_whatsapp text not null default '',
  customer_phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint armazem_v2_customer_name_length check (length(customer_name) <= 160),
  constraint armazem_v2_customer_whatsapp_digits check (customer_whatsapp ~ '^[0-9]{0,20}$'),
  constraint armazem_v2_customer_phone_digits check (customer_phone ~ '^[0-9]{0,20}$')
);

create table if not exists armazem_v2_private.order_items (
  order_number text not null references armazem_v2_private.orders(order_number) on delete cascade,
  position smallint not null,
  item_id text not null,
  drive_file_id text not null,
  code text not null,
  original_name text not null default '',
  theme text not null default '',
  subtheme text not null default '',
  product_key text not null,
  product_name text not null,
  variant_key text not null,
  size_key text not null,
  quantity integer not null,
  unit_price numeric(14,2) not null,
  line_subtotal numeric(14,2) not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (order_number, position),
  constraint armazem_v2_items_position_positive check (position between 1 and 200),
  constraint armazem_v2_items_item_id_required check (length(item_id) between 1 and 500),
  constraint armazem_v2_items_drive_required check (length(drive_file_id) between 1 and 255),
  constraint armazem_v2_items_code_required check (length(code) between 1 and 80),
  constraint armazem_v2_items_product_required check (length(product_key) between 1 and 120),
  constraint armazem_v2_items_product_name_required check (length(product_name) between 1 and 160),
  constraint armazem_v2_items_variant_required check (length(variant_key) between 1 and 120),
  constraint armazem_v2_items_size_required check (length(size_key) between 1 and 120),
  constraint armazem_v2_items_quantity_positive check (quantity > 0),
  constraint armazem_v2_items_unit_price_nonnegative check (unit_price >= 0),
  constraint armazem_v2_items_subtotal_consistent check (line_subtotal = round(unit_price * quantity, 2)),
  constraint armazem_v2_items_details_object check (jsonb_typeof(details) in ('object', 'array', 'string', 'number', 'boolean', 'null')),
  constraint armazem_v2_items_unique_identity unique (order_number, item_id)
);

create table if not exists armazem_v2_private.idempotency_keys (
  idempotency_key text primary key,
  fingerprint text not null,
  order_number text not null references armazem_v2_private.orders(order_number) on delete restrict,
  created_at timestamptz not null default now(),
  constraint armazem_v2_idempotency_key_format check (idempotency_key ~ '^idempotency:v2:[a-f0-9]{64}$'),
  constraint armazem_v2_idempotency_fingerprint_format check (fingerprint ~ '^[a-f0-9]{64}$')
);

create table if not exists armazem_v2_private.outbox_events (
  event_id text primary key,
  event_type text not null,
  aggregate_type text not null default 'order',
  aggregate_id text not null references armazem_v2_private.orders(order_number) on delete restrict,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint armazem_v2_outbox_event_id_required check (length(event_id) between 1 and 160),
  constraint armazem_v2_outbox_event_type check (event_type = 'order.created.v2'),
  constraint armazem_v2_outbox_aggregate_type check (aggregate_type = 'order'),
  constraint armazem_v2_outbox_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint armazem_v2_outbox_status check (status in ('pending', 'delivered', 'dead_letter')),
  constraint armazem_v2_outbox_attempts_nonnegative check (attempts >= 0),
  constraint armazem_v2_outbox_delivery_consistent check (
    (status = 'delivered' and delivered_at is not null)
    or (status <> 'delivered')
  )
);

create index if not exists armazem_v2_orders_created_at_idx
  on armazem_v2_private.orders (created_at desc, order_number desc);
create index if not exists armazem_v2_orders_status_idx
  on armazem_v2_private.orders (status, created_at desc);
create index if not exists armazem_v2_items_drive_file_idx
  on armazem_v2_private.order_items (drive_file_id, product_key, variant_key, size_key);
create index if not exists armazem_v2_outbox_pending_idx
  on armazem_v2_private.outbox_events (available_at, created_at)
  where status = 'pending';

alter table armazem_v2_private.orders enable row level security;
alter table armazem_v2_private.orders force row level security;
alter table armazem_v2_private.order_customers enable row level security;
alter table armazem_v2_private.order_customers force row level security;
alter table armazem_v2_private.order_items enable row level security;
alter table armazem_v2_private.order_items force row level security;
alter table armazem_v2_private.idempotency_keys enable row level security;
alter table armazem_v2_private.idempotency_keys force row level security;
alter table armazem_v2_private.outbox_events enable row level security;
alter table armazem_v2_private.outbox_events force row level security;

revoke all on all tables in schema armazem_v2_private from public;
revoke all on all tables in schema armazem_v2_private from anon;
revoke all on all tables in schema armazem_v2_private from authenticated;
revoke all on all sequences in schema armazem_v2_private from public;
revoke all on all sequences in schema armazem_v2_private from anon;
revoke all on all sequences in schema armazem_v2_private from authenticated;

create or replace function public.armazem_v2_project_order_v1(p_projection jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $$
declare
  v_order jsonb;
  v_items jsonb;
  v_idempotency_key text;
  v_fingerprint text;
  v_order_number text;
  v_event_id text;
  v_event_created_at timestamptz;
  v_existing_idempotency armazem_v2_private.idempotency_keys%rowtype;
  v_existing_fingerprint text;
  v_item_count integer;
  v_calculated_qty integer;
  v_calculated_subtotal numeric(14,2);
  v_declared_subtotal numeric(14,2);
  v_declared_discount numeric(14,2);
  v_declared_total numeric(14,2);
  v_role text;
begin
  v_role := coalesce(current_setting('request.jwt.claim.role', true), '');
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  if p_projection is null or jsonb_typeof(p_projection) <> 'object' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_PROJECTION_OBJECT_REQUIRED';
  end if;

  if coalesce((p_projection ->> 'contractVersion')::integer, 0) <> 1 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CONTRACT_VERSION_INVALID';
  end if;

  v_order := p_projection -> 'order';
  v_items := v_order -> 'items';
  v_idempotency_key := lower(btrim(coalesce(p_projection ->> 'idempotencyKey', '')));
  v_fingerprint := lower(btrim(coalesce(p_projection ->> 'fingerprint', '')));
  v_order_number := upper(btrim(coalesce(v_order ->> 'orderNumber', '')));
  v_event_id := btrim(coalesce(p_projection ->> 'eventId', ''));
  v_event_created_at := coalesce((p_projection ->> 'eventCreatedAt')::timestamptz, (v_order ->> 'createdAt')::timestamptz);

  if v_order is null or jsonb_typeof(v_order) <> 'object' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ORDER_OBJECT_REQUIRED';
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ITEMS_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 200 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ITEMS_COUNT_INVALID';
  end if;
  if v_idempotency_key !~ '^idempotency:v2:[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_IDEMPOTENCY_KEY_INVALID';
  end if;
  if v_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_FINGERPRINT_INVALID';
  end if;
  if v_order_number !~ '^PED[0-9]{7}[A-Z]$' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ORDER_NUMBER_INVALID';
  end if;
  if length(v_event_id) < 1 or length(v_event_id) > 160 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_EVENT_ID_INVALID';
  end if;
  if coalesce(p_projection ->> 'eventType', '') <> 'order.created.v2' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_EVENT_TYPE_INVALID';
  end if;
  if coalesce((v_order ->> 'schemaVersion')::integer, 0) <> 2 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ORDER_SCHEMA_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));

  select *
    into v_existing_idempotency
    from armazem_v2_private.idempotency_keys
   where idempotency_key = v_idempotency_key;

  if found then
    if v_existing_idempotency.fingerprint <> v_fingerprint
       or v_existing_idempotency.order_number <> v_order_number then
      raise exception using errcode = '23505', message = 'ARMAZEM_V2_IDEMPOTENCY_KEY_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'action', 'REPLAY',
      'replayed', true,
      'orderNumber', v_existing_idempotency.order_number
    );
  end if;

  select fingerprint
    into v_existing_fingerprint
    from armazem_v2_private.orders
   where order_number = v_order_number;

  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'ARMAZEM_V2_ORDER_NUMBER_CONFLICT';
    end if;

    insert into armazem_v2_private.idempotency_keys (
      idempotency_key, fingerprint, order_number
    ) values (
      v_idempotency_key, v_fingerprint, v_order_number
    );

    return jsonb_build_object(
      'ok', true,
      'action', 'REPLAY',
      'replayed', true,
      'orderNumber', v_order_number
    );
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_items) as item
     where coalesce(item ->> 'itemId', '') = ''
        or coalesce(item ->> 'driveFileId', '') = ''
        or coalesce(item ->> 'code', '') = ''
        or coalesce(item ->> 'productKey', '') = ''
        or coalesce(item ->> 'variantKey', '') = ''
        or coalesce(item ->> 'sizeKey', '') = ''
        or coalesce(item ->> 'quantity', '') !~ '^[1-9][0-9]*$'
        or coalesce(item ->> 'unitPrice', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
        or coalesce(item ->> 'lineSubtotal', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
  ) then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ITEM_INVALID';
  end if;

  select count(*)::integer,
         sum((item ->> 'quantity')::integer)::integer,
         round(sum((item ->> 'lineSubtotal')::numeric), 2)
    into v_item_count, v_calculated_qty, v_calculated_subtotal
    from jsonb_array_elements(v_items) as item;

  if exists (
    select 1
      from jsonb_array_elements(v_items) as item
     where round((item ->> 'unitPrice')::numeric * (item ->> 'quantity')::integer, 2)
           <> (item ->> 'lineSubtotal')::numeric
  ) then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ITEM_SUBTOTAL_INVALID';
  end if;

  v_declared_subtotal := (v_order #>> '{pricing,subtotal}')::numeric;
  v_declared_discount := (v_order #>> '{pricing,discountAmount}')::numeric;
  v_declared_total := (v_order #>> '{pricing,total}')::numeric;

  if coalesce((v_order ->> 'qty')::integer, 0) <> v_calculated_qty then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ORDER_QTY_INVALID';
  end if;
  if coalesce((v_order #>> '{integrity,canonicalItemCount}')::integer, 0) <> v_item_count then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CANONICAL_ITEM_COUNT_INVALID';
  end if;
  if round(v_declared_subtotal, 2) <> v_calculated_subtotal then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ORDER_SUBTOTAL_INVALID';
  end if;
  if round(greatest(0::numeric, v_declared_subtotal - v_declared_discount), 2) <> round(v_declared_total, 2) then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ORDER_TOTAL_INVALID';
  end if;
  if coalesce(v_order #>> '{pricing,currency}', '') <> 'BRL' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_ORDER_CURRENCY_INVALID';
  end if;

  insert into armazem_v2_private.orders (
    order_number,
    order_code,
    display_id,
    schema_version,
    status,
    seller_id,
    seller_label,
    qty,
    currency,
    subtotal,
    discount_percent,
    discount_amount,
    total,
    calculation_version,
    catalog_version,
    config_version,
    product_registry_version,
    request_item_count,
    canonical_item_count,
    source,
    fingerprint,
    request_id,
    actor,
    created_at,
    updated_at
  ) values (
    v_order_number,
    coalesce(nullif(v_order ->> 'orderCode', ''), v_order_number),
    coalesce(nullif(v_order ->> 'displayId', ''), v_order_number),
    (v_order ->> 'schemaVersion')::smallint,
    coalesce(nullif(v_order ->> 'status', ''), 'Novo'),
    v_order #>> '{seller,id}',
    coalesce(v_order #>> '{seller,label}', ''),
    (v_order ->> 'qty')::integer,
    v_order #>> '{pricing,currency}',
    round(v_declared_subtotal, 2),
    round((v_order #>> '{pricing,discountPercent}')::numeric, 2),
    round(v_declared_discount, 2),
    round(v_declared_total, 2),
    (v_order #>> '{pricing,calculationVersion}')::integer,
    (v_order #>> '{integrity,catalogVersion}')::bigint,
    (v_order #>> '{integrity,configVersion}')::bigint,
    (v_order #>> '{integrity,productRegistryVersion}')::bigint,
    (v_order #>> '{integrity,requestItemCount}')::integer,
    (v_order #>> '{integrity,canonicalItemCount}')::integer,
    v_order ->> 'source',
    v_fingerprint,
    left(coalesce(p_projection ->> 'requestId', ''), 160),
    left(coalesce(p_projection ->> 'actor', 'catalog-v2'), 120),
    (v_order ->> 'createdAt')::timestamptz,
    (v_order ->> 'updatedAt')::timestamptz
  );

  insert into armazem_v2_private.order_customers (
    order_number,
    customer_name,
    customer_whatsapp,
    customer_phone
  ) values (
    v_order_number,
    left(coalesce(v_order #>> '{customer,name}', ''), 160),
    left(regexp_replace(coalesce(v_order #>> '{customer,whatsapp}', ''), '[^0-9]', '', 'g'), 20),
    left(regexp_replace(coalesce(v_order #>> '{customer,phone}', ''), '[^0-9]', '', 'g'), 20)
  );

  insert into armazem_v2_private.order_items (
    order_number,
    position,
    item_id,
    drive_file_id,
    code,
    original_name,
    theme,
    subtheme,
    product_key,
    product_name,
    variant_key,
    size_key,
    quantity,
    unit_price,
    line_subtotal,
    details
  )
  select
    v_order_number,
    ordinality::smallint,
    item ->> 'itemId',
    item ->> 'driveFileId',
    item ->> 'code',
    coalesce(item ->> 'originalName', ''),
    coalesce(item ->> 'theme', ''),
    coalesce(item ->> 'subtheme', ''),
    item ->> 'productKey',
    coalesce(nullif(item ->> 'productName', ''), item ->> 'productKey'),
    item ->> 'variantKey',
    item ->> 'sizeKey',
    (item ->> 'quantity')::integer,
    round((item ->> 'unitPrice')::numeric, 2),
    round((item ->> 'lineSubtotal')::numeric, 2),
    coalesce(item -> 'details', '{}'::jsonb)
  from jsonb_array_elements(v_items) with ordinality as expanded(item, ordinality);

  insert into armazem_v2_private.idempotency_keys (
    idempotency_key,
    fingerprint,
    order_number
  ) values (
    v_idempotency_key,
    v_fingerprint,
    v_order_number
  );

  insert into armazem_v2_private.outbox_events (
    event_id,
    event_type,
    aggregate_id,
    payload,
    created_at
  ) values (
    v_event_id,
    'order.created.v2',
    v_order_number,
    jsonb_build_object(
      'contractVersion', 1,
      'eventId', v_event_id,
      'eventType', 'order.created.v2',
      'order', v_order
    ),
    v_event_created_at
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'CREATED',
    'replayed', false,
    'orderNumber', v_order_number
  );
end;
$$;

create or replace function public.armazem_v2_list_orders_redacted_v1(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, armazem_v2_private
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_role text;
  v_orders jsonb;
begin
  v_role := coalesce(current_setting('request.jwt.claim.role', true), '');
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  select coalesce(jsonb_agg(row_payload order by created_at desc, order_number desc), '[]'::jsonb)
    into v_orders
    from (
      select
        o.created_at,
        o.order_number,
        jsonb_build_object(
          'schemaVersion', o.schema_version,
          'orderNumber', o.order_number,
          'orderCode', o.order_code,
          'displayId', o.display_id,
          'status', o.status,
          'seller', jsonb_build_object('id', o.seller_id, 'label', o.seller_label),
          'customer', jsonb_build_object('redacted', true),
          'qty', o.qty,
          'pricing', jsonb_build_object(
            'currency', o.currency,
            'subtotal', o.subtotal,
            'discountPercent', o.discount_percent,
            'discountAmount', o.discount_amount,
            'total', o.total,
            'calculationVersion', o.calculation_version
          ),
          'integrity', jsonb_build_object(
            'catalogVersion', o.catalog_version,
            'configVersion', o.config_version,
            'productRegistryVersion', o.product_registry_version,
            'requestItemCount', o.request_item_count,
            'canonicalItemCount', o.canonical_item_count
          ),
          'source', o.source,
          'createdAt', o.created_at,
          'updatedAt', o.updated_at,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'position', i.position,
              'itemId', i.item_id,
              'driveFileId', i.drive_file_id,
              'code', i.code,
              'originalName', i.original_name,
              'theme', i.theme,
              'subtheme', i.subtheme,
              'productKey', i.product_key,
              'productName', i.product_name,
              'variantKey', i.variant_key,
              'sizeKey', i.size_key,
              'quantity', i.quantity,
              'unitPrice', i.unit_price,
              'lineSubtotal', i.line_subtotal,
              'details', i.details
            ) order by i.position)
            from armazem_v2_private.order_items i
            where i.order_number = o.order_number
          ), '[]'::jsonb)
        ) as row_payload
      from armazem_v2_private.orders o
      order by o.created_at desc, o.order_number desc
      limit v_limit
    ) selected_orders;

  return jsonb_build_object(
    'ok', true,
    'readOnly', true,
    'customerData', 'redacted',
    'orders', v_orders
  );
end;
$$;

create or replace function public.armazem_v2_projection_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, armazem_v2_private
as $$
declare
  v_role text;
  v_order_count bigint;
  v_item_count bigint;
  v_pending_count bigint;
begin
  v_role := coalesce(current_setting('request.jwt.claim.role', true), '');
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  select count(*) into v_order_count from armazem_v2_private.orders;
  select count(*) into v_item_count from armazem_v2_private.order_items;
  select count(*) into v_pending_count from armazem_v2_private.outbox_events where status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'schemaVersion', 1,
    'orders', v_order_count,
    'items', v_item_count,
    'pendingOutbox', v_pending_count
  );
end;
$$;

revoke all on function public.armazem_v2_project_order_v1(jsonb) from public;
revoke all on function public.armazem_v2_project_order_v1(jsonb) from anon;
revoke all on function public.armazem_v2_project_order_v1(jsonb) from authenticated;
grant execute on function public.armazem_v2_project_order_v1(jsonb) to service_role;

revoke all on function public.armazem_v2_list_orders_redacted_v1(integer) from public;
revoke all on function public.armazem_v2_list_orders_redacted_v1(integer) from anon;
revoke all on function public.armazem_v2_list_orders_redacted_v1(integer) from authenticated;
grant execute on function public.armazem_v2_list_orders_redacted_v1(integer) to service_role;

revoke all on function public.armazem_v2_projection_health_v1() from public;
revoke all on function public.armazem_v2_projection_health_v1() from anon;
revoke all on function public.armazem_v2_projection_health_v1() from authenticated;
grant execute on function public.armazem_v2_projection_health_v1() to service_role;

comment on schema armazem_v2_private is 'Dados internos da projeção Armazem V2. Não expor diretamente pelo PostgREST.';
comment on function public.armazem_v2_project_order_v1(jsonb) is 'Projeção transacional e idempotente de pedidos V2, restrita ao service_role.';
comment on function public.armazem_v2_list_orders_redacted_v1(integer) is 'Leitura administrativa sem dados pessoais, restrita ao service_role.';

commit;
