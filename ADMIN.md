# Guía del administrador · Patrulla Antimosquito

Tareas que se hacen desde el panel de **Supabase** (supabase.com → tu proyecto), sin tocar código.

## Aprobar un municipio nuevo

1. Alguien pide un municipio desde la app → aparece en **Table Editor → `city_requests`** (estado `pendiente`).
2. Si corresponde habilitarlo: **Table Editor → `cities` → Insert row**
   - `name`: el nombre del municipio (tal cual debe verse).
   - `province`: la provincia (opcional).
   - `active`: `true`.
3. (Opcional) En `city_requests`, cambiá el `status` de esa solicitud a `aprobado` o `rechazado` para llevar registro.

El municipio aparece al instante en el alta de usuarios. **No hace falta editar archivos ni volver a publicar.**

> Para ocultar un municipio sin borrarlo, poné su `active` en `false`.

## Ver las solicitudes de municipio

**Table Editor → `city_requests`**. Cada fila trae el municipio pedido, la provincia, y (si lo dejaron) el email de quien lo pidió.

Si además querés recibirlas por **email automático**: en `index.html`, arriba del script, está el bloque `CONFIGURACIÓN EDITABLE`. Creá una clave gratis en https://web3forms.com asociada al correo que quieras y pegala en `WEB3FORMS_KEY`. Desde ahí, cada solicitud te llega también por mail.

## Actualizar la incidencia por ciudad

La pestaña "Incidencia" de la app lee la tabla **`incidence`**. Para cada municipio podés cargar/editar una fila:
- `city`: debe coincidir con el nombre en `cities`.
- `risk_level`: `bajo`, `medio`, `alto` o `critico`.
- `cases_week`: número de casos de la semana.
- `message`: el texto que se muestra.

Los municipios sin fila en `incidence` aparecen igual, con la leyenda "Sin datos de incidencia aún".

## Editar acciones, tips y quizzes

- **Acciones** (`action_types`): el campo `location` define el grupo en la app — usá `exterior`, `interior` o `ambos`. `points` son los puntos, `icon` el emoji, `sort_order` el orden.
- **Tips** (`tips`) y **Quizzes** (`quizzes`): se editan directo en sus tablas; los cambios aparecen sin republicar.

## Moderación de reportes

Los reportes están en **`reports`**. Un reporte se valida solo cuando junta 3 votos "correcto" de revisores (usuarios con 350+ puntos). Si necesitás intervenir, podés cambiar el `status` a mano (`pendiente` / `validado` / `descartado`).

Si una foto aparece en más de un reporte, los revisores ven una alerta en la app; en la tabla podés detectarlo por la columna `photo_hash` repetida.

## Agregar un desafío de "Detectar criaderos"

Estos desafíos (foto + focos a tocar) viven en la tabla **`spot_challenges`**. Ya viene uno de ejemplo (`caso1.jpg`).

Para agregar otro:

1. **Subí la foto** a la raíz del repo (ej. `caso2.jpg`) o a Supabase Storage, y anotá su dirección.
2. **Table Editor → `spot_challenges` → Insert row:**
   - `title`: nombre del desafío.
   - `image_url`: `caso2.jpg` (o la URL completa si está en Storage).
   - `points`: puntos que da completarlo (ej. `10`).
   - `hotspots`: un JSON con los focos correctos. Cada foco es `{"x":..,"y":..,"r":..,"label":".."}` donde:
     - `x` = posición horizontal como fracción de 0 (izquierda) a 1 (derecha).
     - `y` = posición vertical como fracción de 0 (arriba) a 1 (abajo).
     - `r` = radio de tolerancia (cuán cerca hay que tocar). `0.06` funciona bien.
     - `label` = qué es (se muestra al acertar o al ver la solución).
   - Ejemplo:
     ```json
     [{"x":0.42,"y":0.30,"r":0.06,"label":"Balde con agua"},
      {"x":0.29,"y":0.66,"r":0.06,"label":"Regadera"}]
     ```

> **Truco para sacar las coordenadas fácil:** mandale a quien arma el contenido dos versiones de la foto — una normal y otra en blanco y negro con los criaderos resaltados en color — y las coordenadas se pueden extraer automáticamente de la versión resaltada. (Así se cargó el caso de ejemplo.)

## Notificaciones push (temporada)

El envío de notificaciones se enciende/apaga por temporada desde una sola fila.
**SQL Editor:**

```sql
update public.app_settings set push_season = 'alta' where id = 1;
```

Valores: `off` (nada), `baja` (invierno: solo avisos por evento como "reporte validado"), `media` (arranque/cierre de temporada), `alta` (pico Dic–Abr: cadencia completa). Seguí el calendario del Ministerio de Salud para decidir cuándo cambiarlo.

Las solicitudes de municipio, los reportes y demás no cambian. El detalle técnico del envío está en `PUSH-SETUP.md`.
