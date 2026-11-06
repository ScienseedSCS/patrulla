-- ============================================================
-- Patrulla Antimosquito · Auditoría READ-ONLY compacta
-- Un solo resultado JSON. Solo SELECT.
-- Ejecutar en Supabase → SQL Editor.
-- ============================================================

with
tables as (
  select n.nspname as schema, c.relname as table_name,
         c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
         (select count(*) from pg_policies p
           where p.schemaname = n.nspname and p.tablename = c.relname) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname = 'public'
),
no_rls as (
  select schema, table_name from tables where not rls_enabled
),
no_policies as (
  select schema, table_name from tables where rls_enabled and policy_count = 0
),
policies as (
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
  where schemaname in ('public','storage')
),
definer_no_path as (
  select n.nspname as schema, p.proname as function_name,
         pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as c
      where c like 'search_path=%'
    )
),
functions as (
  select n.nspname as schema, p.proname as function_name,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef as security_definer, p.proconfig as config,
         p.proacl::text as acl,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
),
triggers as (
  select n.nspname as schema, c.relname as table_name, t.tgname as trigger_name,
         p.proname as function_name, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and n.nspname in ('public','auth','storage')
),
colprivs as (
  select table_name, column_name, grantee,
         string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.column_privileges
  where table_schema = 'public'
    and grantee in ('anon','authenticated')
    and table_name in ('profiles','reports','report_reviews','action_types','cities')
  group by 1,2,3
),
buckets as (
  select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
)
select jsonb_pretty(jsonb_build_object(
  'context', jsonb_build_object(
    'database', current_database(),
    'db_user', current_user,
    'pg_version', current_setting('server_version')
  ),
  'tables', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from tables t),
  'tables_without_rls', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from no_rls x),
  'tables_without_policies', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from no_policies x),
  'policies', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from policies p),
  'security_definer_without_search_path', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from definer_no_path x),
  'functions', (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from functions f),
  'triggers', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from triggers t),
  'column_privileges', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from colprivs c),
  'storage_buckets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from buckets b)
));
