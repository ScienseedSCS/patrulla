# Auditoría y hardening de Supabase · Patrulla Antimosquito

> **Documento temporal de trabajo.** Vive solo en la branch `deploy/caprover-staging`.
> Antes de mergear a `main`, borrar `docs/supabase-hardening.md` y la carpeta `docs/audit/`.
>
> Fecha de la auditoría: **2026-11-06**
> Proyecto Supabase auditado: `levdxusiudrtutmkyomn`
> Alcance: esquema `public`, políticas de `storage`, funciones, triggers, constraints y grants.
> Método: consultas **read-only** ejecutadas desde el SQL Editor. No se modificó producción.
> Los scripts están en `docs/audit/`; se ejecutan en el SQL Editor (solo `SELECT`).

---

## 0. Resumen ejecutivo

La base está **mejor diseñada de lo que parecía**:

- Las 28 tablas públicas tienen RLS activado.
- El bucket `reports` es privado y sus políticas de Storage son correctas.
- No hay funciones `SECURITY DEFINER` sin `search_path` fijo.
- Los triggers de `profiles` y `reports` bloquean la manipulación directa de puntos, roles y estado de reportes.
- Las funciones de administración y analítica que se revisaron comprueban `is_admin()`.

Pero hay **un fallo de autorización claro** y varios problemas de integridad de puntos:

1. **`resolve_report_consensus` no comprueba quién la llama** y es ejecutable por `anon`. Puede recalcular `review_count` de cualquier reporte y resolver un reporte pendiente que tenga un voto.
2. **`delete_my_report` resta puntos dos veces** si el reporte ya estaba `descartado`.
3. **Se pueden insertar reportes sin foto** y cobrar los puntos de la acción.
4. **El recorrido por la casa no tiene cooldown real**: la UI dice “una vez por semana”, pero ningún trigger usa `action_types.cooldown_days`.
5. **`trg_spot_sumar_puntos` ignora `found`**: se pueden cobrar puntos sin encontrar los criaderos.
6. **`trg_learnqc_sumar_puntos` no valida la respuesta**: acredita 2 puntos por insertar una pregunta activa; las respuestas son públicas.
7. **`_foto_valida` hardcodea el proyecto Supabase de producción**, lo que bloqueará las fotos en un Supabase de staging.
8. **`check_report_validation` es código muerto** que implementa 3 votos, mientras que la función activa resuelve con el **primer** voto. El README dice 3 votos; la UI dice 1; la DB hace 1.

La prioridad es arreglar 1–3, decidir el modelo de revisión y mover quizzes/“detectar criaderos” a RPCs si el ranking va a tener valor real.

---

## 1. Cómo encaja Supabase en la app

La app es una PWA estática. **No hay backend propio**: el servidor web solo entrega HTML, JS, CSS, fuentes e imágenes. El navegador habla directamente con Supabase.

```text
Navegador
  ├─ index.html / JS / CSS / fuentes     ← Apache o nginx (estático)
  ├─ Auth      → https://<ref>.supabase.co/auth/v1
  ├─ Datos     → https://<ref>.supabase.co/rest/v1        (JWT + anon key)
  ├─ RPC       → https://<ref>.supabase.co/rest/v1/rpc/...
  └─ Fotos     → https://<ref>.supabase.co/storage/v1/object/reports/...
```

- **Auth:** email + contraseña. Supabase emite un JWT; `auth.uid()` es la identidad que usan RLS y las funciones.
- **Datos:** PostgREST. El cliente envía la `anon key` (pública por diseño) y el JWT del usuario. RLS decide qué filas puede leer/escribir.
- **RPCs:** funciones `SECURITY DEFINER` para operaciones sensibles (revisión, moderación, puntos, exportación, borrado de cuenta).
- **Storage:** bucket privado `reports`. La app sube a `reports/<user_id>/<timestamp>_<sufijo>.jpg`; el sufijo es `antes`, `despues` o `tour_<estacion>`.
- **Fotos en la DB:** `reports.photo_url`, `photo_before_url` y `tour_photos` guardan la URL “pública” que devuelve `getPublicUrl()`. Esa URL sirve como **ruta estable**, no como permiso: el bucket es privado y la app pide `createSignedUrls(..., 3600)` para mostrar las imágenes.
- **Puntos:** los suma el servidor mediante triggers (`_sumar_puntos`, `trg_reports_sumar_puntos`, etc.). El cliente no puede escribir `profiles.points` directamente.
- **Admin:** `admin.html` y `admin-reportes.html` usan el mismo proyecto y login. El gate visual no es seguridad: las RPCs `admin_*` y `analytics_*` deben comprobar `is_admin()`.
- **Analítica:** `registrar_evento()` guarda eventos seudonimizados (`analytics_id`, sin `user_id`), con límite de 60 eventos/minuto.
- **Push:** suscripciones en `push_subscriptions`; la cola es `notifications_outbox`; el envío real lo hace un proceso con `service_role` (no está en el repo).

