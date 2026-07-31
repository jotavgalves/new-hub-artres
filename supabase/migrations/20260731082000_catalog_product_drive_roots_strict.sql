create or replace function public.armazem_v2_catalog_route_v1(
  p_mode text,
  p_folder_id text default '',
  p_product_key text default ''
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_root constant text := '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';
  v_folder text;
  v_product text;
  v_theme text;
  v_payload jsonb;
  v_folders jsonb;
  v_items jsonb;
  v_inside_scope boolean;
  v_has_items boolean;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  v_folder := btrim(coalesce(p_folder_id, ''));
  v_product := btrim(coalesce(p_product_key, ''));
  if v_product <> '50x50' then
    raise exception using errcode = '22023', message = 'CATALOG_BOLINHAS_SCOPE_INVALID';
  end if;

  select accepted_version
    into v_version
    from armazem_v2_private.catalog_state
   where singleton = true;
  if v_version is null then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_NOT_ACCEPTED';
  end if;

  if p_mode = 'themes' then
    select jsonb_build_object(
      'ok', true,
      'mode', 'themes',
      'source', 'catalog_v2_accepted',
      'scope', 'bolinhas-drive-root',
      'rootDriveId', v_root,
      'total', count(*),
      'folders', coalesce(
        jsonb_agg(
          folder.payload || jsonb_build_object(
            'id', folder.drive_id,
            'parentId', folder.parent_id,
            'product', '50x50',
            'productKey', '50x50',
            'productName', 'Bolinhas 50x50',
            'catalogRootDriveId', v_root,
            'rootVerified', true
          )
          order by folder.path, folder.name
        ),
        '[]'::jsonb
      )
    )
      into v_payload
      from armazem_v2_private.catalog_search_folders folder
     where folder.catalog_version = v_version
       and folder.parent_id = v_root;
    return v_payload;
  end if;

  if p_mode not in ('products', 'items') or v_folder = '' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_MODE_INVALID';
  end if;

  if p_mode = 'items' and v_folder like 'catalog-bolinhas-product:%' then
    v_folder := substring(v_folder from length('catalog-bolinhas-product:') + 1);
  end if;

  with recursive scoped_folders(drive_id) as (
    select folder.drive_id
      from armazem_v2_private.catalog_search_folders folder
     where folder.catalog_version = v_version
       and folder.parent_id = v_root
    union
    select child.drive_id
      from armazem_v2_private.catalog_search_folders child
      join scoped_folders scoped on child.parent_id = scoped.drive_id
     where child.catalog_version = v_version
  )
  select exists(select 1 from scoped_folders where drive_id = v_folder)
    into v_inside_scope;

  if not v_inside_scope then
    raise exception using errcode = '22023', message = 'CATALOG_BOLINHAS_FOLDER_OUTSIDE_ROOT';
  end if;

  select coalesce(nullif(folder.theme, ''), nullif(folder.name, ''), 'Bolinhas 50x50')
    into v_theme
    from armazem_v2_private.catalog_search_folders folder
   where folder.catalog_version = v_version
     and folder.drive_id = v_folder;

  if p_mode = 'products' then
    select coalesce(
      jsonb_agg(
        child.payload || jsonb_build_object(
          'id', child.drive_id,
          'parentId', child.parent_id,
          'product', '50x50',
          'productKey', '50x50',
          'productName', 'Bolinhas 50x50',
          'catalogRootDriveId', v_root,
          'rootVerified', true
        )
        order by child.path, child.name
      ),
      '[]'::jsonb
    )
      into v_folders
      from armazem_v2_private.catalog_search_folders child
     where child.catalog_version = v_version
       and child.parent_id = v_folder;

    select exists(
      select 1
        from armazem_v2_private.catalog_search_items item
       where item.catalog_version = v_version
         and item.parent_folder_id = v_folder
    )
      into v_has_items;

    if v_has_items then
      v_folders := v_folders || jsonb_build_array(
        jsonb_build_object(
          'id', 'catalog-bolinhas-product:' || v_folder,
          'name', 'Bolinhas 50x50',
          'rawName', 'Bolinhas 50x50',
          'label', 'Bolinhas 50x50',
          'kind', 'product',
          'type', 'product',
          'product', '50x50',
          'productKey', '50x50',
          'productName', 'Bolinhas 50x50',
          'theme', coalesce(v_theme, 'Bolinhas 50x50'),
          'productFolderId', v_folder,
          'directItems', true,
          'catalogRootDriveId', v_root,
          'rootVerified', true
        )
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'mode', 'products',
      'source', 'catalog_v2_accepted',
      'scope', 'bolinhas-drive-root',
      'rootDriveId', v_root,
      'theme', coalesce(v_theme, ''),
      'folders', v_folders
    );
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
        'product', '50x50',
        'productKey', '50x50',
        'productName', 'Bolinhas 50x50',
        'productLabel', 'Bolinhas 50x50',
        'productFolderId', item.parent_folder_id,
        'catalogRootDriveId', v_root,
        'rootVerified', true,
        'size', '50X50',
        'sizeKey', '50X50',
        'details', coalesce(item.payload -> 'details', '{}'::jsonb)
          || jsonb_build_object('size', '50X50')
      )
      order by item.sort_id desc
    ),
    '[]'::jsonb
  )
    into v_items
    from armazem_v2_private.catalog_search_items item
   where item.catalog_version = v_version
     and item.parent_folder_id = v_folder;

  return jsonb_build_object(
    'ok', true,
    'mode', 'items',
    'source', 'catalog_v2_accepted',
    'scope', 'bolinhas-drive-root',
    'rootDriveId', v_root,
    'theme', coalesce(v_theme, ''),
    'product', '50x50',
    'productName', 'Bolinhas 50x50',
    'total', jsonb_array_length(v_items),
    'items', v_items
  );
