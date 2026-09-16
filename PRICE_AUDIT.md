# Fantasy LPF — auditoría y arquitectura del sistema de precios

Fecha de corte: 2026-09-13 (America/Panama)  
Torneo auditado: `apertura-2026`  
Base auditada: `data/fantasy-lpf.sqlite`  
Alcance: auditoría, medición, simulación y contratos. No se modificaron precios ni datos de producción.

## PRICE AUDIT BEFORE

El supuesto de que todos los jugadores de una posición tienen exactamente el mismo precio ya no describe el estado actual del código. Existe un motor dinámico en `server/pricing.ts`. Aun así, el motor es demasiado simple: solo usa puntos totales y apariciones para producir un promedio de puntos por partido reducido hacia un prior fijo.

Flujo actual verificado:

1. `scripts/sync-lpf-data.ts` inserta al jugador nuevo en `tournament_players` con un precio base por posición: GK $3.50M, DEF $4.00M, MID $4.20M y FWD $4.50M.
2. Al terminar la sincronización ejecuta `recalculatePlayerPrices()`.
3. `server/pricing.ts::priceForPerformance()` calcula un promedio efectivo con prior de 1.5 puntos y tres partidos de shrinkage, aplica una cantidad lineal por punto y limita el resultado por posición.
4. Redondea a $0.05M, no a $0.10M.
5. `server/pricing.ts::recalculatePlayerPrices()` actualiza directamente `tournament_players.price_cents`.
6. `scripts/recalculate-points.ts` vuelve a recalcular puntos y precios.
7. `/api/catalog` expone `tournament_players.price_cents`; `src/services/lpfDataService.ts` lo convierte a millones en `Player.price`.
8. El onboarding y `server/teamRules.ts` validan el presupuesto contra ese precio del torneo.
9. Al adquirir un jugador, `squad_players.purchase_price_cents` conserva el precio de compra.
10. Al venderlo, `server/app.ts` acredita actualmente el precio de compra, no el precio de mercado vigente. `transfer_items` conserva el precio de venta y compra de cada operación.

Parámetros actuales encontrados en `server/pricing.ts`:

| Posición | Base actual | Incremento por punto del promedio efectivo | Máximo actual |
|---|---:|---:|---:|
| GK | $3.50M | $0.90M | $9.00M |
| DEF | $4.00M | $1.00M | $10.00M |
| MID | $4.20M | $1.10M | $11.50M |
| FWD | $4.50M | $1.30M | $13.00M |

Distribución real antes de cualquier cambio, usando los 288 jugadores activos del torneo y cuantiles R-7:

| Posición | N | Mín. | P25 | Mediana | Promedio | P75 | P90 | P95 | Máx. | Precios distintos |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GK | 27 | 4.05 | 4.75 | 4.85 | 5.01 | 5.40 | 5.67 | 5.89 | 6.15 | 11 |
| DEF | 91 | 4.25 | 5.40 | 5.50 | 5.77 | 5.98 | 6.60 | 7.58 | 8.65 | 30 |
| MID | 87 | 4.60 | 5.40 | 5.70 | 5.88 | 6.15 | 6.85 | 7.25 | 9.80 | 21 |
| FWD | 83 | 5.05 | 6.18 | 6.45 | 7.04 | 7.45 | 8.55 | 9.83 | 13.00 | 31 |

La diferenciación existe, pero sigue concentrada cerca de la mediana, sobre todo en GK y MID. El prior explica parte del agrupamiento: un FWD sin partidos se recalcula alrededor de $6.45M, porque recibe el promedio neutral de 1.5 antes de tener evidencia deportiva.

La plantilla de mayor puntuación cuesta $128.7M con los precios actuales. Por tanto, el mercado actual ya impide comprar simultáneamente a todos los mejores; el problema vigente es la calidad y explicabilidad de la clasificación económica, no una ausencia total de presión presupuestaria.

Los precios fijos encontrados fuera de producción son fixtures de pruebas en `server/app.test.ts` y `server/pricing.test.ts`, además de datos ilustrativos claramente etiquetados en la portada. No son la fuente de verdad del mercado.

## DATA AVAILABILITY