### Roles de Postgres

| Rol | Uso |
|---|---|
| `anon` | Visitante sin login. Solo catálogos públicos y RPCs públicas. |
| `authenticated` | Usuario logueado. RLS por `auth.uid()`. |
| `service_role` | Backend/CI. **Bypassa RLS**; nunca en el frontend. |
| `postgres` | Owner de tablas/funciones. No lo usa la app. |

---

## 2. Inventario

### 2.1 Tablas (28 en `public`)

| Grupo | Tablas | Notas |
|---|---|---|
| Identidad | `profiles` | RLS: cada usuario ve/edita su fila. Triggers protegen `points`, `level`, `is_admin`, `is_reviewer`, `bloqueado`. |
| Catálogo | `cities`, `action_types`, `tips`, `learn_questions`, `spot_challenges` | Lectura pública. `action_types.cooldown_days` existe pero no se usa en triggers. |
| Reportes | `reports`, `report_reviews`, `report_flags`, `city_requests` | Reportes propios o revisores; auto-revisión bloqueada; flags vía RPC. |
| Aprendizaje | `learn_question_correct`, `learn_test_progress`, `spot_answers`, `tip_reads`, `quiz_answers` | `tip_reads`/`quiz_answers` parecen legado. Unique por usuario/pregunta, usuario/bloque y usuario/desafío. |
| Riesgo/OVI | `ovi_indices`, `ovi_sectores`, `ovi_trampas`, `ovi_cargas`, `ovi_calles` | `ovi_trampas`/`ovi_cargas` solo admin; `ovi_indices` oculta datos de prueba; mapas públicos. |
| Ops/analítica | `events`, `analytics_enlace`, `analytics_cohorte`, `notifications_outbox`, `push_subscriptions`, `app_settings` | `events`, `analytics_*`, `notifications_outbox` y `app_settings` no tienen políticas: solo `service_role`/funciones definer. |
| Legado | `quizzes`, `incidence` | Siguen existiendo y son de lectura pública; el código actual usa `learn_questions` y `ovi_*`. |

### 2.2 Storage

- Bucket `reports`: **privado** (`public = false`).
- Límite: 10 MB.
- MIME permitidos: `image/jpeg`, `image/png`, `image/webp`.
- Políticas:
  - `subida_propia_reports`: INSERT si la primera carpeta es `auth.uid()`.
  - `lectura_fotos_reports`: SELECT si es propia o `puede_revisar()`.
  - `borrado_propio_reports`: DELETE si es propia.
  - `admin_borra_fotos_reports`: DELETE si `is_admin()`.
  - No hay política de UPDATE; la app sube con `upsert:false`.

### 2.3 Funciones y triggers relevantes

| Función/trigger | Qué hace |
|---|---|
| `_sumar_puntos(uid, delta)` | Único escritor de `profiles.points`. SECURITY DEFINER; solo `postgres`/`service_role`. |
| `trg_profiles_protect_admin` | En INSERT/UPDATE de `profiles` hechos por `anon`/`authenticated`, fuerza `is_admin`, `is_reviewer`, `bloqueado` y sus campos. |
| `trg_profiles_proteger_puntos` | En INSERT/UPDATE de `profiles` hechos por `anon`/`authenticated`, fuerza `points` y `streak_weeks`; recalcula `level` con `nivel_de()`. |
| `trg_reports_preparar` | Fuerza `status='pendiente'`, `review_count=0`, `resuelto_por_admin=false`, etc.; calcula `points_awarded` desde `action_types`/`tour_photos`. |
| `trg_reports_sumar_puntos` | Acredita `points_awarded` al insertar un reporte. |
| `trg_reports_fotos_validas` | Valida que `photo_url`, `photo_before_url` y `tour_photos` sean del usuario y del bucket; máximo 20 fotos de recorrido. |
| `trg_reports_limite_diario` | Máximo 10 reportes por usuario y día (hora Argentina). |
| `trg_report_validated` | Encola aviso de “reporte validado” al cambiar a `validado`. |
| `resolve_report_consensus` | Cuenta votos, actualiza `review_count` y resuelve el reporte con el voto más reciente si está pendiente. |
| `apply_review_consensus` | Trigger AFTER INSERT en `report_reviews`; llama a `resolve_report_consensus`. |
| `check_report_validation` | Trigger de 3 votos **no asociado a ningún trigger**. Código muerto. |
| `trg_spot_sumar_puntos` | Acredita `spot_challenges.points` al insertar en `spot_answers`. |
| `trg_learnqc_sumar_puntos` | Acredita 2 pts al insertar en `learn_question_correct`. |
| `trg_learntp_preparar` | Trigger de `learn_test_progress`; **definición pendiente de revisar**. |
| `trg_learntp_sumar_bonus` | Acredita bonus si `bonus_awarded` pasa a true y `best_score` alcanza el umbral. |
| `admin_*` | Moderación, bloqueo, revisores, cola; las revisadas comprueban `is_admin()`. |
| `analytics_*` | Wrappers de `_analytics_*`; las muestras revisadas comprueban `is_admin()`. |
| `nombres_autores` | Devuelve usernames; exige `puede_revisar()`. |
| `denunciar_reporte` | Exige `puede_revisar()`, no denunciar el propio reporte, motivo válido. |
| `pedir_segunda_opinion` | Exige que el reporte sea del usuario y esté `descartado`. |
| `edit_report_note` | Solo el dueño y solo si el reporte está `pendiente`. |
| `delete_my_report` | Solo el dueño; borra reporte y resta puntos. **Bug de doble resta.** |
| `registrar_evento` | Analítica seudonimizada, límite 60/minuto. |
| `is_admin`, `puede_revisar`, `is_blocked` | Helpers usados por RLS; SECURITY DEFINER con `search_path` fijo. |

