import React, { useState } from 'react';
import { Player } from '../../types/fantasy';

const positionLabel = { GK: 'POR', DEF: 'DEF', MID: 'MED', FWD: 'DEL' } as const;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;

interface ConfirmOperationModalProps {
  playerToBuy: Player | null;
  currentSquad: Player[];
  budgetRemaining: number;
  freeTransfers?: number;
  comodinActive?: boolean;
  deadlinePassed?: boolean;
  serverError?: string | null;
  onConfirmPurchase: (bought: Player, sold: Player) => Promise<void>;
  onClose: () => void;
}

export const ConfirmOperationModal: React.FC<ConfirmOperationModalProps> = ({
  playerToBuy,
  currentSquad,
  budgetRemaining,
  freeTransfers = 1,
  comodinActive = false,
  deadlinePassed = false,
  serverError,
  onConfirmPurchase,
  onClose
}) => {
  // Players of same position in current squad
  const candidateSell = currentSquad.filter(p => p.position === playerToBuy?.position);
  const initialSellList = candidateSell.length > 0 ? candidateSell : currentSquad;

  const [selectedSellId, setSelectedSellId] = useState<string>(
    initialSellList[0]?.id || ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!playerToBuy) return null;

  const playerToSell = currentSquad.find(p => p.id === selectedSellId) || initialSellList[0];
  const buyPrice = playerToBuy.currentPrice ?? playerToBuy.price;
  const sellPrice = playerToSell?.sellingPrice ?? playerToSell?.currentPrice ?? playerToSell?.price ?? 0;
  const displayBank = roundMoney(budgetRemaining);
  const displayBuyPrice = roundMoney(buyPrice);
  const displaySellPrice = roundMoney(sellPrice);
  const availableFunds = roundMoney(displayBank + displaySellPrice);
  const resultingBudget = roundMoney(availableFunds - displayBuyPrice);
  const isBudgetValid = resultingBudget >= 0;
  const netDiff = roundMoney(displaySellPrice - displayBuyPrice);

  // Club limit check: Max 3 players per club
  const clubCountOtherPlayers = currentSquad.filter(
    p => p.id !== playerToSell?.id && p.clubId === playerToBuy.clubId
  ).length;
  const isClubLimitExceeded = clubCountOtherPlayers >= 3;

  // Transfer points cost calculation
  const isFree = comodinActive || freeTransfers > 0;
  const pointsCost = isFree ? 0 : 4;

  const isOperationAllowed = isBudgetValid && !isClubLimitExceeded && !deadlinePassed && !isSubmitting;

  const handleConfirm = async () => {
    if (playerToSell && isOperationAllowed) {
      setIsSubmitting(true);
      try {
        await onConfirmPurchase(playerToBuy, playerToSell);
        onClose();
      } catch {
        // The parent keeps the modal open and provides the server message.
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh]">
        {/* Header */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between border-b border-surface-container-high shrink-0">
          <div className="flex items-center gap-space-xs">
            <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center shadow-sm">
              <span className="material-symbols-outlined text-[24px]">swap_horiz</span>
            </div>
            <div className="flex flex-col">
              <h2 className="font-headline-lg text-headline-lg uppercase text-on-surface leading-none">
                Confirmar Fichaje
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Operación de mercado 1 por 1
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-space-md overflow-y-auto space-y-space-sm flex-1">
          {/* Incoming Player (Fichaje Entrante) */}
          <div className="bg-surface-container-low p-space-sm rounded-xl space-y-space-2xs border border-primary/30 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-primary font-bold uppercase tracking-wider flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                Jugador a Fichar (Entrante)
              </span>
              <span className="font-label-sm text-[10px] bg-primary/20 text-primary font-bold px-1.5 py-0.5 rounded uppercase">
                {positionLabel[playerToBuy.position]}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-space-xs min-w-0">
                <div className="w-12 h-12 rounded-xl bg-surface-container-highest overflow-hidden shrink-0 shadow-md">
                  <img
                    className="w-full h-full object-cover"
                    src={playerToBuy.imageUrl}
                    alt={playerToBuy.name}
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-headline-md text-headline-md uppercase text-on-surface truncate leading-tight">
                    {playerToBuy.displayName}
                  </span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    {playerToBuy.clubName} · {playerToBuy.totalPoints} pts
                  </span>
                </div>
              </div>
              <span className="font-stat-counter text-stat-counter text-error font-bold shrink-0">
                -${displayBuyPrice.toFixed(1)}M
              </span>
            </div>
          </div>

          {/* Outgoing Player Selection (Venta Requerida) */}
          <div className="bg-surface-container-low p-space-sm rounded-xl space-y-space-2xs border border-surface-container-high/60 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-error font-bold uppercase tracking-wider flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                Selecciona Jugador a Vender
              </span>
              <span className="font-label-sm text-[11px] text-on-surface-variant">
                Misma posición ({positionLabel[playerToBuy.position]})
              </span>
            </div>

            <p className="font-body-sm text-[12px] text-on-surface-variant leading-relaxed">
              Tu plantilla tiene 15 jugadores. Elige a quién vas a transferir para liberar cupo y fondos:
            </p>

            {/* Candidate Players List */}
            <div className="space-y-1.5 pt-1">
              {initialSellList.map(p => {
                const isSelected = p.id === selectedSellId;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedSellId(p.id)}
                    className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-primary/10 border-primary shadow-sm'
                        : 'bg-surface-container border-surface-container-high/40 hover:bg-surface-container-high'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'border-primary bg-primary text-surface-container-lowest'
                            : 'border-outline text-transparent'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-surface-container-highest overflow-hidden shrink-0">
                        <img
                          src={p.imageUrl}
                          alt={p.displayName}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-headline-sm text-headline-sm uppercase text-on-surface truncate leading-tight">
                          {p.displayName}
                        </span>
                        <span className="font-label-sm text-[11px] text-on-surface-variant leading-none mt-0.5">
                          {p.clubCode} · {positionLabel[p.position]}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end shrink-0 pl-2">
                      <span className="font-headline-sm text-headline-sm text-primary font-bold leading-tight">
                        +${roundMoney(p.sellingPrice ?? p.currentPrice ?? p.price).toFixed(1)}M
                      </span>
                      <span className="font-label-sm text-[9px] text-on-surface-variant uppercase">
                        Venta
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Financial Calculation Matrix */}
          <div className="bg-surface-container-low p-space-sm rounded-xl space-y-space-2xs border border-surface-container-high/50">
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-on-surface-variant">Presupuesto en Banco</span>
              <span className="font-bold text-on-surface">${displayBank.toFixed(1)}M</span>
            </div>
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-on-surface-variant">
                Venta: {playerToSell?.displayName || 'Jugador'}
              </span>
              <span className="font-bold text-primary">+${displaySellPrice.toFixed(1)}M</span>
            </div>
            <div className="flex items-center justify-between text-body-sm bg-surface-container/50 px-2 py-1 rounded-lg">
              <span className="text-on-surface font-medium">Fondos Disponibles para Fichar</span>
              <span className="font-bold text-primary">${availableFunds.toFixed(1)}M</span>
            </div>
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-on-surface-variant">
                Compra: {playerToBuy.displayName}
              </span>
              <span className="font-bold text-error">-${displayBuyPrice.toFixed(1)}M</span>
            </div>
            <div className="flex items-center justify-between text-body-sm text-on-surface-variant pt-1 border-t border-surface-container-high">
              <span>Diferencia Neta</span>
              <span className={`font-bold ${netDiff >= 0 ? 'text-primary' : 'text-error'}`}>
                {netDiff >= 0 ? `+${netDiff.toFixed(1)}M` : `${netDiff.toFixed(1)}M`}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-surface-container-high">
              <span className="font-headline-sm text-headline-sm uppercase text-on-surface">
                Nuevo Presupuesto Restante
              </span>
              <span
                className={`font-stat-counter text-stat-counter font-bold ${
                  isBudgetValid ? 'text-primary' : 'text-error'
                }`}
              >
                ${resultingBudget.toFixed(1)}M {isBudgetValid ? '' : '(DÉFICIT)'}
              </span>
            </div>

            {/* Transfer Points Cost Banner */}
            <div className="flex items-center justify-between pt-2 border-t border-surface-container-high text-body-sm">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">toll</span>
                <span className="text-on-surface-variant">Coste en Puntos Fantasy:</span>
              </div>
              <span
                className={`font-bold px-2 py-0.5 rounded text-xs uppercase ${
                  comodinActive
                    ? 'bg-amber-400/20 text-amber-400'
                    : isFree
                    ? 'bg-primary/20 text-primary'
                    : 'bg-error-container text-error'
                }`}
              >
                {comodinActive
                  ? '0 pts (Comodín)'
                  : isFree
                  ? `0 pts (${freeTransfers} libre${freeTransfers > 1 ? 's' : ''})`
                  : '-4 pts (Penalización)'}
              </span>
            </div>

            {!isBudgetValid && (
              <div className="mt-2 p-2 rounded-lg bg-error-container/40 border border-error/40 text-error font-body-sm text-[12px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
                <span>
                  Fondos insuficientes: Te faltan ${Math.abs(resultingBudget).toFixed(1)}M para concretar este fichaje.
                </span>
              </div>
            )}

            {isClubLimitExceeded && (
              <div className="mt-2 p-2 rounded-lg bg-error-container/40 border border-error/40 text-error font-body-sm text-[12px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] shrink-0">group_off</span>
                <span>
                  Límite de club excedido: Ya tienes 3 jugadores de {playerToBuy.clubName}. Máximo 3 por club LPF.
                </span>
              </div>
            )}

            {deadlinePassed && (
              <div className="mt-2 p-2 rounded-lg bg-error-container/40 border border-error/40 text-error font-body-sm text-[12px] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] shrink-0">lock_clock</span>
                <span>
                  Mercado cerrado para la jornada actual (deadline vencido).
                </span>
              </div>
            )}

            {serverError && (
              <div role="alert" className="mt-2 p-2 rounded-lg bg-error-container/40 border border-error/40 text-error font-body-sm text-[12px] flex items-start gap-1.5">
                <span className="material-symbols-outlined text-[16px] shrink-0">sync_problem</span>
                <span>{serverError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Confirmation */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high flex items-center gap-space-xs shrink-0">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-space-md py-2.5 rounded-xl bg-surface-container-high text-on-surface-variant hover:text-on-surface font-headline-sm text-headline-sm uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            onClick={handleConfirm}
            disabled={!isOperationAllowed}
            className={`flex-1 font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg transition-transform flex items-center justify-center gap-2 ${
              isOperationAllowed
                ? 'bg-primary-container text-on-primary-container hover:brightness-105 active:scale-95 font-bold'
                : 'bg-surface-container-highest text-on-surface-variant/50 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <>
                <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                <span>Procesando...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                <span>Confirmar Fichaje {pointsCost > 0 ? '(-4 pts)' : ''}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