| Dato | Estado verificado | Fuente / limitación |
|---|---|---|
| Posición y club | Disponible | `players`, con relación a `clubs`. |
| Precio vigente por torneo | Disponible | `tournament_players.price_cents`; es la fuente autoritativa actual. |
| Campo de precio global del jugador | Existe, pero es legado/ambiguo | `players.price_cents`; no debe usarse como precio de torneo. |
| Fantasy Points totales | Disponible y derivable | Suma de `player_fantasy_points.total_points`. |
| Puntos por jornada | Disponible y derivable | `player_fantasy_points.gameweek_id`, agregando los partidos de la jornada. |
| Desglose de puntos | Disponible | Participación, gol, asistencia, portería a cero y sanciones están separados en `player_fantasy_points`. |
| Apariciones | Parcial, derivable | Se infiere de `participation_points > 0`; conviene materializar una definición única a partir de minutos/titular/suplente. |
| Minutos, titularidad y entrada como suplente | Disponible parcialmente | `player_match_stats`; hay 794 filas de estadísticas. |
| Tasa de participación | Parcial, derivable | Requiere definir el denominador de partidos elegibles del club y tratar correctamente fichajes entre clubes. |
| Forma reciente | Derivable, no modelada correctamente en API | Puede calcularse por últimas N jornadas. El campo llamado `recentForm` en `/api/catalog` es actualmente un promedio de todo el historial, no una ventana reciente. |
| Precio de compra | Disponible | `squad_players.purchase_price_cents`. |
| Precio de venta | No existe como estado independiente | Se calcula hoy usando el precio de compra; `transfer_items.sell_price_cents` solo registra ventas ya ejecutadas. |
| Historial de precio | No disponible | Solo existe el precio actual en `tournament_players`. |
| Transferencias IN/OUT | Estructura disponible, muestra inexistente | `transfers` y `transfer_items` existen, pero la base contiene 0 transferencias y 0 items. |
| Ownership actual | Derivable | Conteo de `squad_players`; solo existen 2 equipos y 26 jugadores distintos en propiedad. |
| Ownership histórico | No disponible | No hay snapshots de propiedad por jornada. |

Cobertura medida:

- 608 jugadores canónicos totales y 608 relaciones con el torneo; 288 están activos/seleccionables.
- 246 de 288 activos tienen alguna fila de Fantasy Points; 244 tienen al menos una aparición inferida.
- Existen 16 jornadas y 96 partidos, pero solo las jornadas 1–7 tienen puntos calculados.
- Existen 778 filas en `player_fantasy_points` y 794 en `player_match_stats`.
- Existen 30 holdings en `squad_players`, pertenecientes a 2 equipos.
- La muestra es insuficiente para activar momentum por mercado.

Distribución de puntos acumulados por posición:

| Posición | Mín. | Mediana | P75 | P90 | P95 | Máx. |
|---|---:|---:|---:|---:|---:|---:|
| GK | -2 | 2 | 6.5 | 8 | 11.5 | 14 |
| DEF | -3 | 3 | 6 | 10 | 13.5 | 28 |
| MID | -3 | 2 | 6 | 10 | 12 | 21 |
| FWD | -2 | 3 | 7.5 | 13 | 18.7 | 39 |

Sí hay diferencias suficientes para pricing posicional. FWD presenta una cola superior mucho más larga; DEF también tiene jugadores extremos por porterías a cero y goles. GK tiene menor techo observado y una muestra pequeña. El uso de percentiles dentro de cada posición evita que las escalas brutas de puntos favorezcan automáticamente a una posición.

## PROPOSED FORMULA

Simulación realizada, sin persistencia:

```text
seasonPointsPercentile      = midrank percentile dentro de la posición
recentFormPercentile        = midrank percentile de puntos promedio en las últimas 3 jornadas puntuadas
pointsPerAppearancePercentile = midrank percentile dentro de la posición
participationRate           = apariciones / partidos puntuados observados para el club

performanceIndex =
    0.50 * seasonPointsPercentile
  + 0.30 * recentFormPercentile
  + 0.15 * pointsPerAppearancePercentile
  + 0.05 * participationRate

confidence = min(appearances / shrinkageAppearances, 1)
adjustedPerformance = performanceIndex * confidence
                    + positionalMedianPerformance * (1 - confidence)
normalizedPremium = adjustedPerformance ^ gamma
fairPrice = minPrice + (maxPrice - minPrice) * normalizedPremium
currentPrice = roundToNearest(fairPrice, $0.1M)
```

La simulación literal con rangos originales, `gamma=1.30` y shrinkage de 4 produjo:

| Posición | N | Mín. | Mediana | P75 | P90 | P95 | Máx. | Distintos |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GK | 27 | 5.4 | 6.0 | 6.75 | 7.16 | 7.61 | 8.6 | 12 |
| DEF | 91 | 4.5 | 6.3 | 7.4 | 8.5 | 8.75 | 9.7 | 33 |
| MID | 87 | 4.7 | 8.4 | 10.1 | 11.3 | 11.74 | 12.8 | 35 |
| FWD | 83 | 6.5 | 10.1 | 11.9 | 13.38 | 15.24 | 16.2 | 38 |

Esta configuración genera variedad, pero encarece demasiado al jugador mediano y lleva el dream team a $162.3M. No debe pasar directamente a producción.

Los 20 precios hipotéticos más altos y los 20 mejores value picks están completos en `PRICE_AUDIT_RESULTS.json`. La concentración superior también es una señal de calibración: 18 de los 20 precios más altos pertenecen a FWD y 2 a MID con la fórmula literal.

Top 20 por puntos con el precio hipotético literal:

| Jugador | Pos. | Club | Puntos | Precio |
|---|---|---|---:|---:|
| Carlos Hernández | FWD | Veraguas United | 39 | 15.4 |
| Ronaldo Dinolis | FWD | San Francisco | 32 | 15.3 |
| Iván Anderson | DEF | Universitario | 28 | 9.7 |
| Héctor Ríos | FWD | Plaza Amador | 28 | 13.4 |
| Keny Bonilla | FWD | San Francisco | 25 | 14.7 |
| Alvin Mendoza | DEF | Alianza | 24 | 9.7 |
| Jordan Girón | DEF | CAI | 22 | 8.7 |
| José Murillo | MID | Plaza Amador | 21 | 10.8 |
| Yeison Ortega | DEF | Alianza | 20 | 9.6 |
| Víctor Medina | FWD | San Francisco | 19 | 14.7 |
| Cristian Quintero | FWD | Tauro | 16 | 16.1 |
| Rolando Burgess | FWD | Árabe Unido | 15 | 15.8 |
| Darwin Pinzón | FWD | Tauro | 15 | 16.2 |
| Jean Ambuila | GK | Alianza | 14 | 8.6 |
| Jhon Marquínez | DEF | Alianza | 14 | 8.6 |
| Álex Rodríguez | GK | CAI | 13 | 7.7 |
| Adolfo Machado | DEF | Alianza | 13 | 8.5 |
| David Castillo | MID | Herrera | 13 | 9.6 |
| Wesley Lashley | MID | Unión Coclé | 13 | 11.1 |
| Valentín Pimentel | MID | San Francisco | 13 | 11.8 |

## RECOMMENDED CONFIG

Configuración inicial recomendada para la muestra actual:

```ts
{
  rangesMillions: {
    GK:  { min: 4.0, max: 9.0 },
    DEF: { min: 4.0, max: 10.0 },
    MID: { min: 4.5, max: 14.0 },
    FWD: { min: 5.0, max: 18.0 },
  },
  weights: { season: 0.50, recent: 0.30, pointsPerAppearance: 0.15, participation: 0.05 },
  recentWindowGameweeks: 3,
  gamma: 2.0,
  shrinkageAppearances: 6,
  roundToMillions: 0.1,
  marketMomentumEnabled: false,
  formulaVersion: 'lpf-price-v2.0.0',
}
```

Razón: conserva los rangos solicitados, lleva el dream team a $128.8M y permite construir un equipo balanceado de $99.9M. El shrinkage de 6 es prudente porque, aunque hay siete jornadas puntuadas, el máximo de apariciones observado en muchos líderes es solo 3–4. Cuando la cobertura sea estable y las apariciones sean completas, debe reevaluarse bajar a 4; no debe cambiarse durante una jornada.

Sensibilidad relevante:

| Gamma | Shrinkage | Dream team |
|---:|---:|---:|
| 1.30 | 4 | $162.3M |
| 1.50 | 8 | $132.3M |
| 1.75 | 8 | $125.6M |
| 2.00 | 6 | $128.8M |
| 2.00 | 8 | $119.8M |
| 2.50 | 6 | $119.2M |

Cambiar el peso reciente entre 20% y 40% apenas movió el dream team entre $162.8M y $161.2M bajo la configuración literal. Gamma y shrinkage son las palancas de calibración dominantes con la muestra actual.

