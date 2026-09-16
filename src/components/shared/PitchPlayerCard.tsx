import React from 'react';
import { motion } from 'motion/react';
import { Player } from '../../types/fantasy';

export const pitchCardSpringTransition = {
  type: 'spring' as const,
  stiffness: 350,
  damping: 28,
  mass: 0.85
};

export interface PitchPlayerCardProps {
  player: Player;
  isCaptain: boolean;
  isVice: boolean;
  isTripleCaptain?: boolean;
  isRecentlySwapped?: boolean;
  isSwapSelected?: boolean;
  isSwapCandidate?: boolean;
  onSelect: () => void;
  onSwap: () => void;
  showGkBadge?: boolean;
  isCompact?: boolean;
  pointsLabel?: React.ReactNode;
}

export const PitchPlayerCard: React.FC<PitchPlayerCardProps> = ({
  player,
  isCaptain,
  isVice,
  isTripleCaptain = false,
  isRecentlySwapped,
  isSwapSelected,
  isSwapCandidate,
  onSelect,
  onSwap,
  showGkBadge,
  isCompact,
  pointsLabel
}) => {
  return (
    <motion.div
      layout
      layoutId={`player-card-${player.id}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={pitchCardSpringTransition}
      onClick={onSelect}
      className={`player-card group flex flex-col items-center cursor-pointer transition-transform active:scale-95 relative ${
        isSwapSelected || isRecentlySwapped ? 'z-20' : ''
      }`}
    >
      <div className="relative">
        <div
          className={`${
            isCompact ? 'w-10 h-10' : 'w-11 h-11'
          } rounded-full bg-surface-container-high overflow-hidden shadow-md flex items-center justify-center transition-all ${
            isSwapSelected
              ? 'ring-4 ring-secondary shadow-[0_0_20px_rgba(0,201,189,0.5)] scale-105'
              : isRecentlySwapped
              ? 'ring-4 ring-primary shadow-[0_0_20px_rgba(0,229,155,0.6)] animate-pulse scale-105'
              : isSwapCandidate
              ? 'ring-2 ring-amber-400/80 shadow-[0_0_12px_rgba(255,184,0,0.4)] animate-pulse'
              : isCaptain
              ? 'ring-2 ring-amber-400 shadow-[0_0_16px_rgba(255,184,0,0.35)]'
              : ''
          }`}
        >
          <img
            className="w-full h-full object-cover"
            src={player.imageUrl}
            alt={player.name}
          />
        </div>

        {/* Recently Swapped Entering Indicator Badge */}
        {isRecentlySwapped && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.25, 1], opacity: 1 }}
            className="absolute -top-2 -right-2 px-1 rounded bg-primary text-surface-container-lowest font-headline-sm text-[8px] font-black shadow-lg flex items-center gap-0.5 z-30"
          >
            <span className="material-symbols-outlined text-[10px]">arrow_upward</span>
            ENTRA
          </motion.span>
        )}

        {/* Swap Selected Leaving Indicator Badge */}
        {isSwapSelected && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.2, 1], opacity: 1 }}
            className="absolute -top-2 -right-2 px-1 rounded bg-secondary text-surface-container-lowest font-headline-sm text-[8px] font-black shadow-lg flex items-center gap-0.5 z-30"
          >
            <span className="material-symbols-outlined text-[10px]">arrow_downward</span>
            SALE
          </motion.span>
        )}

        {/* Swap Candidate Leaving Indicator Badge */}
        {isSwapCandidate && !isSwapSelected && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute -top-2 -right-2 px-1 rounded bg-amber-500 text-surface-container-lowest font-headline-sm text-[8px] font-black shadow-lg flex items-center gap-0.5 z-30"
          >
            <span className="material-symbols-outlined text-[10px]">arrow_downward</span>
            SALE
          </motion.span>
        )}

        {/* Captain Badge */}
        {isCaptain && !isRecentlySwapped && !isSwapSelected && !isSwapCandidate && (
          <>
            <span className={`absolute -top-1.5 -left-1.5 px-1 min-w-[18px] h-[18px] rounded-full text-surface flex items-center justify-center font-headline-sm text-label-sm font-black shadow-lg ${
              isTripleCaptain ? 'bg-amber-300 ring-2 ring-amber-400 shadow-[0_0_12px_rgba(255,184,0,0.8)]' : 'bg-[#FFB800]'
            }`}>
              C
            </span>
            <span className={`absolute top-0 -right-1.5 px-1 rounded-full bg-surface-container-lowest font-label-sm text-[9px] font-black ${
              isTripleCaptain ? 'text-amber-300 ring-1 ring-amber-400/60 font-black' : 'text-[#FFB800]'
            }`}>
              {isTripleCaptain ? '3X 🔥' : '2X'}
            </span>
          </>
        )}

        {/* Vice Badge */}
        {isVice && !isCaptain && !isRecentlySwapped && !isSwapSelected && !isSwapCandidate && (
          <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-secondary-container text-surface flex items-center justify-center font-headline-sm text-label-sm font-black shadow-sm">
            V
          </span>
        )}

        {/* GK Position Badge */}
        {showGkBadge && !isRecentlySwapped && !isSwapSelected && !isSwapCandidate && (
          <span className="absolute -top-1 -right-1 px-1 rounded bg-surface-container-highest text-[9px] font-bold text-secondary shadow">
            POR
          </span>
        )}

        {/* Swap Trigger Pill */}
        <button
          onClick={e => {
            e.stopPropagation();
            onSwap();
          }}
          aria-label={`Sustituir ${player.displayName}`}
          className={`swap-trigger absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-md transition-all z-20 ${
            isSwapSelected
              ? 'bg-secondary text-surface-container-lowest scale-110'
              : isSwapCandidate
              ? 'bg-amber-500 text-surface-container-lowest scale-110 animate-bounce'
              : 'bg-surface-container-highest text-on-surface hover:text-on-primary hover:bg-primary'
          }`}
          type="button"
        >
          <span className="material-symbols-outlined text-[13px]">swap_horiz</span>
        </button>
      </div>

      <div
        className={`mt-1 bg-surface-container/95 backdrop-blur-md px-1.5 py-0.5 rounded-lg flex flex-col items-center shadow-sm transition-all ${
          isCompact ? 'w-[64px]' : 'w-[74px]'
        } ${
          isRecentlySwapped
            ? 'ring-1 ring-primary/60 bg-primary/10'
            : isSwapSelected
            ? 'ring-1 ring-secondary/60 bg-secondary/10'
            : isSwapCandidate
            ? 'ring-1 ring-amber-400/60 bg-amber-500/10'
            : ''
        }`}
      >
        <span
          className={`font-headline-sm text-headline-sm truncate w-full text-center leading-tight ${
            isRecentlySwapped
              ? 'text-primary font-bold'
              : isSwapCandidate
              ? 'text-amber-400 font-bold'
              : isCaptain
              ? 'text-[#FFB800]'
              : 'text-on-surface'
          }`}
        >
          {player.displayName}
        </span>
        <div className="flex items-center justify-between w-full font-label-sm text-label-sm mt-0.5">
          <span className="text-on-surface-variant text-[9px]">{player.clubCode}</span>
          <span
            className={`font-bold ${
              isRecentlySwapped
                ? 'text-primary'
                : isSwapCandidate
                ? 'text-amber-400'
                : isCaptain
                ? 'text-[#FFB800]'
                : 'text-primary'
            }`}
          >
            {pointsLabel ?? (isCaptain ? `${player.lastGwPoints * 2} pts` : `${player.lastGwPoints} pts`)}
          </span>
        </div>
      </div>
    </motion.div>
  );
};
