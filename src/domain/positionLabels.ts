import type { Position } from '../types/fantasy';

export const POSITION_LABELS: Record<Position, string> = {
  GK: 'POR',
  DEF: 'DEF',
  MID: 'MED',
  FWD: 'DEL',
};

export function positionLabel(position: Position): string {
  return POSITION_LABELS[position];
}
