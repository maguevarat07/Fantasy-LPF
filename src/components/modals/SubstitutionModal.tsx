import React, { useState } from 'react';
import { Player } from '../../types/fantasy';

interface SubstitutionModalProps {
  playerToSubOut: Player | null;
  bench: Player[];
  onConfirmSub: (outPlayer: Player, inPlayer: Player) => void;
  onClose: () => void;
}

export const SubstitutionModal: React.FC<SubstitutionModalProps> = ({
  playerToSubOut,
  bench,
  onConfirmSub,
  onClose
}) => {
  const [selectedInId, setSelectedInId] = useState<string>(bench[0]?.id || '');

  if (!playerToSubOut) return null;

  const selectedInPlayer = bench.find(b => b.id === selectedInId);

  const handleConfirm = () => {
    if (selectedInPlayer) {
      onConfirmSub(playerToSubOut, selectedInPlayer);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh]">
        {/* Mobile grabber */}
        <div className="w-12 h-1.5 bg-surface-container-highest rounded-full mx-auto my-2 sm:hidden shrink-0"></div>

        {/* Modal Header */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between border-b border-surface-container-high">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[24px]">swap_horiz</span>
            <div className="flex flex-col">
              <h2 className="font-headline-lg text-headline-lg uppercase text-on-surface leading-none">
                Sustitución Táctica
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Intercambio entre Titular y Banquillo
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

        {/* Player to sub OUT */}
        <div className="p-space-md bg-surface-container-low/50 space-y-space-2xs">
          <span className="font-label-sm text-label-sm text-error font-bold uppercase tracking-wider flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
            Sale a la Banca (Titular)
          </span>

          <div className="bg-surface-container p-space-xs rounded-xl flex items-center justify-between border border-error/30 shadow-sm">
            <div className="flex items-center gap-space-xs min-w-0">
              <div className="w-12 h-12 rounded-xl bg-surface-container-highest overflow-hidden shrink-0">
                <img className="w-full h-full object-cover" src={playerToSubOut.imageUrl} alt={playerToSubOut.name} />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-title-md text-title-md text-on-surface truncate">
                    {playerToSubOut.displayName}
                  </span>
                  <span className="font-label-sm text-[10px] text-on-surface-variant bg-surface-container-highest px-1 rounded">
                    {playerToSubOut.position}
                  </span>
                </div>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {playerToSubOut.clubName} · ${playerToSubOut.price.toFixed(1)}M · {playerToSubOut.lastGwPoints} pts (última jornada)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Select Bench Player to Enter */}
        <div className="p-space-md overflow-y-auto space-y-space-xs flex-1">
          <span className="font-label-sm text-label-sm text-primary font-bold uppercase tracking-wider flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
            Entra a Cancha (Banquillo Disponible)
          </span>

          <div className="space-y-space-2xs">
            {bench.map(player => {
              const isSelected = player.id === selectedInId;
              const isSamePos = player.position === playerToSubOut.position;

              return (
                <div
                  key={player.id}
                  onClick={() => setSelectedInId(player.id)}
                  className={`flex items-center justify-between p-space-xs rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-primary-container/15 border-2 border-primary shadow-md'
                      : 'bg-surface-container-low hover:bg-surface-container-high border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-space-xs min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-surface-container-highest overflow-hidden shrink-0">
                      <img className="w-full h-full object-cover" src={player.imageUrl} alt={player.name} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-title-md text-title-md text-on-surface truncate">
                          {player.displayName}
                        </span>
                        <span className="font-label-sm text-[10px] text-primary bg-primary/20 px-1 rounded font-bold">
                          {player.position}
                        </span>
                      </div>
                      <span className="font-body-sm text-body-sm text-on-surface-variant">
                        {player.clubName} · ${player.price.toFixed(1)}M
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0 pl-2">
                    <span className="font-headline-sm text-headline-sm text-primary font-bold">
                      +{player.lastGwPoints} pts
                    </span>
                    <span className="font-label-sm text-[10px] text-on-surface-variant">
                      {isSamePos ? 'Mismo rol' : 'Cambio de esquema'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer Confirmation */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high flex items-center gap-space-xs shrink-0">
          <button
            onClick={handleConfirm}
            className="w-full bg-primary-container text-on-primary font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            <span>Confirmar Sustitución</span>
          </button>
        </div>
      </div>
    </div>
  );
};
