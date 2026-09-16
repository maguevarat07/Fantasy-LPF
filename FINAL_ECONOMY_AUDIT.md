# Auditoría final del sistema económico — Fantasy LPF

Fecha de corte: 14 de septiembre de 2026. Torneo: `apertura-2026`.

## IMPLEMENTATION STATUS

**PASS con riesgos operativos medios documentados.**

La implementación canónica está conectada de extremo a extremo: `pricingEngine.ts` calcula, `pricingRepository.ts` persiste, `tournament_players.price_cents` es la fuente de verdad, `marketEconomy.ts` calcula el precio de venta y `app.ts` vuelve a cotizar toda transferencia dentro de la transacción. El frontend solo convierte centavos a millones y muestra valores devueltos por la API.

Durante esta integración se corrigieron cuatro conflictos reales:

1. `/api/catalog` no enviaba cambio, precio anterior, versión ni historial aunque el frontend ya los esperaba.
2. El filtro visual terminaba en $10M pese al máximo de $18M.
3. Momentum empezaba a escalar desde 50 managers, contra los 500 definidos en el diseño.
4. El seed heredado todavía introducía POR a $3.5M, MED a $4.2M y DEL a $4.5M. La migración 11 normaliza precios `LEGACY` a los nuevos rangos sin tocar `purchase_price_cents`.

`server/pricing.ts` no es un segundo motor: es un punto de compatibilidad que delega en `pricingEngine.ts`. `src/domain/transferEngine.ts` es código cliente heredado sin imports de producción; no autoriza ni ejecuta las transferencias reales.

## PRICE AUDIT BEFORE/AFTER

El BEFORE corresponde a 288 jugadores activos del primer corte. El AFTER contiene 289 porque el catálogo activo cambió entre fases.

| Posición | Estado | N | Mín. | P25 | Mediana | P75 | P90 | P95 | Máx. | Promedio | Distintos |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| POR | BEFORE | 27 | 4.05 | 4.75 | 4.85 | 5.40 | 5.67 | 5.89 | 6.15 | 5.01 | 11 |
| POR | AFTER | 27 | 4.90 | 5.20 | 5.20 | 5.75 | 6.08 | 6.41 | 7.20 | 5.52 | 11 |
| DEF | BEFORE | 91 | 4.25 | 5.40 | 5.50 | 5.98 | 6.60 | 7.58 | 8.65 | 5.77 | 30 |
| DEF | AFTER | 91 | 4.00 | 5.30 | 5.40 | 6.10 | 6.90 | 7.10 | 7.90 | 5.72 | 28 |
| MED | BEFORE | 87 | 4.60 | 5.40 | 5.70 | 6.15 | 6.85 | 7.25 | 9.80 | 5.88 | 21 |
| MED | AFTER | 88 | 4.50 | 6.70 | 7.00 | 8.10 | 9.00 | 9.33 | 10.20 | 7.33 | 33 |
| DEL | BEFORE | 83 | 5.05 | 6.18 | 6.45 | 7.45 | 8.55 | 9.83 | 13.00 | 7.04 | 31 |
| DEL | AFTER | 83 | 6.10 | 7.70 | 8.10 | 9.25 | 10.30 | 11.75 | 12.50 | 8.60 | 33 |

El dream team cuesta $129.6M y el equipo de los precios máximos $136.9M. Existe una presión presupuestaria material de $29.6M–$36.9M, no una diferencia marginal.

## FORMULA FINAL

```text
performanceIndex =
  0.50 × percentile(seasonPoints, posición)
+ 0.30 × percentile(recentForm, posición)
+ 0.15 × percentile(pointsPerAppearance, posición)
+ 0.05 × participationRate

confidence = min(appearances / 6, 1)

adjustedPerformance =
  performanceIndex × confidence
+ positionalMedian × (1 - confidence)

fairPrice = minPrice + (maxPrice - minPrice) × adjustedPerformance²
```

Los empates usan percentile midrank. Forma usa las tres jornadas puntuadas más recientes, con cero para una jornada sin participación. Una aparición exige minutos, titularidad o entrada como suplente. Los partidos deben estar `CONFIRMED` o `CORRECTED`.

Después del bootstrap, `applyGradualMovement` limita cada jornada a $0.0M, $0.1M, $0.2M o $0.3M según la distancia al fair value. Momentum se aplica después y el límite total sigue siendo ±$0.3M.

## CONFIG FINAL

