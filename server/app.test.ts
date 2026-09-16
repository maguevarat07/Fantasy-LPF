import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { canonicalDataRepository, openDatabase, seedGameweek, seedTournament, type SqliteDatabase } from './db.js';
import { persistEntities } from './ingestion/repository.js';
import { calculatePlayerPoints } from './scoring.js';

const databases: SqliteDatabase[] = [];

function testDatabase(): SqliteDatabase {
  const db = openDatabase({ filename: ':memory:' });
  databases.push(db);
  seedTournament(db, { id: 'apertura-2026', name: 'Apertura 2026' });
  seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1,
    name: 'Jornada 1', deadlineAt: '2099-01-01T00:00:00.000Z', status: 'OPEN' });
  const insertClub = db.prepare('INSERT INTO clubs (id, name, code, active, normalized_name) VALUES (?, ?, ?, 1, ?)');
  for (let index = 1; index <= 12; index += 1) insertClub.run(`club-${index}`, `Club ${index}`, `C${index}`, `club ${index}`);
  const insertPlayer = db.prepare(`INSERT INTO players
    (id, club_id, name, position, price_cents, status, active, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?)`);
  const insertTournamentPlayer = db.prepare(`INSERT INTO tournament_players
    (tournament_id, player_id, price_cents, active) VALUES ('apertura-2026', ?, ?, 1)`);
  const positions = [['GK', 3], ['DEF', 7], ['MID', 7], ['FWD', 5]] as const;
  let club = 1;
  for (const [position, count] of positions) {
    for (let index = 1; index <= count; index += 1) {
      const id = `${position.toLowerCase()}-${index}`;
      insertPlayer.run(id, `club-${club}`, `${position} ${index}`, position, 5_000_000, new Date().toISOString());
      insertTournamentPlayer.run(id, 5_000_000);
      club = club === 12 ? 1 : club + 1;
    }
  }
  return db;
}

