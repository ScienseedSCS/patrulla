-- ============================================================
-- Patrulla Antimosquito · Auditoría READ-ONLY de Supabase
-- ------------------------------------------------------------
-- Solo SELECT. No crea, altera ni borra nada.
-- Ejecutar en Supabase → SQL Editor (de a un bloque) o con:
--   PGOPTIONS='-c default_transaction_read_only=on' \
--   psql "$SUPABASE_DB_URL" -f /tmp/patrulla_audit.sql
--
-- Objetivo: recuperar el "backend invisible" (RLS, grants,
-- funciones, triggers, storage, cron, webhooks) antes de tocar
-- la app.
-- ============================================================

-- 0. Contexto
select current_database() as database,
       current_user as db_user,
       current_setting('server_version') as pg_version;

-- 1. Inventario de tablas + estado de RLS
select n.nspname as schema,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policies p
         where p.schemaname = n.nspname and p.tablename = c.relname) as policy_count,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname in ('public','storage')
order by 1, 2;

-- 2. Tablas públicas SIN RLS (debería estar vacío o justificado)
select n.nspname as schema, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname = 'public'
  and not c.relrowsecurity
order by 2;

-- 3. Tablas con RLS activo pero SIN políticas
select n.nspname as schema, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname = 'public'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = n.nspname and p.tablename = c.relname
  )
order by 2;

-- 4. Todas las políticas (public + storage)
--    Revisar especialmente roles={public,anon,authenticated}
--    y qual/with_check = true.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public','storage')
order by 1, 2, 3;

-- 5. Grants de tabla para anon / authenticated / service_role
select table_schema, table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated','service_role')
group by 1, 2, 3
order by 1, 2, 3;

-- 6. Grants de COLUMNA en tablas sensibles
--    Clave: ¿puede authenticated hacer UPDATE de points / is_reviewer / is_admin?
select table_name, column_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.column_privileges
where table_schema = 'public'
  and grantee in ('anon','authenticated')
  and table_name in ('profiles','reports','report_reviews','action_types','cities')
group by 1, 2, 3
order by 1, 2, 3;

-- 7. Funciones públicas: SECURITY DEFINER, search_path y ACL
select n.nspname as schema,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       p.proowner::regrole as owner,
       p.proconfig as config,
       p.proacl::text as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1, 2;

-- 8. SECURITY DEFINER sin search_path fijo (riesgo de hijacking)
select n.nspname as schema,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and not exists (
    select 1
    from unnest(coalesce(p.proconfig, '{}'::text[])) as c
    where c like 'search_path=%'
  )
order by 2;

-- 9. RPCs ejecutables por anon (revisar: idealmente casi ninguna)
select n.nspname as schema,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 2;

-- 10. Triggers (incluye auth.users y storage)
select n.nspname as schema,
       c.relname as table_name,
       t.tgname as trigger_name,
       p.proname as function_name,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and n.nspname in ('public','auth','storage')
order by 1, 2, 3;

-- 11. Buckets de Storage: public debe ser false para reports
select id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
from storage.buckets
order by name;

-- 12. Extensiones instaladas
select e.extname, e.extversion, n.nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
order by 1;

-- 13. Publicaciones / Realtime
select pubname, schemaname, tablename
from pg_publication_tables
order by 1, 2, 3;

-- 14. Roles relevantes
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
from pg_roles
where rolname not like 'pg_%'
order by 1;

-- ============================================================
-- BLOQUES OPCIONALES (ejecutar solo si la extensión/tabla existe)
-- ============================================================

-- 15. pg_cron: trabajos programados (posible envío de push)
-- select jobid, schedule, command, database, username, active, jobname
-- from cron.job order by jobid;

-- 16. Database Webhooks
-- select * from supabase_functions.hooks;

-- 17. Vault: SOLO nombres de secretos, nunca valores
-- select name, description, created_at, updated_at
-- from vault.secrets order by name;

-- 18. Historial de migraciones (si se usó Supabase CLI)
-- select * from supabase_migrations.schema_migrations order by version;

-- 19. Definiciones completas de funciones SECURITY DEFINER
--     (puede ser largo; revisar sobre todo las que tocan points/roles)
-- select n.nspname, p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        pg_get_functiondef(p.oid) as definition
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prosecdef
-- order by 2;