---

## 3. Lo que ya está bien

- **RLS completo:** las 28 tablas públicas tienen `rowsecurity = true`. No hay tablas sin RLS.
- **Tablas internas bloqueadas:** `events`, `city_requests`, `app_settings`, `notifications_outbox`, `analytics_enlace` y `analytics_cohorte` tienen RLS sin políticas. Solo entran `service_role` o funciones definer.
- **Bucket privado:** `reports` no es público; las fotos se muestran con URLs firmadas.
- **Políticas de Storage correctas:** subida/borrado solo en carpeta propia; lectura propia o revisor; borrado admin; sin UPDATE.
- **`search_path` fijo:** no hay ninguna función `SECURITY DEFINER` sin `search_path`.
- **Owners:** tablas y funciones pertenecen a `postgres`; los clientes usan `anon`/`authenticated`.
- **`profiles` protegido:** los triggers fuerzan `points`, `level`, `is_admin`, `is_reviewer`, `bloqueado` en INSERT y UPDATE. `_sumar_puntos` está restringido a `postgres`/`service_role`.
- **`reports` protegido:** `trg_reports_preparar` fuerza estado/puntos/contadores; el cliente no puede inyectar un reporte validado con puntos. `trg_reports_fotos_validas` valida las fotos. `trg_reports_limite_diario` limita a 10/día.
- **Revisión:** `report_reviews` tiene unique `(report_id, reviewer_id)` y la política impide auto-revisión.
- **Admin/analítica:** las funciones revisadas (`admin_set_revisor`, `admin_bloquear_usuario`, `admin_resolver_reporte`, `admin_cola_moderacion`, `analytics_kpis`, `analytics_participantes`) comprueban `is_admin()`.
- **Privacidad:** `nombres_autores` exige revisor; `denunciar_reporte` y `pedir_segunda_opinion` comprueban permisos; `edit_report_note`/`delete_my_report` comprueban dueño.
- **Analítica:** `registrar_evento` no guarda `user_id`, usa `analytics_id` y limita a 60 eventos/minuto.
- **Constraints:** existen unique para `(user_id, question_id)`, `(user_id, block)`, `(user_id, challenge_id)`, `(report_id, reviewer_id)`, `(report_id, user_id, tipo)` y `(user_id, tip_id)`.

---

## 4. Hallazgos

### 4.1 Crítico

#### 4.1.1 `resolve_report_consensus` sin autorización

**Qué pasa:** es una función normal, `SECURITY DEFINER`, con `EXECUTE` para `PUBLIC`/`anon`/`authenticated`. No comprueba `puede_revisar()` ni que el llamante sea revisor. Hace:

1. `select ... for update` del reporte.
2. `update reports set review_count = n`.
3. Si el reporte está `pendiente` y hay un voto, cambia el estado a `validado` o `descartado`.

**Por qué importa:** cualquiera puede invocarla por PostgREST. No puede inventar votos, pero puede:
- recalcular `review_count` de cualquier reporte;
- resolver un reporte pendiente que ya tenga un voto (por ejemplo, uno devuelto a la cola por un admin);
- bloquear filas con `for update` y generar carga.

**Fix propuesto:**

```sql
-- al inicio de resolve_report_consensus
if not public.puede_revisar() then
  raise exception 'Solo revisores autorizados';
end if;

revoke execute on function public.resolve_report_consensus(bigint)
  from public, anon, authenticated;
```

El trigger `apply_review_consensus` es `SECURITY DEFINER` propiedad de `postgres`; puede seguir llamando a la función. El flujo de revisión no se rompe.

