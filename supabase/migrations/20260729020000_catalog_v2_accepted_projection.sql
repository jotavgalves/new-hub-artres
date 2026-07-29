create schema if not exists armazem_v2_private;

create table if not exists armazem_v2_private.catalog_versions (
  catalog_version bigint primary key check (catalog_version > 0),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('staging', 'accepted', 'archived', 'rejected')),
  expected_route_count integer not null check (expected_route_count >= 1),
  expected_folder_count integer not null check (expected_folder_count >= 1),
  expected_item_count integer not null check (expected_item_count >= 1),
  loaded_route_count integer not null default 0 check (loaded_route_count >= 0),
  loaded_folder_count integer not null default 0 check (loaded_folder_count >= 0),
  loaded_item_count integer not null default 0 check (loaded_item_count >= 0),
  rejection_count integer not null default 0 check (rejection_count >= 0),
  difference_count integer not null default 0 check (difference_count >= 0),
  traversal_complete boolean not null default false,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists armazem_v2_private.catalog_routes (
  catalog_version bigint not null references armazem_v2_private.catalog_versions(catalog_version) on delete cascade,
  route_key text not null check (length(route_key) between 1 and 900),
  mode text not null check (mode in ('themes', 'products', 'items')),
  folder_id text not null default '',
  product_key text not null default '',
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_bytes integer not null check (payload_bytes >= 2 and payload_bytes <= 8388608),
  created_at timestamptz not null default now(),
  primary key (catalog_version, route_key)
);

create table if not exists armazem_v2_private.catalog_search_folders (
  catalog_version bigint not null references armazem_v2_private.catalog_versions(catalog_version) on delete cascade,
  drive_id text not null check (length(drive_id) between 1 and 500),
  parent_id text not null default '',
  name text not null default '',
  path text not null default '',
  theme text not null default '',
  depth integer not null default 0 check (depth >= 0),
  search_text text not null default '',
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (catalog_version, drive_id)
);

create table if not exists armazem_v2_private.catalog_search_items (
  catalog_version bigint not null references armazem_v2_private.catalog_versions(catalog_version) on delete cascade,
  drive_file_id text not null check (length(drive_file_id) between 1 and 500),
  parent_folder_id text not null default '',
  code text not null default '',
  sort_id bigint not null default 0,
  theme text not null default '',
  subtheme text not null default '',
  product_key text not null default '',
  original_name text not null default '',
  search_text text not null default '',
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (catalog_version, drive_file_id)
);

