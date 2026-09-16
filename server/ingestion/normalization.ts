import type { FantasyPosition } from './types.ts';

const DIACRITICS = /[\u0300-\u036f]/g;

export function cleanText(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeIdentity(value: string | undefined | null): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLocaleLowerCase('es')
    .replace(/\b(f\.?c\.?|c\.?d\.?)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizePosition(raw: string | undefined | null): FantasyPosition {
  const value = normalizeIdentity(raw);
  if (!value) return null;
  if (/^(gk|por|portero|goalkeeper|goalie)$/.test(value)) return 'GK';
  if (/^(def|defensa|defender|back|centre back|center back|lateral)$/.test(value)) return 'DEF';
  if (/^(mid|med|medio|mediocampista|midfielder|volante)$/.test(value)) return 'MID';
  if (/^(fwd|del|delantero|forward|striker|ataque|atacante)$/.test(value)) return 'FWD';
  if (value.includes('portero')) return 'GK';
  if (value.includes('defens') || value.includes('lateral') || value.includes('back')) return 'DEF';
  if (value.includes('medio') || value.includes('volante') || value.includes('pivote') || value.includes('centrocampista') || value.includes('mediapunta') || value.includes('interior')) return 'MID';
  if (value.includes('delanter') || value.includes('atacante') || value.includes('extremo') || value.includes('striker')) return 'FWD';
  return null;
}

export function parseNullableInt(raw: string | undefined | null): number | null {
  const match = cleanText(raw).match(/-?\d+/);
  if (!match) return null;
  const value = Number.parseInt(match[0], 10);
  return Number.isFinite(value) ? value : null;
}

export function stableFallbackId(...parts: Array<string | null | undefined>): string {
  return parts.map(normalizeIdentity).filter(Boolean).join(':');
}