function onboarding(teamName: string) {
  const starters = ['gk-1', 'def-1', 'def-2', 'def-3', 'def-4', 'mid-1', 'mid-2', 'mid-3', 'fwd-1', 'fwd-2', 'fwd-3'];
  const bench = ['gk-2', 'def-5', 'mid-4', 'mid-5'];
  return {
    tournamentId: 'apertura-2026',
    teamName,
    province: 'Panamá',
    favoriteClubId: 'club-1',
    formation: '4-3-3',
    gameweekId: 'gw-1',
    starters,
    bench,
    captainId: 'fwd-1',
    viceCaptainId: 'mid-1',
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe('economía de transferencias', () => {
  it('expone al mercado el cambio, versión e historial persistidos por el backend', async () => {
    const db = testDatabase();
    const timestamp = '2026-01-02T00:00:00.000Z';
    db.prepare(`INSERT INTO pricing_runs
      (id, tournament_id, as_of_gameweek_id, formula_version, config_json, input_hash, status, created_at, completed_at)
      VALUES ('catalog-run', 'apertura-2026', 'gw-1', 'lpf-price-v2.0.0', '{}', 'catalog-hash', 'COMPLETED', ?, ?)`)
      .run(timestamp, timestamp);
    db.prepare(`INSERT INTO player_price_history
      (pricing_run_id, tournament_id, player_id, gameweek_id, previous_price_cents,
       current_price_cents, change_cents, fair_price_cents, season_points_percentile,
       recent_form_percentile, points_per_appearance_percentile, performance_index,
       adjusted_performance, confidence, season_points, recent_form,
       points_per_appearance, participation_rate, formula_version, effective_at, market_momentum)
      VALUES ('catalog-run', 'apertura-2026', 'fwd-1', 'gw-1', 500000000,
        530000000, 30000000, 900000000, 0.9, 0.8, 0.85, 0.86, 0.82,
        1, 30, 7.5, 5, 1, 'lpf-price-v2.0.0', ?, 0)`)
      .run(timestamp);
    db.prepare(`UPDATE tournament_players SET price_cents = 530000000,
      previous_price_cents = 500000000, last_change_cents = 30000000,
      last_calculated_gameweek_id = 'gw-1', pricing_status = 'CURRENT',
      pricing_version = 'lpf-price-v2.0.0', price_updated_at = ?
      WHERE tournament_id = 'apertura-2026' AND player_id = 'fwd-1'`).run(timestamp);

    const catalog = await request(createApp({ db, secureCookies: false })).get('/api/catalog').expect(200);
    const player = catalog.body.players.find((item: { id: string }) => item.id === 'fwd-1');
    expect(player).toMatchObject({
      priceCents: 530_000_000, previousPriceCents: 500_000_000,
      priceChangeCents: 30_000_000, pricingVersion: 'lpf-price-v2.0.0', recentForm: 7.5,
    });
    expect(player.priceHistory).toEqual([{
      gameweekId: 'gw-1', gameweekName: 'Jornada 1', priceCents: 530_000_000,
      changeCents: 30_000_000, effectiveAt: timestamp,
    }]);
  });

  it('usa selling price, cobra current price y conserva el historial económico', async () => {
    const db = testDatabase();
    const app = createApp({ db, secureCookies: false });
    const ana = request.agent(app);
    const beto = request.agent(app);
    await ana.post('/api/auth/register').send({
      email: 'economy-ana@example.com', username: 'economy-ana',
      password: 'correct horse battery staple', managerName: 'Ana',
    }).expect(201);
    await beto.post('/api/auth/register').send({
      email: 'economy-beto@example.com', username: 'economy-beto',
      password: 'correct horse battery staple', managerName: 'Beto',
    }).expect(201);
    await ana.post('/api/onboarding').send(onboarding('Economía Ana')).expect(201);
    await beto.post('/api/onboarding').send(onboarding('Economía Beto')).expect(201);

    db.prepare(`UPDATE squad_players SET purchase_price_cents = 500000000
      WHERE player_id = 'def-5'`).run();
    db.prepare(`UPDATE tournament_players SET price_cents = 580000000
      WHERE tournament_id = 'apertura-2026' AND player_id IN ('def-5', 'def-6')`).run();

    const anaBefore = await ana.get('/api/team?tournamentId=apertura-2026&gameweekId=gw-1').expect(200);
    const anaOwned = anaBefore.body.team.squad.find((player: { id: string }) => player.id === 'def-5');
    expect(anaOwned).toMatchObject({
      purchasePriceCents: 500_000_000,
      currentPriceCents: 580_000_000,
      sellingPriceCents: 540_000_000,
      profitLossCents: 40_000_000,
      purchaseGameweekId: 'gw-1',
    });

    await ana.post('/api/transfers').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1',
      items: [{ playerOutId: 'def-5', playerInId: 'def-6',
        expectedBuyPriceCents: 500_000_000, expectedSellPriceCents: 540_000_000 }],
    }).expect(409).expect(response => expect(response.body.error.code).toBe('PRICE_CHANGED'));

    const anaTransfer = await ana.post('/api/transfers').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1',
      items: [{ playerOutId: 'def-5', playerInId: 'def-6',
        expectedBuyPriceCents: 580_000_000, expectedSellPriceCents: 540_000_000 }],
    }).expect(201);
    expect(anaTransfer.body.transfer.bankAfterCents)
      .toBe(anaTransfer.body.transfer.bankBeforeCents - 40_000_000);
    expect(db.prepare(`SELECT purchase_price_cents AS purchasePrice FROM squad_players
      WHERE fantasy_team_id = ? AND player_id = 'def-6'`)
      .get(anaTransfer.body.team.id)).toEqual({ purchasePrice: 580_000_000 });
    expect(db.prepare(`SELECT sell_price_cents AS sellingPrice, buy_price_cents AS buyingPrice,
        purchase_price_cents AS purchasePrice, profit_loss_cents AS profitLoss,
        purchase_gameweek_id AS purchaseGameweek
      FROM transfer_items WHERE transfer_id = ?`).get(anaTransfer.body.transfer.id)).toEqual({
      sellingPrice: 540_000_000, buyingPrice: 580_000_000,
      purchasePrice: 500_000_000, profitLoss: 40_000_000, purchaseGameweek: 'gw-1',
    });

    db.prepare(`UPDATE tournament_players SET price_cents = 420000000
      WHERE tournament_id = 'apertura-2026' AND player_id = 'def-5'`).run();
    const betoTransfer = await beto.post('/api/transfers').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1',
      items: [{ playerOutId: 'def-5', playerInId: 'def-6',
        expectedBuyPriceCents: 580_000_000, expectedSellPriceCents: 420_000_000 }],
    }).expect(201);
    expect(betoTransfer.body.transfer.bankAfterCents)
      .toBe(betoTransfer.body.transfer.bankBeforeCents - 160_000_000);
    const betoHistory = betoTransfer.body.team.transferHistory[0];
    expect(betoHistory).toMatchObject({
      purchasePrice: 5, sellingPrice: 4.2, profitLoss: -0.8,
      purchaseGameweek: 'gw-1', saleGameweek: 'gw-1', playerInPrice: 5.8,
    });
  });

  it('aplica una sola penalización al batch que supera dos fichajes gratuitos y el comodín conserva los gratuitos', async () => {
    const db = testDatabase();
    const app = createApp({ db, secureCookies: false });
    const regular = request.agent(app);
    const wildcard = request.agent(app);
    for (const [agent, suffix] of [[regular, 'regular'], [wildcard, 'wildcard']] as const) {
      await agent.post('/api/auth/register').send({
        email: `batch-${suffix}@example.com`, username: `batch-${suffix}`,
        password: 'correct horse battery staple', managerName: suffix,
      }).expect(201);
      await agent.post('/api/onboarding').send(onboarding(`Equipo ${suffix}`)).expect(201);
    }

    const regularTeam = db.prepare("SELECT id FROM fantasy_teams WHERE name = 'Equipo regular'")
      .get() as { id: string };
    db.prepare('UPDATE fantasy_teams SET free_transfers = 2 WHERE id = ?').run(regularTeam.id);
    const items = [
      { playerOutId: 'def-5', playerInId: 'def-6' },
      { playerOutId: 'mid-4', playerInId: 'mid-6' },
      { playerOutId: 'fwd-3', playerInId: 'fwd-4' },
    ];
    const regularTransfer = await regular.post('/api/transfers').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1', items,
    }).expect(201);
    expect(regularTransfer.body.transfer.pointsCost).toBe(4);
    expect(regularTransfer.body.team.freeTransfers).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS total FROM transfer_items WHERE transfer_id = ?')
      .get(regularTransfer.body.transfer.id)).toEqual({ total: 3 });

    await wildcard.post('/api/chips/activate').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1', chipId: 'wildcard',
    }).expect(200);
    const wildcardTransfer = await wildcard.post('/api/transfers').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1', items,
    }).expect(201);
    expect(wildcardTransfer.body.transfer.pointsCost).toBe(0);
    expect(wildcardTransfer.body.team.freeTransfers).toBe(1);
    expect(db.prepare('SELECT wildcard_used AS wildcardUsed FROM transfers WHERE id = ?')
      .get(wildcardTransfer.body.transfer.id)).toEqual({ wildcardUsed: 1 });
  });

  it('el comodín no permite gastar más que bank más selling price y el rechazo es atómico', async () => {
    const db = testDatabase();
    const app = createApp({ db, secureCookies: false });
    const manager = request.agent(app);
    await manager.post('/api/auth/register').send({
      email: 'wildcard-budget@example.com', username: 'wildcard-budget',
      password: 'correct horse battery staple', managerName: 'Budget',
    }).expect(201);
    const created = await manager.post('/api/onboarding').send(onboarding('Equipo Budget')).expect(201);
    await manager.post('/api/chips/activate').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1', chipId: 'wildcard',
    }).expect(200);
    db.prepare(`UPDATE tournament_players SET price_cents = 20000000000
      WHERE tournament_id = 'apertura-2026' AND player_id = 'def-6'`).run();

    await manager.post('/api/transfers').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1',
      items: [{ playerOutId: 'def-5', playerInId: 'def-6',
        expectedBuyPriceCents: 20_000_000_000, expectedSellPriceCents: 5_000_000 }],
    }).expect(422).expect(response => {
      expect(response.body.error.code).toBe('TEAM_RULE_VIOLATION');
      expect(response.body.error.message).toContain('presupuesto suficiente');
    });

    expect(db.prepare('SELECT COUNT(*) AS total FROM transfers WHERE fantasy_team_id = ?')
      .get(created.body.team.id)).toEqual({ total: 0 });
    expect(db.prepare(`SELECT player_id AS playerId FROM squad_players
      WHERE fantasy_team_id = ? AND player_id IN ('def-5', 'def-6') ORDER BY player_id`)
      .all(created.body.team.id)).toEqual([{ playerId: 'def-5' }]);
    const unchanged = await manager.get('/api/team?tournamentId=apertura-2026&gameweekId=gw-1').expect(200);
    expect(unchanged.body.team.bankCents).toBe(created.body.team.bankCents);
    expect(unchanged.body.team.freeTransfers).toBe(1);
  });
});

