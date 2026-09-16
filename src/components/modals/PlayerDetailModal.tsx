import React, { useState } from 'react';
import { Player } from '../../types/fantasy';
import { PriceChangeIndicator } from '../shared/PriceChangeIndicator';

const positionLabel = { GK: 'POR', DEF: 'DEF', MID: 'MED', FWD: 'DEL' } as const;

interface PlayerDetailModalProps {
  player: Player | null;
  onClose: () => void;
  onMakeCaptain?: (p: Player) => void;
  onSubstitute?: (p: Player) => void;
  onFichar?: (p: Player) => void;
  onTransfer?: (p: Player) => void;
  isOwned?: boolean;
  isCaptain?: boolean;
}

export const PlayerDetailModal: React.FC<PlayerDetailModalProps> = ({
  player,
  onClose,
  onMakeCaptain,
  onSubstitute,
  onFichar,
  onTransfer,
  isOwned = false,
  isCaptain
}) => {
  const [activeTab, setActiveTab] = useState<'resumen' | 'historial' | 'calendario'>('resumen');

  if (!player) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh]">
        {/* Modal Top Grabber on mobile */}
        <div className="w-12 h-1.5 bg-surface-container-highest rounded-full mx-auto my-2 sm:hidden shrink-0"></div>

        {/* Modal Header Strip */}
        <div className="p-space-md bg-surface-container-low flex items-start justify-between relative">
          <div className="flex items-center gap-space-sm min-w-0">
            <div className="relative w-16 h-16 rounded-xl bg-surface-container-highest overflow-hidden shadow-inner flex-shrink-0">
              <img className="w-full h-full object-cover" src={player.imageUrl} alt={player.name} />
              <span className="absolute bottom-0 inset-x-0 bg-surface-container-lowest/90 font-headline-sm text-[10px] text-secondary font-bold text-center py-0.5">
                {positionLabel[player.position]}
              </span>
            </div>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="font-headline-lg text-headline-lg uppercase text-on-surface truncate leading-none">
                  {player.displayName}
                </h2>
                {isCaptain && (
                  <span className="w-5 h-5 rounded-full bg-[#FFB800] text-surface font-headline-sm text-[11px] font-bold flex items-center justify-center shadow">
                    C
                  </span>
                )}
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant truncate mt-0.5">
                {player.name} · {player.clubName}
              </p>
              {isOwned && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-primary">
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">check_circle</span>
                  Este jugador pertenece a tu plantilla
                </p>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className="bg-primary-container text-on-primary-container font-stat-counter text-stat-counter px-2 py-0.5 rounded leading-none">
                  ${(player.currentPrice ?? player.price).toFixed(1)}M
                </span>
                <PriceChangeIndicator change={player.priceChange} compact />
                <span className="font-label-sm text-label-sm text-primary font-bold">
                  {player.totalPoints} PTS TOTALES
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab Pill Headers */}
        <div className="flex items-center gap-space-2xs px-space-md pt-space-xs bg-surface-container-low border-b border-surface-container-high">
          {(['resumen', 'historial', 'calendario'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2 px-space-sm font-headline-sm text-headline-sm uppercase tracking-wider transition-colors border-b-2 ${
                activeTab === tab
                  ? 'border-primary text-primary font-bold'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab === 'resumen' ? 'Resumen' : tab === 'historial' ? 'Historial reciente' : 'Calendario'}
            </button>
          ))}
        </div>

        {/* Scrollable Content Body */}
        <div className="p-space-md overflow-y-auto space-y-space-sm flex-1">
          {activeTab === 'resumen' && (
            <div className="space-y-space-sm">
              {isOwned && (
                <section className="grid grid-cols-2 gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3" aria-label="Economía del jugador">
                  <div>
                    <span className="block text-[10px] uppercase text-on-surface-variant">Compraste</span>
                    <strong className="text-on-surface">{player.purchasePrice == null ? '—' : `$${player.purchasePrice.toFixed(1)}M`}</strong>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-on-surface-variant">Actual</span>
                    <strong className="text-primary">${(player.currentPrice ?? player.price).toFixed(1)}M</strong>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-on-surface-variant">Vendes</span>
                    <strong className="text-primary">{player.sellingPrice == null ? '—' : `$${player.sellingPrice.toFixed(1)}M`}</strong>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase text-on-surface-variant">Ganancia</span>
                    <strong className="text-on-surface">
                      {player.sellingPrice == null || player.purchasePrice == null
                        ? '—'
                        : `${player.sellingPrice - player.purchasePrice >= 0 ? '+' : '-'}$${Math.abs(player.sellingPrice - player.purchasePrice).toFixed(1)}M`}
                    </strong>
                  </div>
                </section>
              )}
              <div className="bg-surface-container-low p-space-sm rounded-xl space-y-space-xs shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-headline-sm text-headline-sm uppercase text-on-surface">Última jornada confirmada</span>
                  <span className="font-headline-md text-headline-md text-primary font-bold">{player.lastGwPoints} PTS</span>
                </div>
                <p className="text-body-sm text-on-surface-variant">
                  {player.breakdownLastGw?.description || 'Aún no hay un desglose oficial confirmado para este jugador.'}
                </p>
              </div>

              {/* General Season Metrics */}
              <div className="grid grid-cols-3 gap-space-xs text-center">
                <div className="bg-surface-container-low p-space-xs rounded-lg">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Goles</span>
                  <p className="font-stat-counter text-stat-counter text-primary leading-none mt-1">{player.goals}</p>
                </div>
                <div className="bg-surface-container-low p-space-xs rounded-lg">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Asistencias</span>
                  <p className="font-stat-counter text-stat-counter text-secondary leading-none mt-1">{player.assists}</p>
                </div>
                <div className="bg-surface-container-low p-space-xs rounded-lg">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Forma</span>
                  <p className="font-stat-counter text-stat-counter text-amber-400 leading-none mt-1">
                    {player.recentForm.toFixed(1)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'historial' && (
            <div className="space-y-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Historial de precio
              </span>
              {player.priceHistory?.length ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {player.priceHistory.map(point => (
                    <div key={`${point.gameweekId}-${point.effectiveAt}`} className="min-w-[92px] rounded-lg bg-surface-container-low p-2 text-center">
                      <span className="block text-[10px] text-on-surface-variant">{point.gameweekName ?? point.gameweekId}</span>
                      <strong className="block text-primary">${point.price.toFixed(1)}M</strong>
                      <PriceChangeIndicator change={point.change} compact />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-on-surface-variant">Aún no hay cambios de precio confirmados.</p>
              )}

              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Puntuaciones Últimas 5 Fechas
              </span>
              {player.historyLast5.length ? <div className="grid grid-cols-5 gap-space-2xs text-center">
                {player.historyLast5.map(item => (
                  <div key={item.gw} className="bg-surface-container-low p-space-xs rounded-lg flex flex-col items-center">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">{item.gw}</span>
                    <span className="font-headline-md text-headline-md text-primary font-bold mt-1">{item.pts}</span>
                    <span className="text-[10px] text-on-surface-variant">pts</span>
                  </div>
                ))}
              </div> : <p className="text-sm text-on-surface-variant">Todavía no hay jornadas confirmadas para mostrar.</p>}
            </div>
          )}

          {activeTab === 'calendario' && (
            <div className="space-y-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Próximos Rivales & FDR
              </span>
              <div className="p-space-sm bg-surface-container-low rounded-lg text-sm text-on-surface-variant">
                {player.nextOpponent === 'Por confirmar' ? 'El calendario oficial aún no está sincronizado.' : player.nextOpponent}
              </div>
            </div>
          )}
        </div>

        {/* Modal Sticky Bottom Action Footer */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high flex items-center gap-space-xs shrink-0">
          {onFichar && !isOwned && (
            <button
              onClick={() => {
                onClose();
                onFichar(player);
              }}
              className="flex-1 bg-primary-container text-on-primary-container font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-1.5 font-bold hover:brightness-105"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>Fichar por ${player.price.toFixed(1)}M</span>
            </button>
          )}

          {isOwned && onTransfer && (
            <button
              onClick={() => {
                onTransfer(player);
                onClose();
              }}
              className="flex-1 bg-surface-container-high text-primary hover:text-primary-container font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl active:scale-95 transition-transform flex items-center justify-center gap-1.5 font-bold border border-primary/40"
            >
              <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
              <span>Transferir ({player.sellingPrice == null ? 'venta pendiente' : `$${player.sellingPrice.toFixed(1)}M`})</span>
            </button>
          )}

          {onMakeCaptain && (
            <button
              onClick={() => {
                onMakeCaptain(player);
                onClose();
              }}
              className="flex-1 bg-[#FFB800] text-surface font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-1.5 font-bold"
            >
              <span className="material-symbols-outlined text-[18px]">stars</span>
              <span>{isCaptain ? 'Capitán Asignado' : 'Hacer Capitán (2x)'}</span>
            </button>
          )}

          {onSubstitute && (
            <button
              onClick={() => {
                onSubstitute(player);
                onClose();
              }}
              className="flex-1 bg-surface-container-high text-secondary hover:text-primary font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl active:scale-95 transition-transform flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
              <span>Sustituir</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