create table if not exists armazem_v2_private.catalog_state (
  singleton boolean primary key default true check (singleton),
  accepted_version bigint references armazem_v2_private.catalog_versions(catalog_version),
  accepted_fingerprint text not null default '',
  accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into armazem_v2_private.catalog_state(singleton)
values (true)
on conflict (singleton) do nothing;

create index if not exists catalog_routes_lookup_idx
  on armazem_v2_private.catalog_routes(catalog_version, mode, folder_id, product_key);
create index if not exists catalog_search_folders_lookup_idx
  on armazem_v2_private.catalog_search_folders(catalog_version, parent_id, depth);
create index if not exists catalog_search_items_parent_idx
  on armazem_v2_private.catalog_search_items(catalog_version, parent_folder_id);
create index if not exists catalog_search_items_code_idx
  on armazem_v2_private.catalog_search_items(catalog_version, code);

alter table armazem_v2_private.catalog_versions enable row level security;
alter table armazem_v2_private.catalog_routes enable row level security;
alter table armazem_v2_private.catalog_search_folders enable row level security;
alter table armazem_v2_private.catalog_search_items enable row level security;
alter table armazem_v2_private.catalog_state enable row level security;

revoke all on armazem_v2_private.catalog_versions from public, anon, authenticated;
revoke all on armazem_v2_private.catalog_routes from public, anon, authenticated;
revoke all on armazem_v2_private.catalog_search_folders from public, anon, authenticated;
revoke all on armazem_v2_private.catalog_search_items from public, anon, authenticated;
revoke all on armazem_v2_private.catalog_state from public, anon, authenticated;

create or replace function public.armazem_v2_catalog_begin_v1(p_manifest jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_fingerprint text;
  v_routes integer;
  v_folders integer;
  v_items integer;
  v_existing armazem_v2_private.catalog_versions%rowtype;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_MANIFEST_REQUIRED';
  end if;
  if coalesce((p_manifest ->> 'contractVersion')::integer, 0) <> 1 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_CONTRACT_INVALID';
  end if;

  v_version := coalesce((p_manifest ->> 'catalogVersion')::bigint, 0);
  v_fingerprint := lower(btrim(coalesce(p_manifest ->> 'fingerprint', '')));
  v_routes := coalesce((p_manifest ->> 'routeCount')::integer, 0);
  v_folders := coalesce((p_manifest ->> 'folderCount')::integer, 0);
  v_items := coalesce((p_manifest ->> 'itemCount')::integer, 0);

  if v_version <= 0 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_VERSION_INVALID';
  end if;
  if v_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_FINGERPRINT_INVALID';
  end if;
  if v_routes < 1 or v_routes > 5000 or v_folders < 1 or v_folders > 10000 or v_items < 1 or v_items > 250000 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_COUNTS_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('armazem-v2-catalog:' || v_version::text, 0));

  select * into v_existing
    from armazem_v2_private.catalog_versions
   where catalog_version = v_version;

  if found and v_existing.status = 'accepted' then
    if v_existing.fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'ARMAZEM_V2_CATALOG_VERSION_FINGERPRINT_CONFLICT';
    end if;
    return jsonb_build_object('ok', true, 'action', 'REPLAY', 'catalogVersion', v_version);
  end if;

  delete from armazem_v2_private.catalog_versions where catalog_version = v_version;
  insert into armazem_v2_private.catalog_versions(
    catalog_version, fingerprint, status,
    expected_route_count, expected_folder_count, expected_item_count
  ) values (
    v_version, v_fingerprint, 'staging', v_routes, v_folders, v_items
  );

  return jsonb_build_object('ok', true, 'action', 'STARTED', 'catalogVersion', v_version);
end;
$function$;

create or replace function public.armazem_v2_catalog_load_batch_v1(
  p_catalog_version bigint,
  p_kind text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_count integer;
  v_status text;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;
  if p_catalog_version <= 0 or p_kind not in ('routes', 'folders', 'items') then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_BATCH_INVALID';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_BATCH_ROWS_REQUIRED';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 250 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_BATCH_SIZE_INVALID';
  end if;

  select status into v_status
    from armazem_v2_private.catalog_versions
   where catalog_version = p_catalog_version
   for update;
  if not found or v_status <> 'staging' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_VERSION_NOT_STAGING';
  end if;

  if p_kind = 'routes' then
    insert into armazem_v2_private.catalog_routes(
      catalog_version, route_key, mode, folder_id, product_key, payload, payload_bytes
    )
    select
      p_catalog_version,
      btrim(row ->> 'routeKey'),
      btrim(row ->> 'mode'),
      btrim(coalesce(row ->> 'folderId', '')),
      btrim(coalesce(row ->> 'productKey', '')),
      row -> 'payload',
      coalesce((row ->> 'payloadBytes')::integer, 0)
    from jsonb_array_elements(p_rows) as expanded(row)
    on conflict (catalog_version, route_key) do update set
      mode = excluded.mode,
      folder_id = excluded.folder_id,
      product_key = excluded.product_key,
      payload = excluded.payload,
      payload_bytes = excluded.payload_bytes;
  elsif p_kind = 'folders' then
    insert into armazem_v2_private.catalog_search_folders(
      catalog_version, drive_id, parent_id, name, path, theme, depth, search_text, payload
    )
    select
      p_catalog_version,
      btrim(row ->> 'driveId'),
      btrim(coalesce(row ->> 'parentId', '')),
      left(coalesce(row ->> 'name', ''), 500),
      left(coalesce(row ->> 'path', ''), 2000),
      left(coalesce(row ->> 'theme', ''), 500),
      greatest(coalesce((row ->> 'depth')::integer, 0), 0),
      left(coalesce(row ->> 'searchText', ''), 4000),
      row -> 'payload'
    from jsonb_array_elements(p_rows) as expanded(row)
    on conflict (catalog_version, drive_id) do update set
      parent_id = excluded.parent_id,
      name = excluded.name,
      path = excluded.path,
      theme = excluded.theme,
      depth = excluded.depth,
      search_text = excluded.search_text,
      payload = excluded.payload;
  else
    insert into armazem_v2_private.catalog_search_items(
      catalog_version, drive_file_id, parent_folder_id, code, sort_id,
      theme, subtheme, product_key, original_name, search_text, payload
    )
    select
      p_catalog_version,
      btrim(row ->> 'driveFileId'),
      btrim(coalesce(row ->> 'parentFolderId', '')),
      left(coalesce(row ->> 'code', ''), 100),
      coalesce((row ->> 'sortId')::bigint, 0),
      left(coalesce(row ->> 'theme', ''), 500),
      left(coalesce(row ->> 'subtheme', ''), 500),
      left(coalesce(row ->> 'productKey', ''), 160),
      left(coalesce(row ->> 'originalName', ''), 1000),
      left(coalesce(row ->> 'searchText', ''), 4000),
      row -> 'payload'
    from jsonb_array_elements(p_rows) as expanded(row)
    on conflict (catalog_version, drive_file_id) do update set
      parent_folder_id = excluded.parent_folder_id,
      code = excluded.code,
      sort_id = excluded.sort_id,
      theme = excluded.theme,
      subtheme = excluded.subtheme,
      product_key = excluded.product_key,
      original_name = excluded.original_name,
      search_text = excluded.search_text,
      payload = excluded.payload;
  end if;

  update armazem_v2_private.catalog_versions set
    loaded_route_count = (select count(*) from armazem_v2_private.catalog_routes where catalog_version = p_catalog_version),
    loaded_folder_count = (select count(*) from armazem_v2_private.catalog_search_folders where catalog_version = p_catalog_version),
    loaded_item_count = (select count(*) from armazem_v2_private.catalog_search_items where catalog_version = p_catalog_version),
    updated_at = now()
  where catalog_version = p_catalog_version;

  return jsonb_build_object('ok', true, 'loaded', v_count, 'kind', p_kind, 'catalogVersion', p_catalog_version);
end;
$function$;

create or replace function public.armazem_v2_catalog_accept_v1(p_manifest jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_fingerprint text;
  v_rejections integer;
  v_differences integer;
  v_complete boolean;
  v_row armazem_v2_private.catalog_versions%rowtype;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  v_version := coalesce((p_manifest ->> 'catalogVersion')::bigint, 0);
  v_fingerprint := lower(btrim(coalesce(p_manifest ->> 'fingerprint', '')));
  v_rejections := coalesce((p_manifest ->> 'rejectionCount')::integer, -1);
  v_differences := coalesce((p_manifest ->> 'differenceCount')::integer, -1);
  v_complete := coalesce((p_manifest ->> 'traversalComplete')::boolean, false);

  perform pg_advisory_xact_lock(hashtextextended('armazem-v2-catalog-accept', 0));
  select * into v_row
    from armazem_v2_private.catalog_versions
   where catalog_version = v_version
   for update;

  if not found or v_row.status <> 'staging' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_VERSION_NOT_STAGING';
  end if;
  if v_row.fingerprint <> v_fingerprint then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_FINGERPRINT_MISMATCH';
  end if;
  if v_rejections <> 0 or v_differences <> 0 or not v_complete then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_VALIDATION_FAILED';
  end if;
  if v_row.loaded_route_count <> v_row.expected_route_count
     or v_row.loaded_folder_count <> v_row.expected_folder_count
     or v_row.loaded_item_count <> v_row.expected_item_count then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_LOADED_COUNTS_MISMATCH';
  end if;

  update armazem_v2_private.catalog_versions
     set status = 'archived', updated_at = now()
   where status = 'accepted' and catalog_version <> v_version;

  update armazem_v2_private.catalog_versions
     set status = 'accepted', rejection_count = 0, difference_count = 0,
         traversal_complete = true, accepted_at = now(), updated_at = now()
   where catalog_version = v_version;

  insert into armazem_v2_private.catalog_state(
    singleton, accepted_version, accepted_fingerprint, accepted_at, updated_at
  ) values (
    true, v_version, v_fingerprint, now(), now()
  ) on conflict (singleton) do update set
    accepted_version = excluded.accepted_version,
    accepted_fingerprint = excluded.accepted_fingerprint,
    accepted_at = excluded.accepted_at,
    updated_at = excluded.updated_at;

  delete from armazem_v2_private.catalog_versions
   where status in ('staging', 'rejected') and created_at < now() - interval '7 days';

  return jsonb_build_object(
    'ok', true,
    'action', 'ACCEPTED',
    'catalogVersion', v_version,
    'routeCount', v_row.loaded_route_count,
    'folderCount', v_row.loaded_folder_count,
    'itemCount', v_row.loaded_item_count
  );
end;
$function$;

create or replace function public.armazem_v2_catalog_status_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_state armazem_v2_private.catalog_state%rowtype;
  v_version armazem_v2_private.catalog_versions%rowtype;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  select * into v_state from armazem_v2_private.catalog_state where singleton = true;
  if v_state.accepted_version is null then
    return jsonb_build_object('ok', true, 'configured', false);
  end if;
  select * into v_version from armazem_v2_private.catalog_versions where catalog_version = v_state.accepted_version;

  return jsonb_build_object(
    'ok', true,
    'configured', true,
    'catalogVersion', v_state.accepted_version,
    'fingerprint', v_state.accepted_fingerprint,
    'acceptedAt', v_state.accepted_at,
    'routeCount', v_version.loaded_route_count,
    'folderCount', v_version.loaded_folder_count,
    'itemCount', v_version.loaded_item_count,
    'traversalComplete', v_version.traversal_complete,
    'rejectionCount', v_version.rejection_count,
    'differenceCount', v_version.difference_count
  );
end;
$function$;

create or replace function public.armazem_v2_catalog_route_v1(
  p_mode text,
  p_folder_id text default '',
  p_product_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_key text;
  v_payload jsonb;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;
  select accepted_version into v_version from armazem_v2_private.catalog_state where singleton = true;
  if v_version is null then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_NOT_ACCEPTED';
  end if;

  if p_mode = 'themes' then
    v_key := 'themes';
  elsif p_mode = 'products' then
    v_key := 'products:' || btrim(coalesce(p_folder_id, ''));
  elsif p_mode = 'items' then
    v_key := 'items:' || btrim(coalesce(p_folder_id, '')) || ':' || btrim(coalesce(p_product_key, ''));
  else
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_MODE_INVALID';
  end if;

  select payload into v_payload
    from armazem_v2_private.catalog_routes
   where catalog_version = v_version and route_key = v_key;
  if not found then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_ROUTE_NOT_FOUND';
  end if;
  return v_payload;
end;
$function$;

create or replace function public.armazem_v2_catalog_search_v1(
  p_mode text,
  p_query text,
  p_limit integer default 80
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_query text;
  v_limit integer;
  v_items jsonb;
  v_folders jsonb;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;
  if p_mode not in ('search', 'globalSearch', 'folderSearch') then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_MODE_INVALID';
  end if;
  select accepted_version into v_version from armazem_v2_private.catalog_state where singleton = true;
  if v_version is null then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_NOT_ACCEPTED';
  end if;

  v_query := left(lower(btrim(coalesce(p_query, ''))), 120);
  v_limit := least(greatest(coalesce(p_limit, 80), 1), 120);

  select coalesce(jsonb_agg(payload order by sort_id desc), '[]'::jsonb)
    into v_items
    from (
      select payload, sort_id
        from armazem_v2_private.catalog_search_items
       where catalog_version = v_version
         and (search_text like '%' || v_query || '%' or lower(code) = regexp_replace(v_query, '[^0-9]', '', 'g'))
       order by case when lower(code) = regexp_replace(v_query, '[^0-9]', '', 'g') then 0 else 1 end, sort_id desc
       limit v_limit
    ) ranked_items;

  select coalesce(jsonb_agg(payload order by path, name), '[]'::jsonb)
    into v_folders
    from (
      select payload, path, name
        from armazem_v2_private.catalog_search_folders
       where catalog_version = v_version and search_text like '%' || v_query || '%'
       order by path, name
       limit least(v_limit, 60)
    ) ranked_folders;

  if p_mode = 'search' then
    return jsonb_build_object('ok', true, 'mode', p_mode, 'source', 'catalog_v2_accepted', 'total', jsonb_array_length(v_items), 'items', v_items);
  elsif p_mode = 'folderSearch' then
    return jsonb_build_object('ok', true, 'mode', p_mode, 'source', 'catalog_v2_accepted', 'total', jsonb_array_length(v_folders), 'results', v_folders);
  end if;
  return jsonb_build_object(
    'ok', true, 'mode', p_mode, 'source', 'catalog_v2_accepted',
    'totalFolders', jsonb_array_length(v_folders), 'totalItems', jsonb_array_length(v_items),
    'folders', v_folders, 'items', v_items
  );
end;
$function$;

revoke all on function public.armazem_v2_catalog_begin_v1(jsonb) from public, anon, authenticated;
revoke all on function public.armazem_v2_catalog_load_batch_v1(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.armazem_v2_catalog_accept_v1(jsonb) from public, anon, authenticated;
revoke all on function public.armazem_v2_catalog_status_v1() from public, anon, authenticated;
revoke all on function public.armazem_v2_catalog_route_v1(text, text, text) from public, anon, authenticated;
revoke all on function public.armazem_v2_catalog_search_v1(text, text, integer) from public, anon, authenticated;

grant execute on function public.armazem_v2_catalog_begin_v1(jsonb) to service_role;
grant execute on function public.armazem_v2_catalog_load_batch_v1(bigint, text, jsonb) to service_role;
grant execute on function public.armazem_v2_catalog_accept_v1(jsonb) to service_role;
grant execute on function public.armazem_v2_catalog_status_v1() to service_role;
grant execute on function public.armazem_v2_catalog_route_v1(text, text, text) to service_role;
grant execute on function public.armazem_v2_catalog_search_v1(text, text, integer) to service_role;