describe('Fantasy LPF backend', () => {
  it('aplica exactamente las reglas de puntuación LPF', () => {
    expect(calculatePlayerPoints({ position: 'GK', started: true, substituteIn: false, goals: 1,
      confirmedAssists: 1, yellowCards: 1, redCards: 0, ownGoals: 0, cleanSheet: true })).toMatchObject({
      participationPoints: 1, goalPoints: 10, assistPoints: 3, cleanSheetPoints: 5,
      yellowCardPoints: -1, totalPoints: 18,
    });
    expect(calculatePlayerPoints({ position: 'DEF', started: false, substituteIn: true, goals: 0,
      confirmedAssists: 0, yellowCards: 0, redCards: 1, ownGoals: 1, cleanSheet: true }).totalPoints).toBe(0);
  });

  it('repite una ingestión canónica sin duplicar identidades externas', async () => {
    const db = openDatabase({ filename: ':memory:' });
    databases.push(db);
    const entities = [
      {
        kind: 'club' as const,
        name: 'Tauro FC',
        normalizedName: 'tauro fc',
        external: { source: 'LPF' as const, externalId: 'tauro', sourceUrl: 'https://example.test/clubs/tauro' },
      },
      {
        kind: 'player' as const,
        fullName: 'Jugador Uno',
        displayName: 'Jugador Uno',
        normalizedName: 'jugador uno',
        clubName: 'Tauro FC',
        normalizedClubName: 'tauro fc',
        position: 'MID' as const,
        dateOfBirth: null,
        nationality: 'Panamá',
        shirtNumber: 8,
        imageUrl: null,
        external: { source: 'LPF' as const, externalId: 'player-1', sourceUrl: 'https://example.test/players/1' },
      },
    ];
    const repository = canonicalDataRepository(db);
    const first = await persistEntities(repository, entities, []);
    const second = await persistEntities(repository, entities, []);
    expect(first.created).toBe(2);
    expect(second).toEqual({ created: 0, updated: 0 });
    expect((db.prepare('SELECT COUNT(*) AS total FROM players').get() as { total: number }).total).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS total FROM player_external_ids').get() as { total: number }).total).toBe(1);
  });

  it('mantiene sesión opaca en cookie httpOnly y no expone el hash', async () => {
    const app = createApp({ db: testDatabase(), secureCookies: false });
    const anonymous = await request(app).get('/api/auth/session');
    expect(anonymous.status).toBe(401);

    const agent = request.agent(app);
    const registration = await agent.post('/api/auth/register').send({
      email: 'ana@example.com', username: 'ana', password: 'correct horse battery staple', managerName: 'Ana Pérez',
    });
    expect(registration.status).toBe(201);
    expect(registration.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(JSON.stringify(registration.body)).not.toContain('password');

    const session = await agent.get('/api/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe('ana@example.com');

    await agent.post('/api/auth/change-password').send({
      currentPassword: 'correct horse battery staple', newPassword: 'new secure battery staple',
    }).expect(200);
    await agent.post('/api/auth/logout').expect(204);
    await request(app).post('/api/auth/login').send({ email: 'ana', password: 'correct horse battery staple' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: '@ana', password: 'new secure battery staple' }).expect(200);
  });

  it('guarda y recupera el borrador de onboarding por usuario', async () => {
    const app = createApp({ db: testDatabase(), secureCookies: false });
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      email: 'draft@example.com', username: 'draft-user', password: 'correct horse battery staple', managerName: 'Draft User',
    }).expect(201);
    await agent.put('/api/onboarding/draft').send({
      tournamentId: 'apertura-2026', step: 2, teamName: 'Borrador FC', province: 'Colón',
      formation: '4-3-3', selectedPlayerIds: ['gk-1'], starters: [], bench: [], captainId: '', viceCaptainId: '',
    }).expect(200);
    const draft = await agent.get('/api/onboarding/draft?tournamentId=apertura-2026').expect(200);
    expect(draft.body.draft).toMatchObject({ step: 2, teamName: 'Borrador FC', selectedPlayerIds: ['gk-1'] });
    await agent.post('/api/onboarding').send(onboarding('Equipo Final')).expect(201);
    expect((await agent.get('/api/onboarding/draft?tournamentId=apertura-2026')).body.draft).toBeNull();
  });

  it('permite crear el equipo por primera vez aunque el deadline ya venció, pero bloquea ediciones posteriores', async () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-1', tournamentId: 'apertura-2026', weekNumber: 1,
      name: 'Jornada 1', deadlineAt: '2020-01-01T00:00:00.000Z', status: 'LOCKED' });
    const app = createApp({ db, secureCookies: false });
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      email: 'closed@example.com', username: 'closed-user', password: 'correct horse battery staple', managerName: 'Closed User',
    }).expect(201);
    const created = await agent.post('/api/onboarding').send({ ...onboarding('Tarde FC'), gameweekId: 'gw-1' }).expect(201);
    expect(created.body.team.name).toBe('Tarde FC');

    const { teamName: _teamName, province: _province, favoriteClubId: _favoriteClubId, ...lineupPayload } = onboarding('Tarde FC');
    const editResponse = await agent.put('/api/team/lineup').send({ ...lineupPayload, gameweekId: 'gw-1' }).expect(409);
    expect(editResponse.body.error.code).toBe('DEADLINE_PASSED');
  });

  it('recupera la última alineación guardada si la jornada solicitada todavía no tiene una propia', async () => {
    const db = testDatabase();
    seedGameweek(db, { id: 'gw-2', tournamentId: 'apertura-2026', weekNumber: 2,
      name: 'Jornada 2', deadlineAt: '2099-01-08T00:00:00.000Z', status: 'OPEN' });
    const app = createApp({ db, secureCookies: false });
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      email: 'returning@example.com', username: 'returning-user',
      password: 'correct horse battery staple', managerName: 'Returning User',
    }).expect(201);
    await agent.post('/api/onboarding').send(onboarding('Persistente FC')).expect(201);

    const restored = await agent.get('/api/team?tournamentId=apertura-2026&gameweekId=gw-2').expect(200);
    expect(restored.body.team.squad).toHaveLength(15);
    expect(restored.body.team.lineup).toMatchObject({
      gameweekId: 'gw-1', captainId: 'fwd-1', viceCaptainId: 'mid-1',
    });
    expect(restored.body.team.lineup.players).toHaveLength(15);
  });

  it('aísla dos usuarios, impone un equipo por torneo y comparte el mismo equipo en ligas', async () => {
    const db = testDatabase();
    const app = createApp({ db, secureCookies: false });
    const ana = request.agent(app);
    const beto = request.agent(app);
    await ana.post('/api/auth/register').send({
      email: 'ana@example.com', username: 'ana', password: 'correct horse battery staple', managerName: 'Ana Pérez',
    }).expect(201);
    await beto.post('/api/auth/register').send({
      email: 'beto@example.com', username: 'beto', password: 'another correct battery staple', managerName: 'Beto Díaz',
    }).expect(201);

    const anaTeam = await ana.post('/api/onboarding').send(onboarding('Canaleras FC')).expect(201);
    const betoTeam = await beto.post('/api/onboarding').send(onboarding('Istmeños FC')).expect(201);
    expect(anaTeam.body.team.id).not.toBe(betoTeam.body.team.id);
    const initialOwnership = db.prepare(`SELECT COUNT(*) AS total,
      COUNT(DISTINCT purchase_gameweek_id) AS gameweeks, MIN(purchase_gameweek_id) AS gameweek
      FROM squad_players WHERE fantasy_team_id = ?`).get(anaTeam.body.team.id) as
      { total: number; gameweeks: number; gameweek: string };
    expect(initialOwnership).toEqual({ total: 15, gameweeks: 1, gameweek: 'gw-1' });
    await ana.post('/api/onboarding').send(onboarding('Equipo duplicado')).expect(409);

    const league = await ana.post('/api/leagues').send({ tournamentId: 'apertura-2026', name: 'Liga de Prueba' }).expect(201);
    await beto.post('/api/leagues/join').send({ code: league.body.league.code }).expect(201);
    const table = await ana.get(`/api/leagues/${league.body.league.id}/leaderboard`).expect(200);
    expect(table.body.leaderboard).toHaveLength(2);

    const membershipIds = db.prepare(`SELECT fantasy_team_id FROM league_memberships WHERE league_id = ? ORDER BY fantasy_team_id`)
      .all(league.body.league.id) as { fantasy_team_id: string }[];
    expect(membershipIds.map(row => row.fantasy_team_id).sort()).toEqual(
      [anaTeam.body.team.id, betoTeam.body.team.id].sort(),
    );
    const anaOwn = await ana.get('/api/team?tournamentId=apertura-2026').expect(200);
    const betoOwn = await beto.get('/api/team?tournamentId=apertura-2026').expect(200);
    expect(anaOwn.body.team.name).toBe('Canaleras FC');
    expect(betoOwn.body.team.name).toBe('Istmeños FC');

    await ana.post('/api/transfers').send({
      tournamentId: 'apertura-2026', gameweekId: 'gw-1',
      items: [{ playerOutId: 'def-5', playerInId: 'def-6' }],
    }).expect(201);
    const anaReloaded = await ana.get('/api/team?tournamentId=apertura-2026&gameweekId=gw-1').expect(200);
    const betoReloaded = await beto.get('/api/team?tournamentId=apertura-2026&gameweekId=gw-1').expect(200);
    expect(anaReloaded.body.team.transferHistory).toHaveLength(1);
    expect(anaReloaded.body.team.transferHistory[0]).toMatchObject({ playerOutName: 'DEF 5', playerInName: 'DEF 6' });
    expect(betoReloaded.body.team.transferHistory).toHaveLength(0);
    const transferredOwnership = db.prepare(`SELECT sp.purchase_price_cents AS purchasePrice,
      sp.purchase_gameweek_id AS purchaseGameweek, tp.price_cents AS currentPrice
      FROM squad_players sp
      JOIN fantasy_teams ft ON ft.id = sp.fantasy_team_id
      JOIN tournament_players tp ON tp.tournament_id = ft.tournament_id AND tp.player_id = sp.player_id
      WHERE sp.fantasy_team_id = ? AND sp.player_id = 'def-6'`).get(anaTeam.body.team.id);
    expect(transferredOwnership).toEqual({
      purchasePrice: 5_000_000, purchaseGameweek: 'gw-1', currentPrice: 5_000_000,
    });
  });
});