**Test:** `anon` y un usuario no revisor deben recibir excepción; un revisor debe poder insertar un `report_reviews` y el trigger debe resolver el reporte.

---

### 4.2 Alto

#### 4.2.1 `delete_my_report` resta puntos dos veces

**Qué pasa:** al borrar un reporte propio, la función siempre resta `points_awarded`. Si el reporte ya estaba `descartado`, `resolve_report_consensus` o `admin_resolver_reporte` ya habían restado esos puntos. Al borrarlo se restan otra vez. La app también resta en local sin mirar el estado.

**Por qué importa:** un usuario puede perder puntos que ya había perdido; el saldo queda inconsistente y la UI puede mostrar un valor distinto hasta recargar.

**Fix propuesto:**

```sql
declare pts int; st text; uid uuid := auth.uid();
begin
  select points_awarded, status into pts, st
    from public.reports
   where id = p_id and user_id = uid;
  if pts is null then return; end if;

  delete from public.report_reviews where report_id = p_id;
  delete from public.reports where id = p_id and user_id = uid;

  if coalesce(st, '') <> 'descartado' then
    update public.profiles
       set points = greatest(0, coalesce(points,0) - coalesce(pts,0))
     where id = uid;
  end if;
end;
```

**Test:** borrar un reporte `pendiente` resta; `validado` resta; `descartado` **no** resta. Corregir también la resta local de la app.

#### 4.2.2 Reportes sin foto

**Qué pasa:** `trg_reports_preparar` calcula `points_awarded` aunque `photo_url` sea `NULL`. `trg_reports_fotos_validas` acepta `NULL` (`_foto_valida` devuelve true si `p_url is null`). Un usuario puede insertar directamente un reporte sin foto y cobrar los puntos de la acción.

**Por qué importa:** puntos por reportes vacíos; el revisor tendrá que descartarlos y restar puntos, pero mientras tanto el ranking se contamina.

**Fix propuesto:** dentro del bloque de `current_user in ('anon','authenticated')` de `trg_reports_preparar`:

```sql
if NEW.photo_url is null then
  raise exception 'El reporte necesita una foto';
end if;

if NEW.action_type = 'house_tour' then
  if jsonb_typeof(NEW.tour_photos) <> 'array'
     or jsonb_array_length(NEW.tour_photos) = 0 then
    raise exception 'El recorrido necesita fotos';
  end if;
end if;
```

**Test:** insertar un reporte sin `photo_url` debe fallar; un `house_tour` sin `tour_photos` debe fallar; la app normal sigue funcionando.

#### 4.2.3 El recorrido por la casa no tiene cooldown real

**Qué pasa:** la UI dice “Una vez por semana” y `action_types.cooldown_days` existe, pero ningún trigger lo usa. `trg_reports_limite_diario` solo limita a 10 reportes/día. Un usuario puede enviar hasta 10 recorridos al día; a 50 pts cada uno son 500 pts/día.

**Por qué importa:** es el vector de farming más rentable: fotos propias válidas, puntos altos y sin espera semanal.

**Fix propuesto:** en `trg_reports_preparar`, leer `cooldown_days` de `action_types` y comprobar reportes recientes del mismo `action_type`:

```sql
select points, cooldown_days into base, cd
  from public.action_types
 where id = NEW.action_type;

if coalesce(cd, 0) > 0 and exists (
  select 1
    from public.reports r
   where r.user_id = NEW.user_id
     and r.action_type = NEW.action_type
     and r.created_at > now() - (cd || ' days')::interval
) then
  raise exception 'Todavía no podés repetir esta acción';
end if;
```

Decidir si un reporte `descartado` cuenta para el cooldown. Recomendación: no contar los descartados, para permitir reintentar tras un rechazo.

**Test:** segundo `house_tour` dentro de 7 días falla; tras 7 días funciona; otras acciones con `cooldown_days` se comportan igual.

#### 4.2.4 `trg_spot_sumar_puntos` ignora `found`

**Qué pasa:** acredita `spot_challenges.points` por insertar en `spot_answers`, sin mirar `NEW.found`. La unique `(user_id, challenge_id)` limita a un cobro por desafío, pero se puede insertar `found = 0` y cobrar.

**Por qué importa:** puntos gratis por desafío; el ranking se puede inflar sin jugar.

**Fix propuesto:**

```sql
select points, coalesce(jsonb_array_length(hotspots), 0)
  into pts, req
  from public.spot_challenges
 where id = NEW.challenge_id and active;

if pts is not null and req > 0 and coalesce(NEW.found, 0) >= req then
  perform public._sumar_puntos(NEW.user_id, pts);
end if;
```

**Limitación:** `found` sigue siendo controlado por el cliente. Para una solución robusta, mover la validación a un RPC que reciba los taps y valide contra `hotspots`, y revocar el INSERT directo en `spot_answers`. Eso es un cambio de producto.

