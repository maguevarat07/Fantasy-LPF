import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, seedGameweek, seedTournament, type SqliteDatabase } from './db.js';
import {
  PRICING_CONFIG,
  applyGradualMovement,
  calculatePlayerPrices,
  calculatePriceQuotes,
  calculateRecentForm,
  midrankPercentiles,
  roundMoney,
  type PlayerPricingInput,
} from './pricingEngine.js';

const databases: SqliteDatabase[] = [];
afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

const player = (overrides: Partial<PlayerPricingInput> & Pick<PlayerPricingInput, 'playerId'>): PlayerPricingInput => ({
  playerId: overrides.playerId,
  position: overrides.position ?? 'FWD',
  seasonPoints: overrides.seasonPoints ?? 0,
  recentGameweekPoints: overrides.recentGameweekPoints ?? [],
  appearances: overrides.appearances ?? 0,
  eligibleMatches: overrides.eligibleMatches ?? 0,
  previousPriceCents: overrides.previousPriceCents ?? 600_000_000,
});

describe('Pricing Engine puro v2', () => {
  it('calcula percentiles midrank por posición y conserva empates', () => {
    const values = [
      { id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 2 }, { id: 'd', value: 4 },
    ];
    const result = midrankPercentiles(values, item => item.value, item => item.id);
    expect(result.get('a')).toBe(0);
    expect(result.get('b')).toBeCloseTo(0.5);
    expect(result.get('c')).toBeCloseTo(0.5);
    expect(result.get('d')).toBe(1);
  });

  it('calcula forma sobre las tres jornadas puntuadas más recientes, con cero por no participación', () => {
    expect(calculateRecentForm([3, 6, 0])).toBe(3);
    expect(calculateRecentForm([99, 3, 6, 0])).toBe(3);
    expect(calculateRecentForm([6])).toBe(6);
  });

  it('reduce muestras pequeñas hacia la mediana posicional', () => {
    const quotes = calculatePriceQuotes({
      tournamentId: 't', asOfGameweekId: 'gw', config: PRICING_CONFIG,
      players: [
        player({ playerId: 'low', seasonPoints: 0, recentGameweekPoints: [0, 0, 0], appearances: 6, eligibleMatches: 6 }),
        player({ playerId: 'mid', seasonPoints: 10, recentGameweekPoints: [2, 2, 2], appearances: 6, eligibleMatches: 6 }),
        player({ playerId: 'flash', seasonPoints: 40, recentGameweekPoints: [0, 0, 40], appearances: 1, eligibleMatches: 6 }),
        player({ playerId: 'star', seasonPoints: 60, recentGameweekPoints: [12, 12, 12], appearances: 6, eligibleMatches: 6 }),
      ],
    }, { bootstrap: true });
    const flash = quotes.find(quote => quote.playerId === 'flash')!;
    const star = quotes.find(quote => quote.playerId === 'star')!;
    expect(flash.confidence).toBeCloseTo(1 / 6);
    expect(star.confidence).toBe(1);
    expect(flash.adjustedPerformance).toBeLessThan(flash.performanceIndex);
    expect(star.currentPriceCents).toBeGreaterThan(flash.currentPriceCents);
  });

  it('aplica gamma, redondeo a $0.1M y límites posicionales', () => {
    const quotes = calculatePriceQuotes({
      tournamentId: 't', asOfGameweekId: 'gw', config: PRICING_CONFIG,
      players: [
        player({ playerId: 'gk-low', position: 'GK', appearances: 6, eligibleMatches: 6 }),
        player({ playerId: 'gk-high', position: 'GK', seasonPoints: 100, recentGameweekPoints: [20, 20, 20], appearances: 6, eligibleMatches: 6 }),
        player({ playerId: 'fwd-low', position: 'FWD', appearances: 6, eligibleMatches: 6 }),
        player({ playerId: 'fwd-high', position: 'FWD', seasonPoints: 100, recentGameweekPoints: [20, 20, 20], appearances: 6, eligibleMatches: 6 }),
      ],
    }, { bootstrap: true });
    for (const quote of quotes) expect(quote.currentPriceCents % 10_000_000).toBe(0);
    expect(quotes.find(quote => quote.playerId === 'gk-low')!.currentPriceCents).toBeGreaterThanOrEqual(400_000_000);
    expect(quotes.find(quote => quote.playerId === 'gk-high')!.currentPriceCents).toBeLessThanOrEqual(900_000_000);
    expect(quotes.find(quote => quote.playerId === 'fwd-low')!.currentPriceCents).toBeGreaterThanOrEqual(500_000_000);
    expect(quotes.find(quote => quote.playerId === 'fwd-high')!.currentPriceCents).toBeLessThanOrEqual(1_800_000_000);
    expect(roundMoney(555_000_000)).toBe(560_000_000);
  });

  it('calcula fair price con la fórmula no lineal configurada', () => {
    const quote = calculatePriceQuotes({
      tournamentId: 't', asOfGameweekId: 'gw', config: PRICING_CONFIG,
      players: [player({
        playerId: 'only', seasonPoints: 18, recentGameweekPoints: [3, 6, 9],
        appearances: 6, eligibleMatches: 6,
      })],
    }, { bootstrap: true })[0];
    expect(quote.performanceIndex).toBeCloseTo(0.525);
    expect(quote.adjustedPerformance).toBeCloseTo(0.525);
    expect(quote.fairPriceCents).toBe(860_000_000);
  });

  it('mueve como máximo ±$0.3M usando umbrales de $0.1M, $0.2M y $0.3M', () => {
    expect(applyGradualMovement(600_000_000, 605_000_000)).toBe(600_000_000);
    expect(applyGradualMovement(600_000_000, 610_000_000)).toBe(610_000_000);
    expect(applyGradualMovement(600_000_000, 620_000_000)).toBe(620_000_000);
    expect(applyGradualMovement(600_000_000, 900_000_000)).toBe(630_000_000);
    expect(applyGradualMovement(600_000_000, 300_000_000)).toBe(570_000_000);
  });

  it('usa fair price directamente en bootstrap y movimiento gradual después', () => {
    const input = {
      tournamentId: 't', asOfGameweekId: 'gw', config: PRICING_CONFIG,
      players: [player({ playerId: 'one', seasonPoints: 40, recentGameweekPoints: [10, 10, 10], appearances: 6, eligibleMatches: 6 })],
    };
    const bootstrap = calculatePriceQuotes(input, { bootstrap: true })[0];
    const gradual = calculatePriceQuotes(input, { bootstrap: false })[0];
    expect(bootstrap.currentPriceCents).toBe(bootstrap.fairPriceCents);
    expect(Math.abs(gradual.priceChangeCents)).toBeLessThanOrEqual(30_000_000);
  });
});

