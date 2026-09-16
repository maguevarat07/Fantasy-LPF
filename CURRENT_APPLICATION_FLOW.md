# Flujo actual de Fantasy LPF

```mermaid
flowchart TB
  subgraph DATA[Fuentes deportivas externas]
    LPF[LPF<br/>partidos, publicaciones y datos oficiales]
    TM[Transfermarkt<br/>clubes, plantillas, altas, bajas y fotos]
    SW[Soccerway<br/>partidos y verificación]
    FM[FotMob<br/>partidos, alineaciones y estadísticas]
    S365[365Scores<br/>partidos y verificación]
  end

  CRON[Vercel Cron<br/>diario 08:00 UTC / 03:00 Panamá]
  LEASE[Lease de sincronización<br/>evita ejecuciones simultáneas]

  subgraph INGEST[Backend: ingestión y verificación]
    ADAPTERS[Adaptadores por fuente<br/>descarga y normalización]
    OBS[Observaciones originales<br/>URL, fuente, estado y evidencia]
    IDS[External IDs<br/>club, jugador y partido por fuente]
    RECON[Reconciliación conservadora<br/>identidad, club, jugador y partido]
    VERIFY[Verificación cruzada<br/>working / partial / blocked / conflictos]
    GATE[Compuerta de seguridad<br/>sin conflictos de verificación]
  end

  subgraph CORE[Supabase PostgreSQL: fuente de verdad]
    CANON[Datos canónicos<br/>clubes, jugadores, partidos y jornadas]
    ROSTER[Registro del torneo<br/>plantillas activas y movimientos de club]
    STATS[Estadísticas por jugador y partido]
    FANTASY[Usuarios, sesiones, equipos, XI,<br/>ligas, transferencias y propiedad]
    HISTORY[Historial<br/>syncs, puntos y precios]
  end

  subgraph ECON[Motor Fantasy del servidor]
    SCORE[Fantasy Points<br/>reglas oficiales por partido]
    CLOSE[Cierre y recálculo<br/>de jornadas finalizadas]
    PRICE[Pricing Engine<br/>rendimiento, forma, apariciones,<br/>participación y shrinkage]
    MARKET[Mercado de la jornada siguiente<br/>current, purchase y selling price]
  end

  subgraph APP[Aplicación en Vercel]
    API[API Express serverless<br/>validación, autorización y reglas]
    WEB[Frontend React/Vite<br/>catálogo, onboarding, equipo,<br/>mercado, ligas y clasificación]
    USER[Usuario en navegador<br/>sesión mediante cookie httpOnly]
  end

  LPF --> ADAPTERS
  TM --> ADAPTERS
  SW --> ADAPTERS
  FM --> ADAPTERS
  S365 --> ADAPTERS
  CRON --> LEASE --> ADAPTERS
  ADAPTERS --> OBS
  ADAPTERS --> IDS
  OBS --> RECON
  IDS --> RECON
  RECON --> VERIFY
  RECON -->|solo identidades aceptadas| CANON
  VERIFY --> GATE
  GATE --> ROSTER
  CANON --> STATS
  STATS --> SCORE
  GATE --> SCORE
  SCORE --> CLOSE --> PRICE --> MARKET
  SCORE --> HISTORY
  PRICE --> HISTORY
  CANON --> API
  ROSTER --> API
  MARKET --> API
  FANTASY <--> API
  HISTORY --> API
  API <--> WEB <--> USER
```

## Recorrido de una actualización deportiva

1. Vercel ejecuta `/api/cron/sync` una vez al día y valida su firma secreta.
2. Un lease en PostgreSQL impide que dos sincronizaciones modifiquen los datos simultáneamente.
3. Los adaptadores consultan LPF, Transfermarkt, Soccerway, FotMob y 365Scores desde el servidor.
4. Se conservan las observaciones de cada fuente y sus identificadores externos.
5. El reconciliador relaciona jugadores, clubes y partidos sin unir identidades ambiguas.
6. Las identidades reconciliadas y aceptadas se guardan en el catálogo; las ambiguas quedan como evidencia y conflicto.
7. Si la verificación detecta conflictos, el flujo se detiene antes de actualizar el registro del torneo o recalcular la economía.
8. Se recalculan los puntos Fantasy de las jornadas finalizadas.
9. El Pricing Engine calcula los precios siguientes y guarda su historial de forma idempotente.
10. La API entrega al frontend los precios, puntos y datos persistidos en Supabase.

## Recorrido de una acción del usuario

1. React carga el catálogo público desde la API.
2. Registro e inicio de sesión crean una sesión persistente mediante cookie `httpOnly`.
3. Onboarding, alineaciones, ligas y transferencias se envían a la API.
4. El backend comprueba presupuesto, posiciones, máximo por club, deadline, transferencias gratuitas, penalizaciones y precios.
5. PostgreSQL guarda la operación y el frontend vuelve a leer el estado confirmado por el servidor.

El frontend no calcula de forma autoritativa los puntos, el precio actual, el precio de venta ni el precio de compra.
