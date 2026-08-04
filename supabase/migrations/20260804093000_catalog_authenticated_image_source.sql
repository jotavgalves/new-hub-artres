create or replace function public.armazem_v2_catalog_image_source_v1(
  p_drive_file_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, armazem_v2_private
as $function$
declare
  v_role text;
  v_version bigint;
  v_id text;
  v_item armazem_v2_private.catalog_search_items%rowtype;
  v_root text;
  v_inside_scope boolean;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'ARMAZEM_V2_SERVICE_ROLE_REQUIRED';
  end if;

  v_id := btrim(coalesce(p_drive_file_id, ''));
  if length(v_id) < 5 or length(v_id) > 500 or v_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_IMAGE_ID_INVALID';
  end if;

  select accepted_version into v_version
    from armazem_v2_private.catalog_state
   where singleton = true;
  if v_version is null then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_NOT_ACCEPTED';
  end if;

  select * into v_item
    from armazem_v2_private.catalog_search_items
   where catalog_version = v_version
     and drive_file_id = v_id;
  if not found then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_IMAGE_NOT_FOUND';
  end if;

  v_root := case v_item.product_key
    when '50x50' then '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae'
    when 'painel-150' then '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
    else ''
  end;
  if v_root = '' then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_IMAGE_PRODUCT_INVALID';
  end if;

  with recursive ancestors(drive_id, parent_id) as (
    select folder.drive_id, folder.parent_id
      from armazem_v2_private.catalog_search_folders folder
     where folder.catalog_version = v_version
       and folder.drive_id = v_item.parent_folder_id
    union all
    select parent.drive_id, parent.parent_id
      from armazem_v2_private.catalog_search_folders parent
      join ancestors child on parent.drive_id = child.parent_id
     where parent.catalog_version = v_version
  )
  select exists(select 1 from ancestors where parent_id = v_root)
    into v_inside_scope;

  if not v_inside_scope then
    raise exception using errcode = '22023', message = 'ARMAZEM_V2_CATALOG_IMAGE_OUTSIDE_ROOT';
  end if;

  return jsonb_build_object(
    'ok', true,
    'catalogVersion', v_version,
    'driveFileId', v_item.drive_file_id,
    'sourceDriveFileId', coalesce(nullif(v_item.payload ->> 'sourceDriveFileId', ''), v_item.drive_file_id),
    'mimeType', coalesce(v_item.payload ->> 'mimeType', ''),
    'extension', coalesce(v_item.payload ->> 'extension', ''),
    'modifiedTime', coalesce(v_item.payload ->> 'modifiedTime', ''),
    'checksum', coalesce(v_item.payload ->> 'checksum', ''),
    'pdfPreview', case
      when lower(coalesce(v_item.payload ->> 'pdfPreview', 'false')) in ('true', '1') then true
      else false
    end,
    'productKey', v_item.product_key,
    'catalogRootDriveId', v_root,
    'rootVerified', true
  );
end;
$function$;

revoke all on function public.armazem_v2_catalog_image_source_v1(text) from public, anon, authenticated;
grant execute on function public.armazem_v2_catalog_image_source_v1(text) to service_role;
