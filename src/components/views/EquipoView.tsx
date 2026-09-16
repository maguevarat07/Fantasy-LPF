import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { Player, Formation, ChipId } from '../../types/fantasy';
import { PitchPlayerCard } from '../shared/PitchPlayerCard';

interface EquipoViewProps {
  formation: Formation;
  onSelectFormation: (f: Formation) => void;
  starters: Player[];
  bench: Player[];
  captainId: string;
  viceCaptainId: string;
  onOpenPlayerDetail: (p: Player) => void;
  onOpenSubstitution: (p: Player) => void;
  onDirectSub?: (outPlayer: Player, inPlayer: Player) => void;
  onOpenCaptainModal: () => void;
  onOpenDashboard: () => void;
  onSaveLineup: () => void;
  hasLineupChanges?: boolean;
  onAutoPick: () => void;
  totalPitchBudget?: number;
  activeChip?: ChipId | null;
  isTripleCaptain?: boolean;
  isBenchBoost?: boolean;
}

const FORMATIONS: Formation[] = ['4-3-3', '3-4-3', '3-5-2', '4-4-2', '4-5-1', '5-3-2'];

const springTransition = {
  type: 'spring' as const,
  stiffness: 350,
  damping: 28,
  mass: 0.85
};

export const EquipoView: React.FC<EquipoViewProps> = ({
  formation,
  onSelectFormation,
  starters,
  bench,
  captainId,
  viceCaptainId,
  onOpenPlayerDetail,
  onOpenSubstitution,
  onDirectSub,
  onOpenCaptainModal,
  onOpenDashboard,
  onSaveLineup,
  hasLineupChanges = false,
  onAutoPick,
  totalPitchBudget = 78.8,
  activeChip = null,
  isTripleCaptain = false,
  isBenchBoost = false
}) => {
  // Quick swap state for interactive on-pitch substitution
  const [quickSwapPlayer, setQuickSwapPlayer] = useState<Player | null>(null);
  const [recentlyEnteringId, setRecentlyEnteringId] = useState<string | null>(null);
  const [recentlyExitingId, setRecentlyExitingId] = useState<string | null>(null);
  const [lastSubNotification, setLastSubNotification] = useState<{
    inName: string;
    outName: string;
    key: number;
  } | null>(null);

  // Track substitutions to trigger animations and visual cues
  const prevStartersRef = useRef<Player[]>(starters);

  // Track tactical formation change to trigger animated feedback and radar sweep
  const [formationNotice, setFormationNotice] = useState<{
    formation: Formation;
    desc: string;
    key: number;
  } | null>(null);

  const prevFormationRef = useRef<Formation>(formation);

  useEffect(() => {
    if (prevFormationRef.current !== formation) {
      const [d, m, f] = formation.split('-');
      setFormationNotice({
        formation,
        desc: `${d} Defensas • ${m} Mediocampistas • ${f} Delanteros`,
        key: Date.now()
      });

      const timer = setTimeout(() => {
        setFormationNotice(null);
      }, 3500);

      prevFormationRef.current = formation;
      return () => clearTimeout(timer);
    }
  }, [formation]);

  useEffect(() => {
    const prevMap = new Map(prevStartersRef.current.map(p => [p.id, p]));
    const currentIds = new Set(starters.map(s => s.id));

    const newlyAdded = starters.filter(p => !prevMap.has(p.id));
    const newlyRemoved = prevStartersRef.current.filter(p => !currentIds.has(p.id));

    if (newlyAdded.length > 0 && newlyRemoved.length > 0) {
      const inPlayer = newlyAdded[0];
      const outPlayer = newlyRemoved[0];

      setRecentlyEnteringId(inPlayer.id);
      setRecentlyExitingId(outPlayer.id);
      setLastSubNotification({
        inName: inPlayer.displayName,
        outName: outPlayer.displayName,
        key: Date.now()
      });

      const timer = setTimeout(() => {
        setRecentlyEnteringId(null);
        setRecentlyExitingId(null);
      }, 2800);

      const notifTimer = setTimeout(() => {
        setLastSubNotification(null);
      }, 4000);

      prevStartersRef.current = starters;
      return () => {
        clearTimeout(timer);
        clearTimeout(notifTimer);
      };
    }
    prevStartersRef.current = starters;
  }, [starters]);

  // Candidate validation helpers
  const isStarterCandidate = (starter: Player) => {
    if (!quickSwapPlayer) return false;
    const isQuickInBench = bench.some(b => b.id === quickSwapPlayer.id);
    if (!isQuickInBench) return false;
    if (quickSwapPlayer.position === 'GK') {
      return starter.position === 'GK';
    }
    return starter.position !== 'GK';
  };

  const isBenchCandidate = (benchPlayer: Player) => {
    if (!quickSwapPlayer) return false;
    const isQuickInStarters = starters.some(s => s.id === quickSwapPlayer.id);
    if (!isQuickInStarters) return false;
    if (quickSwapPlayer.position === 'GK') {
      return benchPlayer.position === 'GK';
    }
    return benchPlayer.position !== 'GK';
  };

  // Separate starters by position
  const gks = starters.filter(p => p.position === 'GK');
  const defs = starters.filter(p => p.position === 'DEF');
  const mids = starters.filter(p => p.position === 'MID');
  const fwds = starters.filter(p => p.position === 'FWD');

  // Unified quick swap handler
  const handleStartSwap = (player: Player) => {
    // If no player is currently selected, start swap mode
    if (!quickSwapPlayer) {
      setQuickSwapPlayer(player);
      return;
    }

    // If clicking the currently selected player: cancel swap
    if (quickSwapPlayer.id === player.id) {
      setQuickSwapPlayer(null);
      return;
    }

    // Case 1: quickSwapPlayer is in bench, clicked player is in starters -> EXECUTE SWAP!
    const isQuickInBench = bench.some(b => b.id === quickSwapPlayer.id);
    const isClickedInStarters = starters.some(s => s.id === player.id);
    if (isQuickInBench && isClickedInStarters) {
      if (isStarterCandidate(player) && onDirectSub) {
        onDirectSub(player, quickSwapPlayer);
        setQuickSwapPlayer(null);
      }
      return;
    }

    // Case 2: quickSwapPlayer is in starters, clicked player is in bench -> EXECUTE SWAP!
    const isQuickInStarters = starters.some(s => s.id === quickSwapPlayer.id);
    const isClickedInBench = bench.some(b => b.id === player.id);
    if (isQuickInStarters && isClickedInBench) {
      if (isBenchCandidate(player) && onDirectSub) {
        onDirectSub(quickSwapPlayer, player);
        setQuickSwapPlayer(null);
      }
      return;
    }

    // Case 3: Both in same zone (switching selection to another starter or another bench player)
    setQuickSwapPlayer(player);
  };

  // Handle card click on pitch
  const handlePitchPlayerClick = (player: Player) => {
    if (!quickSwapPlayer) {
      onOpenPlayerDetail(player);
      return;
    }
    handleStartSwap(player);
  };

  // Handle card click on bench
  const handleBenchPlayerClick = (player: Player) => {
    if (!quickSwapPlayer) {
      onOpenPlayerDetail(player);
      return;
    }
    handleStartSwap(player);
  };

  return (
    <LayoutGroup id="tactical-field-bench">
      <div className="flex flex-col w-full pb-28 relative">
        {/* Tactical Header & Formation Selector */}
        <div className="px-gutter-mobile pt-space-xs pb-space-xs flex items-center justify-between gap-space-xs">
          <div className="flex items-center gap-space-xs">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-surface-container-high text-primary shadow-sm">
              <span className="material-symbols-outlined text-[20px]">sports_soccer</span>
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-on-surface leading-none">
                  Mi Once Titular
                </span>
                {activeChip && (
                  <span className="px-2 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-primary text-[10px] font-bold uppercase tracking-wider shadow-sm animate-pulse">
                    {activeChip === 'triple_cap' ? '🔥 Triple Capitán (3x)' : activeChip === 'bench_boost' ? '⚡ Banquillo Potenciado' : activeChip === 'emergency_fund' ? '💰 Fondo +$5.0M' : '🃏 Comodín LPF'}
                  </span>
                )}
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Jornada actual · Presupuesto: <strong className="text-primary font-bold">${totalPitchBudget.toFixed(1)}M</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-space-2xs bg-surface-container-low px-space-xs py-space-2xs rounded-full shadow-inner">
            <span className="font-label-sm text-label-sm text-secondary font-bold">11 Titulares</span>
          </div>
        </div>

        {/* Formations Horizontal Selector */}
        <div className="w-full overflow-x-auto no-scrollbar px-gutter-mobile py-space-2xs">
          <div className="flex items-center gap-space-xs w-max">
            {FORMATIONS.map(f => {
              const isSelected = formation === f;
              return (
                <button
                  key={f}
                  onClick={() => onSelectFormation(f)}
                  className={`relative px-space-sm py-1.5 rounded-full font-headline-sm text-headline-sm tracking-wider uppercase transition-all duration-200 active:scale-95 flex items-center gap-1.5 ${
                    isSelected
                      ? 'text-on-primary font-bold shadow-md'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId="activeFormationIndicator"
                      className="absolute inset-0 rounded-full bg-primary-container ring-1 ring-primary/40 -z-10 shadow-sm"
                      transition={springTransition}
                    />
                  )}
                  <span className="relative z-10">{f}</span>
                  {isSelected && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="relative z-10 w-1.5 h-1.5 rounded-full bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Interactive Tactical Feedback & Substitution Notification Banner */}
        <div className="px-gutter-mobile w-full max-w-[640px] mx-auto">
          <AnimatePresence mode="wait">
            {lastSubNotification && !quickSwapPlayer && (
              <motion.div
                key={`sub-done-${lastSubNotification.key}`}
                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.96 }}
                transition={{ duration: 0.25 }}
                className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-surface-container-highest/95 border border-primary/50 text-on-surface shadow-xl mb-2 backdrop-blur-md"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0 animate-pulse">
                    <span className="material-symbols-outlined text-[20px]">swap_horiz</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-headline-sm text-headline-sm uppercase text-primary leading-none">
                        Cambio Realizado
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-on-surface-variant truncate">
                      <span className="text-primary font-bold flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[13px]">arrow_upward</span>
                        Entra {lastSubNotification.inName}
                      </span>
                      <span>•</span>
                      <span className="text-amber-400 font-bold flex items-center gap-0.5">
                        <span className="material-symbols-outlined text-[13px]">arrow_downward</span>
                        Sale {lastSubNotification.outName}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setLastSubNotification(null)}
                  className="w-6 h-6 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface text-[12px] transition-colors"
                  title="Cerrar aviso"
                >
                  ✕
                </button>
              </motion.div>
            )}

            {quickSwapPlayer && (
              <motion.div
                key="quick-swap-banner"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-surface-container-highest border border-secondary/60 text-on-surface shadow-xl mb-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-secondary text-[20px] animate-pulse">
                    swap_horiz
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-headline-sm text-headline-sm uppercase text-secondary leading-none truncate">
                      {bench.some(b => b.id === quickSwapPlayer.id)
                        ? 'Sustitución rápida: Desde la banca'
                        : 'Sustitución rápida: Desde el once titular'}
                    </span>
                    <span className="text-[11px] text-on-surface-variant truncate">
                      {bench.some(b => b.id === quickSwapPlayer.id) ? (
                        <>Toca un titular del 11 para que ingrese <strong className="text-on-surface">{quickSwapPlayer.displayName}</strong> ({quickSwapPlayer.position})</>
                      ) : (
                        <>Toca un suplente de la banca para sustituir a <strong className="text-on-surface">{quickSwapPlayer.displayName}</strong> ({quickSwapPlayer.position})</>
                      )}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setQuickSwapPlayer(null)}
                  className="w-7 h-7 rounded-full bg-surface-container-high hover:bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface text-[14px] transition-colors"
                  title="Cancelar sustitución rápida"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Interactive Tactical Football Pitch */}
        <div className="px-gutter-mobile mt-space-2xs w-full max-w-[640px] mx-auto">
          <div
            className={`relative w-full rounded-2xl overflow-hidden shadow-2xl bg-surface-container-lowest border transition-all duration-300 ${
              quickSwapPlayer
                ? 'border-secondary/60 ring-2 ring-secondary/20'
                : 'border-surface-container-high/40'
            }`}
            style={{ aspectRatio: '3/4.25' }}
          >
            {/* Pitch SVG Graphic Lines */}
            <div className="absolute inset-0 opacity-25 pointer-events-none">
              <svg className="w-full h-full" fill="none" preserveAspectRatio="none" viewBox="0 0 400 550">
                <rect x="15" y="15" width="370" height="520" rx="4" stroke="currentColor" strokeWidth="1.5" className="text-primary/40" />
                <line x1="15" y1="275" x2="385" y2="275" stroke="currentColor" strokeWidth="1.5" className="text-primary/35" />
                <circle cx="200" cy="275" r="48" stroke="currentColor" strokeWidth="1.5" className="text-primary/35" />
                <circle cx="200" cy="275" r="2.5" fill="currentColor" className="text-primary" />
                <rect x="95" y="15" width="210" height="85" stroke="currentColor" strokeWidth="1.5" className="text-primary/30" />
                <rect x="145" y="15" width="110" height="35" stroke="currentColor" strokeWidth="1.5" className="text-primary/30" />
                <path d="M 160 100 A 40 40 0 0 0 240 100" stroke="currentColor" strokeWidth="1.5" className="text-primary/30" />
                <rect x="95" y="450" width="210" height="85" stroke="currentColor" strokeWidth="1.5" className="text-primary/35" />
                <rect x="145" y="500" width="110" height="35" stroke="currentColor" strokeWidth="1.5" className="text-primary/35" />
                <path d="M 160 450 A 40 40 0 0 1 240 450" stroke="currentColor" strokeWidth="1.5" className="text-primary/35" />
                <circle cx="200" cy="485" r="2.5" fill="currentColor" className="text-primary" />
              </svg>
            </div>

            {/* Ambient Lighting Vignette */}
            <div className="absolute inset-0 bg-gradient-to-b from-surface-container-lowest/80 via-transparent to-surface-container-lowest/90 pointer-events-none" />
            <div className="absolute inset-0 bg-radial from-primary/10 via-transparent to-transparent pointer-events-none" />

            {/* Football Pitch Tactical Rows */}
            <div className="relative z-10 w-full h-full flex flex-col justify-between py-space-sm px-space-2xs">
              {/* ROW 4: FORWARDS */}
              <div className="w-full relative">
                <motion.div
                  layout
                  transition={springTransition}
                  className="flex items-center justify-around w-full"
                >
                  <AnimatePresence mode="popLayout">
                    {fwds.map(player => (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        isCaptain={player.id === captainId}
                        isVice={player.id === viceCaptainId}
                        isTripleCaptain={isTripleCaptain}
                        isRecentlySwapped={recentlyEnteringId === player.id}
                        isSwapSelected={quickSwapPlayer?.id === player.id}
                        isSwapCandidate={isStarterCandidate(player)}
                        onSelect={() => handlePitchPlayerClick(player)}
                        onSwap={() => handleStartSwap(player)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>

              {/* ROW 3: MIDFIELDERS */}
              <div className="w-full relative">
                <motion.div
                  layout
                  transition={springTransition}
                  className="flex items-center justify-around w-full px-0.5"
                >
                  <AnimatePresence mode="popLayout">
                    {mids.map(player => (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        isCaptain={player.id === captainId}
                        isVice={player.id === viceCaptainId}
                        isTripleCaptain={isTripleCaptain}
                        isRecentlySwapped={recentlyEnteringId === player.id}
                        isSwapSelected={quickSwapPlayer?.id === player.id}
                        isSwapCandidate={isStarterCandidate(player)}
                        onSelect={() => handlePitchPlayerClick(player)}
                        onSwap={() => handleStartSwap(player)}
                        isCompact={mids.length >= 5}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>

              {/* ROW 2: DEFENDERS */}
              <div className="w-full relative">
                <motion.div
                  layout
                  transition={springTransition}
                  className="flex items-center justify-around px-1 w-full"
                >
                  <AnimatePresence mode="popLayout">
                    {defs.map(player => (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        isCaptain={player.id === captainId}
                        isVice={player.id === viceCaptainId}
                        isTripleCaptain={isTripleCaptain}
                        isRecentlySwapped={recentlyEnteringId === player.id}
                        isSwapSelected={quickSwapPlayer?.id === player.id}
                        isSwapCandidate={isStarterCandidate(player)}
                        onSelect={() => handlePitchPlayerClick(player)}
                        onSwap={() => handleStartSwap(player)}
                        isCompact={defs.length >= 5}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>

              {/* ROW 1: GOALKEEPER */}
              <div className="w-full relative">
                <motion.div
                  layout
                  transition={springTransition}
                  className="flex items-center justify-center w-full"
                >
                  <AnimatePresence mode="popLayout">
                    {gks.map(player => (
                      <PitchPlayerCard
                        key={player.id}
                        player={player}
                        isCaptain={player.id === captainId}
                        isVice={player.id === viceCaptainId}
                        isTripleCaptain={isTripleCaptain}
                        isRecentlySwapped={recentlyEnteringId === player.id}
                        isSwapSelected={quickSwapPlayer?.id === player.id}
                        isSwapCandidate={isStarterCandidate(player)}
                        onSelect={() => handlePitchPlayerClick(player)}
                        onSwap={() => handleStartSwap(player)}
                        showGkBadge
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </div>
            </div>
          </div>
        </div>

        {/* Bench Strip (Banca de Suplentes) */}
        <div className="px-gutter-mobile mt-space-sm w-full max-w-[640px] mx-auto">
          <div
            className={`bg-surface-container-low rounded-xl p-space-sm shadow-md transition-all duration-300 border ${
              quickSwapPlayer && starters.some(s => s.id === quickSwapPlayer.id)
                ? 'border-primary/50 shadow-[0_0_20px_rgba(0,229,155,0.15)] ring-1 ring-primary/30'
                : 'border-transparent'
            }`}
          >
            <div className="flex items-center justify-between mb-space-xs">
              <div className="flex items-center gap-space-2xs">
                <span className="material-symbols-outlined text-on-surface-variant text-[18px]">event_seat</span>
                <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-on-surface">
                  Banca de Suplentes
                </span>
                {isBenchBoost && (
                  <span className="ml-1.5 px-2 py-0.5 rounded-full bg-secondary/20 text-secondary text-[10px] font-black uppercase border border-secondary/40 shadow-sm animate-pulse">
                    ⚡ Banquillo Potenciado ACTIVO
                  </span>
                )}
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                {quickSwapPlayer && starters.some(s => s.id === quickSwapPlayer.id)
                  ? '⚡ Toca para sustituir'
                  : 'Orden de Sustitución'}
              </span>
            </div>

            {/* 4 Bench Slots Animated */}
            <motion.div
              layout
              transition={springTransition}
              className="grid grid-cols-4 gap-space-xs"
            >
              <AnimatePresence mode="popLayout">
                {bench.map((player, idx) => {
                  const isSelected = quickSwapPlayer?.id === player.id;
                  const isCandidate = isBenchCandidate(player);
                  const isRecentlyExited = recentlyExitingId === player.id;
                  const isSamePos = quickSwapPlayer?.position === player.position;

                  return (
                    <motion.div
                      key={player.id}
                      layout
                      layoutId={`player-card-${player.id}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={springTransition}
                      onClick={() => handleBenchPlayerClick(player)}
                      className={`bench-card flex flex-col items-center p-space-2xs rounded-lg transition-all active:scale-95 cursor-pointer relative ${
                        isSelected
                          ? 'bg-secondary/20 ring-2 ring-secondary'
                          : isRecentlyExited
                          ? 'bg-amber-500/10 ring-2 ring-amber-400/80 shadow-[0_0_16px_rgba(255,184,0,0.25)]'
                          : isCandidate
                          ? isSamePos
                            ? 'bg-primary/20 ring-2 ring-primary animate-pulse shadow-[0_0_14px_rgba(0,229,155,0.25)]'
                            : 'bg-surface-container-high ring-1 ring-primary/40 hover:bg-primary/10'
                          : 'bg-surface-container hover:bg-surface-container-high'
                      }`}
                    >
                      <div className="relative">
                        <div
                          className={`w-10 h-10 rounded-full bg-surface-container-high overflow-hidden shadow-inner flex items-center justify-center transition-all ${
                            isSelected
                              ? 'ring-4 ring-secondary shadow-[0_0_20px_rgba(0,201,189,0.5)] scale-105'
                              : isRecentlyExited
                              ? 'ring-4 ring-amber-400 shadow-[0_0_20px_rgba(255,184,0,0.6)] animate-pulse scale-105'
                              : isCandidate
                              ? 'ring-2 ring-primary shadow-[0_0_12px_rgba(0,229,155,0.4)] animate-pulse'
                              : ''
                          }`}
                        >
                          <img
                            className="w-full h-full object-cover"
                            src={player.imageUrl}
                            alt={player.name}
                          />
                        </div>
                        <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-surface-container-highest text-[9px] font-bold text-on-surface flex items-center justify-center shadow">
                          {idx + 1}
                        </span>

                        {/* Entering / Selected Badge */}
                        {isSelected && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: [0, 1.2, 1], opacity: 1 }}
                            className="absolute -top-2 -right-2 px-1 rounded bg-secondary text-surface-container-lowest font-headline-sm text-[8px] font-black shadow-lg flex items-center gap-0.5 z-30"
                          >
                            <span className="material-symbols-outlined text-[10px]">arrow_upward</span>
                            ENTRA
                          </motion.span>
                        )}

                        {/* Candidate To Enter Badge */}
                        {isCandidate && !isSelected && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="absolute -top-2 -right-2 px-1 rounded bg-primary text-surface-container-lowest font-headline-sm text-[8px] font-black shadow-lg flex items-center gap-0.5 z-30"
                          >
                            <span className="material-symbols-outlined text-[10px]">arrow_upward</span>
                            ENTRA
                          </motion.span>
                        )}

                        {/* Recently Exited Player Badge */}
                        {isRecentlyExited && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: [0, 1.25, 1], opacity: 1 }}
                            className="absolute -top-2 -right-2 px-1 rounded bg-amber-500 text-surface-container-lowest font-headline-sm text-[8px] font-black shadow-lg flex items-center gap-0.5 z-30"
                          >
                            <span className="material-symbols-outlined text-[10px]">arrow_downward</span>
                            SALE
                          </motion.span>
                        )}

                        {/* Quick Swap Trigger Pill Button */}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleStartSwap(player);
                          }}
                          aria-label={`Sustitución rápida para ${player.displayName}`}
                          className={`swap-trigger absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-md transition-all z-20 ${
                            isSelected
                              ? 'bg-secondary text-surface-container-lowest scale-110'
                              : isCandidate
                              ? 'bg-primary text-surface-container-lowest scale-110 animate-bounce'
                              : 'bg-surface-container-highest text-on-surface hover:text-on-primary hover:bg-primary'
                          }`}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[13px]">swap_horiz</span>
                        </button>
                      </div>

                      <span
                        className={`font-headline-sm text-label-md mt-1 truncate w-full text-center ${
                          isRecentlyExited
                            ? 'text-amber-400 font-bold'
                            : isSelected
                            ? 'text-secondary font-bold'
                            : isCandidate
                            ? 'text-primary font-bold'
                            : 'text-on-surface'
                        }`}
                      >
                        {player.displayName}
                      </span>
                      <div className="flex items-center justify-between w-full font-label-sm text-[9px] mt-0.5 px-0.5">
                        <span className={`font-bold ${isCandidate && isSamePos ? 'text-primary' : 'text-on-surface-variant'}`}>
                          {player.position}
                        </span>
                        <span className="text-primary font-bold">${player.price.toFixed(1)}M</span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>

        {/* Floating Tactical Actions Bar */}
        <div className="fixed bottom-16 left-0 right-0 z-40 px-gutter-mobile py-2 bg-gradient-to-t from-surface via-surface/90 to-transparent pointer-events-none">
          <div className="max-w-[640px] mx-auto pointer-events-auto flex items-center gap-space-xs">
            {/* Captaincy Quick Button */}
            <button
              onClick={onOpenCaptainModal}
              className="flex items-center justify-center px-4 h-12 rounded-xl bg-surface-container-high text-on-surface hover:text-primary transition-all active:scale-95 shadow-lg shrink-0 gap-2 border border-surface-container-highest/60"
              title="Designar Capitanía"
              type="button"
            >
              <span className="w-5 h-5 rounded-full bg-amber-400 text-surface-container-lowest font-headline-sm text-headline-sm flex items-center justify-center font-bold">C</span>
              <span className="font-headline-sm text-headline-sm uppercase">Capitán</span>
            </button>

            {/* Primary Save Action Button - Visible only when there are actual unsaved changes */}
            <AnimatePresence>
              {hasLineupChanges && (
                <motion.button
                  key="save-changes-btn"
                  initial={{ opacity: 0, scale: 0.9, x: 20 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, x: 20 }}
                  transition={{ duration: 0.2 }}
                  onClick={onSaveLineup}
                  className="flex-1 flex items-center justify-center gap-2 h-12 px-space-md rounded-xl bg-primary-container text-on-primary font-headline-md text-headline-md uppercase tracking-wider shadow-[0_4px_20px_rgba(0,229,155,0.35)] hover:brightness-105 active:scale-[0.98] transition-all"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[22px]">check_circle</span>
                  <span>Guardar Cambios</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
};