function jobDatabase(): SqliteDatabase {
  const db = openDatabase({ filename: ':memory:' });
  databases.push(db);
  seedTournament(db, { id: 't', name: 'Torneo' });
  seedGameweek(db, { id: 'gw-1', tournamentId: 't', weekNumber: 1, name: 'J1',
    deadlineAt: '2020-01-01T00:00:00.000Z', status: 'FINISHED' });
  db.prepare("INSERT INTO clubs (id,name,code,active,normalized_name) VALUES ('c1','Club 1','C1',1,'club 1')").run();
  db.prepare("INSERT INTO clubs (id,name,code,active,normalized_name) VALUES ('c2','Club 2','C2',1,'club 2')").run();
  for (const [id, club] of [['p1', 'c1'], ['p2', 'c1'], ['p3', 'c2']]) {
    db.prepare(`INSERT INTO players (id,club_id,name,position,price_cents,status,active,updated_at)
      VALUES (?,?,?,'FWD',600000000,'ACTIVE',1,?)`).run(id, club, id, new Date().toISOString());
    db.prepare("INSERT INTO tournament_players (tournament_id,player_id,price_cents,active) VALUES ('t',?,600000000,1)").run(id);
  }
  const insertMatch = db.prepare(`INSERT INTO matches
    (id,home_club_id,away_club_id,home_club_name,away_club_name,starts_at,home_score,away_score,
     created_at,updated_at,gameweek_id,score_status) VALUES (?, 'c1','c2','Club 1','Club 2',?,1,0,?,?, 'gw-1',?)`);
  const insertStats = db.prepare(`INSERT INTO player_match_stats
    (player_id,match_id,source,starter,substitute_in,minutes,goals,assists,yellow_cards,red_cards,own_goals,saves,
     source_url,external_id,updated_at) VALUES ('p1',?,'TEST',1,0,90,0,0,0,0,0,0,'test',?,?)`);
  const insertPoints = db.prepare(`INSERT INTO player_fantasy_points
    (player_id,match_id,gameweek_id,participation_points,goal_points,assist_points,clean_sheet_points,
     yellow_card_points,red_card_points,own_goal_points,total_points,input_hash,calculation_version,calculated_at)
    VALUES ('p1',?,'gw-1',1,0,0,0,0,0,0,?,'hash','test',?)`);
  const now = new Date().toISOString();
  for (const [id, status, points] of [['m1', 'CONFIRMED', 5], ['m2', 'CORRECTED', 3], ['m3', 'PROVISIONAL', 100]] as const) {
    insertMatch.run(id, now, now, now, status);
    insertStats.run(id, id, now);
    insertPoints.run(id, points, now);
  }
  return db;
}

describe('calculatePlayerPrices job', () => {
  it('persiste PricingRun e historial una sola vez y solo consume resultados confirmados/corregidos', () => {
    const db = jobDatabase();
    const first = calculatePlayerPrices(db, 't', 'gw-1');
    const second = calculatePlayerPrices(db, 't', 'gw-1');
    expect(first.bootstrap).toBe(true);
    expect(first.updated).toBe(3);
    expect(second).toMatchObject({ runId: first.runId, updated: 0, idempotent: true });
    expect((db.prepare('SELECT COUNT(*) AS count FROM pricing_runs').get() as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS count FROM player_price_history').get() as { count: number }).count).toBe(3);
    const p1 = db.prepare(`SELECT season_points AS seasonPoints, confidence FROM player_price_history
      WHERE pricing_run_id = ? AND player_id = 'p1'`).get(first.runId) as { seasonPoints: number; confidence: number };
    expect(p1.seasonPoints).toBe(8);
    expect(p1.confidence).toBeCloseTo(2 / 6);
  });
});