Variantes de rangos con gamma 1.30/shrinkage 4:

| Variante | GK | DEF | MID | FWD | Dream | Equipo válido mínimo |
|---|---|---|---|---|---:|---:|
| Original | 4–9 | 4–10 | 4.5–14 | 5–18 | 162.3 | 90.5 |
| Moderada | 4–8.5 | 4–9 | 4.5–12 | 5–15 | 143.2 | 85.4 |
| Comprimida | 4–8 | 4–8.5 | 4.5–11 | 5–14 | 134.8 | 83.3 |

Comprimir rangos ayuda, pero reduce el espacio futuro para diferenciar estrellas. Es preferible conservar los rangos y ajustar gamma/shrinkage.

## DREAM TEAM COST

La optimización es exacta por club: para cada club evalúa todas las asignaciones posibles de hasta tres jugadores por posición y combina los 12 clubes respetando 2 GK, 5 DEF, 5 MID y 3 FWD.

- Puntos acumulados: **304**.
- Costo con precios actuales: **$128.7M**.
- Costo con fórmula literal gamma 1.30/shrinkage 4: **$162.3M**.
- Costo con configuración recomendada gamma 2.00/shrinkage 6: **$128.8M**.
- Resultado: la configuración recomendada cae dentro del objetivo $115M–$130M sin ajustes manuales por jugador.

## BALANCED TEAM COST

Con la configuración recomendada se construyó automáticamente una plantilla que cumple cuotas, máximo tres por club, cuatro estrellas de top decile y seis value picks:

- Costo: **$99.9M**.
- Puntos acumulados: **160**.
- Estrellas: **4**.
- Value picks: **6**.

Es una prueba de factibilidad económica, no una recomendación editorial de jugadores. La búsqueda parte del máximo deportivo y sustituye dentro de la misma posición hasta satisfacer presupuesto, distribución de estrellas y límite por club.

La fórmula literal gamma 1.30/shrinkage 4 no encontró una plantilla con la mezcla exigida dentro de $95M–$100M mediante el mismo procedimiento; esto no demuestra imposibilidad matemática, pero refuerza que esa calibración no está lista.

## REQUIRED DATABASE CHANGES

No se aplicaron migraciones. Contrato propuesto:

1. Mantener `tournament_players.price_cents` como precio vigente autoritativo.
2. Marcar `players.price_cents` como legado y dejar de leerlo; retirarlo solo mediante migración posterior verificada.
3. Crear `pricing_runs`:
   - `id`, `tournament_id`, `as_of_gameweek_id`, `formula_version`, `config_json`, `input_hash`, `status`, `created_at`, `completed_at`.
   - `UNIQUE(tournament_id, as_of_gameweek_id, formula_version, input_hash)` para idempotencia.
4. Crear `player_price_history`:
   - `pricing_run_id`, `tournament_id`, `player_id`, `gameweek_id`, `previous_price_cents`, `current_price_cents`, `change_cents`, `performance_index`, `adjusted_performance`, `confidence`, `season_points`, `recent_form`, `points_per_appearance`, `participation_rate`, `formula_version`, `effective_at`.
   - PK `(pricing_run_id, player_id)` e índice `(tournament_id, player_id, effective_at DESC)`.
5. Añadir a `tournament_players`: `price_updated_at`, `pricing_version` y opcionalmente `previous_price_cents` para lectura rápida. El historial sigue siendo la fuente auditable.
6. Mantener `squad_players.purchase_price_cents` como snapshot de adquisición.
7. No hace falta persistir `selling_price_cents` en el holding: debe derivarse de purchase/current y guardarse definitivamente en `transfer_items.sell_price_cents` al ejecutar la transferencia.
8. Para momentum futuro, crear snapshots agregados por jornada, no eventos personales expuestos: `player_ownership_snapshots(tournament_id, gameweek_id, player_id, owned_count, active_manager_count, transfers_in, transfers_out, captured_at)`.

## REQUIRED BACKEND CHANGES

No se implementaron en esta fase. Los agentes siguientes deberán:

