import React from 'react';

export type TabKey = 'equipo' | 'mercado' | 'liga' | 'dashboard' | 'fichajes' | 'jornadas' | 'clasificacion';

interface BottomNavProps {
  currentTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onSelectTab }) => {
  const isEquipoActive = currentTab === 'equipo' || currentTab === 'dashboard';
  const isMercadoActive = currentTab === 'mercado' || currentTab === 'fichajes';
  const isLigaActive = currentTab === 'liga' || currentTab === 'clasificacion' || currentTab === 'jornadas';

  return (
    <nav className="fixed bottom-0 w-full z-50 pb-safe bg-surface-container-lowest/95 backdrop-blur-xl border-t border-surface-container-high/60 shadow-[0_-4px_24px_rgba(0,0,0,0.4)]">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-space-sm">
        {/* 1. Mi Equipo */}
        <button
          aria-current={isEquipoActive ? 'page' : undefined}
          className={`flex flex-col items-center justify-center min-w-[64px] min-h-[48px] py-1 transition-all rounded-xl ${
            isEquipoActive
              ? 'text-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
          onClick={() => onSelectTab('equipo')}
        >
          <span className="material-symbols-outlined text-[24px]">
            {isEquipoActive ? 'shield_person' : 'sports_soccer'}
          </span>
          <span className="font-label-sm text-[11px] uppercase tracking-wider mt-0.5">
            Mi Equipo
          </span>
        </button>

        {/* 2. Fichar / Mercado */}
        <button
          aria-current={isMercadoActive ? 'page' : undefined}
          className={`flex flex-col items-center justify-center min-w-[64px] min-h-[48px] py-1 transition-all rounded-xl ${
            isMercadoActive
              ? 'text-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
          onClick={() => onSelectTab('mercado')}
        >
          <span className="material-symbols-outlined text-[24px]">
            person_add
          </span>
          <span className="font-label-sm text-[11px] uppercase tracking-wider mt-0.5">
            Fichar
          </span>
        </button>

        {/* 3. Liga */}
        <button
          aria-current={isLigaActive ? 'page' : undefined}
          className={`flex flex-col items-center justify-center min-w-[64px] min-h-[48px] py-1 transition-all rounded-xl ${
            isLigaActive
              ? 'text-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
          onClick={() => onSelectTab('liga')}
        >
          <span className="material-symbols-outlined text-[24px]">
            leaderboard
          </span>
          <span className="font-label-sm text-[11px] uppercase tracking-wider mt-0.5">
            Liga
          </span>
        </button>
      </div>
    </nav>
  );
};
