import React from 'react';

interface TeamValueSummaryProps {
  currentMarketValue?: number;
  sellingSquadValue?: number;
  bank: number;
  totalAvailableValue?: number;
  compact?: boolean;
}

const formatMoney = (value?: number) => value == null ? '—' : `$${value.toFixed(1)}M`;

export const TeamValueSummary: React.FC<TeamValueSummaryProps> = ({
  currentMarketValue,
  sellingSquadValue,
  bank,
  totalAvailableValue,
  compact = false,
}) => {
  const values = [
    { label: 'Valor de mercado', value: currentMarketValue },
    { label: 'Valor de venta', value: sellingSquadValue },
    { label: 'Banco', value: bank },
    { label: 'Valor disponible', value: totalAvailableValue },
  ];

  return (
    <section
      aria-label="Valor económico del equipo"
      className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${compact ? '' : 'rounded-2xl bg-surface-container-low p-3 border border-surface-container-high/50'}`}
    >
      {values.map(item => (
        <div key={item.label} className="min-w-0 rounded-xl bg-surface-container px-2.5 py-2 text-center">
          <span className="block truncate text-[10px] uppercase tracking-wide text-on-surface-variant">{item.label}</span>
          <strong className="mt-0.5 block font-headline-md text-primary tabular-nums">{formatMoney(item.value)}</strong>
        </div>
      ))}
    </section>
  );
};
