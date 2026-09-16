import React, { useState, useMemo } from 'react';
import { FantasyTeam, TransferHistoryRecord } from '../../types/fantasy';
import { TeamValueSummary } from '../shared/TeamValueSummary';

interface PresupuestoModalProps {
  team: FantasyTeam;
  transferHistory: TransferHistoryRecord[];
  onClose: () => void;
  onGoToMarket?: () => void;
}

export const PresupuestoModal: React.FC<PresupuestoModalProps> = ({
  team,
  transferHistory = [],
  onClose,
  onGoToMarket
}) => {
  const currentPeriod = transferHistory[0]?.gameweek ?? 'actual';
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentPeriod);

  const periods = useMemo(() => {
    const list = new Set<string>([currentPeriod]);
    transferHistory.forEach(t => {
      if (t.gameweek) list.add(t.gameweek);
    });
    return Array.from(list);
  }, [transferHistory, currentPeriod]);

  // Filter transfers by selected period
  const transfers = useMemo(() => {
    if (selectedPeriod === 'all') return transferHistory;
    return transferHistory.filter(t => t.gameweek === selectedPeriod);
  }, [transferHistory, selectedPeriod]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/80 backdrop-blur-sm px-gutter-mobile pb-safe animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-md bg-surface-container rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[85vh]">
        
        {/* Header */}
        <div className="px-5 py-4 bg-surface-container-low flex items-center justify-between border-b border-surface-container-high/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400">
              <span className="material-symbols-outlined text-[20px]">payments</span>
            </div>
            <div>
              <h2 className="font-headline-sm text-sm uppercase text-on-surface font-black leading-tight">
                Dinero Disponible
              </h2>
              <span className="text-[11px] text-on-surface-variant">
                Balance y transferencias realizadas
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="w-8 h-8 rounded-full bg-surface-container-high hover:bg-surface-container-highest flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Balance Card */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <TeamValueSummary
            currentMarketValue={team.currentMarketValue}
            sellingSquadValue={team.sellingSquadValue}
            bank={team.budgetRemaining}
            totalAvailableValue={team.totalAvailableValue}
          />

          {/* Period Selector Tabs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase text-on-surface">
                Transferencias por Jornada
              </span>
              <span className="text-[11px] text-on-surface-variant font-mono">
                {transfers.length} {transfers.length === 1 ? 'cambio' : 'cambios'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {periods.map(p => (
                <button
                  key={p}
                  onClick={() => setSelectedPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedPeriod === p
                      ? 'bg-primary text-surface-container-lowest shadow-sm'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {p === 'actual' ? 'Jornada actual' : p} {p === currentPeriod ? '(Actual)' : ''}
                </button>
              ))}

              <button
                onClick={() => setSelectedPeriod('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  selectedPeriod === 'all'
                    ? 'bg-primary text-surface-container-lowest shadow-sm'
                    : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Todas
              </button>
            </div>
          </div>

          {/* Transfers List */}
          <div className="space-y-2">
            {transfers.length > 0 ? (
              transfers.map(record => {
                const diff = record.balanceDiff || 0;
                const isPositive = diff >= 0;

                return (
                  <div
                    key={record.id}
                    className="bg-surface-container-low rounded-xl p-3 border border-surface-container-high/40 space-y-2"
                  >
                    {/* Date and tag */}
                    <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                      <span className="font-bold text-on-surface">{record.gameweek}</span>
                      <span>{record.dateStr}</span>
                    </div>

                    {/* Swap Row */}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      {/* Out */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 text-[10px] text-error font-bold mb-0.5">
                          <span>SALE</span>
                        </div>
                        <p className="font-bold text-on-surface truncate">{record.playerOutName}</p>
                        <span className="text-[11px] font-mono text-emerald-400 font-bold">
                          +${(record.playerOutPrice || 0).toFixed(1)}M
                        </span>
                      </div>

                      {/* Direction Arrow */}
                      <div className="w-6 h-6 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant shrink-0">
                        <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </div>

                      {/* In */}
                      <div className="flex-1 min-w-0 text-right">
                        <div className="flex items-center justify-end gap-1 text-[10px] text-emerald-400 font-bold mb-0.5">
                          <span>ENTRA</span>
                        </div>
                        <p className="font-bold text-on-surface truncate">{record.playerInName}</p>
                        <span className="text-[11px] font-mono text-amber-400 font-bold">
                          -${(record.playerInPrice || 0).toFixed(1)}M
                        </span>
                      </div>
                    </div>

                    {/* Money Result */}
                    <div className="pt-1.5 border-t border-surface-container-high/40 flex items-center justify-between text-[11px]">
                      <span className="text-on-surface-variant">Resultado en balance:</span>
                      <span className={`font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {isPositive ? `+$${diff.toFixed(1)}M disponible` : `-$${Math.abs(diff).toFixed(1)}M usado`}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 text-center bg-surface-container-low rounded-xl border border-surface-container-high/40">
                <span className="material-symbols-outlined text-on-surface-variant text-[28px] mb-1">
                  swap_horizontal_circle
                </span>
                <p className="text-xs text-on-surface font-medium">Sin transferencias en {selectedPeriod === 'all' ? 'el torneo' : selectedPeriod}</p>
                <p className="text-[11px] text-on-surface-variant mt-0.5">No se ha modificado tu saldo en este periodo.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-surface-container-low border-t border-surface-container-high/50 flex items-center justify-end gap-2 shrink-0">
          {onGoToMarket && (
            <button
              onClick={() => {
                onClose();
                onGoToMarket();
              }}
              className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-primary text-xs font-bold transition-all cursor-pointer"
            >
              Ir al Mercado
            </button>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-primary text-surface-container-lowest text-xs font-bold transition-all cursor-pointer hover:brightness-105"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};
