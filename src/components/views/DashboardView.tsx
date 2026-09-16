import React from 'react';
import type { FantasyTeam, Player } from '../../types/fantasy';

interface DashboardViewProps {
  team: FantasyTeam;
  captainPlayer?: Player;
  vicePlayer?: Player;
  onGoToField: () => void;
  onGoToMarket: () => void;
  onGoToLeague: () => void;
  onOpenCaptainModal: () => void;
  onOpenFinances?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  team, captainPlayer, vicePlayer, onGoToField, onGoToMarket, onGoToLeague,
  onOpenCaptainModal, onOpenFinances,
}) => {
  const squadCount = team.starters.length + team.bench.length;
  const initial = team.name.trim().charAt(0).toUpperCase() || 'F';
  const playerCard = (player: Player | undefined, role: 'C' | 'V') => (
    <div className="bg-surface-container-low rounded-lg p-space-sm flex items-center gap-space-xs shadow-md">
      <div className="relative w-12 h-12 rounded-full overflow-hidden bg-surface-container-highest flex-shrink-0">
        <img className="w-full h-full object-cover" src={player?.imageUrl || '/player-placeholder.svg'} alt={player?.name || role} />
        <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-primary-container text-on-primary text-[11px] font-bold flex items-center justify-center">{role}</span>
      </div>
      <div className="min-w-0">
        <p className="font-title-md text-on-surface truncate">{player?.displayName || 'Sin seleccionar'}</p>
        <p className="font-body-sm text-on-surface-variant truncate">{player ? `${player.clubName} · ${player.position}` : 'Selecciona un jugador del XI'}</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col w-full space-y-space-md px-gutter-mobile pb-28 pt-space-xs">
      <div className="w-full bg-surface-container-low rounded-xl p-space-sm shadow-xl flex items-center gap-space-xs">
        <span className="material-symbols-outlined text-primary">event_busy</span>
        <div>
          <p className="font-label-sm uppercase tracking-wider text-on-surface-variant">Próxima jornada</p>
          <p className="font-title-md text-on-surface">Calendario canónico pendiente de sincronización</p>
        </div>
      </div>

      <section className="w-full bg-surface-container rounded-xl p-space-md shadow-xl">
        <div className="flex items-center gap-space-sm">
          <div className="w-14 h-14 rounded-xl bg-primary-container text-on-primary flex items-center justify-center font-headline-lg text-2xl font-bold">{initial}</div>
          <div className="min-w-0">
            <h1 className="font-headline-md text-on-surface uppercase truncate">{team.name}</h1>
            <p className="font-body-sm text-on-surface-variant truncate">DT: {team.managerName}</p>
          </div>
          <span className="ml-auto px-space-xs py-1 rounded-full bg-primary/10 text-primary font-label-sm font-bold">{squadCount}/15</span>
        </div>

        <div className="grid grid-cols-2 gap-space-xs mt-space-md">
          <div className="bg-surface-container-high rounded-lg p-space-sm">
            <p className="font-label-sm uppercase text-on-surface-variant">Puntos totales</p>
            <p className="font-stat-counter text-primary mt-1">{team.totalPoints}</p>
          </div>
          <div className="bg-surface-container-high rounded-lg p-space-sm">
            <p className="font-label-sm uppercase text-on-surface-variant">Última jornada</p>
            <p className="font-stat-counter text-on-surface mt-1">{team.lastGwPoints}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-space-xs mt-space-xs">
          <button onClick={onOpenFinances} className="text-left bg-surface-container-low rounded-lg p-space-sm hover:bg-surface-container-high transition-colors">
            <p className="font-label-sm uppercase text-on-surface-variant">Disponible</p>
            <p className="font-headline-sm text-primary">${team.budgetRemaining.toFixed(1)}M</p>
          </button>
          <div className="bg-surface-container-low rounded-lg p-space-sm">
            <p className="font-label-sm uppercase text-on-surface-variant">Fichajes libres</p>
            <p className="font-headline-sm text-primary">{team.freeTransfers}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-space-xs">
        <button onClick={onGoToField} className="bg-primary text-on-primary py-space-sm rounded-lg font-headline-sm uppercase">Alinear</button>
        <button onClick={onGoToMarket} className="bg-surface-container-high text-secondary py-space-sm rounded-lg font-headline-sm uppercase">Mercado</button>
        <button onClick={onGoToLeague} className="bg-surface-container-high text-on-surface py-space-sm rounded-lg font-headline-sm uppercase">Ligas</button>
      </div>

      <section className="w-full bg-surface-container rounded-xl p-space-md shadow-xl space-y-space-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-sm text-on-surface uppercase">Capitanía</h2>
          <button onClick={onOpenCaptainModal} className="text-primary font-label-md uppercase">Cambiar</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-xs">
          {playerCard(captainPlayer, 'C')}
          {playerCard(vicePlayer, 'V')}
        </div>
      </section>

      <button onClick={onGoToLeague} className="w-full bg-surface-container rounded-xl p-space-md shadow-xl text-left">
        <p className="font-headline-sm text-on-surface uppercase">Ligas privadas</p>
        <p className="font-body-sm text-on-surface-variant mt-1">Consulta tus ligas, crea una nueva o únete con un código.</p>
      </button>
    </div>
  );
};
