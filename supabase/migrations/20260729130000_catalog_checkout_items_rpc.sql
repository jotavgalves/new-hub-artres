create or replace function public.armazem_v2_catalog_checkout_items_v1(
  p_drive_file_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_requested_count integer;
  v_ids text[];
  v_items jsonb;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  v_requested_count := coalesce(cardinality(p_drive_file_ids), 0);
  if v_requested_count < 1 or v_requested_count > 200 then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CHECKOUT_ITEMS_COUNT_INVALID';
  end if;

  if exists (
    select 1
      from unnest(p_drive_file_ids) as supplied(drive_file_id)
     where drive_file_id is null
        or length(btrim(drive_file_id)) < 1
        or length(btrim(drive_file_id)) > 500
  ) then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CHECKOUT_DRIVE_FILE_ID_INVALID';
  end if;

  select array_agg(drive_file_id order by first_ordinal)
    into v_ids
    from (
      select btrim(supplied.drive_file_id) as drive_file_id,
             min(supplied.ordinality) as first_ordinal
        from unnest(p_drive_file_ids) with ordinality as supplied(drive_file_id, ordinality)
       group by btrim(supplied.drive_file_id)
    ) normalized;

  select accepted_version
    into v_version
    from armazem_v2_private.catalog_state
   where singleton = true;

  if v_version is null then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_NOT_ACCEPTED';
  end if;

  select coalesce(
    jsonb_agg(
      item.payload || jsonb_build_object(
        'id', item.drive_file_id,
        'driveFileId', item.drive_file_id,
        'code', item.code,
        'originalName', item.original_name,
        'theme', item.theme,
        'subtheme', item.subtheme,
        'product', item.product_key,
        'productKey', item.product_key,
        'productName', coalesce(
          nullif(item.payload ->> 'productName', ''),
          nullif(item.payload ->> 'productLabel', ''),
          item.product_key
        ),
        'size', coalesce(
          nullif(item.payload ->> 'size', ''),
          nullif(item.payload ->> 'sizeKey', ''),
          'default'
        ),
        'sizeKey', coalesce(
          nullif(item.payload ->> 'sizeKey', ''),
          nullif(item.payload ->> 'size', ''),
          'default'
        )
      )
      order by array_position(v_ids, item.drive_file_id)
    ),
    '[]'::jsonb
  )
    into v_items
    from armazem_v2_private.catalog_search_items item
   where item.catalog_version = v_version
     and item.drive_file_id = any(v_ids);

  return jsonb_build_object(
    'ok', true,
    'source', 'catalog_v2_accepted',
    'catalogVersion', v_version,
    'requestedCount', v_requested_count,
    'requestedUniqueCount', cardinality(v_ids),
    'resolvedCount', jsonb_array_length(v_items),
    'items', v_items
  );
end;
$function$;

revoke all on function public.armazem_v2_catalog_checkout_items_v1(text[])
  from public, anon, authenticated;
grant execute on function public.armazem_v2_catalog_checkout_items_v1(text[])
  to service_role;