end;
$function$;

create or replace function public.armazem_v2_catalog_search_v1(
  p_mode text,
  p_query text,
  p_limit integer default 80
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_root constant text := '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';
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

  select accepted_version
    into v_version
    from armazem_v2_private.catalog_state
   where singleton = true;
  if v_version is null then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_NOT_ACCEPTED';
  end if;

  v_query := left(lower(btrim(coalesce(p_query, ''))), 120);
  v_limit := least(greatest(coalesce(p_limit, 80), 1), 120);

  with recursive scoped_folders(drive_id) as (
    select folder.drive_id
      from armazem_v2_private.catalog_search_folders folder
     where folder.catalog_version = v_version
       and folder.parent_id = v_root
    union
    select child.drive_id
      from armazem_v2_private.catalog_search_folders child
      join scoped_folders scoped on child.parent_id = scoped.drive_id
     where child.catalog_version = v_version
  )
  select coalesce(
    jsonb_agg(
      ranked.payload || jsonb_build_object(
        'id', ranked.drive_file_id,
        'driveFileId', ranked.drive_file_id,
        'product', '50x50',
        'productKey', '50x50',
        'productName', 'Bolinhas 50x50',
        'productLabel', 'Bolinhas 50x50',
        'productFolderId', ranked.parent_folder_id,
        'catalogRootDriveId', v_root,
        'rootVerified', true,
        'size', '50X50',
        'sizeKey', '50X50',
        'details', coalesce(ranked.payload -> 'details', '{}'::jsonb)
          || jsonb_build_object('size', '50X50')
      )
      order by ranked.sort_id desc
    ),
    '[]'::jsonb
  )
    into v_items
    from (
      select item.payload, item.drive_file_id, item.parent_folder_id, item.sort_id
        from armazem_v2_private.catalog_search_items item
        join scoped_folders scoped on scoped.drive_id = item.parent_folder_id
       where item.catalog_version = v_version
         and (
           item.search_text like '%' || v_query || '%'
           or lower(item.code) = regexp_replace(v_query, '[^0-9]', '', 'g')
         )
       order by
         case when lower(item.code) = regexp_replace(v_query, '[^0-9]', '', 'g') then 0 else 1 end,
         item.sort_id desc
       limit v_limit
    ) ranked;

  with recursive scoped_folders(drive_id) as (
    select folder.drive_id
      from armazem_v2_private.catalog_search_folders folder
     where folder.catalog_version = v_version
       and folder.parent_id = v_root
    union
    select child.drive_id
      from armazem_v2_private.catalog_search_folders child
      join scoped_folders scoped on child.parent_id = scoped.drive_id
     where child.catalog_version = v_version
  )
  select coalesce(
    jsonb_agg(
      ranked.payload || jsonb_build_object(
        'id', ranked.drive_id,
        'parentId', ranked.parent_id,
        'product', '50x50',
        'productKey', '50x50',
        'productName', 'Bolinhas 50x50',
        'catalogRootDriveId', v_root,
        'rootVerified', true
      )
      order by ranked.path, ranked.name
    ),
    '[]'::jsonb
  )
    into v_folders
    from (
      select folder.payload, folder.drive_id, folder.parent_id, folder.path, folder.name
        from armazem_v2_private.catalog_search_folders folder
        join scoped_folders scoped on scoped.drive_id = folder.drive_id
       where folder.catalog_version = v_version
         and folder.search_text like '%' || v_query || '%'
       order by folder.path, folder.name
       limit least(v_limit, 60)
    ) ranked;

  if p_mode = 'search' then
    return jsonb_build_object(
      'ok', true,
      'mode', p_mode,
      'source', 'catalog_v2_accepted',
      'scope', 'bolinhas-drive-root',
      'rootDriveId', v_root,
      'total', jsonb_array_length(v_items),
      'items', v_items
    );
  elsif p_mode = 'folderSearch' then
    return jsonb_build_object(
      'ok', true,
      'mode', p_mode,
      'source', 'catalog_v2_accepted',
      'scope', 'bolinhas-drive-root',
      'rootDriveId', v_root,
      'total', jsonb_array_length(v_folders),
      'results', v_folders
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', p_mode,
    'source', 'catalog_v2_accepted',
    'scope', 'bolinhas-drive-root',
    'rootDriveId', v_root,
    'totalFolders', jsonb_array_length(v_folders),
    'totalItems', jsonb_array_length(v_items),
    'folders', v_folders,
    'items', v_items
  );
end;
$function$;

create or replace function public.armazem_v2_catalog_checkout_items_v1(
  p_drive_file_ids text[]
) returns jsonb
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

  with recursive
  bolinhas_folders(drive_id) as (
    select folder.drive_id
      from armazem_v2_private.catalog_search_folders folder
     where folder.catalog_version = v_version
       and folder.parent_id = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae'
    union
    select child.drive_id
      from armazem_v2_private.catalog_search_folders child
      join bolinhas_folders scoped on child.parent_id = scoped.drive_id
     where child.catalog_version = v_version
  ),
  panel_folders(drive_id) as (
    select folder.drive_id
      from armazem_v2_private.catalog_search_folders folder
     where folder.catalog_version = v_version
       and folder.parent_id = '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
    union
    select child.drive_id
      from armazem_v2_private.catalog_search_folders child
      join panel_folders scoped on child.parent_id = scoped.drive_id
     where child.catalog_version = v_version
  ),
  classified as (
    select
      item.*,
      case
        when bolinhas.drive_id is not null and panel.drive_id is null then '50x50'
        when panel.drive_id is not null and bolinhas.drive_id is null then 'painel-150'
        else null
      end as canonical_product_key,
      case
        when bolinhas.drive_id is not null and panel.drive_id is null then 'Bolinhas 50x50'
        when panel.drive_id is not null and bolinhas.drive_id is null then 'Painel 150 cm'
        else null
      end as canonical_product_name,
      case
        when bolinhas.drive_id is not null and panel.drive_id is null then '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae'
        when panel.drive_id is not null and bolinhas.drive_id is null then '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
        else null
      end as canonical_root_id,
      case
        when bolinhas.drive_id is not null and panel.drive_id is null then '50X50'
        when panel.drive_id is not null and bolinhas.drive_id is null then '150X150'
        else null
      end as canonical_size_key
    from armazem_v2_private.catalog_search_items item
    left join bolinhas_folders bolinhas on bolinhas.drive_id = item.parent_folder_id
    left join panel_folders panel on panel.drive_id = item.parent_folder_id
    where item.catalog_version = v_version
      and item.drive_file_id = any(v_ids)
  )
  select coalesce(
    jsonb_agg(
      item.payload || jsonb_build_object(
        'id', item.drive_file_id,
        'driveFileId', item.drive_file_id,
        'code', item.code,
        'originalName', item.original_name,
        'theme', item.theme,
        'subtheme', item.subtheme,
        'product', item.canonical_product_key,
        'productKey', item.canonical_product_key,
        'productName', item.canonical_product_name,
        'productLabel', item.canonical_product_name,
        'catalogRootDriveId', item.canonical_root_id,
        'rootVerified', true,
        'size', item.canonical_size_key,
        'sizeKey', item.canonical_size_key,
        'details', coalesce(item.payload -> 'details', '{}'::jsonb)
          || jsonb_build_object('size', item.canonical_size_key)
      )
      order by array_position(v_ids, item.drive_file_id)
    ),
    '[]'::jsonb
  )
    into v_items
    from classified item
   where item.canonical_product_key is not null;

  return jsonb_build_object(
    'ok', true,
    'source', 'catalog_v2_accepted',
    'catalogVersion', v_version,
    'scope', 'strict-product-drive-roots',
    'requestedCount', v_requested_count,
    'requestedUniqueCount', cardinality(v_ids),
    'resolvedCount', jsonb_array_length(v_items),
    'items', v_items
  );
end;
$function$;

revoke all on function public.armazem_v2_catalog_route_v1(text, text, text)
  from public, anon, authenticated;
revoke all on function public.armazem_v2_catalog_search_v1(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.armazem_v2_catalog_checkout_items_v1(text[])
  from public, anon, authenticated;

grant execute on function public.armazem_v2_catalog_route_v1(text, text, text)
  to service_role;
grant execute on function public.armazem_v2_catalog_search_v1(text, text, integer)
  to service_role;
grant execute on function public.armazem_v2_catalog_checkout_items_v1(text[])
  to service_role;
