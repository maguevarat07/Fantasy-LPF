# Fantasy LPF

Aplicación multiusuario con frontend React, API Express y base persistente SQLite. La sesión se guarda en una cookie opaca `httpOnly`; usuarios, borradores de onboarding, equipos, alineaciones, ligas, transferencias y comodines se validan y persisten en el servidor.

## Uso local

Requiere Node.js 20 o posterior.

```bash
npm ci
npm run sync:lpf
npm run dev
```

Durante desarrollo el frontend se abre en `http://localhost:3000` y la API en `http://localhost:3001`. Para uso local compilado, ejecuta `npm run build` y luego `npm start`; Express sirve la aplicación y la API en `http://localhost:3001`.

Cada usuario tiene un único Fantasy Team por torneo. Ese mismo equipo puede pertenecer a varias ligas privadas, y los endpoints verifican la sesión y la propiedad del equipo antes de leer o modificar datos. Los cambios de alineación, fichajes y comodines respetan el deadline guardado por el servidor; si falta una jornada oficial, la operación se rechaza.

## Datos LPF

`npm run sync:lpf` ejecuta los adaptadores del lado servidor y actualiza `data/fantasy-lpf.sqlite`. La temporada configurada usa la competición PN1A 2026 de Transfermarkt para obtener los 12 clubes, sus plantillas, posiciones, dorsales, nacionalidades, fotos y el señuelo gris cuando no existe retrato. También guarda IDs externos, observaciones crudas, cambios de club y vigencia de cada inscripción.

Las fuentes cumplen funciones complementarias. LPF oficial contrasta identidad, club, posición y los totales acumulados que publica. Soccerway, FotMob y 365Scores aportan calendario y marcadores estructurados. El resumen `verification` de la sincronización muestra coincidencias, conflictos y partidos con una sola fuente. Una discrepancia nunca sobrescribe silenciosamente el dato canónico. Los totales oficiales sin identificador de partido o torneo se conservan como evidencia y no se convierten directamente en puntos Fantasy.

La LPF de Panamá usa el identificador `9039` en FotMob. El identificador `10007`, presente en una configuración anterior, correspondía a una competición argentina.

Una respuesta parcial o bloqueada nunca desactiva jugadores. El catálogo se reemplaza por la plantilla activa de Transfermarkt únicamente cuando la ejecución confirma 12 clubes y al menos 180 jugadores.

El esquema también conserva jornadas, partidos, IDs externos, estadísticas por partido, estado de asistencias y puntos auditables por componente. El cálculo `lpf-v1` aplica participación, goles según posición, asistencia confirmada, portería a cero, tarjetas y autogoles de forma idempotente. Si una fuente todavía no entrega datos verificables, la interfaz muestra un estado vacío en vez de completar el calendario o las estadísticas con ejemplos.

Las variables opcionales están documentadas en `.env.example`.

El worker periódico se habilita con `ENABLE_DATA_SYNC=true`; `DATA_SYNC_INTERVAL_HOURS` controla el intervalo y `DATA_SYNC_RUN_ON_START=true` solicita una ejecución al iniciar. También puede invocarse `npm run sync:lpf` desde un cron externo. Cada sincronización recalcula las jornadas finalizadas.

## Market Momentum

La demanda del mercado es una señal opcional y secundaria. Se activa únicamente con `MARKET_MOMENTUM_ENABLED=true`; apagada, el motor deportivo funciona igual y registra momentum cero. Cuenta solo fichajes confirmados originados por usuarios, excluye operaciones iniciales, banca, seeds, tests, administración y reversiones. Los movimientos con Comodín pesan 25%.

La señal usa `(entradas ponderadas - salidas ponderadas) / equipos activos`. Solo cuentan equipos completos de 15 jugadores. Con menos de 50 equipos activos su peso es cero; entre 50 y 100 escala linealmente y desde 100 alcanza fuerza completa, siempre sujeto a un mínimo de 100 items válidos en 24 horas. Su presión queda limitada a ±$0.1M y nunca modifica el `fairPrice` deportivo.

Como protección básica, las cuentas menores de 24 horas no aportan señal, un equipo con más de 15 items en la ventana se excluye y cada equipo solo puede contribuir una unidad neta por jugador. Estos controles reducen churn y ataques simples; el feature flag debe permanecer apagado hasta contar con suficiente actividad real y monitoreo de cuentas coordinadas.

## Verificación

```bash
npm test
npm run test:final
npm run lint
npm run typecheck
npm run build
npm audit
```

`npm run test:final` crea una copia consistente de SQLite y ejecuta el examen de dos usuarios: dos equipos independientes, el mismo equipo asociado explícitamente a dos ligas, liga compartida, rechazo de una liga ajena, aislamiento entre sesiones y persistencia después de reiniciar la API.
