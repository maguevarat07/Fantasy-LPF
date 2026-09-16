import { describe, expect, it } from 'vitest';
import { parseLpfPublishedTotals } from './lpf.js';

describe('parseLpfPublishedTotals', () => {
  it('extracts the cumulative totals exposed by the official LPF table', () => {
    expect(parseLpfPublishedTotals(
      ['#', 'Jugador', 'Club', 'Posición', 'Goles', 'Asistencias', 'Tarjetas amarillas', 'Tarjetas rojas'],
      ['10', 'Jugador', 'Club', 'Delantero', '4', '3', '2', '1'],
    )).toEqual({ goals: 4, assists: 3, yellowCards: 2, redCards: 1 });
  });

  it('does not invent totals when the page has no statistical columns', () => {
    expect(parseLpfPublishedTotals(['Jugador', 'Posición'], ['Jugador', 'Defensa'])).toBeNull();
  });
});