#### 4.2.5 `trg_learnqc_sumar_puntos` no valida la respuesta

**Qué pasa:** acredita 2 puntos por insertar en `learn_question_correct`, siempre que la pregunta exista y esté activa. No valida que la respuesta sea correcta. `learn_questions` es de lectura pública y el cliente la usa para corregir; por tanto, las respuestas están expuestas.

**Por qué importa:** un usuario puede insertar todas las preguntas activas y cobrar 2 pts por cada una. La unique evita repetir la misma pregunta, pero no evita insertar todas. El daño está acotado (≈80 pts si inserta las 40 preguntas de los cuatro bloques), pero el ranking se puede inflar.

**Fix propuesto (cambio de producto):**
- Crear `responder_pregunta(p_question_id, p_answer)` como RPC `SECURITY DEFINER` que valide la respuesta contra `learn_questions` y, solo si es correcta, inserte en `learn_question_correct`.
- Revocar INSERT directo en `learn_question_correct`.
- Dejar de enviar la respuesta correcta al cliente; el RPC devuelve feedback.
- Mientras no se haga, documentar el riesgo y no usar el ranking para premios reales.

#### 4.2.6 `_foto_valida` hardcodea el proyecto Supabase

**Qué pasa:** la función usa literalmente:

```text
https://levdxusiudrtutmkyomn.supabase.co/storage/v1/object/public/reports/<uid>/
```

**Por qué importa:** si creamos un Supabase de staging con otro `project-ref`, las fotos subidas a staging tendrán otro host y `trg_reports_fotos_validas` las rechazará. Es un bloqueo para probar el flujo de reportes en staging.

**Fix propuesto:** parametrizar el host.
- Opción A: `current_setting('app.supabase_url', true)` y cambiar la función a `STABLE`; configurar el valor por entorno.
- Opción B: una tabla de configuración (`app_settings`/`app_config`) leída por la función.
- Opción C (más limpia a largo plazo): guardar la **ruta del objeto** en la DB en vez de la URL completa y construir la URL en la app.

**Test:** una URL de staging debe aceptarse en staging; una URL de otro usuario o con `..` debe rechazarse; una URL de otro proyecto no debe aceptarse.

---

### 4.3 Medio

#### 4.3.1 `check_report_validation` es código muerto y el modelo de revisión es 1 voto

- `check_report_validation` implementa 3 votos (`review_count >= 3`), pero **no está asociada a ningún trigger**.
- El trigger activo es `review_consensus` → `apply_review_consensus` → `resolve_report_consensus`, que resuelve con el **primer** voto.
- Los votos posteriores solo actualizan `review_count`; `resolve_report_consensus` sale antes porque el estado ya no es `pendiente`.
- El README dice 3 votos; la UI dice 1; la DB hace 1.

**Decisión:** mantener 1 voto (actualizar README/ADMIN y borrar la función muerta) o implementar 3 votos (cambiar `resolve_report_consensus`, la cola de revisión y la UI). No dejar la ambigüedad.

#### 4.3.2 `trg_learntp_preparar` pendiente

No se incluyó su definición en la segunda auditoría. Es la función que debería evitar que un usuario ponga `best_score=10` y `bonus_awarded=true` para cobrar el bonus sin jugar. Consulta pendiente:

```sql
select pg_get_functiondef('public.trg_learntp_preparar'::regproc);
```

Si no valida, el bonus de `learn_test_progress` es farmeable (una vez por bloque).

#### 4.3.3 Grants de columna amplios

`authenticated` tiene `INSERT/UPDATE/REFERENCES` sobre todas las columnas de `profiles`, `reports` y `report_reviews`, incluidas `points`, `is_admin`, `is_reviewer`, `bloqueado`, `status`, `points_awarded`, `review_count`.

Los triggers de `profiles` y `reports` mitigan el riesgo, pero es defensa en profundidad:
- revocar `anon` de `profiles`/`reports`/`report_reviews` (no los necesita);
- revocar `REFERENCES`;
- más adelante, grant por columna y dejar de enviar `points`/`level`/`status`/`points_awarded` desde la app.

`action_types` y `cities` solo necesitan `SELECT`; hoy tienen `INSERT/UPDATE/REFERENCES` para `anon`/`authenticated`, aunque RLS bloquea las escrituras.

#### 4.3.4 `EXECUTE` público en funciones trigger/internas

Muchas funciones trigger tienen `EXECUTE` para `PUBLIC`/`anon`/`authenticated`. Las funciones trigger normalmente no se pueden invocar por RPC (`returns trigger`), pero conviene revocar:

