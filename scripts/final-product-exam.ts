import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { createApp } from '../server/app.ts';

type CatalogPlayer = { id: string; clubId: string; position: 'GK' | 'DEF' | 'MID' | 'FWD'; totalPoints?: number; matchesPlayed?: number };
type Catalog = { tournament: { id: string }; clubs: unknown[]; players: CatalogPlayer[] };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function chooseSquad(players: CatalogPlayer[], reverse = false): CatalogPlayer[] {
  const source = reverse ? [...players].reverse() : players;
  const quotas = { GK: 2, DEF: 5, MID: 5, FWD: 3 } as const;
  const clubCounts = new Map<string, number>();
  const chosen: CatalogPlayer[] = [];
  for (const position of Object.keys(quotas) as Array<keyof typeof quotas>) {
    for (const player of source.filter(item => item.position === position)) {
      if ((clubCounts.get(player.clubId) ?? 0) >= 3) continue;
      chosen.push(player);
      clubCounts.set(player.clubId, (clubCounts.get(player.clubId) ?? 0) + 1);
      if (chosen.filter(item => item.position === position).length === quotas[position]) break;
    }
  }
  assert(chosen.length === 15, 'No fue posible construir una plantilla válida desde el catálogo canónico.');
  return chosen;
}

function lineup(squad: CatalogPlayer[]) {
  const by = (position: CatalogPlayer['position']) => squad.filter(player => player.position === position);
  const starters = [by('GK')[0], ...by('DEF').slice(0, 4), ...by('MID').slice(0, 3), ...by('FWD').slice(0, 3)];
  const bench = [by('GK')[1], by('DEF')[4], ...by('MID').slice(3, 5)];
  return { starters: starters.map(player => player.id), bench: bench.map(player => player.id) };
}

