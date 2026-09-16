import React, { useState, useEffect } from 'react';

interface GameweekStatusModalProps {
  currentGameweek: number;
  deadlineAt?: string;
  status?: string;
  onClose: () => void;
  onGoToFixtures?: () => void;
}

export const GameweekStatusModal: React.FC<GameweekStatusModalProps> = ({
  currentGameweek,
  deadlineAt,
  status,
  onClose,
  onGoToFixtures
}) => {
  // Live Panama City Clock
  const [panamaTime, setPanamaTime] = useState<string>('');
  const [panamaDate, setPanamaDate] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      try {
        const timeStr = new Intl.DateTimeFormat('es-PA', {
          timeZone: 'America/Panama',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(now);

        const dateStr = new Intl.DateTimeFormat('es-PA', {
          timeZone: 'America/Panama',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }).format(now);

        setPanamaTime(timeStr);
        setPanamaDate(dateStr);
      } catch {
        setPanamaTime(now.toLocaleTimeString());
        setPanamaDate(now.toLocaleDateString());
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const deadlineLabel = deadlineAt
    ? new Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(deadlineAt))
    : 'Pendiente de confirmación';
  const statusLabel = status === 'FINISHED' ? 'FINALIZADA' : status === 'LIVE' ? 'EN DISPUTA' : 'ABIERTA';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/60 max-h-[90vh] animate-fade-in">
        
        {/* Mobile drag bar */}
        <div className="w-12 h-1.5 bg-surface-container-highest rounded-full mx-auto my-2 sm:hidden shrink-0"></div>

        {/* Modal Header */}
        <div className="p-space-md bg-surface-container-low border-b border-surface-container-high/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-space-xs min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-[22px]">schedule</span>
            </div>
            <div className="flex flex-col min-w-0">
              <h2 className="font-headline-md text-headline-md uppercase text-on-surface truncate">
                Horario Oficial & Jornada LPF
              </h2>
              <span className="font-body-sm text-[12px] text-on-surface-variant">
                Liga Panameña de Fútbol · Torneo vigente
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-space-md overflow-y-auto space-y-space-md">
          
          {/* Live Panama City Clock Card */}
          <div className="bg-surface-container-low rounded-2xl p-space-md border border-surface-container-high/60 shadow-sm flex flex-col items-center text-center relative overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">🇵🇦</span>
              <span className="font-headline-sm text-[12px] uppercase tracking-wider text-on-surface-variant font-bold">
                Hora Local de Ciudad de Panamá
              </span>
              <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            </div>

            <div className="font-mono text-[34px] sm:text-[40px] font-black tracking-wider text-primary py-1 leading-none">
              {panamaTime || '--:--:--'}
            </div>

            <p className="font-body-sm text-[13px] text-on-surface-variant capitalize mt-1">
              {panamaDate || 'Zona horaria: America/Panama (UTC-5)'}
            </p>

            <div className="flex items-center gap-1.5 mt-2 bg-surface-container px-3 py-1 rounded-full text-[11px] text-on-surface-variant border border-surface-container-high/40">
              <span className="material-symbols-outlined text-[14px] text-primary">public</span>
              <span>Zona Horaria Oficial: EST (UTC-5 sin cambio de hora)</span>
            </div>
          </div>

          {/* Active Gameweek Status */}
          <div className="bg-surface-container-low rounded-2xl p-space-md border border-surface-container-high/60 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                <span className="font-headline-sm text-[13px] uppercase text-on-surface font-bold">
                  Jornada {currentGameweek}
                </span>
              </div>
              <span className="bg-primary/20 text-primary font-bold text-[11px] px-2 py-0.5 rounded leading-none border border-primary/30">
                {statusLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="bg-surface-container p-2.5 rounded-xl border border-surface-container-high/30">
                <span className="text-on-surface-variant block text-[10px] uppercase font-bold">
                  Fecha Límite (Deadline)
                </span>
                <span className="font-semibold text-on-surface mt-0.5 block">
                  {deadlineLabel}
                </span>
              </div>

              <div className="bg-surface-container p-2.5 rounded-xl border border-surface-container-high/30">
                <span className="text-on-surface-variant block text-[10px] uppercase font-bold">
                  Estado de Fichajes
                </span>
                <span className="font-semibold text-primary mt-0.5 block">
                  {status === 'OPEN' && deadlineAt && Date.parse(deadlineAt) > Date.now()
                    ? 'Mercado habilitado'
                    : 'Mercado cerrado'}
                </span>
              </div>
            </div>
          </div>

          {/* Canonical gameweek source */}
          <div className="bg-surface-container-low rounded-2xl p-space-md border border-surface-container-high/60 shadow-sm space-y-2.5">
            <span className="font-headline-sm text-[12px] uppercase text-on-surface font-bold tracking-wider block">
              Calendario canónico
            </span>
            <p className="font-body-sm text-[12px] text-on-surface-variant">
              La jornada y su cierre provienen de la base sincronizada. Los partidos mostrados corresponden siempre a esta jornada.
            </p>
          </div>

        </div>

        {/* Modal Footer Actions */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high/50 flex items-center justify-between gap-space-sm shrink-0">
          {onGoToFixtures && (
            <button
              onClick={() => {
                onClose();
                onGoToFixtures();
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary-container text-on-primary font-headline-sm text-[12px] uppercase tracking-wider shadow-sm hover:brightness-105 active:scale-95 transition-all font-bold"
            >
              <span className="material-symbols-outlined text-[16px]">sports_soccer</span>
              <span>Ver Partidos J{currentGameweek}</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-surface-container-high text-on-surface font-headline-sm text-[12px] uppercase tracking-wider hover:bg-surface-container-highest active:scale-95 transition-all ml-auto"
          >
            Entendido
          </button>
        </div>

      </div>
    </div>
  );
};