- `apply_review_consensus()`
- `check_report_validation()`
- `trg_*` (todas)
- `edit_report_note(bigint, text)` y `delete_my_report(bigint)` → quitar `anon`
- `_bonus_test(text, integer)` → opcional; es pura
- `foto_repetida(text, bigint, integer)` → ya está solo `authenticated`; considerar restringir a revisor/dueño.

**Cuidado:** `_foto_valida` y `nivel_de` las llaman triggers que **no** son `SECURITY DEFINER` (`trg_reports_fotos_validas`, `trg_profiles_proteger_puntos`). Si se les revoca `EXECUTE` a `authenticated`, esos triggers fallan. Mantenerlas públicas o convertir los triggers a `SECURITY DEFINER` con `search_path` fijo.

#### 4.3.5 `foto_repetida` sin restricción

Cualquier usuario autenticado puede consultar si un hash aparece en otros reportes. Solo devuelve boolean; el riesgo es bajo. Si se quiere endurecer, exigir `puede_revisar()` o que el hash pertenezca a un reporte propio.

#### 4.3.6 `review_select` deja al autor ver `reviewer_id`

La política permite al autor del reporte leer las reviews de su reporte, incluido `reviewer_id` (UUID). No hay `nombres_autores` para no revisores, así que no se pueden mapear a usernames, pero es información innecesaria. Si la app no usa esa rama, quitarla o exponer solo `vote`/`reason` mediante una vista.

#### 4.3.7 `pedir_municipio` es pública y puede generar spam

La RPC es `anon`/`authenticated` y escribe en `city_requests`; no se auditó si además encola avisos a administradores. Añadir rate limit/dedupe por email/IP o un captcha si empieza a recibir abuso.

#### 4.3.8 `trg_learntp_sumar_bonus` depende de campos del cliente

El trigger acredita bonus si `bonus_awarded` pasa a true y `best_score` alcanza el umbral. Si `trg_learntp_preparar` no fuerza esos campos, se puede cobrar el bonus sin jugar. Ver 4.3.2.

---

### 4.4 Bajo / higiene

- `quizzes`, `incidence`, `tip_reads` y `quiz_answers` parecen legado. `README.md` y `ADMIN.md` siguen hablando de `quizzes`/`incidence`; actualizar o borrar.
- `check_report_validation` es código muerto; borrar.
- `reports`/`profiles`/`report_reviews` tienen grants `REFERENCES` innecesarios.
- `action_types`/`cities` tienen grants de escritura que RLS bloquea; revocar.
- `reports` inserta `photo_hash` calculado por el cliente; sirve para detectar duplicados, no como control de seguridad.
- `reports` acepta `lat/lng`/`captured_at` del cliente; son declarativos, no verificables.
- `storage` no tiene política de UPDATE; correcto.
- `reports` no tiene política de UPDATE/DELETE para usuarios; correcto: se usan RPCs.

### 4.5 Pendiente de verificar

- `trg_learntp_preparar` (bonus).
- `admin_pendientes_moderacion`, `admin_avisar_usuario`, `admin_revisores`: confirmar `is_admin()` (las muestras lo hacen).
- `ovi_cargar_*`, `ovi_borrar_prueba`, `sector_actividad`, `ovi_actividad_admin`: confirmar admin.
- `ranking_vecinos`, `municipality_ranking`, `city_totals`, `region_totals`: revisar qué campos exponen y si respetan `en_ranking`.
- `pedir_municipio`: rate limit/dedupe.
- `foto_repetida`: restricción a revisor/dueño.
- `trg_reports_sector`, `trg_profiles_sector_valido`, `trg_profiles_city_valida`: integridad, no seguridad.
- `trg_profile_progress`, `trg_profiles_cohorte`, `trg_incidence_risk`: efectos secundarios/analítica.

---

## 5. Plan de hardening

> **No aplicar directamente en producción.** Probar en staging, con tests, y luego promover.

### 5.1 Migración 1 · Seguridad y puntos (sin decisiones de producto)

1. **`resolve_report_consensus`**
   - añadir `puede_revisar()`;
   - `revoke execute ... from public, anon, authenticated`.
2. **`delete_my_report`**
   - leer `status`;
   - restar solo si no es `descartado`.
3. **`trg_reports_preparar`**
   - exigir `photo_url`;
   - exigir `tour_photos` no vacío para `house_tour`;
   - aplicar `cooldown_days`.
4. **`trg_spot_sumar_puntos`**
   - exigir `found >= jsonb_array_length(hotspots)`.
5. **Revokes de higiene**
   - `apply_review_consensus()`, `check_report_validation()`, `trg_*` a `public, anon, authenticated`;
   - `edit_report_note`, `delete_my_report` a `anon`;
   - `_bonus_test` a `public, anon, authenticated` (opcional, es pura).
