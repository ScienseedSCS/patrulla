# Tests de Patrulla Antimosquito

Esta suite existe para poder **partir el monolito `index.html` sin romper la app**.
Corre con **Bun + happy-dom**, sin navegador ni Chromium: levanta el HTML real en
un DOM simulado, reemplaza Supabase por un fake en memoria y prueba flujos de
usuario de punta a punta en menos de un segundo.

```bash
bun install
bun test                # toda la suite
bun run test:app        # sólo flujos de la app (happy-dom)
bun run test:static     # estructura, assets, build y presupuesto
```

Salida esperada hoy: **39 tests, 0 fallos, ~1 s**.

---

## 1. Por qué Bun + happy-dom

- **Sin navegador**: no hay `playwright install`, ni Chromium, ni videos, ni
  flakiness de red. Todo corre en el mismo proceso de Bun.
- **Rápido**: la suite completa tarda menos que un `build`.
- **Prueba el HTML real**: no se testea una copia de la lógica; se ejecuta el
  `index.html` que se publica.
- **Determinista**: el fake de Supabase responde siempre igual y no toca datos
  reales ni staging.

El costo es que **no hay layout ni píxeles**: no sirve para regresiones visuales.
Para eso, más adelante, se puede sumar Playwright como capa separada (no hace
falta para la refactorización).

---

## 2. Estructura

```text
tests/
  harness/
    app.js              # carga index.html/admin en happy-dom, stubs, helpers
    fake-supabase.js    # auth + from() + rpc() + storage en memoria
    seed.js             # datos de partida (perfil, acciones, tips, reportes…)
    use-app.js          # afterEach: cierra ventana y falla ante errores JS
  app/
    smoke.test.js       # arranque y pantalla principal
    guest.test.js       # onboarding, login, registro, recuperación
    navigation.test.js  # pestañas, riesgo, deep links, tour
    report.test.js      # reporte simple y antes/después
    learn.test.js       # tips, quiz y detectar criaderos
    review.test.js      # revisor autorizado vs. cuenta común
    profile.test.js     # editar perfil y cerrar sesión
    admin.test.js       # gates de admin.html y admin-reportes.html
  static/
    structure.test.js   # IDs, navegación, CSP, secretos
    links.test.js       # assets, manifest y service worker
    build.test.js       # allowlist de dist/ y referencias locales
    size-budget.test.js # el monolito no puede seguir creciendo
```

### El harness

`tests/harness/app.js` hace lo siguiente:

1. Lee `index.html` (o `admin.html`, `admin-reportes.html`).
2. Saca el `supabase-js` real y `config.js`; no queremos red ni claves.
3. Si hubiera un `src/app.js` externo, lo incrusta (preparado para la próxima
   etapa).
4. Inyecta un `config.js` de test y el fake de Supabase **antes** del script
   que crea el cliente.
5. Escribe el HTML en un `Window` de happy-dom y espera a que la app llegue al
   estado pedido (`bootApp`, `bootGuest`, `bootAdmin`).
6. Expone helpers: `click`, `setValue`, `select`, `upload`, `mockRect`,
   `fakeState`, `dumpStorage`, etc.

### El fake de Supabase

`tests/harness/fake-supabase.js` implementa el subconjunto que usa la app:

- `auth`: `getSession`, `getUser`, `signInWithPassword`, `signUp`, `signOut`,
  `updateUser`, `resetPasswordForEmail`, `onAuthStateChange`.
- `from(tabla)`: `select`, `insert`, `update`, `upsert`, `delete`, `eq`, `neq`,
  `in`, `gte`, `lte`, `order`, `limit`, `single`, `maybeSingle`, `count/head`.
- `rpc(nombre)`: respuestas por defecto y overrides por test.
- `storage.from(bucket)`: `upload`, `remove`, `createSignedUrls`, `getPublicUrl`.

Replica los triggers mínimos que afectan lo que ve el usuario:

- insertar un reporte suma `points_awarded` al perfil;
- insertar `learn_question_correct` suma 2;
- el bonus de `learn_test_progress` se paga una sola vez;
- insertar `spot_answers` suma los puntos del desafío;
- insertar `report_reviews` incrementa `review_count`.

