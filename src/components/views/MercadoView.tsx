import React, { useState, useMemo } from 'react';
import { Player, Position } from '../../types/fantasy';
import { PriceChangeIndicator } from '../shared/PriceChangeIndicator';

const positionLabel = { GK: 'POR', DEF: 'DEF', MID: 'MED', FWD: 'DEL' } as const;

interface MercadoViewProps {
  players: Player[];
  userStarterIds: string[];
  userBenchIds: string[];
  budgetRemaining: number;
  onOpenPlayerDetail: (p: Player) => void;
  onFicharPlayer: (p: Player) => void;
  onGoToTransfers: () => void;
  onOpenFiltersModal: () => void;
}

export const MercadoView: React.FC<MercadoViewProps> = ({
  players,
  userStarterIds,
  userBenchIds,
  budgetRemaining,
  onOpenPlayerDetail,
  onFicharPlayer,
  onGoToTransfers,
  onOpenFiltersModal
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPos, setSelectedPos] = useState<'ALL' | Position>('ALL');
  const [selectedClub, setSelectedClub] = useState('ALL');
  const [sortBy, setSortBy] = useState<'pts' | 'forma' | 'precio' | 'ratio'>('pts');
  const clubs = useMemo(() => Array.from(new Map<string, { id: string; name: string }>(players.map(player => [player.clubId, {
    id: player.clubId, name: player.clubName,
  }])).values()).sort((a, b) => a.name.localeCompare(b.name)), [players]);

  const filteredPlayers = useMemo(() => {
    return players
      .filter(p => {
        const matchesQuery = !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.displayName.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesPos = selectedPos === 'ALL' || (p.position === 'FWD' && selectedPos === 'FWD') || (p.position === 'MID' && selectedPos === 'MID') || (p.position === 'DEF' && selectedPos === 'DEF') || (p.position === 'GK' && selectedPos === 'GK');
        const matchesClub = selectedClub === 'ALL' || p.clubId === selectedClub || p.clubName === selectedClub;
        return matchesQuery && matchesPos && matchesClub;
      })
      .sort((a, b) => {
        if (sortBy === 'pts') return b.totalPoints - a.totalPoints;
        if (sortBy === 'forma') return b.recentForm - a.recentForm;
        if (sortBy === 'precio') return (b.currentPrice ?? b.price) - (a.currentPrice ?? a.price);
        if (sortBy === 'ratio') return (b.totalPoints / (b.currentPrice ?? b.price)) - (a.totalPoints / (a.currentPrice ?? a.price));
        return 0;
      });
  }, [players, searchQuery, selectedPos, selectedClub, sortBy]);

  const allOwnedIds = useMemo(() => new Set([...userStarterIds, ...userBenchIds]), [userStarterIds, userBenchIds]);

  return (
    <div className="flex flex-col w-full pb-36">
      {/* Clean Market Header with Budget */}
      <div className="px-gutter-mobile pt-space-xs pb-space-xs">
        <div className="flex items-center justify-between gap-space-xs bg-surface-container-low px-space-md py-space-sm rounded-xl border border-surface-container-high/50 shadow-sm">
          <div className="flex flex-col">
            <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-on-surface">
              Mercado LPF
            </span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">
              Ficha y refuerza tu plantilla del torneo vigente
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="font-headline-md text-headline-md text-primary font-bold">
              ${budgetRemaining.toFixed(1)}M
            </span>
            <span className="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider">
              Disponible
            </span>
          </div>
        </div>
      </div>

      {/* Search & Tactical Query Module */}
      <div className="px-gutter-mobile space-y-space-xs mb-space-sm">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-space-sm flex items-center pointer-events-none text-primary">
              <span className="material-symbols-outlined text-[20px]">search</span>
            </div>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-space-xs bg-surface-container-lowest rounded-xl font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary shadow-inner"
              placeholder="Buscar por jugador o club..."
              type="text"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-space-sm flex items-center text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[18px]">cancel</span>
              </button>
            )}
          </div>
        </div>

        {/* Position Segmented Pills */}
        <div className="flex items-center gap-space-2xs overflow-x-auto no-scrollbar py-0.5">
          {(['ALL', 'POR', 'DEF', 'MED', 'DEL'] as const).map(pos => {
            const isSelected = (pos === 'ALL' && selectedPos === 'ALL') || (pos === 'POR' && selectedPos === 'GK') || (pos === 'DEF' && selectedPos === 'DEF') || (pos === 'MED' && selectedPos === 'MID') || (pos === 'DEL' && selectedPos === 'FWD');
            const targetPos = pos === 'POR' ? 'GK' : pos === 'DEL' ? 'FWD' : pos === 'ALL' ? 'ALL' : pos;

            return (
              <button
                key={pos}
                onClick={() => setSelectedPos(targetPos as any)}
                className={`flex-1 min-w-[56px] py-1.5 px-space-xs rounded-lg font-headline-sm text-headline-sm tracking-wider uppercase transition-all duration-150 ${
                  isSelected
                    ? 'bg-primary-container text-on-primary-container shadow-md font-bold'
                    : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                }`}
              >
                {pos === 'ALL' ? 'Todos' : pos}
              </button>
            );
          })}
        </div>

        {/* Club Selector & Sort Matrix */}
        <div className="grid grid-cols-2 gap-space-xs pt-space-2xs">
          <div className="relative">
            <select
              value={selectedClub}
              onChange={e => setSelectedClub(e.target.value)}
              className="w-full appearance-none bg-surface-container-low text-on-surface font-label-md text-label-md py-2 pl-space-sm pr-8 rounded-lg focus:outline-none focus:bg-surface-container-high transition-colors"
            >
              <option value="ALL">Todos los Clubes</option>
              {clubs.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-space-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px]">expand_more</span>
            </div>
          </div>

          <div className="relative">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="w-full appearance-none bg-surface-container-low text-on-surface font-label-md text-label-md py-2 pl-space-sm pr-8 rounded-lg focus:outline-none focus:bg-surface-container-high transition-colors"
            >
              <option value="pts">Puntos Totales</option>
              <option value="forma">Forma Reciente</option>
              <option value="precio">Precio ($)</option>
              <option value="ratio">Valor / Puntos</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-space-xs text-primary">
              <span className="material-symbols-outlined text-[18px]">swap_vert</span>
            </div>
          </div>
        </div>
      </div>

      {/* Players List Roster */}
      <div className="px-gutter-mobile space-y-space-xs">
        {filteredPlayers.map(player => {
          const isOwned = allOwnedIds.has(player.id);
          const isInjured = player.status === 'INJURED';

          return (
            <article
              key={player.id}
              onClick={() => onOpenPlayerDetail(player)}
              className="player-card relative bg-surface-container rounded-xl p-space-sm shadow-md transition-transform active:scale-[0.99] flex flex-col gap-space-xs cursor-pointer hover:bg-surface-container-high"
            >
              <div className="flex items-start justify-between gap-space-xs">
                <div className="flex items-center gap-space-xs min-w-0">
                  <div className="relative flex-shrink-0">
                    <img
                      className={`w-12 h-12 rounded-full object-cover bg-surface-container-highest shadow-inner ${
                        isInjured ? 'grayscale contrast-125' : ''
                      }`}
                      src={player.imageUrl}
                      alt={player.name}
                    />
                    <span className="absolute -bottom-1 -right-1 bg-surface-container-lowest font-headline-sm text-[11px] leading-tight px-1 rounded text-secondary-container">
                      {positionLabel[player.position]}
                    </span>
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-headline-md text-headline-md uppercase tracking-wider text-on-surface leading-none truncate">
                        {player.displayName}
                      </h3>
                      {isOwned && (
                        <span className="bg-primary-container/20 text-primary font-label-sm text-label-sm px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[11px]">verified</span>
                          Tu Equipo
                        </span>
                      )}
                      {isInjured && (
                        <span className="bg-error-container text-tertiary-fixed-dim font-label-sm text-label-sm px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[12px]">medical_services</span>
                          Lesión
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="font-body-sm text-body-sm text-on-surface-variant truncate">
                        {positionLabel[player.position]} · {player.clubName}
                      </span>
                      <span className="text-on-surface-variant font-label-sm">·</span>
                      <span className="font-label-sm text-label-sm text-secondary-fixed-dim">
                        {player.nextOpponent}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="font-stat-counter text-[24px] leading-none text-primary font-bold">
                    ${(player.currentPrice ?? player.price).toFixed(1)}M
                  </span>
                  <PriceChangeIndicator change={player.priceChange} compact />
                </div>
              </div>

              {/* Injury Warning Strip if applicable */}
              {isInjured && player.statusNote && (
                <div className="bg-error-container/20 px-space-xs py-1.5 rounded-lg flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-error text-[16px]">warning</span>
                  <span className="font-body-sm text-body-sm text-error font-medium truncate">
                    {player.statusNote}
                  </span>
                </div>
              )}

              {/* Key Stats Bar */}
              <div className="grid grid-cols-3 gap-space-2xs bg-surface-container-low/70 rounded-lg p-space-xs">
                <div className="flex flex-col items-center">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Puntos</span>
                  <span className="font-headline-md text-headline-md text-on-surface">{player.totalPoints}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">Forma</span>
                  <div className="flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[13px] text-primary">local_fire_department</span>
                    <span className="font-headline-md text-headline-md text-primary">{player.recentForm.toFixed(1)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                    Última J.
                  </span>
                  <span className="font-headline-md text-headline-md text-secondary">{player.lastGwPoints}</span>
                </div>
              </div>

              {/* Footer row: Note + Action */}
              <div className="flex items-center justify-between pt-0.5">
                <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1 min-w-0 pr-2 truncate">
                  <span className="material-symbols-outlined text-[13px] text-surface-tint shrink-0">check_circle</span>
                  <span className="truncate">{player.statusNote || 'Disponible para la jornada actual'}</span>
                </span>

                {isOwned ? (
                  <button 
                    disabled 
                    className="bg-surface-container-high text-on-surface-variant font-label-md text-label-md uppercase px-space-sm py-1.5 rounded-lg opacity-80 cursor-default"
                  >
                    Alineado
                  </button>
                ) : isInjured ? (
                  <button 
                    disabled 
                    className="bg-surface-container-high text-on-surface-variant/50 font-label-md text-label-md uppercase px-space-md py-1.5 rounded-lg cursor-not-allowed"
                  >
                    Inactivo
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFicharPlayer(player);
                    }}
                    className="fichar-btn bg-primary-container hover:bg-primary-fixed active:scale-95 text-on-primary-container font-label-lg text-label-lg px-space-md py-1.5 rounded-lg uppercase tracking-wider flex items-center gap-1 shadow-md transition-transform"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Fichar
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {/* Empty state */}
        {filteredPlayers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-space-xl text-center bg-surface-container-low rounded-xl">
            <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant mb-space-xs">
              <span className="material-symbols-outlined text-[28px]">sports_soccer</span>
            </div>
            <h4 className="font-headline-md text-headline-md uppercase text-on-surface">Sin resultados tácticos</h4>
            <p className="font-body-sm text-body-sm text-on-surface-variant max-w-[240px] mt-1">
              No encontramos ningún jugador de la LPF que coincida con tus criterios de búsqueda.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedPos('ALL');
                setSelectedClub('ALL');
              }}
              className="mt-space-sm font-label-md text-label-md text-primary uppercase underline"
            >
              Restablecer filtros
            </button>
          </div>
        )}
      </div>

      {/* Persistent Tactical Squad Budget HUD Dock (Fixed above bottom shell nav) */}
      <div className="fixed bottom-16 left-0 right-0 z-40 px-gutter-mobile pb-space-xs pointer-events-none">
        <div className="pointer-events-auto max-w-[480px] mx-auto bg-surface-container-lowest/95 backdrop-blur-xl rounded-xl p-space-xs shadow-[0_8px_30px_rgba(0,0,0,0.7)] flex items-center justify-between gap-space-xs border border-surface-container-high/60">
          <div className="flex items-center gap-space-xs min-w-0">
            <div className="flex flex-col pl-space-2xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider leading-none">
                Presupuesto
              </span>
              <span className="font-headline-md text-headline-md text-primary font-bold leading-tight">
                ${budgetRemaining.toFixed(1)}M
              </span>
            </div>

            <div className="h-6 w-px bg-surface-bright mx-1"></div>

            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider leading-none">
                Plantilla
              </span>
              <div className="flex items-center gap-1">
                <span className="font-headline-md text-headline-md text-secondary font-bold leading-tight">
                  15/15
                </span>
                <span className="material-symbols-outlined text-[14px] text-primary-container">
                  check_circle
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onGoToTransfers}
            className="flex-shrink-0 bg-primary-container hover:brightness-105 text-on-primary-container font-headline-sm text-headline-sm uppercase tracking-wider px-space-md py-2 rounded-xl flex items-center gap-1.5 shadow-md transition-transform active:scale-95"
            title="Ver historial y economía de fichajes"
          >
            <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
            <span>Mis fichajes</span>
          </button>
        </div>
      </div>
    </div>
  );
};
