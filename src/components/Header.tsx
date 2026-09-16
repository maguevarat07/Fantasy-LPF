import React, { useState } from 'react';
import { LPF_LOGO_URL, USER_AVATAR_URL } from '../data/assets';
import { ChipId } from '../types/fantasy';

interface HeaderProps {
  title?: string;
  onBack?: () => void;
  showBack?: boolean;
  onOpenProfile?: () => void;
  onOpenComodines?: () => void;
  onOpenFinances?: () => void;
  budgetRemaining?: number;
  currentGameweek?: number | null;
  onOpenGameweekModal?: () => void;
  userAvatarUrl?: string;
  activeChip?: ChipId | null;
}

export const Header: React.FC<HeaderProps> = ({
  title = 'Mi Once Titular',
  onBack,
  showBack = false,
  onOpenProfile,
  onOpenComodines,
  onOpenFinances,
  budgetRemaining = 2.4,
  currentGameweek = null,
  onOpenGameweekModal,
  userAvatarUrl,
  activeChip
}) => {
  const [logoImgFailed, setLogoImgFailed] = useState(false);
  const [avatarImgFailed, setAvatarImgFailed] = useState(false);
  const [panamaTime, setPanamaTime] = useState<string>('');

  // Reset avatar failed state if avatar url changes
  React.useEffect(() => {
    setAvatarImgFailed(false);
  }, [userAvatarUrl]);

  // Live Panama City (America/Panama, UTC-5) Clock
  React.useEffect(() => {
    const updateTime = () => {
      try {
        const timeStr = new Intl.DateTimeFormat('es-PA', {
          timeZone: 'America/Panama',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(new Date());
        setPanamaTime(timeStr);
      } catch {
        const now = new Date();
        setPanamaTime(now.toLocaleTimeString());
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="fixed top-0 w-full z-50 pt-safe bg-surface-container-lowest/90 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.35)] border-b border-surface-container-high/40">
      <div className="h-16 px-gutter-mobile flex items-center justify-between gap-space-xs max-w-2xl mx-auto">
        {/* Left: Back button or LPF Logo */}
        <div className="flex items-center gap-space-xs min-w-0 shrink-0">
          {showBack && onBack ? (
            <button
              aria-label="Volver atrás"
              className="w-10 h-10 flex items-center justify-center rounded-full text-on-surface hover:bg-surface-container-highest/50 transition-colors"
              onClick={onBack}
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back_ios_new</span>
            </button>
          ) : (
            <button 
              className="flex items-center gap-2 focus:outline-none group text-left"
              onClick={() => onOpenComodines && onOpenComodines()}
              title="LPF Fantassy"
            >
              {!logoImgFailed ? (
                <img
                  src={LPF_LOGO_URL}
                  alt="LPF FANTASSY"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoImgFailed(true)}
                  className="h-10 w-auto max-w-[140px] object-contain shrink-0"
                />
              ) : (
                /* Native Vector Shield for LPF (guaranteed to always render cleanly) */
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center text-primary shadow-sm">
                    <span className="material-symbols-outlined text-[20px]">sports_soccer</span>
                  </div>
                  <div className="flex flex-col leading-none">
                    <div className="flex items-center gap-1">
                      <span className="font-headline-lg text-[17px] font-black text-on-surface tracking-tight">
                        LPF
                      </span>
                      <span className="font-headline-sm text-[9px] font-bold text-primary bg-primary/20 px-1 py-0.5 rounded leading-none">
                        FANTASSY
                      </span>
                    </div>
                    <span className="text-[9px] text-on-surface-variant font-medium tracking-wide">
                      PANAMÁ
                    </span>
                  </div>
                </div>
              )}
            </button>
          )}
        </div>

        {/* Center: Dynamic Gameweek & Live Panama City Clock Pill */}
        <button
          onClick={onOpenGameweekModal}
          title={currentGameweek ? `Jornada ${currentGameweek} LPF · Hora local: ${panamaTime || 'UTC-5'}` : 'Jornada oficial pendiente de sincronización'}
          className="flex items-center gap-space-2xs bg-surface-container-high/90 hover:bg-surface-container-highest px-space-xs py-space-2xs rounded-full shadow-inner max-w-full overflow-hidden border border-surface-container-highest/60 active:scale-95 transition-all cursor-pointer group"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse shrink-0"></span>
          <span className="font-label-md text-label-md text-primary font-black tracking-wider uppercase">
            {currentGameweek ? `J${currentGameweek}` : 'Pendiente'}
          </span>
          <span className="text-on-surface-variant font-label-sm text-label-sm hidden min-[360px]:inline">·</span>
          <span className="font-label-sm text-label-sm text-on-surface font-mono font-bold hidden min-[360px]:inline tracking-tight">
            {panamaTime || '00:00:00'}
          </span>
          <span className="text-[9px] text-primary/80 font-bold hidden min-[440px]:inline uppercase">
            PA
          </span>
        </button>

        {/* Right: Comodines, Budget & Profile avatar */}
        <div className="flex items-center gap-space-xs shrink-0">
          <button
            onClick={onOpenComodines}
            title={activeChip ? `Comodín Activo (${activeChip}) · Toca para gestionar` : 'Comodines & Recompensas LPF'}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              activeChip
                ? 'bg-primary text-surface-container-lowest shadow-[0_0_12px_rgba(0,229,155,0.4)] ring-2 ring-primary/40 animate-pulse'
                : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {activeChip === 'triple_cap' ? 'military_tech' : activeChip === 'bench_boost' ? 'chair' : activeChip === 'emergency_fund' ? 'savings' : 'token'}
            </span>
          </button>

          <div 
            className="flex flex-col items-end cursor-pointer px-1.5 py-0.5 rounded-lg hover:bg-surface-container-high/60 active:scale-95 transition-all"
            onClick={onOpenFinances}
            title="Presupuesto Remanente y Libro Contable de Fichajes"
          >
            <span className="font-label-sm text-label-sm text-primary font-bold leading-none">
              ${budgetRemaining.toFixed(1)}M
            </span>
            <span className="font-label-sm text-[9px] text-on-surface-variant uppercase tracking-wider leading-none mt-0.5">
              REM
            </span>
          </div>

          <button
            className="relative min-w-[38px] min-h-[38px] w-9 h-9 rounded-full flex items-center justify-center cursor-pointer ring-2 ring-primary/50 overflow-hidden bg-surface-container-high hover:ring-primary transition-all active:scale-95"
            onClick={onOpenProfile}
            title="Mi Perfil de Mánager"
          >
            {!avatarImgFailed ? (
              <img
                alt="Perfil Mánager"
                referrerPolicy="no-referrer"
                onError={() => setAvatarImgFailed(true)}
                className="w-full h-full object-cover"
                src={userAvatarUrl || USER_AVATAR_URL}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary-container text-on-primary-container font-headline-sm text-[12px] font-bold">
                PM
              </div>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