1. Sustituir el motor lineal actual por un módulo puro y versionado que reciba métricas ya agregadas.
2. Separar `calculatePriceQuote()` de `persistTournamentPrices()` para permitir dry-run, auditoría y pruebas.
3. Ejecutar repricing únicamente después de cerrar/recalcular una jornada completa. Una sincronización de plantillas no debe cambiar precios a mitad de jornada.
4. Calcular forma reciente sobre las últimas tres jornadas puntuadas, incluyendo cero si el jugador no participa.
5. Definir una aparición desde stats canónicos (`minutes > 0 OR starter OR substitute_in`) y no desde el resultado del motor de puntos.
6. Calcular partidos elegibles por club y resolver correctamente cambios de club mediante `player_club_history`.
7. Escribir `pricing_runs` y `player_price_history` en la misma transacción que actualiza `tournament_players`.
8. Aplicar el cambio una sola vez por `input_hash`; reintentar el job no debe crear otro movimiento de precio.
9. Exponer quote completo en catálogo/equipo y no duplicar la fórmula en frontend.
10. Cambiar la transferencia para usar una política explícita de venta.

Política de venta v1 recomendada:

```text
si currentPrice <= purchasePrice:
  sellingPrice = currentPrice
si currentPrice > purchasePrice:
  sellingPrice = purchasePrice + floorTo0.1M((currentPrice - purchasePrice) / 2)
```

Conserva toda la pérdida y solo la mitad de la ganancia, limita arbitraje y usa el historial de compra ya persistido. No altera las reglas de transferencias gratuitas, acumulación o penalización.

## REQUIRED FRONTEND CONTRACT

El frontend no debe calcular precios, percentiles ni selling price. Campos requeridos en catálogo:

```ts
type PlayerMarketView = {
  playerId: string;
  currentPriceCents: number;
  previousPriceCents: number | null;
  priceChangeCents: number;
  priceTrend: 'UP' | 'DOWN' | 'FLAT';
  fantasyPoints: number;
  recentForm: number;
  appearances: number;
  pointsPerAppearance: number;
  participationRate: number | null;
  pricingVersion: string;
  priceUpdatedAt: string;
};
```

Campos adicionales cuando el jugador pertenece al usuario:

```ts
type OwnedPlayerMarketView = PlayerMarketView & {
  purchasePriceCents: number;
  sellingPriceCents: number;
  unrealizedGainCents: number;
};
```

Compatibilidad temporal: `Player.price` puede seguir siendo millones para los componentes actuales, pero debe derivarse de `currentPriceCents`. Los campos opcionales `currentPrice`, `purchasePrice` y `sellingPrice` ya existen en `src/types/fantasy.ts`, pero no están poblados de forma completa.

Debe elevarse el filtro de precio del mercado: `MarketFiltersModal` usa actualmente máximo $10.0M, incompatible con FWD de hasta $18.0M. El máximo debe venir del contrato/configuración del torneo.

## MARKET MOMENTUM

Contrato diseñado, desactivado inicialmente:

```ts
type MarketMomentumConfig = {
  enabled: boolean;                 // false inicialmente
  minimumActiveManagers: number;   // 500 recomendado
  minimumWindowTransfers: number;  // 100 recomendado
  windowHours: number;              // 24
  weight: number;                   // máximo 0.10
  maxPriceImpactCents: number;      // ±$0.3M por jornada
};

type MarketMomentumInput = {
  playerId: string;
  activeManagers: number;
  currentOwnership: number;
  transfersIn: number;
  transfersOut: number;
  windowStartedAt: string;
  windowEndedAt: string;
};
```

Momentum debe modificar como máximo 10% del índice o ±$0.3M por jornada, después del componente deportivo. Si no se cumplen ambos umbrales, su contribución es exactamente cero. Con 2 equipos y 0 transferencias actuales debe permanecer desactivado.

## RISKS

1. Cobertura deportiva parcial: 42 jugadores activos no tienen puntos y 44 no tienen aparición inferida.
2. La muestra de apariciones es menor que el número de jornadas; bajar shrinkage demasiado pronto sobrevalora actuaciones aisladas.
3. `recentForm` está mal nombrado en la API actual porque promedia toda la temporada.
4. Recalcular precios dentro del sync general puede cambiarlos varias veces o durante una jornada.
5. No existe historial de precio; hoy no se puede explicar ni revertir una valoración.
6. La venta a precio de compra ignora caídas y ganancias de mercado.
7. Dos equipos y cero transferencias no permiten inferir demanda real ni protegerse contra manipulación.
8. Aplicar nuevos precios sin una política de transición puede alterar el poder adquisitivo de equipos existentes. Debe conservarse purchase price y ejecutar una migración/snapshot único antes de activar v2.
9. El percentil por posición depende de la población activa. Altas/bajas de jugadores pueden cambiar precios aunque un jugador no haya jugado; se debe congelar la población por corte de jornada.
10. La tasa de participación basada en el club actual falla para jugadores transferidos durante el torneo si no usa historia de club.
11. Los rangos amplios con gamma 1.30 hacen demasiado cara a la mediana; el dream team de $162.3M lo demuestra.

