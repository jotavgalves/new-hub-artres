begin;
alter table armazem_v2_private.orders drop constraint if exists armazem_v2_orders_number_format;
alter table armazem_v2_private.orders add constraint armazem_v2_orders_number_format check (order_number ~ '^PED[0-9]{7}[A-Z]+$');
do $$
declare v_definition text; v_updated text;
begin
  select pg_get_functiondef(p.oid) into v_definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'armazem_v2_project_order_v1' limit 1;
  if v_definition is null then raise exception 'ARMAZEM_V2_PROJECT_ORDER_FUNCTION_MISSING'; end if;
  v_updated := replace(v_definition, '''^PED[0-9]{7}[A-Z]$''', '''^PED[0-9]{7}[A-Z]+$''');
  if v_updated <> v_definition then execute v_updated; end if;
end $$;
commit;
