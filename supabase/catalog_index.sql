-- Índice materializado do catálogo do Google Drive.
-- Rode este arquivo no SQL Editor do Supabase de artes antes de executar scripts/reindex-drive-catalog.mjs.

create extension if not exists pg_trgm;

create table if not exists public.catalog_index (
  id bigserial primary key,
  drive_id text not null unique,
  parent_drive_id text,
  root_drive_id text,
  type text not null check (type in ('folder', 'artwork', 'other')),
  name text not null,
  normalized_name text not null default '',
  mime_type text,
  path text not null default '',
  path_parts jsonb not null default '[]'::jsonb,
  depth integer not null default 0,
  theme text,
  subtheme text,
  product text,
  size text,
  code text,
  extension text,
  drive_url text,
  thumbnail_url text,
  search_text text not null default '',
  raw jsonb not null default '{}'::jsonb,
  last_indexed_run_id text,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists catalog_index_type_idx on public.catalog_index(type);
create index if not exists catalog_index_parent_idx on public.catalog_index(parent_drive_id);
create index if not exists catalog_index_root_idx on public.catalog_index(root_drive_id);
create index if not exists catalog_index_code_idx on public.catalog_index(code);
create index if not exists catalog_index_theme_idx on public.catalog_index(theme);
create index if not exists catalog_index_product_idx on public.catalog_index(product);
create index if not exists catalog_index_deleted_idx on public.catalog_index(deleted_at);
create index if not exists catalog_index_search_trgm_idx on public.catalog_index using gin(search_text gin_trgm_ops);
create index if not exists catalog_index_path_trgm_idx on public.catalog_index using gin(path gin_trgm_ops);

create or replace function public.catalog_index_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists catalog_index_set_updated_at_trigger on public.catalog_index;
create trigger catalog_index_set_updated_at_trigger
before update on public.catalog_index
for each row execute function public.catalog_index_set_updated_at();

-- Leitura pública via REST pode ficar bloqueada por RLS; as Pages Functions usam SERVICE KEY no servidor.
-- Se você decidir expor leitura anon no futuro, crie políticas específicas e restritas.
