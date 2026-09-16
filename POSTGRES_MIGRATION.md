# Migración de SQLite a Supabase PostgreSQL

Esta etapa añade PostgreSQL en paralelo. El servidor actual continúa usando SQLite hasta que todas las rutas sean portadas y aprobadas.

## Variables privadas

Usa la URL del **Transaction pooler** de Supabase, normalmente en el puerto 6543. Nunca uses un nombre `VITE_*` para esta credencial.

```dotenv
DATABASE_URL=postgresql://usuario:clave@host-pooler:6543/postgres?sslmode=require
MIGRATION_SQLITE_PATH=C:\ruta\al\proyecto\data\fantasy-lpf.sqlite
```

`POSTGRES_URL` también es reconocido si la integración de Vercel entrega ese nombre. `DATABASE_URL` tiene prioridad.

## Crear el esquema

Vincula la CLI de Supabase al proyecto y aplica las migraciones versionadas:

```powershell
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

También puedes pegar la migración `supabase/migrations/202609150001_initial_schema.sql` en el editor SQL de Supabase una sola vez. La CLI es preferible porque registra la versión aplicada.

## Importar los datos

Antes de importar, detén temporalmente escrituras en la aplicación SQLite y conserva una copia del archivo. El importador verifica `integrity_check` y las claves foráneas antes de copiar.

```powershell
npm run db:import:postgres
```

Por seguridad, el comando se detiene si cualquiera de las 35 tablas de destino contiene datos. Si una ejecución fue interrumpida, puedes reanudarla de forma idempotente:

```powershell
npm run db:import:postgres -- --allow-existing
```

El importador conserva IDs, hashes de contraseña, precios, historial y vínculos externos. Convierte los indicadores `0/1` a booleanos, los JSON de texto a `jsonb`, las fechas a tipos temporales de PostgreSQL y mantiene el dinero como `bigint`.

## Validar sin escribir

```powershell
npm run db:validate:postgres
```

El reporte compara para cada tabla:

- cantidad de filas;
- huella SHA-256 de sus claves primarias;
- sumas de saldos, precios y puntos relevantes.

La migración solo se considera completa cuando `success` es `true` y `failed` está vacío.

## Cliente del servidor

`server/postgres/client.ts` abre como máximo una conexión por instancia serverless, desactiva prepared statements para compatibilidad con Supavisor en modo transaccional y expone operaciones asíncronas:

- `query`, `one`, `maybeOne` y `execute`;
- `transaction`, que entrega un ejecutor ligado a una sola transacción;
- `getPostgresDatabase`, singleton para funciones de Vercel;
- `closePostgresDatabase`, destinado a scripts y pruebas, no a cada petición web.

Todas las consultas nuevas deben usar placeholders PostgreSQL `$1`, `$2`, etc. Las operaciones que cambian equipos, transferencias, jornadas o precios deben ejecutar lecturas de validación y escrituras dentro de una sola `transaction`.

## Seguridad

Las tablas tienen RLS habilitado y no conceden acceso a los roles `anon` ni `authenticated`. La aplicación accede únicamente desde el backend mediante la conexión privada. Las credenciales de PostgreSQL y el secreto del cron no deben incluirse en GitHub.
