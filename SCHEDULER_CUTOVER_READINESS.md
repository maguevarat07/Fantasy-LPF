# Migración del scheduler a Supabase — cutover productivo

Fecha del cutover: 2026-09-22 UTC. Código productivo: `0f0ae25c130469b764953c65fc5c5cfe8b0ff1a8`.

## Estado verificado

- Vercel conserva frontend, API y worker `api/automation/worker.ts`. El deployment está READY y el panel Project Settings → Cron Jobs no lista tareas; `vercel.json` no tiene `crons`.
- Supabase PostgreSQL ejecutó las migraciones `202609200001`, `202609210003` y `202609210004`–`202609210007`. `pg_cron`, `pgmq` y `pg_net` están instalados; la cola Basic `fantasy_pipeline` y el secreto de Vault existen. El secreto no se almacena en Git ni se registra aquí.
- `fantasy_pipeline_dispatch` está activo cada minuto para despertar mensajes y crear un nuevo ciclo cuando el último terminó hace al menos 24 horas. `fantasy_pipeline_archive_prune` limpia los mensajes archivados mayores de 30 días los domingos.
- `SUPABASE_PRODUCTIVE_WORKER_ENABLED=true` en Vercel Production. El worker exige `PIPELINE_WORKER_SECRET`; los usuarios `anon`, `authenticated` y `fantasy_lpf_app` no pueden ejecutar el dispatcher interno.

## Evidencia de prueba productiva

Run `7da23915-ee24-4f07-a8bb-679801c6718b`: INGESTED → PUBLISHING → RECONCILED → SCORING → SCORED → PRICED; sin `last_error`. Procesó 4 558 registros obtenidos y aceptó 1 553. El checkpoint avanzó por 1 470 entidades y 2 647 observaciones. Tiempos acumulados: ingestión 84 473 ms, publicación 56 014 ms, scoring 6 083 ms, pricing 3 357 ms. El pricing run de `apertura-2026-gw-9` terminó `COMPLETED` a las 03:28:34 UTC.

Hubo dos fallos detectados y corregidos antes del cutover: el uso de `now()` no veía el mensaje recién creado por `pgmq.send` dentro de la misma transacción (`202609210005` usa `clock_timestamp()`), y el timeout HTTP de 10 s ocultaba el resultado de la ingestión de 84 s (`202609210006` usa 290 s). La prueba repetida devolvió 200 y archivó los mensajes de forma atómica. Lint, typecheck y build pasaron; la suite QA previa tuvo 115/115 tests.

Cron productivo invocó el dispatcher automáticamente desde las 03:30 UTC. Prueba automática completa de entrega a las **03:34:00 UTC**: mensaje 61 para un run ya PRICED → wake-up `pg_net` 61 → worker HTTP 200 → archivo en `pgmq.a_fantasy_pipeline` a las 03:34:00.724 UTC. No se creó otro run; cola vacía y ningún lease activo.

## Condiciones y operación

El run tuvo `quality_status=PARTIAL` por 71 conflictos de identidad bloqueantes aislados y uno no bloqueante ya presentes; su `scoring_status=SCORED` y `pricing_status=PRICED`. Estos conflictos requieren revisión de datos, pero no bloquearon las entidades no afectadas. La próxima creación automática de un ciclo nuevo después del guard de 24 horas **todavía no se ha observado**; no se debe confundir la prueba automática del wake-up con un nuevo ciclo completo automático.

Para pausar, ejecutar `scripts/pause-supabase-scheduler.sql`; conserva run, cola y checkpoints. Para rollback: pausar Supabase Cron, apagar el flag del worker, esperar a que cese el lease y restaurar un deployment Vercel con los Cron anteriores. No activar ambos programadores de forma permanente.