| Parámetro | Valor |
|---|---|
| POR | $4.0M–$9.0M |
| DEF | $4.0M–$10.0M |
| MED | $4.5M–$14.0M |
| DEL | $5.0M–$18.0M |
| Gamma | 2.0 |
| Shrinkage | 6 apariciones |
| Ventana de forma | 3 jornadas |
| Redondeo | $0.1M |
| Movimiento normal | máximo ±$0.3M/jornada |
| Versión | `lpf-price-v2.0.0` |
| Momentum | OFF |

## DATABASE

- Esquema `user_version = 11`.
- `PRAGMA integrity_check = ok` y cero errores de foreign keys.
- Una ejecución de pricing completada y 288 filas históricas.
- 287 jugadores activos están en estado `CURRENT` v2.
- Alexis Cedeño y Ricardo Ávila están `LEGACY` con precios provisionales válidos de $4.0M y $4.5M. Entrarán en el siguiente cálculo de jornada.
- `pricing_runs` tiene unicidad por torneo, jornada, versión e input hash.
- `player_price_history` tiene PK por run/jugador, unicidad por torneo/jugador/jornada/versión e índices por jugador y jornada.
- `squad_players.purchase_price_cents` permanece separado del precio vigente y conserva `purchase_gameweek_id`.
- `transfer_items` congela compra, venta, purchase price original y ganancia/pérdida.
- Todos los campos monetarios autoritativos inspeccionados son enteros; cero precios `CURRENT` están fuera del tick de $0.1M.

## TOP 15 PRICE

| # | Jugador | Pos. | Precio | Puntos |
|---:|---|---|---:|---:|
| 1 | Darwin Pinzón | DEL | $12.5M | 15 |
| 2 | Cristian Quintero | DEL | $12.4M | 16 |
| 3 | Rolando Burgess | DEL | $12.1M | 15 |
| 4 | Carlos Hernández | DEL | $11.9M | 39 |
| 5 | Ronaldo Dinolis | DEL | $11.8M | 32 |
| 6 | Keny Bonilla | DEL | $11.3M | 25 |
| 7 | Víctor Medina | DEL | $11.3M | 19 |
| 8 | Omar Browne | DEL | $10.9M | 13 |
| 9 | Héctor Ríos | DEL | $10.3M | 28 |
| 10 | John Jairo Alvarado | DEL | $10.3M | 9 |
| 11 | Armando Cooper | MED | $10.2M | 10 |
| 12 | Adrian Bethancourt | DEL | $10.0M | 13 |
| 13 | Alberto Quintero | DEL | $9.9M | 12 |
| 14 | Joel Barría | DEL | $9.9M | 9 |
| 15 | Nicholas Anderson | MED | $9.8M | 9 |

## TOP 15 POINTS

| # | Jugador | Pos. | Puntos | Precio |
|---:|---|---|---:|---:|
| 1 | Carlos Hernández | DEL | 39 | $11.9M |
| 2 | Ronaldo Dinolis | DEL | 32 | $11.8M |
| 3 | Iván Anderson | DEF | 28 | $7.9M |
| 4 | Héctor Ríos | DEL | 28 | $10.3M |
| 5 | Keny Bonilla | DEL | 25 | $11.3M |
| 6 | Alvin Mendoza | DEF | 24 | $7.9M |
| 7 | Jordan Girón | DEF | 22 | $7.1M |
| 8 | José Murillo | MED | 21 | $8.6M |
| 9 | Yeison Ortega | DEF | 20 | $7.8M |
| 10 | Víctor Medina | DEL | 19 | $11.3M |
| 11 | Cristian Quintero | DEL | 16 | $12.4M |
| 12 | Rolando Burgess | DEL | 15 | $12.1M |
| 13 | Darwin Pinzón | DEL | 15 | $12.5M |
| 14 | Jean Ambuila | POR | 14 | $7.2M |
| 15 | Jhon Marquínez | DEF | 14 | $7.0M |

## VALUE PICKS

Ordenados por puntos acumulados/precio actual: Iván Anderson (28/$7.9M), Carlos Hernández (39/$11.9M), Jordan Girón (22/$7.1M), Alvin Mendoza (24/$7.9M), Héctor Ríos (28/$10.3M), Ronaldo Dinolis (32/$11.8M), Yeison Ortega (20/$7.8M), José Murillo (21/$8.6M), Keny Bonilla (25/$11.3M), Álex Rodríguez (13/$6.5M), Jhon Marquínez (14/$7.0M), Jean Ambuila (14/$7.2M), Adolfo Machado (13/$6.9M), Abdul Morales (10/$5.8M) y David Castillo (13/$7.7M).

## DREAM TEAM

