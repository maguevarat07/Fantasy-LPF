import React, { useState, useMemo } from 'react';
import { LeagueMember, Player, Formation } from '../../types/fantasy';

interface RivalSquadModalProps {
  member: LeagueMember | null;
  allPlayers: Player[];
  onClose: () => void;
  onOpenPlayerDetail: (player: Player) => void;
  onGoToMyTeam?: () => void;
  userSquadOverride?: {
    starters: string[];
    bench: string[];
    formation: Formation;
    captainId: string;
    viceCaptainId: string;
    totalPoints: number;
    lastGwPoints: number;
  };
}

export const RivalSquadModal: React.FC<RivalSquadModalProps> = ({
  member,
  allPlayers,
  onClose,
  onOpenPlayerDetail,
  onGoToMyTeam,
  userSquadOverride
}) => {
  const [viewMode, setViewMode] = useState<'pitch' | 'list'>('pitch');

  if (!member) return null;

  // If viewing current user, prioritize real live user state
  const isUser = member.isCurrentUser;
  const activeStartersIds = isUser && userSquadOverride ? userSquadOverride.starters : member.starters;
  const activeBenchIds = isUser && userSquadOverride ? userSquadOverride.bench : member.bench;
  const activeFormation = isUser && userSquadOverride ? userSquadOverride.formation : member.formation;
  const activeCaptainId = isUser && userSquadOverride ? userSquadOverride.captainId : member.captainId;
  const activeViceId = isUser && userSquadOverride ? userSquadOverride.viceCaptainId : member.viceCaptainId;
  const displayTotalPoints = isUser && userSquadOverride ? userSquadOverride.totalPoints : member.totalPoints;
  const displayGwPoints = isUser && userSquadOverride ? userSquadOverride.lastGwPoints : member.gwPoints;

  const starters = useMemo(() => allPlayers.filter(player => activeStartersIds?.includes(player.id)), [activeStartersIds, allPlayers]);
  const bench = useMemo(() => allPlayers.filter(player => activeBenchIds?.includes(player.id)), [activeBenchIds, allPlayers]);

  // Group starters by position
  const gks = starters.filter(p => p.position === 'GK');
  const defs = starters.filter(p => p.position === 'DEF');
  const mids = starters.filter(p => p.position === 'MID');
  const fwds = starters.filter(p => p.position === 'FWD');

  // Calculate live sum of points on pitch
  const livePitchPoints = starters.reduce((acc, p) => {
    const isCap = p.id === activeCaptainId;
    return acc + (isCap ? (p.lastGwPoints || 0) * 2 : (p.lastGwPoints || 0));
  }, 0);

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[60] flex items-end justify-center bg-surface-container-lowest/85 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rival-squad-title"
    >
      <div className="flex min-h-0 max-h-full w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-surface-container-high/60 bg-surface-container shadow-2xl animate-fade-in sm:rounded-2xl">
        
        {/* Mobile Grabber */}
        <div className="w-12 h-1.5 bg-surface-container-highest rounded-full mx-auto my-2 sm:hidden shrink-0"></div>

        {/* Modal Top Header */}
        <div className="p-space-md bg-surface-container-low border-b border-surface-container-high/50 flex items-start justify-between relative shrink-0">
          <div className="flex items-center gap-space-sm min-w-0">
            <div className="relative w-14 h-14 rounded-2xl bg-surface-container-highest overflow-hidden shadow-inner flex-shrink-0 border-2 border-primary/40">
              <img className="w-full h-full object-cover" src={member.avatarUrl} alt={member.managerName} />
              <span className="absolute bottom-0 inset-x-0 bg-surface-container-lowest/90 font-headline-sm text-[10px] text-primary font-bold text-center py-0.5">
                {member.position}º LUGAR
              </span>
            </div>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="rival-squad-title" className="font-headline-md text-headline-md uppercase text-on-surface truncate leading-tight">
                  {member.teamName}
                </h2>
                {isUser && (
                  <span className="bg-primary text-surface-container-lowest text-[9px] font-black px-1.5 py-0.5 rounded shrink-0">
                    TU EQUIPO
                  </span>
                )}
              </div>
              <p className="font-body-sm text-[13px] text-on-surface-variant truncate mt-0.5">
                DT: <span className="text-on-surface font-semibold">{member.managerName}</span> · {activeFormation}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="bg-primary/20 text-primary font-bold text-[11px] px-2 py-0.5 rounded leading-none border border-primary/30">
                  Jornada: {livePitchPoints || displayGwPoints} PTS
                </span>
                <span className="bg-surface-container-highest text-on-surface font-semibold text-[11px] px-2 py-0.5 rounded leading-none">
                  Total: {displayTotalPoints} pts
                </span>
                <span className="text-[11px] text-on-surface-variant">
                  Valor: ${member.teamValue.toFixed(1)}M
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0 ml-2"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* View mode toggle bar */}
        <div className="px-space-md py-2 bg-surface-container-low border-b border-surface-container-high/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="font-label-sm text-[11px] uppercase tracking-wider text-on-surface-variant">
              Alineación oficial de la jornada
            </span>
            <span className="text-primary font-bold text-[11px]">({activeFormation})</span>
          </div>

          <div className="flex items-center bg-surface-container-high p-0.5 rounded-lg">
            <button
              onClick={() => setViewMode('pitch')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-headline-sm text-[11px] uppercase tracking-wider transition-all ${
                viewMode === 'pitch'
                  ? 'bg-primary-container text-on-primary font-bold shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">sports_soccer</span>
              <span>Cancha</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-headline-sm text-[11px] uppercase tracking-wider transition-all ${
                viewMode === 'list'
                  ? 'bg-primary-container text-on-primary font-bold shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">format_list_bulleted</span>
              <span>Lista</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-space-sm space-y-space-md sm:p-space-md">
          {viewMode === 'pitch' ? (
            /* Tactical Pitch View */
            <div className="flex flex-col gap-space-sm">
              <div className="relative w-full rounded-2xl bg-gradient-to-b from-[#0a2e1d] via-[#0d3b24] to-[#0a2e1d] p-3 sm:p-4 border border-[#1b5e39]/60 shadow-2xl overflow-hidden min-h-[440px] sm:min-h-[470px] flex flex-col justify-between py-3">
                {/* Field Markings */}
                <div className="absolute inset-0 pointer-events-none opacity-20">
                  {/* Outer border */}
                  <div className="absolute inset-2 border-2 border-white/70 rounded-xl" />
                  {/* Halfway line */}
                  <div className="absolute top-1/2 left-2 right-2 h-0.5 bg-white/70 -translate-y-1/2" />
                  {/* Center circle */}
                  <div className="absolute top-1/2 left-1/2 w-24 h-24 border-2 border-white/70 rounded-full -translate-x-1/2 -translate-y-1/2" />
                  {/* Penalty box top */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 w-40 h-16 border-2 border-white/70 border-t-0 rounded-b-xl" />
                  {/* Penalty box bottom */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-40 h-16 border-2 border-white/70 border-b-0 rounded-t-xl" />
                </div>

                {/* 1. Delanteros (FWD) - Parte Superior (Ataque) */}
                <div className="relative z-10 flex justify-around items-center py-1 gap-1">
                  {fwds.map(player => (
                    <PitchPlayerCard
                      key={player.id}
                      player={player}
                      isCaptain={player.id === activeCaptainId}
                      isVice={player.id === activeViceId}
                      onClick={() => onOpenPlayerDetail(player)}
                    />
                  ))}
                </div>

                {/* 2. Mediocampistas (MID) - Centro-Superior */}
                <div className="relative z-10 flex justify-around items-center py-1 gap-1">
                  {mids.map(player => (
                    <PitchPlayerCard
                      key={player.id}
                      player={player}
                      isCaptain={player.id === activeCaptainId}
                      isVice={player.id === activeViceId}
                      onClick={() => onOpenPlayerDetail(player)}
                    />
                  ))}
                </div>

                {/* 3. Defensas (DEF) - Centro-Inferior */}
                <div className="relative z-10 flex justify-around items-center py-1 gap-1">
                  {defs.map(player => (
                    <PitchPlayerCard
                      key={player.id}
                      player={player}
                      isCaptain={player.id === activeCaptainId}
                      isVice={player.id === activeViceId}
                      onClick={() => onOpenPlayerDetail(player)}
                    />
                  ))}
                </div>

                {/* 4. Portero (GK) - Parte Inferior (Portería) */}
                <div className="relative z-10 flex justify-center py-1">
                  {gks.map(player => (
                    <PitchPlayerCard
                      key={player.id}
                      player={player}
                      isCaptain={player.id === activeCaptainId}
                      isVice={player.id === activeViceId}
                      isGk
                      onClick={() => onOpenPlayerDetail(player)}
                    />
                  ))}
                </div>
              </div>

              {/* Bench Card */}
              <div className="bg-surface-container-low rounded-xl p-3 border border-surface-container-high/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-headline-sm text-[12px] uppercase text-on-surface tracking-wider">
                    Banquillo de Suplentes ({bench.length})
                  </span>
                  <span className="font-label-sm text-[10px] text-on-surface-variant">
                    Puntos acumulados de reserva
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {bench.map((player, idx) => (
                    <button
                      key={player.id}
                      onClick={() => onOpenPlayerDetail(player)}
                      className="flex flex-col items-center bg-surface-container p-2 rounded-lg hover:bg-surface-container-high transition-all text-center group border border-surface-container-high/40"
                    >
                      <span className="text-[9px] font-bold text-on-surface-variant uppercase mb-1">
                        {idx + 1}. {player.position}
                      </span>
                      <div className="w-9 h-9 rounded-full overflow-hidden bg-surface-container-highest shadow-inner mb-1">
                        <img className="w-full h-full object-cover" src={player.imageUrl} alt={player.displayName} />
                      </div>
                      <span className="font-headline-sm text-[11px] text-on-surface truncate w-full group-hover:text-primary">
                        {player.displayName}
                      </span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="font-mono font-bold text-[11px] text-primary">
                          {player.lastGwPoints} pts
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* List Table View */
            <div className="space-y-space-sm">
              <div className="bg-surface-container-low rounded-xl p-space-sm border border-surface-container-high/60 space-y-1.5">
                <span className="font-headline-sm text-[12px] uppercase text-on-surface tracking-wider block mb-1">
                  Once Titular ({starters.length})
                </span>
                {starters.map(player => {
                  const isCap = player.id === activeCaptainId;
                  const isVice = player.id === activeViceId;
                  const pts = isCap ? (player.lastGwPoints || 0) * 2 : (player.lastGwPoints || 0);

                  return (
                    <div
                      key={player.id}
                      onClick={() => onOpenPlayerDetail(player)}
                      className="flex items-center justify-between p-2 rounded-lg bg-surface-container hover:bg-surface-container-high cursor-pointer transition-colors border border-surface-container-high/30"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl overflow-hidden bg-surface-container-highest shrink-0">
                          <img className="w-full h-full object-cover" src={player.imageUrl} alt={player.displayName} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-headline-sm text-[13px] text-on-surface truncate font-bold">
                              {player.displayName}
                            </span>
                            {isCap && (
                              <span className="bg-[#FFB800] text-surface text-[10px] font-black px-1 rounded">
                                C (2x)
                              </span>
                            )}
                            {isVice && (
                              <span className="bg-surface-container-highest text-on-surface text-[10px] font-bold px-1 rounded">
                                V
                              </span>
                            )}
                          </div>
                          <span className="font-body-sm text-[11px] text-on-surface-variant truncate">
                            {player.clubName} · {player.position} · ${player.price.toFixed(1)}M
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <span className="font-mono font-bold text-[13px] text-primary">
                          {pts} pts
                        </span>
                        <span className="font-label-sm text-[10px] text-on-surface-variant">
                          Total: {player.totalPoints} pts
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bench List */}
              <div className="bg-surface-container-low rounded-xl p-space-sm border border-surface-container-high/60 space-y-1.5">
                <span className="font-headline-sm text-[12px] uppercase text-on-surface tracking-wider block mb-1">
                  Banquillo ({bench.length})
                </span>
                {bench.map(player => (
                  <div
                    key={player.id}
                    onClick={() => onOpenPlayerDetail(player)}
                    className="flex items-center justify-between p-2 rounded-lg bg-surface-container hover:bg-surface-container-high cursor-pointer transition-colors border border-surface-container-high/30 opacity-80 hover:opacity-100"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg overflow-hidden bg-surface-container-highest shrink-0">
                        <img className="w-full h-full object-cover" src={player.imageUrl} alt={player.displayName} />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-headline-sm text-[12px] text-on-surface truncate">
                          {player.displayName}
                        </span>
                        <span className="font-body-sm text-[10px] text-on-surface-variant">
                          {player.clubName} · {player.position}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end shrink-0">
                      <span className="font-mono font-bold text-[12px] text-on-surface-variant">
                        {player.lastGwPoints} pts
                      </span>
                      <span className="font-label-sm text-[10px] text-on-surface-variant">
                        Total: {player.totalPoints} pts
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Sticky Bottom Action Footer */}
        <div className="relative z-10 shrink-0 border-t border-surface-container-high/50 bg-surface-container-low p-space-md flex items-center justify-between gap-space-sm shadow-[0_-8px_24px_rgba(0,0,0,0.28)]">
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span className="material-symbols-outlined text-[18px] text-primary">analytics</span>
            <span className="font-label-sm text-[12px] text-on-surface-variant">
              Toca a cualquier jugador para ver su historial LPF
            </span>
          </div>

          {isUser && onGoToMyTeam ? (
            <button
              onClick={() => {
                onClose();
                onGoToMyTeam();
              }}
              className="px-4 py-2 rounded-xl bg-primary-container text-on-primary font-headline-sm text-[12px] uppercase tracking-wider shadow-sm hover:brightness-105 active:scale-95 transition-all font-bold shrink-0"
            >
              Editar Mi Once
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-surface-container-high text-on-surface font-headline-sm text-[12px] uppercase tracking-wider hover:bg-surface-container-highest active:scale-95 transition-all shrink-0"
            >
              Cerrar
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

interface PitchPlayerCardProps {
  player: Player;
  isCaptain: boolean;
  isVice: boolean;
  isGk?: boolean;
  onClick: () => void;
}

const PitchPlayerCard: React.FC<PitchPlayerCardProps> = ({ player, isCaptain, isVice, isGk, onClick }) => {
  const pts = isCaptain ? (player.lastGwPoints || 0) * 2 : (player.lastGwPoints || 0);

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center group relative cursor-pointer active:scale-95 transition-transform max-w-[70px] sm:max-w-[80px]"
    >
      {/* Player Avatar Circle */}
      <div className={`relative w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-surface-container-highest overflow-hidden border-2 shadow-lg group-hover:border-primary transition-colors ${
        isGk ? 'border-amber-400/90' : 'border-white/80'
      }`}>
        <img className="w-full h-full object-cover" src={player.imageUrl} alt={player.displayName} />

        {/* Goalkeeper badge */}
        {isGk && (
          <span className="absolute -bottom-1 -left-1 px-1 rounded bg-amber-500 text-surface font-headline-sm text-[8px] font-black shadow ring-1 ring-black/40">
            POR
          </span>
        )}

        {/* Captain badge */}
        {isCaptain && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#FFB800] text-surface font-black text-[11px] flex items-center justify-center shadow-md ring-1 ring-white">
            C
          </span>
        )}
        {/* Vice captain badge */}
        {isVice && !isCaptain && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-surface-container-lowest text-on-surface font-bold text-[10px] flex items-center justify-center shadow-md ring-1 ring-white">
            V
          </span>
        )}
      </div>

      {/* Name banner */}
      <span className="bg-surface-container-lowest/90 backdrop-blur-sm text-on-surface font-headline-sm text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded shadow mt-1 truncate max-w-[68px] sm:max-w-[76px] leading-tight text-center group-hover:text-primary">
        {player.displayName}
      </span>

      {/* Points Pill */}
      <span
        className={`font-mono text-[10px] font-bold px-1.5 py-0.2 rounded shadow mt-0.5 leading-tight ${
          isCaptain
            ? 'bg-[#FFB800] text-surface ring-1 ring-white/50'
            : pts >= 8
            ? 'bg-primary text-surface-container-lowest font-black'
            : 'bg-surface-container-high/90 text-primary'
        }`}
      >
        {pts} pts {isCaptain && '(2x)'}
      </span>
    </button>
  );
};