El estado se guarda en `localStorage` bajo `__patrulla_fake_supabase__` y sólo
se reinicia cuando cambia `seedId`. Por eso se puede simular un logout + recarga
sin perder lo que la prueba creó.

### Datos de partida

`tests/harness/seed.js` crea un mundo coherente:

- `Ana` (`user-1`): 400 pts, revisora desactivada, onboarded.
- `Beto` (`user-2`): autor de un reporte pendiente.
- catálogo de acciones, un tip, una pregunta de quiz, un desafío de criaderos,
  una semana de ovitrampas y una ciudad.

Cada test puede pisar lo que necesite:

```js
makeSeed({ profile: { is_reviewer: true } });
makeSeed({ session: false });                 // arranca en login
makeSeed({ tables: { tips: [] } });           // catálogo vacío
makeSeed({ rpc: { foto_repetida: { data: true, error: null } } });
```

---

## 3. Qué cubre hoy

| Área | Pruebas |
|---|---|
| Acceso | onboarding, login inválido/válido, registro con validaciones, recuperación |
| Navegación | 4 pestañas, `aria-current`, deep link `?sec=`, tour inicial |
| Reportar | foto simple (+10), antes/después (+15), puntos, Mis reportes |
| Aprender | tips desplegables, quiz con acierto + bonus, detectar criaderos |
| Revisar | revisor autorizado valida, cuenta común ve el aviso y no la pestaña |
| Perfil | editar nombre, logout y recarga sin sesión |
| Admin | gate de `admin.html` y `admin-reportes.html`, rol admin vs. revisor |
| Estructura | IDs únicos, refs del JS, CSP, sin `service_role`/`sb_secret_` |
| Assets/PWA | links locales, manifest, precache del service worker |
| Build | allowlist de `dist/`, healthz, robots, sin archivos internos |
| Presupuesto | tamaño de `index.html`, líneas del script inline, paneles |

### Límites conocidos (a propósito)

- **No hay layout**: `getBoundingClientRect` devuelve cajas de mentira. Se usa
  `mockRect` para el desafío de criaderos.
- **No hay recarga real**: `location.reload()` se registra y la prueba simula
  la recarga con una ventana nueva + `localStorage` copiado.
- **No hay canvas real**: `processImage` usa un canvas stub; lo que se prueba
  es el flujo, no la calidad del JPEG.
- **No hay red**: el fake cubre lo que la app usa. Si se agrega una consulta
  nueva, hay que extender el fake (ver abajo).
- **No hay push/geolocation reales**: se evitan con el seed (`push_prompted`).
- **El harness evalúa el HTML del repo**: happy-dom ejecuta JavaScript inline
  (por eso es tan útil). No lo uses para cargar HTML de terceros.
- **No valida RLS, triggers ni el esquema real de Supabase**: el fake replica
  el comportamiento que la app espera. Para el esquema real están los scripts
  de `docs/audit/` y `deploy/smoke.sh` contra staging.

---

## 4. Cómo agregar una prueba

### Un flujo de usuario

```js
import { describe, expect, test } from 'bun:test';
import { bootApp, makeSeed } from '../harness/app.js';
import { useApp } from '../harness/use-app.js';

const slot = useApp();

test('mi flujo', async () => {
  slot.app = await bootApp({ seed: makeSeed({ profile: { is_reviewer: true } }) });
  const app = slot.app;

  app.click('.navbtn[data-sec="revisar"]');
  await app.waitFor(() => app.q('.review-item'));

  expect(app.text('#modalAuthor')).toBe('Beto');
});
```

Reglas:

- Usar `useApp()`: cierra la ventana y **falla si hubo un error JS no controlado**.
- Esperar con `await app.waitFor(...)`; nunca usar `sleep` fijo.
- Preferir selectores de contrato (`#id`, `.clase`, `[data-*]`) y textos visibles.
- Si una consulta nueva no está en el fake, agregarla en
  `fake-supabase.js` (y su caso en `seed.js`). No mockear la app entera.

### Una regla estructural

