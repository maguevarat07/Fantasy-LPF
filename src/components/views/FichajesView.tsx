import React, { useState } from 'react';
import { FantasyTeam, TransferHistoryRecord, Player } from '../../types/fantasy';
import { TeamValueSummary } from '../shared/TeamValueSummary';
import { PriceChangeIndicator } from '../shared/PriceChangeIndicator';

const positionLabel = { GK: 'POR', DEF: 'DEF', MID: 'MED', FWD: 'DEL' } as const;

interface FichajesViewProps {
  team: FantasyTeam;
  allPlayers: Player[];
  transferHistory: TransferHistoryRecord[];
  onGoToMarket: () => void;
  onOpenComodines: () => void;
  onResetDraft?: () => void;
  currentGameweek?: number | null;
}

export const FichajesView: React.FC<FichajesViewProps> = ({
  team,
  allPlayers,
  transferHistory,
  onGoToMarket,
  onOpenComodines,
  onResetDraft,
  currentGameweek,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'current'>('all');

  const filteredHistory = transferHistory.filter(h => {
    if (selectedFilter === 'current') return currentGameweek !== null && currentGameweek !== undefined
      && (h.gameweek === `apertura-2026-gw-${currentGameweek}` || h.gameweek === `J${currentGameweek}`);
    return true;
  });

  const penaltyPoints = team.transferPenaltyPoints || 0;
  const isComodinActive = !!team.comodinActiveInGw;

  return (
    <div className="flex flex-col w-full px-gutter-mobile gap-space-md pb-32 pt-space-xs">
      {/* Status & Penalty Advisory Header Card */}
      <div className="flex flex-col w-full rounded-xl bg-surface-container-low p-space-md gap-space-sm shadow-md relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-36 h-36 rounded-full bg-primary-container/10 blur-2xl pointer-events-none"></div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span
              className="material-symbols-outlined text-primary text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              swap_horiz
            </span>
            <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-on-surface">
              Panel de Transferencias LPF
            </span>
          </div>
          <div className="flex items-center gap-space-2xs bg-surface-container-highest px-space-xs py-space-2xs rounded-full">
            <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">Jornada actual</span>
          </div>
        </div>

        {/* Rule & Deduction Grid */}
        <div className="grid grid-cols-2 gap-space-xs">
          <div className="flex flex-col bg-surface-container p-space-xs rounded-lg">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Fichajes Libres</span>
            <div className="flex items-baseline gap-space-2xs mt-0.5">
              <span className="font-stat-counter text-stat-counter text-primary font-bold">{team.freeTransfers}</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">/ 2 máx. acumulables</span>
            </div>
          </div>
          <div className="flex flex-col bg-surface-container p-space-xs rounded-lg">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Penalización actual</span>
            <div className="flex items-center gap-space-2xs mt-0.5">
              <span className={`font-stat-counter text-stat-counter font-bold ${penaltyPoints > 0 ? 'text-error' : 'text-primary'}`}>
                {penaltyPoints > 0 ? `-${penaltyPoints}` : '0'}
              </span>
              <span className={`font-label-sm text-label-sm font-bold uppercase ${penaltyPoints > 0 ? 'text-error' : 'text-primary'}`}>
                PTS
              </span>
            </div>
          </div>
        </div>

        {/* Comodín status or Penalty Warning Alert */}
        {isComodinActive ? (
          <div className="flex items-center gap-space-xs bg-primary-container/30 text-primary p-space-xs rounded-lg shadow-sm border border-primary/40">
            <span
              className="material-symbols-outlined text-[20px] text-primary flex-shrink-0"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_fix_high
            </span>
            <p className="font-body-sm text-body-sm leading-tight text-on-surface">
              <strong>Comodín LPF activado:</strong> Las transferencias de la jornada actual son gratuitas (sin coste de puntos).
            </p>
          </div>
        ) : penaltyPoints > 0 ? (
          <div className="flex items-center gap-space-xs bg-error-container/80 text-on-error-container p-space-xs rounded-lg shadow-sm">
            <span
              className="material-symbols-outlined text-[20px] text-error flex-shrink-0"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              warning
            </span>
            <p className="font-body-sm text-body-sm leading-tight text-on-error-container">
              <strong>Aviso de deducción:</strong> Se han aplicado <strong>-{penaltyPoints} pts</strong> a tu total por transferencias adicionales.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-surface-container p-space-xs rounded-lg">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-primary text-[18px]">verified</span>
              <span className="font-body-sm text-body-sm text-on-surface">
                {team.freeTransfers > 0
                  ? `Tienes ${team.freeTransfers} transferencia${team.freeTransfers > 1 ? 's' : ''} gratuita${team.freeTransfers > 1 ? 's' : ''} disponible${team.freeTransfers > 1 ? 's' : ''}.`
                  : 'Has consumido tus fichajes gratuitos. El próximo costará -4 pts.'}
              </span>
            </div>
            {team.comodinAvailable && !isComodinActive && (
              <button
                onClick={onOpenComodines}
                className="font-label-sm text-label-sm text-primary uppercase underline font-bold shrink-0 ml-2"
              >
                Comodín
              </button>
            )}
          </div>
        )}

        {/* Financial Transition Bar */}
        <div className="flex items-center justify-between bg-surface-container-high px-space-sm py-space-xs rounded-lg">
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Presupuesto en Banco</span>
            <div className="flex items-center gap-space-xs mt-0.5">
              <span className="font-title-md text-title-md text-primary font-bold">
                ${team.budgetRemaining.toFixed(1)}M
              </span>
            </div>
          </div>
          <div className="flex items-center gap-space-2xs bg-primary-container/20 text-primary px-space-xs py-space-2xs rounded-full">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            <span className="font-label-sm text-label-sm uppercase font-bold tracking-wide">
              Plantilla 15/15
            </span>
          </div>
        </div>

        <TeamValueSummary
          currentMarketValue={team.currentMarketValue}
          sellingSquadValue={team.sellingSquadValue}
          bank={team.budgetRemaining}
          totalAvailableValue={team.totalAvailableValue}
          compact
        />
      </div>

      {/* Action CTA: Go to market */}
      <button
        onClick={onGoToMarket}
        className="w-full bg-primary-container text-on-primary-container hover:brightness-105 py-space-sm rounded-xl font-headline-md text-headline-md uppercase tracking-wider flex items-center justify-center gap-space-xs shadow-lg active:scale-[0.98] transition-transform font-bold"
        type="button"
      >
        <span className="material-symbols-outlined text-[24px]">storefront</span>
        <span>Explorar Mercado LPF para Fichar</span>
      </button>

      <details className="rounded-xl bg-surface-container-low border border-surface-container-high/40 shadow-md">
        <summary className="cursor-pointer list-none p-space-sm flex items-center justify-between gap-2">
          <div>
            <h2 className="font-headline-md text-headline-md uppercase text-on-surface">Economía de mis jugadores</h2>
            <p className="text-xs text-on-surface-variant">Compra, valor actual y precio de venta de tu plantilla.</p>
          </div>
          <span className="material-symbols-outlined text-primary">expand_more</span>
        </summary>
        <div className="border-t border-surface-container-high/50 p-space-xs space-y-1.5">
          {allPlayers.map(player => {
            const currentPrice = player.currentPrice ?? player.price;
            const profit = player.purchasePrice == null || player.sellingPrice == null
              ? null
              : player.sellingPrice - player.purchasePrice;
            return (
              <div key={player.id} className="rounded-lg bg-surface-container px-2.5 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-sm text-on-surface">{player.displayName}</strong>
                  <span className="block truncate text-[11px] text-on-surface-variant">
                    {positionLabel[player.position]} · {player.clubName}
                  </span>
                </div>
                <div className="shrink-0 text-right text-[11px] tabular-nums">
                  <div className="flex items-center justify-end gap-1.5">
                    <strong className="text-primary">${currentPrice.toFixed(1)}M</strong>
                    <PriceChangeIndicator change={player.priceChange} compact />
                  </div>
                  <span className="text-on-surface-variant">
                    Compra {player.purchasePrice == null ? '—' : `$${player.purchasePrice.toFixed(1)}M`} · Venta {player.sellingPrice == null ? '—' : `$${player.sellingPrice.toFixed(1)}M`}
                  </span>
                  {profit !== null && (
                    <span className={`block font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-error'}`}>
                      {profit >= 0 ? 'Ganancia' : 'Pérdida'} {profit >= 0 ? '+' : '-'}${Math.abs(profit).toFixed(1)}M
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {/* Section Title: Historial & Movimientos */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span className="font-headline-md text-headline-md uppercase text-on-surface">
            Historial de Transferencias
          </span>
          <span className="bg-primary/20 text-primary font-label-sm text-label-sm font-bold px-space-xs py-0.5 rounded-full">
            {filteredHistory.length}
          </span>
        </div>
        <div className="flex items-center gap-1 bg-surface-container-high p-0.5 rounded-lg text-xs">
          <button
            onClick={() => setSelectedFilter('all')}
            className={`px-2 py-0.5 rounded ${selectedFilter === 'all' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant'}`}
          >
            Todas
          </button>
          <button
            onClick={() => setSelectedFilter('current')}
            className={`px-2 py-0.5 rounded ${selectedFilter === 'current' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant'}`}
          >
            Jornada actual
          </button>
        </div>
      </div>

      {/* Transfer List Cards */}
      <div className="space-y-space-sm">
        {filteredHistory.map((item) => {
          const outImg = allPlayers.find(p => p.displayName === item.playerOutName || p.name === item.playerOutName)?.imageUrl || '';
          const inImg = allPlayers.find(p => p.displayName === item.playerInName || p.name === item.playerInName)?.imageUrl || '';

          return (
            <div
              key={item.id}
              className="flex flex-col w-full bg-surface-container-low rounded-xl p-space-sm gap-space-xs shadow-md border border-surface-container-high/40"
            >
              <div className="flex items-center justify-between pb-space-2xs">
                <div className="flex items-center gap-2">
                  <span className="font-headline-sm text-headline-sm uppercase text-on-surface font-bold">
                    {item.gameweek}
                  </span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">
                    {item.dateStr}
                  </span>
                </div>
                <span
                  className={`font-label-sm text-label-sm font-bold px-2 py-0.5 rounded ${
                    item.pointsCost > 0
                      ? 'bg-error-container text-error'
                      : 'bg-primary/20 text-primary'
                  }`}
                >
                  {item.auditTag || (item.pointsCost > 0 ? `-${item.pointsCost} PTS` : '0 PTS')}
                </span>
              </div>

              {/* Outgoing Player Card */}
              <div className="flex items-center justify-between bg-surface-container p-space-xs rounded-lg">
                <div className="flex items-center gap-space-xs min-w-0">
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container-highest">
                    {outImg ? (
                      <img
                        className="w-full h-full object-cover"
                        src={outImg}
                        alt={item.playerOutName}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                        <span className="material-symbols-outlined text-[20px]">person</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-error/90 text-on-error flex items-center justify-center h-3">
                      <span className="material-symbols-outlined text-[10px]">arrow_downward</span>
                    </div>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-space-2xs">
                      <span className="font-title-md text-title-md text-on-surface truncate">
                        {item.playerOutName}
                      </span>
                    </div>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      {item.playerOutClub}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Venta</span>
                  <span className="font-label-lg text-label-lg text-on-surface font-bold">
                    +${item.playerOutPrice.toFixed(1)}M
                  </span>
                </div>
              </div>

              {/* Transfer Connection Pill */}
              <div className="flex items-center justify-center -my-1 z-10">
                <div className="flex items-center gap-space-2xs bg-surface-container-highest text-on-surface-variant px-space-xs py-0.5 rounded-full shadow text-[11px]">
                  <span className="material-symbols-outlined text-[12px] text-error">south</span>
                  <span className="font-label-sm text-label-sm uppercase font-bold tracking-widest text-primary">
                    Transferencia
                  </span>
                  <span className="material-symbols-outlined text-[12px] text-primary">north</span>
                </div>
              </div>

              {/* Incoming Player Card */}
              <div className="flex items-center justify-between bg-surface-container p-space-xs rounded-lg">
                <div className="flex items-center gap-space-xs min-w-0">
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container-highest shadow-[0_0_12px_rgba(0,229,155,0.25)]">
                    {inImg ? (
                      <img
                        className="w-full h-full object-cover"
                        src={inImg}
                        alt={item.playerInName}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-[20px]">person</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-primary-container text-on-primary flex items-center justify-center h-3">
                      <span className="material-symbols-outlined text-[10px]">arrow_upward</span>
                    </div>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-space-2xs">
                      <span className="font-title-md text-title-md text-primary truncate">
                        {item.playerInName}
                      </span>
                    </div>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      {item.playerInClub}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Compra</span>
                  <span className="font-label-lg text-label-lg text-primary font-bold">
                    -${item.playerInPrice.toFixed(1)}M
                  </span>
                </div>
              </div>

              {/* Balance footer */}
              <div className="flex items-center justify-between pt-1 border-t border-surface-container-high/60 text-xs text-on-surface-variant">
                <span>Diferencia neta de saldo:</span>
                <span className={`font-bold ${item.balanceDiff >= 0 ? 'text-primary' : 'text-error'}`}>
                  {item.balanceDiff >= 0 ? `+$${item.balanceDiff.toFixed(1)}M` : `-$${Math.abs(item.balanceDiff).toFixed(1)}M`}
                </span>
              </div>
            </div>
          );
        })}

        {filteredHistory.length === 0 && (
          <div className="p-space-lg text-center bg-surface-container-low rounded-xl text-on-surface-variant font-body-sm">
            No se han registrado transferencias en este filtro.
          </div>
        )}
      </div>
    </div>
  );
};
