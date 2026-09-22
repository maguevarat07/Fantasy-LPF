# Migración del scheduler a Supabase — estado de preparación

Fecha: 2026-09-21. Rama local: `supabase-scheduler-cutover`. **No desplegada.** Vercel Cron sigue configurado; Supabase Cron productivo no existe. La instalación de migraciones productivas fue bloqueada por la revisión automática y no se reintentó por otra vía.

## Implementado y verificado localmente

- `api/automation/worker.ts` comprueba el secreto interno y devuelve 503 si `SUPABASE_PRODUCTIVE_WORKER_ENABLED` no es `true`. Atiende un mensaje por request. Publica el siguiente mensaje y archiva el actual dentro de una misma transacción.
- Publicación en lotes de 50 entidades/100 observaciones; scoring en lotes de tres jornadas con `pipeline_runs.score_cursor`. El cursor solo avanza tras completar cada lote. La ruta Vercel Cron antigua conserva su tamaño de lote anterior.
- `supabase/migrations/202609200001_pipeline_queue.sql` crea la cola Basic `fantasy_pipeline` y dispatcher idempotente sin instalar Cron. `202609210003` añade el cursor. `202609210004` instala `pg_net`, función de wake-up que lee el secreto de Vault y una tabla de solicitudes, sin instalar Cron.
- `scripts/activate-supabase-scheduler.sql` agenda dispatcher cada minuto y limpieza semanal de mensajes archivados mayores de 30 días. `scripts/pause-supabase-scheduler.sql` desprograma ambas tareas y conserva la cola, run y checkpoints.
- El migrador acepta una lista exacta de archivos para evitar aplicar migraciones históricas fuera de este alcance.
- Regresión: 115/115 tests, 23/23 archivos; typecheck, lint y build pasan. Pruebas PostgreSQL QA cubren cola, retry, visibility timeout, checkpoints, RLS y scoring por jornadas. No se ha probado aún `pg_net` productivo ni la URL Vercel del worker.

## Orden de despliegue y validación pendiente

1. Confirmar autorización explícita en un mensaje para cambiar esquema, secretos y schedulers productivos.
2. Aplicar las tres migraciones seleccionadas, sin instalar Cron. Verificar `pgmq.list_queues()`, columnas, funciones, `pg_extension` y RLS. Confirmar que no hay jobs en `cron.job`.
3. Desplegar esta rama **con las 24 entradas Cron de Vercel intactas**. El flag permanece OFF. Verificar deployment SHA y endpoint: 401 sin secreto, 503 con secreto y flag apagado.
4. Crear un secreto aleatorio dedicado de al menos 32 caracteres, guardarlo en `PIPELINE_WORKER_SECRET` de Vercel Production y en Supabase Vault con nombre `fantasy_pipeline_worker_secret`. No guardarlo en Git, navegador ni logs. Se requiere intervención del usuario para introducir una credencial nueva en el panel web de Vercel.
5. Encender temporalmente el flag para una invocación productiva controlada, lejos de un Vercel Cron activo. Verificar un mensaje, lease, checkpoint, retry, ausencia de duplicados y respuesta HTTP. Dejar Cron Supabase sin programar durante la prueba.
6. Solo si todo pasa: comprobar que no hay worker/lease activo, desplegar `vercel.json` sin `crons` y verificar el deployment. Ejecutar `scripts/activate-supabase-scheduler.sql`. Registrar hora UTC, primer `cron.job_run_details`, `pipeline_runs`, cola, logs del worker y estado final.
7. Probar pausa SQL sin borrar mensajes. Para rollback real: pausar Supabase Cron, poner el flag OFF, esperar visibilidad/lease, restaurar el deployment Vercel con las 24 entradas Cron y permitir que continúe desde el mismo `pipeline_runs`.

## Puertas actuales

PG_CRON: instalado, no programado para producción.
PG_NET: pendiente de instalar.
PGMQ: extensión instalada; cola productiva pendiente.
VAULT: extensión instalada; secreto dedicado pendiente.
WORKER: probado localmente, no desplegado.
SUPABASE CRON PRODUCTIVO: OFF.
VERCEL CRON: ON.
CUTOVER: NO.
AUTOMATIC SUPABASE INVOCATION: NOT YET OBSERVED.

La migración solo se puede declarar operativa después de un ciclo automático real y de comprobar las invariantes de datos productivos.
