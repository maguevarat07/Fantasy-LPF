import React from 'react';

interface PriceChangeIndicatorProps {
  change?: number | null;
  compact?: boolean;
}

export const PriceChangeIndicator: React.FC<PriceChangeIndicatorProps> = ({ change, compact = false }) => {
  if (change === undefined || change === null || !Number.isFinite(change)) {
    return (
      <span className="text-on-surface-variant" aria-label="Cambio de precio no disponible">
        —
      </span>
    );
  }

  const normalized = Math.abs(change) < 0.05 ? 0 : change;
  const isUp = normalized > 0;
  const isDown = normalized < 0;
  const symbol = isUp ? '↑' : isDown ? '↓' : '—';
  const amount = `${isUp ? '+' : isDown ? '-' : ''}${Math.abs(normalized).toFixed(1)}`;
  const color = isUp ? 'text-emerald-400' : isDown ? 'text-error' : 'text-on-surface-variant';

  return (
    <span
      className={`${color} font-bold tabular-nums ${compact ? 'text-[11px]' : 'text-sm'}`}
      aria-label={`Cambio de precio ${isUp ? 'al alza' : isDown ? 'a la baja' : 'sin cambio'}: ${amount} millones`}
    >
      {symbol} {amount}
    </span>
  );
};
