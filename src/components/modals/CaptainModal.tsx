import React, { useState } from 'react';
import { Player } from '../../types/fantasy';

interface CaptainModalProps {
  starters: Player[];
  captainId: string;
  viceCaptainId: string;
  onSave: (capId: string, viceId: string) => void;
  onClose: () => void;
}

export const CaptainModal: React.FC<CaptainModalProps> = ({
  starters,
  captainId: initialCapId,
  viceCaptainId: initialViceId,
  onSave,
  onClose
}) => {
  const [currentCapId, setCurrentCapId] = useState(initialCapId);
  const [currentViceId, setCurrentViceId] = useState(initialViceId);

  const handleSelectCap = (id: string) => {
    if (id === currentViceId) {
      setCurrentViceId(currentCapId);
    }
    setCurrentCapId(id);
  };

  const handleSelectVice = (id: string) => {
    if (id === currentCapId) {
      setCurrentCapId(currentViceId);
    }
    setCurrentViceId(id);
  };

  const handleConfirm = () => {
    onSave(currentCapId, currentViceId);
    onClose();
  };

  const capPlayer = starters.find(p => p.id === currentCapId);
  const vicePlayer = starters.find(p => p.id === currentViceId);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh]">
        {/* Mobile grabber */}
        <div className="w-12 h-1.5 bg-surface-container-highest rounded-full mx-auto my-2 sm:hidden shrink-0"></div>

        {/* Modal Header */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between border-b border-surface-container-high">
          <div className="flex items-center gap-space-xs">
            <span className="w-8 h-8 rounded-full bg-amber-400 text-surface flex items-center justify-center font-headline-sm text-headline-sm font-bold shadow-md">
              C
            </span>
            <div className="flex flex-col">
              <h2 className="font-headline-lg text-headline-lg uppercase text-on-surface leading-none">
                Designar capitanía · Jornada actual
              </h2>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Multiplicador x2 y respaldo automático
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

        {/* Dual Spotlight Card */}
        <div className="p-space-md bg-surface-container-low/50 grid grid-cols-2 gap-space-xs">
          {/* Captain preview */}
          <div className="bg-surface-container p-space-xs rounded-xl flex items-center gap-space-xs border border-amber-400/40 shadow-sm">
            <div className="w-10 h-10 rounded-full bg-surface-container-highest overflow-hidden shrink-0">
              <img className="w-full h-full object-cover" src={capPlayer?.imageUrl} alt={capPlayer?.name} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-label-sm text-label-sm text-amber-400 font-bold uppercase">Capitán (x2)</span>
              <span className="font-headline-sm text-headline-sm text-on-surface truncate">{capPlayer?.displayName}</span>
            </div>
          </div>

          {/* Vice preview */}
          <div className="bg-surface-container p-space-xs rounded-xl flex items-center gap-space-xs border border-secondary/40 shadow-sm">
            <div className="w-10 h-10 rounded-full bg-surface-container-highest overflow-hidden shrink-0">
              <img className="w-full h-full object-cover" src={vicePlayer?.imageUrl} alt={vicePlayer?.name} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-label-sm text-label-sm text-secondary font-bold uppercase">Vicecapitán</span>
              <span className="font-headline-sm text-headline-sm text-on-surface truncate">{vicePlayer?.displayName}</span>
            </div>
          </div>
        </div>

        {/* Starters Selector List */}
        <div className="p-space-md overflow-y-auto space-y-space-2xs flex-1">
          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider block mb-space-xs">
            Selecciona entre tu Once Titular
          </span>

          {starters.map(player => {
            const isCap = player.id === currentCapId;
            const isVice = player.id === currentViceId;

            return (
              <div
                key={player.id}
                className={`flex items-center justify-between p-space-xs rounded-xl transition-colors ${
                  isCap
                    ? 'bg-amber-400/10 border border-amber-400/50'
                    : isVice
                    ? 'bg-secondary/10 border border-secondary/50'
                    : 'bg-surface-container-low hover:bg-surface-container-high'
                }`}
              >
                <div className="flex items-center gap-space-xs min-w-0">
                  <div className="w-10 h-10 rounded-full bg-surface-container-highest overflow-hidden shrink-0">
                    <img className="w-full h-full object-cover" src={player.imageUrl} alt={player.name} />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-title-md text-title-md text-on-surface truncate">
                        {player.displayName}
                      </span>
                      <span className="font-label-sm text-[10px] text-on-surface-variant bg-surface-container-highest px-1 rounded">
                        {player.position}
                      </span>
                    </div>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      {player.clubName} · {player.totalPoints} pts
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-space-xs shrink-0">
                  <button
                    onClick={() => handleSelectCap(player.id)}
                    className={`px-2.5 py-1 rounded-lg font-headline-sm text-headline-sm font-bold uppercase transition-all ${
                      isCap
                        ? 'bg-amber-400 text-surface shadow-md'
                        : 'bg-surface-container-high text-on-surface-variant hover:text-amber-400'
                    }`}
                  >
                    (C) 2x
                  </button>

                  <button
                    onClick={() => handleSelectVice(player.id)}
                    className={`px-2.5 py-1 rounded-lg font-headline-sm text-headline-sm font-bold uppercase transition-all ${
                      isVice
                        ? 'bg-secondary text-surface shadow-md'
                        : 'bg-surface-container-high text-on-surface-variant hover:text-secondary'
                    }`}
                  >
                    (V)
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high flex items-center gap-space-xs shrink-0">
          <button
            onClick={handleConfirm}
            className="w-full bg-primary-container text-on-primary font-headline-md text-headline-md uppercase tracking-wider py-2.5 rounded-xl shadow-lg active:scale-95 transition-transform"
          >
            Confirmar Capitanía
          </button>
        </div>
      </div>
    </div>
  );
};
