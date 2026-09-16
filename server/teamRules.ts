import type { ApplicationDatabase } from './applicationDatabase.js';

export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'] as const;
export type Position = (typeof POSITIONS)[number];

export const FORMATIONS: Record<string, Record<Position, number>> = {
  '3-4-3': { GK: 1, DEF: 3, MID: 4, FWD: 3 },
  '3-5-2': { GK: 1, DEF: 3, MID: 5, FWD: 2 },
  '4-3-3': { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  '4-4-2': { GK: 1, DEF: 4, MID: 4, FWD: 2 },
  '4-5-1': { GK: 1, DEF: 4, MID: 5, FWD: 1 },
  '5-3-2': { GK: 1, DEF: 5, MID: 3, FWD: 2 },
};

const SQUAD_QUOTA: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

export class TeamRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamRuleError';
  }
}

interface PlayerRow {
  id: string;
  club_id: string;
  position: Position;
  price_cents: number;
  active: number | boolean;
}

export async function loadTournamentPlayers(
  db: ApplicationDatabase,
  tournamentId: string,
  playerIds: readonly string[],
): Promise<PlayerRow[]> {
  if (playerIds.length === 0) return [];
  const placeholders = playerIds.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT p.id, p.club_id, p.position, tp.price_cents, tp.active
    FROM tournament_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.tournament_id = ? AND p.id IN (${placeholders})
  `).all(tournamentId, ...playerIds) as unknown as PlayerRow[];
  return rows.map(player => ({
    ...player,
    price_cents: Number(player.price_cents),
    active: Boolean(player.active),
  }));
}

export function validateSquad(players: readonly PlayerRow[]): number {
  if (players.length !== 15) throw new TeamRuleError('La plantilla debe contener exactamente 15 jugadores.');
  if (new Set(players.map(player => player.id)).size !== 15) {
    throw new TeamRuleError('La plantilla no puede contener jugadores repetidos.');
  }
  if (players.some(player => !player.active)) {
    throw new TeamRuleError('Todos los jugadores deben estar activos en el torneo.');
  }

  const byPosition: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const byClub = new Map<string, number>();
  let total = 0;
  for (const player of players) {
    byPosition[player.position] += 1;
    byClub.set(player.club_id, (byClub.get(player.club_id) ?? 0) + 1);
    total += player.price_cents;
  }
  for (const position of POSITIONS) {
    if (byPosition[position] !== SQUAD_QUOTA[position]) {
      throw new TeamRuleError(`La plantilla requiere ${SQUAD_QUOTA[position]} jugadores ${position}.`);
    }
  }
  if ([...byClub.values()].some(count => count > 3)) {
    throw new TeamRuleError('La plantilla permite como máximo 3 jugadores por club.');
  }
  return total;
}

export function validateLineup(
  allPlayers: readonly PlayerRow[],
  formation: string,
  starters: readonly string[],
  bench: readonly string[],
  captainId: string,
  viceCaptainId: string,
): void {
  const formationQuota = FORMATIONS[formation];
  if (!formationQuota) throw new TeamRuleError('Formación no permitida.');
  if (starters.length !== 11 || bench.length !== 4) {
    throw new TeamRuleError('La alineación requiere 11 titulares y 4 suplentes.');
  }
  const squadIds = new Set(allPlayers.map(player => player.id));
  const lineupIds = [...starters, ...bench];
  if (new Set(lineupIds).size !== 15 || lineupIds.some(id => !squadIds.has(id))) {
    throw new TeamRuleError('La alineación debe usar exactamente los 15 jugadores de la plantilla.');
  }
  if (captainId === viceCaptainId || !starters.includes(captainId) || !starters.includes(viceCaptainId)) {
    throw new TeamRuleError('Capitán y vicecapitán deben ser titulares distintos.');
  }

  const positions = new Map(allPlayers.map(player => [player.id, player.position]));
  const starterCount: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of starters) starterCount[positions.get(id)!] += 1;
  for (const position of POSITIONS) {
    if (starterCount[position] !== formationQuota[position]) {
      throw new TeamRuleError(`La formación ${formation} requiere ${formationQuota[position]} titulares ${position}.`);
    }
  }
  if (positions.get(bench[0]) !== 'GK') {
    throw new TeamRuleError('El primer puesto de la banca debe ser el portero suplente.');
  }
}