Máximo de puntos con cuotas y máximo tres por club: **304 puntos, $129.6M**.

| Jugador | Pos. | Club | Precio | Puntos |
|---|---|---|---:|---:|
| Jean Ambuila | POR | Alianza | $7.2M | 14 |
| Álex Rodríguez | POR | CAI | $6.5M | 13 |
| Ronaldo Ford | DEF | UMECIT | $7.3M | 12 |
| Alvin Mendoza | DEF | Alianza | $7.9M | 24 |
| Yeison Ortega | DEF | Alianza | $7.8M | 20 |
| Jordan Girón | DEF | CAI | $7.1M | 22 |
| Iván Anderson | DEF | Universitario | $7.9M | 28 |
| David Castillo | MED | Herrera | $7.7M | 13 |
| José Murillo | MED | Plaza Amador | $8.6M | 21 |
| Estevis López | MED | Veraguas | $9.4M | 12 |
| Wesley Lashley | MED | Unión Coclé | $8.8M | 13 |
| Valentín Pimentel | MED | San Francisco | $9.4M | 13 |
| Héctor Ríos | DEL | Plaza Amador | $10.3M | 28 |
| Carlos Hernández | DEL | Veraguas | $11.9M | 39 |
| Ronaldo Dinolis | DEL | San Francisco | $11.8M | 32 |

Está $29.6M por encima del presupuesto. El usuario debe sustituir varias estrellas, no solo ajustar $0.1M.

## BALANCED TEAM

La optimización exacta del máximo de puntos bajo $100M produjo **172 puntos por $100.0M**. La muestra de solo siete jornadas y los huecos estadísticos obligan a incluir jugadores con pocos puntos para financiar las estrellas.

| Jugador | Pos. | Club | Precio | Puntos |
|---|---|---|---:|---:|
| José Guerra | POR | Tauro | $5.8M | 8 |
| Kevin Mosquera | POR | Árabe Unido | $5.8M | 7 |
| Éric Davis | DEF | Plaza Amador | $5.4M | 9 |
| Alexis Cedeño | DEF | Veraguas | $4.0M | 0 |
| Jordan Girón | DEF | CAI | $7.1M | 22 |
| Iván Anderson | DEF | Universitario | $7.9M | 28 |
| Javier Góndola | DEF | Unión Coclé | $4.6M | 0 |
| Ricardo Ávila | MED | UMECIT | $4.5M | 0 |
| David Castillo | MED | Herrera | $7.7M | 13 |
| Dean Tenorio | MED | Herrera | $5.4M | 0 |
| José Murillo | MED | Plaza Amador | $8.6M | 21 |
| Javier Figueroa | MED | Tauro | $4.9M | -1 |
| Héctor Ríos | DEL | Plaza Amador | $10.3M | 28 |
| Carlos Hernández | DEL | Veraguas | $11.9M | 39 |
| Juan Villalobos | DEL | Árabe Unido | $6.1M | -2 |

## STAR TEST

La plantilla válida más cara cuesta **$136.9M**. El dream team deportivo cuesta $129.6M. Ambos exceden ampliamente $100M; llenar el equipo de jugadores premium exige sacrificar entre $29.6M y $36.9M.

## INVESTMENT TEST

**PASS.** La prueba de integración crea dos usuarios y ejecuta operaciones HTTP contra una base aislada:

- Usuario A compra a $5.0M.
- El precio actual pasa a $5.8M.
- A conserva `purchasePrice = $5.0M` y ve `sellingPrice = $5.4M`.
- Una cotización obsoleta recibe `409 PRICE_CHANGED`.
- El servidor cobra $5.8M al comprador y acredita $5.4M al vendedor.
- El banco baja exactamente $0.4M.
- Usuario B compra al `currentPrice` vigente.
- El historial congela compra, venta y profit/loss.

## DEPRECIATION TEST

**PASS.** Compra $7.0M, precio actual $6.4M, precio de venta $6.4M. La caída se traslada completa.

Para apreciación, el vendedor recibe purchase price más la mitad de la ganancia, redondeada hacia abajo al tick de $0.1M.

## IDEMPOTENCY

**PASS sobre una copia aislada de la base real.**

- Primera ejecución GW7: 289 jugadores actualizados, un run y 289 filas históricas.
- Segunda ejecución GW7: cero actualizaciones, mismo `runId`, `idempotent = true`.
- El hash de precios después de la primera y segunda ejecución fue idéntico.

## TRANSFER INTEGRATION

