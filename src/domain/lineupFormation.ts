import type { Formation, Player } from '../types/fantasy';

interface ArrangeLineupInput {
  formation: Formation;
  starters: string[];
  bench: string[];
  players: Player[];
  captainId: string;
  viceCaptainId: string;
}

export interface ArrangedLineup {
  starters: string[];
  bench: string[];
  captainId: string;
  viceCaptainId: string;
}

/**
 * Rearranges the existing 15-player squad into a valid XI for the selected
 * formation. Current starters are kept whenever their position quota permits;
 * captain and vice-captain receive priority so a formation change is minimally
 * disruptive to the manager's choices.
 */
export function arrangeLineupForFormation({
  formation,
  starters,
  bench,
  players,
  captainId,
  viceCaptainId,
}: ArrangeLineupInput): ArrangedLineup {
  const [defenders, midfielders, forwards] = formation.split('-').map(Number);
  const required = { GK: 1, DEF: defenders, MID: midfielders, FWD: forwards } as const;
  const orderedIds = [...new Set([...starters, ...bench])];
  const playerById = new Map(players.map(player => [player.id, player]));
  const currentStarters = new Set(starters);

  const priority = (id: string) => {
    if (id === captainId) return 0;
    if (id === viceCaptainId) return 1;
    if (currentStarters.has(id)) return 2;
    return 3;
  };

  const idsFor = (position: Player['position']) => orderedIds
    .filter(id => playerById.get(id)?.position === position)
    .sort((left, right) => priority(left) - priority(right) || orderedIds.indexOf(left) - orderedIds.indexOf(right));

  const nextStarters = (
    ['GK', 'DEF', 'MID', 'FWD'] as const
  ).flatMap(position => idsFor(position).slice(0, required[position]));

  if (nextStarters.length !== 11) {
    return { starters, bench, captainId, viceCaptainId };
  }

  const starterSet = new Set(nextStarters);
  const nextBench = orderedIds
    .filter(id => !starterSet.has(id))
    .sort((left, right) => {
      const leftIsGoalkeeper = playerById.get(left)?.position === 'GK' ? 0 : 1;
      const rightIsGoalkeeper = playerById.get(right)?.position === 'GK' ? 0 : 1;
      return leftIsGoalkeeper - rightIsGoalkeeper || orderedIds.indexOf(left) - orderedIds.indexOf(right);
    });

  const firstCaptain = nextStarters.find(id => playerById.get(id)?.position !== 'GK') ?? nextStarters[0];
  const nextCaptainId = starterSet.has(captainId) ? captainId : firstCaptain;
  const nextViceCaptainId = starterSet.has(viceCaptainId) && viceCaptainId !== nextCaptainId
    ? viceCaptainId
    : nextStarters.find(id => id !== nextCaptainId) ?? nextCaptainId;

  return {
    starters: nextStarters,
    bench: nextBench,
    captainId: nextCaptainId,
    viceCaptainId: nextViceCaptainId,
  };
}