async function main() {
  const sourceDatabase = resolve(process.env.DATABASE_PATH ?? 'data/fantasy-lpf.sqlite');
  const examDirectory = mkdtempSync(join(tmpdir(), 'fantasy-lpf-final-exam-'));
  const examDatabase = join(examDirectory, 'exam.sqlite');
  const source = new Database(sourceDatabase, { readonly: true });
  await source.backup(examDatabase);
  source.close();
  const results: Record<string, 'PASS'> = {};
  let activeDatabase: { close(): void } | null = null;
  try {
    const app = createApp({ dbPath: examDatabase, secureCookies: false });
    activeDatabase = app.locals.db as { close(): void };
    const catalogResponse = await request(app).get('/api/catalog').expect(200);
    const catalog = catalogResponse.body as Catalog;
    assert(catalog.clubs.length === 12, `Se esperaban 12 clubes y llegaron ${catalog.clubs.length}.`);
    assert(catalog.players.length >= 180, `Catálogo insuficiente: ${catalog.players.length} jugadores.`);
    assert(new Set(catalog.players.map(player => player.id)).size === catalog.players.length, 'Hay IDs de jugadores duplicados.');
    assert(catalog.players.some(player => Number(player.matchesPlayed) > 0 && Number(player.totalPoints) !== 0),
      'El catálogo no está exponiendo las estadísticas y puntuaciones procesadas.');
    const examDb = app.locals.db as unknown as { prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] } };
    const sports = examDb.prepare(`SELECT (SELECT COUNT(*) FROM gameweeks) AS gameweeks,
      (SELECT COUNT(*) FROM matches) AS matches,
      (SELECT COUNT(DISTINCT source || ':' || external_id) FROM match_external_ids) AS externalMatches`).get() as
      { gameweeks: number; matches: number; externalMatches: number };
    assert(sports.gameweeks >= 8 && sports.matches >= 48, 'La resincronización no dejó un calendario LPF utilizable.');
    assert(sports.matches === sports.externalMatches, 'La resincronización duplicó identidades externas de partidos.');
    const recentTransfermarktRuns = examDb.prepare(`SELECT status FROM sync_runs WHERE source = 'TRANSFERMARKT'
      ORDER BY finished_at DESC LIMIT 2`).all() as Array<{ status: string }>;
    assert(recentTransfermarktRuns.length === 2 && recentTransfermarktRuns.every(run => run.status === 'WORKING'),
      'No existen dos sincronizaciones consecutivas correctas de Transfermarkt.');
    results.dataFoundation = 'PASS';
    results.dataIdentityAndSyncHistory = 'PASS';

    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const suffix = Date.now().toString(36);
    await agentA.post('/api/auth/register').send({ email: `usuario-a-${suffix}@example.test`, username: `usuario_a_${suffix}`, password: 'Clave segura de prueba A 2026', managerName: 'Usuario A' }).expect(201);
    await agentB.post('/api/auth/register').send({ email: `usuario-b-${suffix}@example.test`, username: `usuario_b_${suffix}`, password: 'Clave segura de prueba B 2026', managerName: 'Usuario B' }).expect(201);

    const createTeam = async (agent: typeof agentA, name: string, squad: CatalogPlayer[]) => {
      const selected = lineup(squad);
      return agent.post('/api/onboarding').send({
        tournamentId: catalog.tournament.id, gameweekId: 'current', teamName: name,
        province: 'Panamá', favoriteClubId: squad[0].clubId, formation: '4-3-3',
        ...selected, captainId: selected.starters[9], viceCaptainId: selected.starters[8],
      }).expect(201);
    };
    const teamA = (await createTeam(agentA, 'Canaleros FC', chooseSquad(catalog.players))).body.team;
    const teamB = (await createTeam(agentB, 'Marea Roja FC', chooseSquad(catalog.players, true))).body.team;
    results.usuarioA = 'PASS';
    results.usuarioB = 'PASS';

    const leagueA = (await agentA.post('/api/leagues').send({ tournamentId: catalog.tournament.id, name: 'Liga Amigos QA' }).expect(201)).body.league;
    const leagueUniversity = (await agentA.post('/api/leagues').send({ tournamentId: catalog.tournament.id, name: 'Liga Universidad QA' }).expect(201)).body.league;
    await agentB.post('/api/leagues/join').send({ code: leagueA.code }).expect(201);
    const aLeagues = (await agentA.get(`/api/leagues?tournamentId=${catalog.tournament.id}`).expect(200)).body.leagues;
    assert(aLeagues.length === 2, 'Usuario A no recuperó sus dos ligas.');
    assert(teamA.id !== teamB.id, 'Los usuarios comparten por error el mismo Fantasy Team.');
    const teamIds = aLeagues.map((league: { id: string }) => league.id);
    assert(teamIds.includes(leagueA.id) && teamIds.includes(leagueUniversity.id), 'Las ligas creadas no se recuperaron.');
    const memberships = examDb.prepare(`SELECT league_id AS leagueId, fantasy_team_id AS fantasyTeamId
      FROM league_memberships WHERE league_id IN (?, ?) ORDER BY league_id`).all(leagueA.id, leagueUniversity.id) as
      Array<{ leagueId: string; fantasyTeamId: string }>;
    assert(memberships.filter(item => item.fantasyTeamId === teamA.id).length === 2,
      'Las dos ligas de A no apuntan al mismo Fantasy Team.');
    results.sameTeamMultipleLeagues = 'PASS';

    const board = (await agentB.get(`/api/leagues/${leagueA.id}/leaderboard`).expect(200)).body.leaderboard;
    assert(board.length === 2, 'La liga compartida no contiene ambos equipos.');
    assert(board.every((member: { starters?: string[]; bench?: string[] }) => member.starters?.length === 11 && member.bench?.length === 4),
      'La clasificación no devuelve la alineación real de los rivales.');
    const bOwn = (await agentB.get(`/api/team?tournamentId=${catalog.tournament.id}`).expect(200)).body.team;
    assert(bOwn.id === teamB.id && bOwn.name === 'Marea Roja FC', 'La sesión B obtuvo el equipo de A.');
    await agentB.get(`/api/leagues/${leagueUniversity.id}/leaderboard`).expect(403);
    const aAfterForbiddenAccess = (await agentA.get(`/api/team?tournamentId=${catalog.tournament.id}`).expect(200)).body.team;
    assert(aAfterForbiddenAccess.id === teamA.id && aAfterForbiddenAccess.name === teamA.name,
      'El intento de acceso cruzado alteró el equipo A.');
    results.crossUserSecurity = 'PASS';

    activeDatabase.close();
    activeDatabase = null;
    const restarted = createApp({ dbPath: examDatabase, secureCookies: false });
    activeDatabase = restarted.locals.db as { close(): void };
    const freshA = request.agent(restarted);
    const freshB = request.agent(restarted);
    await freshA.post('/api/auth/login').send({ email: `usuario-a-${suffix}@example.test`, password: 'Clave segura de prueba A 2026' }).expect(200);
    await freshB.post('/api/auth/login').send({ email: `usuario-b-${suffix}@example.test`, password: 'Clave segura de prueba B 2026' }).expect(200);
    const persistedA = (await freshA.get(`/api/team?tournamentId=${catalog.tournament.id}&gameweekId=current`).expect(200)).body.team;
    const persistedB = (await freshB.get(`/api/team?tournamentId=${catalog.tournament.id}&gameweekId=current`).expect(200)).body.team;
    assert(persistedA.id === teamA.id && persistedA.squad.length === 15 && persistedA.lineup.players.length === 15, 'El equipo A no persistió íntegro.');
    assert(persistedB.id === teamB.id && persistedB.squad.length === 15 && persistedB.lineup.players.length === 15, 'El equipo B no persistió íntegro.');
    results.persistence = 'PASS';
    activeDatabase.close();
    activeDatabase = null;
    process.stdout.write(`${JSON.stringify({ success: true, catalog: { clubs: catalog.clubs.length, players: catalog.players.length }, results }, null, 2)}\n`);
  } finally {
    try { activeDatabase?.close(); } catch { /* El examen ya informará el error original. */ }
    const resolvedExamDirectory = resolve(examDirectory);
    assert(resolvedExamDirectory.startsWith(resolve(tmpdir())), 'Directorio temporal fuera de la raíz permitida.');
    try { rmSync(resolvedExamDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows puede retener brevemente el WAL. */ }
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