**PASS.** El endpoint vuelve a leer ownership, current price y banco dentro de la transacción. Calcula `bankAfter = bankBefore + sellingPrice - currentBuyPrice`; nunca acredita el precio actual del saliente. Rechaza precios esperados obsoletos, conserva posición y valida nuevamente plantilla, presupuesto y máximo por club.

- Una transferencia gratuita por jornada y consumo de acumuladas: cubierto.
- Máximo dos acumuladas: regresión existente conservada.
- -4 por transferencia adicional: cubierto en batch.
- Comodín: costo cero, conserva gratuitas y no permite sobregiro.
- Deadline: bloqueado por servidor.
- Operación atómica: comprobada ante rechazo por presupuesto.

## MARKET MOMENTUM

**PASS, configurado OFF.** Requiere `MARKET_MOMENTUM_ENABLED=true`, al menos 500 equipos completos y 100 items válidos en 24 horas. Escala hasta fuerza completa a los 1,000 managers, reduce Comodín al 25%, excluye operaciones no comerciales, cuentas nuevas, reversiones y actividad anómala. Su impacto propio está limitado a ±$0.1M y el movimiento total permanece bajo ±$0.3M.

Con dos managers y cero transferencias reales, debe continuar apagado.

## UI

**PASS con alcance autenticado validado por código y API.** Mercado muestra precio actual, variación y forma. Detalle y fichajes muestran compra, venta y ganancia/pérdida. Los resúmenes muestran valor de mercado, valor de venta, banco y valor disponible. `/api/catalog` entrega versión e historial y `/api/team` entrega ownership económico calculado en backend.

La aplicación local cargó visualmente sin pantalla vacía, overlay, errores de consola ni imágenes rotas; mostró 12 clubes, $100M y plantilla de 15. La navegación autenticada no se abrió con una cuenta personal durante la auditoría; sus contratos están cubiertos por las pruebas HTTP y la inspección de componentes.

## TEST RESULTS

- 8 archivos de prueba aprobados.
- 50 pruebas aprobadas.
- Incluyen pricing, repositorio, momentum, transferencias, ownership, scoring, autenticación, onboarding, ligas, aislamiento e ingestión.
- Hubo un timeout de bcrypt cuando tests, build y optimización corrían simultáneamente. La suite aislada terminó 50/50; no hubo fallo de aserción.

## BUILD RESULTS

- Typecheck web: PASS.
- Typecheck servidor: PASS.
- ESLint sin warnings: PASS.
- Build Vite: PASS, 2,108 módulos.
- Advertencia no bloqueante: bundle principal de 689.89 kB, 181.58 kB gzip, supera la recomendación de 500 kB.

## REMAINING RISKS

1. **MEDIUM:** dos altas activas posteriores al snapshot v2 usan precios provisionales `LEGACY` dentro del rango y no tienen historial. Deben obtener precio v2 al cerrar la próxima jornada.
2. **MEDIUM:** el primer bootstrap registró cambios de hasta $4.4M. Es una recalibración única; los movimientos normales posteriores sí están limitados a ±$0.3M.
3. **MEDIUM:** solo hay siete jornadas con puntos y varias apariciones incompletas. La calibración debe revisarse cuando mejore la cobertura, sin cambiarla dentro de una jornada.
4. **LOW:** `players.price_cents` y `src/domain/transferEngine.ts` siguen como compatibilidad heredada. Ninguno es fuente autoritativa del flujo actual.
5. **LOW:** no existen transferencias de usuarios reales en la base actual. Los escenarios económicos se validaron mediante transacciones HTTP en bases aisladas.
6. **LOW:** el bundle web merece división por rutas antes de que el crecimiento de la interfaz afecte tiempos de carga.

## RECOMMENDATION

Aceptar el sistema económico para producción con momentum apagado, monitoreo del próximo cierre de jornada y una comprobación posterior de que los dos jugadores `LEGACY` reciban historial v2. Mantener `lpf-price-v2.0.0` congelado durante cada jornada y realizar cualquier recalibración futura mediante una versión nueva.

## ¿ESTÁ EL SISTEMA ECONÓMICO LISTO PARA PRODUCCIÓN?

**YES.**

No quedan fallos CRITICAL/HIGH conocidos: precios y selling price son autoritativos en backend, el dinero usa enteros, el historial es transaccional, la idempotencia fue ejecutada sobre datos reales, las transferencias preservan ownership y las reglas Fantasy no cambiaron. Los riesgos restantes son operativos y acotados; momentum debe permanecer OFF y las dos incorporaciones provisionales deben observarse en la próxima ejecución.