6. **Grants**
   - `revoke insert, update, references on public.action_types, public.cities from anon, authenticated;`
   - `grant select on public.action_types, public.cities to anon, authenticated;`
   - `revoke references on public.profiles, public.reports, public.report_reviews from anon, authenticated;`
   - `revoke insert, update on public.profiles, public.reports, public.report_reviews from anon;`
7. **`check_report_validation`**
   - `drop function` si se confirma que no tiene triggers (no los tiene).
8. **Documentar** que `_foto_valida`/`nivel_de` siguen públicas porque las llaman triggers no definer; o convertir esos triggers a `SECURITY DEFINER` en una migración posterior.

### 5.2 Migración 2 · Decisiones de producto

- **Revisión:** 1 voto vs 3 votos.
- **Quiz/“detectar criaderos”:** mover scoring a RPCs, ocultar respuestas/hotspots y revocar INSERT directo.
- **`_foto_valida`:** parametrizar el host por entorno.
- **Column grants:** grant por columna y dejar de enviar campos sensibles desde la app.
- **House tour:** cooldown en UI + servidor; decidir si los descartados cuentan.
- **`foto_repetida`:** restringir a revisor/dueño.
- **`review_select`:** quitar la rama del autor si no se usa.
- **`pedir_municipio`:** rate limit/dedupe.
- **Legado:** borrar `quizzes`, `incidence`, `tip_reads`, `quiz_answers` cuando se confirme que no se usan.

### 5.3 Rollout

1. Snapshot/backup de producción.
2. Baseline de staging (solo esquema + catálogos; **sin datos personales**).
3. Aplicar migración 1 en staging.
4. Ejecutar tests.
5. Smoke E2E en staging.
6. Aplicar en producción en ventana controlada.
7. Verificar logs, puntos y revisión.
8. Rollback: snapshot + migración inversa o restaurar backup.

---

## 6. Tests

### 6.1 Herramientas

- **pgTAP** para RLS/funciones/triggers, ejecutado contra staging o Supabase local.
- **psql** para pruebas SQL si no hay Docker.
- **Playwright** para E2E contra staging.
- **Vitest** para funciones puras cuando se modularice el frontend.

### 6.2 Matriz mínima

**Anon**
- Puede leer catálogos públicos (`cities`, `action_types`, `tips`, `learn_questions`, `spot_challenges`, `ovi_sectores`, `ovi_calles`, `incidence`).
- No puede leer `profiles`, `reports`, `report_reviews`, `report_flags`, `push_subscriptions`, `spot_answers`, `learn_*` privados.
- No puede insertar/actualizar en `profiles`, `reports`, `report_reviews`.
- No puede ejecutar `edit_report_note`, `delete_my_report`, `resolve_report_consensus`, `admin_*`, `analytics_*`, `nombres_autores`.
- `is_admin()`/`puede_revisar()` devuelven false.

**Usuario autenticado A**
- Ve su `profiles`; no el de B.
- Actualiza `username`, `city`, `sector`, `en_ranking`, `push_prefs`; no `points`, `level`, `is_admin`, `is_reviewer`, `bloqueado`.
- Inserta un reporte con `status='validado'` y `points_awarded=999999`: el trigger debe forzar `pendiente` y recalcular puntos.
- Inserta un reporte sin foto: debe fallar.
- Inserta un reporte con foto de B: debe fallar.
- Inserta dos veces el mismo `spot_answers`: unique violation.
- Inserta `spot_answers` con `found=0`: no debe acreditar puntos.
- Inserta `learn_question_correct` directamente: decidir si se bloquea; si no, documentar que se puede farmear.
- Borra un reporte `descartado`: no debe restar puntos dos veces.
- No puede revisar su propio reporte ni insertar `report_reviews`.
- No puede llamar `admin_*`, `analytics_*`, `nombres_autores`, `resolve_report_consensus`.
- Puede llamar `edit_report_note`/`delete_my_report` solo sobre sus reportes.
- No puede leer fotos de B; sí las propias con URL firmada.

**Revisor**
- Ve reportes `pendiente` y fotos.
- Inserta una review; no puede insertar otra para el mismo reporte.
- No puede revisar su propio reporte.
- Puede llamar `nombres_autores`.
- No puede llamar `admin_*` si no es admin.
- El flujo de consenso se comporta como se decida (1 o 3 votos).

**Admin**
- Puede ver la cola, resolver, avisar, bloquear, set reviewer y analytics.
- No puede bloquearse a sí mismo.
- Las funciones admin rechazan a un usuario normal.

**Storage**
- Bucket privado: URL pública no accesible sin firma.
- Subida solo a `<auth.uid()>/...`.
- Lectura propia o revisor; no de terceros.
- Borrado propio o admin.
- MIME/size límites.
- Path con `..` rechazado por `_foto_valida`.