Sumar un caso en `tests/static/structure.test.js`. Ejemplos útiles cuando se
parta el HTML:

- que cada `<script src>` local exista;
- que el bundle no incluya `config.js` ni claves;
- que las secciones y `data-sec` sigan mapeando 1:1.

---

## 5. Plan para dejar de servir un único `index.html`

La suite es la red de seguridad. La refactorización se hace en pasos chicos,
siempre con `bun test` en verde. **No se cambia el comportamiento en el mismo
commit en que se mueve código.**

### Fase 0 · Red de seguridad (hecha)

- Suite E2E con fake de Supabase.
- Tests estáticos de estructura, assets, build y presupuesto.
- `index.html` no puede crecer: `tests/static/size-budget.test.js`.

### Fase 1 · CSS afuera

- Mover el `<style>` a `src/styles.css`.
- `index.html` queda con `<link rel="stylesheet" href="styles.css">`.
- Actualizar `scripts/build.mjs`, `sw.js` y `deploy/` si hace falta.
- Bajar el presupuesto de `index.html`.
- Tests que ya cubren: assets, build, flujos (no cambia el DOM).

### Fase 2 · JS afuera, sin cambiar la lógica

- Mover el script inline a `src/app.js` **tal cual** (IIFE, sin imports).
- `index.html`: `<script src="app.js"></script>`.
- El harness ya sabe incrustar un `app.js` local; no debería necesitar cambios.
- `scripts/build.mjs` y `sw.js` publican/cachean `app.js`.
- Bajar el presupuesto de `index.html` a la mitad o menos.

### Fase 3 · Módulos de dominio puros

Extraer primero lo que no toca el DOM y tiene tests unitarios fáciles:

- `src/domain/levels.js` (`LEVELS`, `currentLevel`)
- `src/domain/points.js` (reglas de puntos y bonus)
- `src/domain/risk.js` (`riskWeeksFor`, `weekRange`, semáforo)
- `src/domain/hotspots.js` (`parseHotspots`, tolerancia de toque)
- `src/domain/format.js` (`esc`, `nf`, fechas)

Cada extracción:

1. Mover la función sin cambiar su salida.
2. Importarla desde `src/app.js`.
3. Agregar `tests/unit/<modulo>.test.js` con casos de borde.
4. Mantener los E2E en verde.

### Fase 4 · Capa de datos

- `src/data/supabase.js`: crear el cliente y centralizar tablas/RPC.
- `src/data/profile.js`, `src/data/reports.js`, `src/data/learn.js`.
- Reemplazar llamadas `db.from(...)` dispersas por funciones nombradas.
- Los tests siguen usando el mismo fake: sólo cambia quién llama a `db`.

### Fase 5 · Vistas y shell

- Partir el HTML por sección (`src/views/*.js` o templates).
- `index.html` queda como shell mínimo (head, contenedores, `<script src>`).
- Opcional: bundle con `Bun.build` o esbuild. Si el bundle es un IIFE clásico,
  el harness actual sigue funcionando; si es ESM, adaptar el harness para
  cargar módulos.
- Endurecer la CSP: sacar `'unsafe-inline'` de `script-src` y `style-src`.
- Mover los E2E a `dist/` (o al bundle) para probar el artefacto exacto que se
  publica. Hoy prueban la fuente y `build.test.js` verifica que `dist/`
  publique lo mismo.

### Fase 6 · Admin y build único

- Extraer la lógica compartida de `admin.html` / `admin-reportes.html`.
- Un solo pipeline de build para app + paneles.
- Tests de gates ya existen; sumar tests de acciones de moderación.

### Regla de oro

Cada PR de refactor debe:

1. No cambiar comportamiento observable.
2. Mantener `bun test` en verde.
3. **Bajar** el presupuesto de `size-budget.test.js` cuando corresponda.
4. Actualizar `scripts/build.mjs` y `sw.js` si agrega archivos nuevos.

---

## 6. CI

El workflow `.github/workflows/tests.yml` corre `bun install --frozen-lockfile`
y `bun test` en cada push y pull request. No necesita secretos ni Supabase:
todo el backend está fakeado.
