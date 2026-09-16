# Agente 3 — Database + Ownership

## Auditoría previa

El sistema ya tenía los fundamentos correctos:

- `tournament_players.price_cents` representa el precio vigente de un jugador dentro de un torneo.
- `squad_players.purchase_price_cents` conserva el precio pagado por un equipo.
- `transfer_items.sell_price_cents` y `buy_price_cents` conservan los importes ejecutados.
- `fantasy_teams` impone un equipo por usuario y torneo.

La base real estaba en `user_version = 6`. Existían 2 usuarios, 2 equipos, 30 holdings y ningún historial de precios. Uno de los correos corresponde a una cuenta personal, por lo que la migración se trató como una instalación con managers reales: no se recalibraron precios ni se inventó historial.

## Esquema antes

```text
tournament_players
  tournament_id + player_id (PK)
  price_cents
  active

squad_players
  fantasy_team_id + player_id (PK)
  purchase_price_cents
  acquired_at

pricing_runs: no existía en la base
player_price_history: no existía en la base
```

## Esquema después

`tournament_players` sigue siendo `PlayerTournamentPrice` y ahora soporta:

```text
tournament_id + player_id (PK)
initial_price_cents
price_cents                    -- currentPrice autoritativo
fair_price_cents               -- nullable hasta el primer cálculo v2
previous_price_cents
last_change_cents
last_calculated_gameweek_id
pricing_status                 -- LEGACY/CURRENT/STALE/ERROR
pricing_version
price_updated_at
active
```

`player_price_history` registra un snapshot auditable por ejecución y jugador. Incluye precio anterior, nuevo, justo, cambio, métricas deportivas, percentiles, confidence, momentum, versión y fecha efectiva.

Restricciones:

- PK `(pricing_run_id, player_id)`.
- UNIQUE `(tournament_id, player_id, gameweek_id, formula_version)`.
- Índices para consultas por jugador y por jornada.

`pricing_runs` conserva tournament, jornada de corte, versión, configuración, `input_hash`, estado y timestamps. La combinación `(tournament_id, as_of_gameweek_id, formula_version, input_hash)` es única.

`squad_players` añade `purchase_gameweek_id`. Es nullable para holdings anteriores porque su jornada real de compra no se puede reconstruir con certeza. Todo onboarding y transferencia nuevos guardan la jornada confirmada.

## Migración y justicia económica

- El precio vigente anterior se copió a `initial_price_cents` como snapshot de transición.
- Los 30 `purchase_price_cents` existentes se conservaron exactamente.
- `fair_price_cents`, `previous_price_cents`, `last_change_cents` y `purchase_gameweek_id` histórico permanecen `NULL` cuando son desconocidos.
- No se creó historial retroactivo.
- Los precios vigentes no cambiaron.
- Los registros migrados quedan con `pricing_status = LEGACY` hasta un cálculo v2 real.
- La base anterior se respaldó en `data/backups/fantasy-lpf.pre-economy-v8.sqlite`.

Verificación antes/después:

| Medida | Antes | Después |
|---|---:|---:|
| Usuarios | 2 | 2 |
| Equipos | 2 | 2 |
| Holdings | 30 | 30 |
| Suma purchase prices | 18,880,000,000 | 18,880,000,000 |
| Suma precios vigentes | 361,305,000,000 | 361,305,000,000 |
| Pricing runs | inexistente | 0 |
| Price history | inexistente | 0 |
| Foreign-key errors | 0 | 0 |

`PRAGMA integrity_check` devolvió `ok` en el respaldo y en la base migrada.

## Repositorio persistente

`server/pricingRepository.ts` ofrece:

- `startPricingRun`: crea o recupera una ejecución por el mismo input; rechaza sustituir silenciosamente un cálculo completado con otra entrada para la misma jornada y versión.
- `completePricingRun`: escribe historial, actualiza el precio vigente y completa el run dentro de una única transacción.
- `failPricingRun`: registra una ejecución fallida.
- `getPricingRun`: recupera su estado.

El repositorio recibe resultados ya calculados. No implementa ni duplica la fórmula matemática del Agente 2.

## Ownership

- Onboarding: guarda el precio vigente como `purchase_price_cents` y la jornada efectiva como `purchase_gameweek_id`.
- Transferencia: elimina el holding saliente y crea el entrante con su precio de compra actual y jornada efectiva.
- Un recálculo posterior de `tournament_players.price_cents` no modifica `purchase_price_cents`.
- El precio de venta no se persiste en el holding; el Agente 5/6 debe calcularlo desde purchase/current y congelarlo en `transfer_items` al ejecutar.

## Tests

Las pruebas de `pricingRepository.test.ts` cubren:

- migración y snapshot inicial;
- persistencia atómica;
- historial entre jornadas;
- constraint único de historial;
- idempotencia por input;
- rollback total ante un jugador inválido;
- transición de un run a `FAILED`;
- independencia entre current price y purchase price.

`app.test.ts` comprueba además que onboarding y transferencia guarden `purchase_gameweek_id`.

## Handoff para Agente 4

- Entregar al repositorio métricas completas; no escribir directamente en las tablas.
- Usar una jornada terminada y perteneciente al mismo torneo.
- `playerId` debe pertenecer a `tournament_players` del torneo.
- No inferir historial anterior ni rellenar campos desconocidos.
- Mantener números deportivos finitos y dinero como enteros seguros.
- `completePricingRun` obtiene el previous price directamente de la base para evitar carreras o datos obsoletos.

## Handoff para Agente 6

- Leer current/initial/fair/previous/change/status/version desde `tournament_players`.
- Leer `purchase_price_cents` desde `squad_players` únicamente para el equipo autenticado.
- Derivar `sellingPrice` en backend; nunca sobrescribir purchase price con current price.
- El endpoint histórico debe ordenar `player_price_history` por `effective_at` y limitarse al torneo solicitado.
- No exponer ownership personal agregado sin autorización; momentum futuro debe usar snapshots agregados.
- Mantener temporalmente `price` en millones para compatibilidad del frontend, derivado siempre de `price_cents`.

## Integración concurrente

Durante la primera validación global, `pricingEngine.ts` estaba siendo modificado simultáneamente y produjo fallos transitorios. Tras terminar esa integración, el conjunto completo quedó aprobado: 33 pruebas, lint y typecheck web/servidor.
