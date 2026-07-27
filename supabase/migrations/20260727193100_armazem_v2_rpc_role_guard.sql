begin;

do $migration$
declare
  r record;
  v_definition text;
  v_updated text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'armazem_v2_project_order_v1',
         'armazem_v2_list_orders_redacted_v1',
         'armazem_v2_projection_health_v1'
       )
  loop
    v_definition := pg_get_functiondef(r.oid);
    v_updated := replace(
      v_definition,
      $legacy$coalesce(current_setting('request.jwt.claim.role', true), '')$legacy$,
      $claims$coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_setting('request.jwt.claim.role', true),
    ''
  )$claims$
    );

    if v_updated = v_definition then
      raise exception using errcode = '22023', message = 'ARMAZEM_V2_ROLE_GUARD_PATTERN_NOT_FOUND';
    end if;

    execute v_updated;
  end loop;
end
$migration$;

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

comment on function public.armazem_v2_project_order_v1(jsonb) is
  'Projeção transacional V2. ACL exclusiva de service_role e guard compatível com request.jwt.claims.';

commit;
