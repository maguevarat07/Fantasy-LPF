import type { Player } from '../types/fantasy';

// Display the latest published player points for a lineup without changing official team scores.
export function lineupGameweekPoints(
  starterIds: readonly string[] | undefined,
  captainId: string | undefined,
  players: readonly Pick<Player, 'id' | 'lastGwPoints'>[],
): number | null {
  if (!starterIds?.length || !players.length) return null;

  const starters = new Set(starterIds);
  let found = 0;
  let points = 0;
  for (const player of players) {
    if (!starters.has(player.id)) continue;
    found += 1;
    points += player.lastGwPoints * (player.id === captainId ? 2 : 1);
  }
  return found ? points : null;
}