**Puntos**
- Reporte simple: puntos de `action_types`.
- Antes/después: +5.
- House tour: 5 × estaciones.
- Quiz: 2 por pregunta correcta + bonus 15/8.
- Repaso: bonus 8 una vez/día.
- Rechazo: resta puntos.
- Borrado: resta una sola vez.
- `_sumar_puntos` no ejecutable por `anon`/`authenticated`.

**Datos/privacidad**
- `exportar_mis_datos` solo devuelve datos propios.
- `borrar_mi_cuenta` solo borra la propia; cascada.
- `registrar_evento` guarda `analytics_id`, no `user_id`.
- Rate limit de 60 eventos/minuto.

### 6.3 CI

- `verify`: HTML/JS, migraciones SQL, secret scan.
- `test:db`: pgTAP contra staging/local.
- `test:e2e`: Playwright contra staging.
- `deploy:staging`: automático.
- `deploy:production`: manual/tag.

---

## 7. Staging y baseline

### 7.1 Qué dumpear

- **Sí:** esquema `public` (tablas, constraints, índices, funciones, triggers, políticas RLS, grants), triggers sobre `auth.users` si existen, políticas de `storage.objects` y configuración de `storage.buckets`.
- **No:** `auth.users`, `profiles`, `reports`, `storage.objects` ni datos personales.
- **Catálogos para seed:** `cities`, `action_types`, `tips`, `learn_questions`, `spot_challenges`, `app_settings`; un fixture pequeño de `ovi_*` si se quiere probar el mapa.
- **No** volcar `storage` entero: Supabase gestiona ese esquema; extraer solo políticas y bucket.

### 7.2 Herramientas

- `libpq` (`brew install libpq`) para `pg_dump`/`psql` sin Docker.
- O Supabase CLI + OrbStack/Docker para `db dump`, `supabase test db` y tests locales.

Comando orientativo (revisar privilegios/owners antes de aplicar):

```bash
PGOPTIONS='-c default_transaction_read_only=on' \
pg_dump "$SUPABASE_DB_URL" \
  --schema-only --schema=public --no-owner \
  --file=supabase/migrations/00000000000000_baseline.sql
```

### 7.3 Orden

1. Crear proyecto Supabase de staging.
2. Aplicar baseline.
3. Aplicar `storage` (bucket privado + políticas).
4. Seed de catálogos.
5. Aplicar hardening.
6. Configurar `config.js`/env de staging y `_foto_valida` con el host de staging.
7. Ejecutar pgTAP.
8. Smoke E2E.
9. Recién entonces producción.

---

## 8. Decisiones abiertas

1. **Modelo de revisión:** 1 voto (actual) vs 3 votos (README). Si es 3, cambiar `resolve_report_consensus`, la cola y la UI.
2. **Quiz/“detectar criaderos”:** aceptar scoring client-side en el piloto o mover a RPCs server-side. Si el ranking tiene premios, mover.
3. **`trg_learntp_preparar`:** revisar definición y decidir si el bonus es farmeable.
4. **`_foto_valida`:** `current_setting`, tabla de config o guardar rutas de objeto.
5. **Staging:** `libpq` para el dump vs OrbStack + Supabase CLI.
6. **Legado:** borrar `quizzes`, `incidence`, `tip_reads`, `quiz_answers` cuando se confirme que no se usan.
7. **`review_select`:** quitar la rama del autor si la app no la usa.
8. **House tour:** ¿los reportes `descartado` cuentan para el cooldown? Recomendación: no.
9. **`pedir_municipio`:** rate limit/dedupe/captcha.
10. **Privacidad/legal:** política de privacidad enlazada, retención, contacto del responsable, borrado/exportación (la app ya tiene export/delete).

---

## 9. Referencias

- Scripts de auditoría (read-only):
  - `docs/audit/patrulla_audit_compact.sql`
  - `docs/audit/patrulla_audit.sql`
  - `docs/audit/patrulla_audit2.sql`
- Branch: `deploy/caprover-staging`
- Deploy: `deploy/README.md`, `Dockerfile`, `deploy/nginx.conf`
- App: `index.html`, `admin.html`, `admin-reportes.html`, `config.js`, `sw.js`
- Docs a actualizar: `README.md`, `ADMIN.md` (hablan de `quizzes`/`incidence`, 3 votos, `supabase-fix.sql` inexistente, `PUSH-SETUP.md` inexistente).
- Supabase project: `https://levdxusiudrtutmkyomn.supabase.co` (la `anon/publishable key` es pública por diseño).

---

## 10. Nota sobre el token de CapRover

El app token de CapRover no va en este repo ni en esta documentación. Vive en GitLab CI/CD Variables (masked + protected) o en un gestor de secretos. CapRover lo genera y lo valida; si se pierde, se regenera. El token compartido por chat debe rotarse.
