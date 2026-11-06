-- ============================================================
-- Patrulla Antimosquito · Auditoría 2 (READ-ONLY)
-- Definiciones de funciones críticas + constraints + defaults.
-- Ejecutar en Supabase → SQL Editor. Solo SELECT.
-- ============================================================

with wanted(name) as (
  values
    ('trg_profiles_proteger_puntos'),
    ('trg_profiles_protect_admin'),
    ('trg_reports_preparar'),
    ('trg_reports_sumar_puntos'),
    ('trg_reports_limite_diario'),
    ('trg_reports_fotos_validas'),
    ('_foto_valida'),
    ('trg_report_validated'),
    ('apply_review_consensus'),
    ('resolve_report_consensus'),
    ('edit_report_note'),
    ('delete_my_report'),
    ('admin_set_revisor'),
    ('admin_bloquear_usuario'),
    ('admin_resolver_reporte'),
    ('admin_cola_moderacion'),
    ('nombres_autores'),
    ('analytics_participantes'),
    ('analytics_kpis'),
    ('_bonus_test'),
    ('trg_learntp_sumar_bonus'),
    ('trg_spot_sumar_puntos'),
    ('trg_learnqc_sumar_puntos'),
    ('check_report_validation'),
    ('puede_revisar'),
    ('is_admin'),
    ('_sumar_puntos'),
    ('registrar_evento'),
    ('pedir_segunda_opinion'),
    ('denunciar_reporte'),
    ('foto_repetida')
),
funcs as (
  select 'function' as section,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
         pg_get_functiondef(p.oid) as details
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join wanted w on w.name = p.proname
  where n.nspname = 'public'
),
cons as (
  select 'constraint' as section,
         c.relname || ':' || con.conname as name,
         pg_get_constraintdef(con.oid) as details
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'profiles','reports','report_reviews','learn_question_correct',
      'learn_test_progress','spot_answers','tip_reads','quiz_answers',
      'push_subscriptions','report_flags','city_requests','notifications_outbox'
    )
),
idx as (
  select 'index' as section,
         tablename || ':' || indexname as name,
         indexdef as details
  from pg_indexes
  where schemaname = 'public'
    and tablename in (
      'profiles','reports','report_reviews','learn_question_correct',
      'learn_test_progress','spot_answers','tip_reads','quiz_answers',
      'push_subscriptions','report_flags','city_requests','notifications_outbox'
    )
),
defs as (
  select 'column_default' as section,
         table_name || ':' || column_name as name,
         concat('nullable=', is_nullable, '; default=', coalesce(column_default, 'NULL')) as details
  from information_schema.columns
  where table_schema = 'public'
    and table_name in (
      'profiles','reports','report_reviews','learn_question_correct',
      'learn_test_progress','spot_answers','tip_reads','quiz_answers',
      'push_subscriptions','report_flags','city_requests','notifications_outbox'
    )
),
owners as (
  select 'table_owner' as section,
         c.relname as name,
         pg_get_userbyid(c.relowner)::text as details
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
  union all
  select 'function_owner' as section,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
         pg_get_userbyid(p.proowner)::text || '; security_definer=' || p.prosecdef::text as details
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join wanted w on w.name = p.proname
  where n.nspname = 'public'
),
trgs as (
  select 'trigger_enabled' as section,
         c.relname || ':' || t.tgname as name,
         t.tgenabled::text as details
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
)
select * from (
  select * from funcs
  union all select * from cons
  union all select * from idx
  union all select * from defs
  union all select * from owners
  union all select * from trgs
) x
order by section, name;