## IMPLEMENTATION PLAN

1. Agente 2: implementar tipos/config centralizada y funciones puras, sin persistencia.
2. Agente 3: crear migraciones de `pricing_runs`/`player_price_history` y repositorio transaccional.
3. Agente 4: implementar agregador de métricas con ventana reciente, apariciones y elegibilidad por club.
4. Agente 5: integrar job idempotente al cierre de jornada y política de selling price en transferencias.
5. Agente 6: ampliar contratos API y frontend, incluido filtro dinámico hasta el máximo posicional.
6. Agente 7: pruebas económicas, regresión, dream/balanced teams y rollout controlado.

La activación debe usar primero dry-run durante al menos una jornada, comparar `PRICE AUDIT BEFORE/AFTER`, crear snapshot de precios actuales y habilitar v2 únicamente después de validar costos de dream y balanced team.

### HANDOFF FOR AGENTS 2–7

Contratos definitivos a respetar:

- Dinero siempre como enteros en centésimas internas (`price_cents`); redondeo de mercado a pasos de `10_000_000` equivalentes a $0.1M. Nunca usar floats para persistencia o transferencias.
- `tournament_players.price_cents` sigue siendo el precio vigente autoritativo. `players.price_cents` no participa en v2.
- Config inicial: rangos 4–9/4–10/4.5–14/5–18, pesos 50/30/15/5, ventana 3, gamma 2.0, shrinkage 6, momentum apagado, versión `lpf-price-v2.0.0`.
- Percentiles se calculan dentro de posición sobre la población activa congelada al cierre de la jornada, usando midranks para empates.
- Aparición: `minutes > 0 OR starter = true OR substitute_in = true`; no inferirla del total de puntos.
- Forma reciente: promedio de puntos de las últimas tres jornadas puntuadas; una no aparición cuenta como cero.
- Pricing engine puro: misma entrada + config debe producir el mismo output y `inputHash`.
- API mínima:

```ts
type PricingEngineInput = {
  tournamentId: string;
  asOfGameweekId: string;
  players: PlayerPricingInput[];
  config: PricingConfig;
};

type PlayerPricingInput = {
  playerId: string;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  seasonPoints: number;
  recentGameweekPoints: number[];
  appearances: number;
  eligibleMatches: number;
  previousPriceCents: number;
  momentum?: MarketMomentumInput;
};

type PlayerPriceQuote = {
  playerId: string;
  currentPriceCents: number;
  previousPriceCents: number;
  priceChangeCents: number;
  performanceIndex: number;
  adjustedPerformance: number;
  confidence: number;
  recentForm: number;
  pointsPerAppearance: number;
  participationRate: number | null;
  formulaVersion: string;
  inputHash: string;
};
```

- Persistencia: un `pricing_run` por torneo/jornada/versión/hash; un `player_price_history` por jugador/run; actualización de precio e historial en una sola transacción.
- Repricing ocurre después de cerrar y recalcular una jornada, nunca por cada scrape ni a mitad de jornada.
- Purchase price es snapshot de adquisición. Selling price aplica pérdida completa y mitad de ganancia, redondeada hacia abajo a $0.1M. `transfer_items` guarda los importes efectivos ejecutados.
- Momentum permanece `enabled=false` hasta alcanzar simultáneamente 500 mánagers activos y 100 transferencias en la ventana; peso máximo 10% e impacto máximo ±$0.3M por jornada.
- El frontend consume quotes del backend y no reimplementa la economía. Debe mostrar current, purchase, selling, change, recent form y Fantasy Points.
- No se modifica ninguna regla inmutable de puntuación, plantilla, presupuesto, clubes, transfers, comodín o deadlines.

Artefactos reproducibles:

- `scripts/price-audit-before.mjs`: consulta SQLite en modo read-only, calcula distribuciones y simulaciones.
- `PRICE_AUDIT_RESULTS.json`: salida completa, incluidos Top 20 de precios, Top 20 de puntos, value picks y plantillas.
