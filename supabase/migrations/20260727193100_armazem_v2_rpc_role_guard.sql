begin;

-- As funções abaixo já são executáveis exclusivamente por service_role.
-- O GUC local mantém compatibilidade com o guard interno sem depender do
-- formato de propagação individual das claims pelo PostgREST.

alter function public.armazem_v2_project_order_v1(jsonb)
  set "request.jwt.claim.role" = 'service_role';

alter function public.armazem_v2_list_orders_redacted_v1(integer)
  set "request.jwt.claim.role" = 'service_role';

alter function public.armazem_v2_projection_health_v1()
  set "request.jwt.claim.role" = 'service_role';

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
  'Projeção transacional V2. ACL exclusiva de service_role e contexto interno fixado.';

commit;
