import React, { useState } from 'react';
import { FantasyTeam, TransferHistoryRecord, ChipId } from '../../types/fantasy';
import {
  calculateManagerMastery,
  getEvaluatedMilestones,
  WeeklyQuest,
  isChipUnlocked
} from '../../domain/rewardsEngine';

interface ComodinesModalProps {
  team: FantasyTeam;
  transferHistory?: TransferHistoryRecord[];
  onClose: () => void;
  onActivateChip: (chipId: ChipId) => void;
  onDeactivateChip: (chipId: ChipId) => void;
  onClaimChest: () => void;
  onClaimQuest: (questId: string, xpReward: number) => void;
}

export const ComodinesModal: React.FC<ComodinesModalProps> = ({
  team,
  transferHistory = [],
  onClose,
  onActivateChip,
  onDeactivateChip,
  onClaimChest,
  onClaimQuest
}) => {
  const [activeTab, setActiveTab] = useState<'comodines' | 'recompensas' | 'historial'>('comodines');
  const [weeklyQuests, setWeeklyQuests] = useState<WeeklyQuest[]>([]);

  // Calculate live mastery level and milestones
  const mastery = calculateManagerMastery(team);
  const milestones = getEvaluatedMilestones(team);

  // 4 Tactical Chips with live state detection
  const chipsConfig = [
    {
      id: 'wildcard' as ChipId,
      name: 'Comodín LPF (Wildcard)',
      icon: 'auto_fix_high',
      accentColor: 'text-primary',
      badgeBg: 'bg-primary/20 text-primary border-primary/40',
      description: 'Realiza cambios ilimitados en tu plantilla sin penalización de -4 puntos durante toda esta jornada. Válido 1 vez por torneo.',
      effectBenefit: 'Fichajes gratis ilimitados en la jornada activa (0 pts penalización)'
    },
    {
      id: 'triple_cap' as ChipId,
      name: 'Triple Capitán (3x)',
      icon: 'military_tech',
      accentColor: 'text-amber-400',
      badgeBg: 'bg-amber-400/20 text-amber-400 border-amber-400/40',
      description: 'Tu capitán seleccionado triplica su puntuación en vez del doble tradicional (x3 multiplicador de puntos oficiales).',
      effectBenefit: 'Capitán designado suma el triple (x3) de puntos'
    },
    {
      id: 'bench_boost' as ChipId,
      name: 'Banquillo Potenciado',
      icon: 'chair',
      accentColor: 'text-secondary',
      badgeBg: 'bg-secondary/20 text-secondary border-secondary/40',
      description: 'Los puntos de los 4 suplentes en el banquillo (POR, DEF, MED, DEL) se suman automáticamente a tu marcador general de la jornada.',
      effectBenefit: 'Los 4 jugadores suplentes aportan puntos al marcador'
    },
    {
      id: 'emergency_fund' as ChipId,
      name: 'Fondo de Emergencia',
      icon: 'savings',
      accentColor: 'text-emerald-400',
      badgeBg: 'bg-emerald-400/20 text-emerald-400 border-emerald-400/40',
      description: 'Añade de inmediato +$5.0M de presupuesto extra a tus fondos para armar un once con los mejores cracks de la LPF.',
      effectBenefit: '+$5.0M de presupuesto salarial inmediato para fichar'
    }
  ];

  const handleQuestClaim = (quest: WeeklyQuest) => {
    if (quest.isClaimed) return;
    setWeeklyQuests(prev =>
      prev.map(q => (q.id === quest.id ? { ...q, isClaimed: true } : q))
    );
    onClaimQuest(quest.id, quest.xpReward);
  };

  const isChestAlreadyClaimed = !!team.lastChestClaimedDate;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-surface-container-lowest/85 backdrop-blur-md px-gutter-mobile pb-safe">
      <div className="flex flex-col w-full max-w-lg bg-surface-container rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden border border-surface-container-high/70 max-h-[92vh] animate-in fade-in duration-200">
        
        {/* Header */}
        <div className="p-space-md bg-surface-container-low flex items-center justify-between border-b border-surface-container-high/60 shrink-0">
          <div className="flex items-center gap-space-xs">
            <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shadow-sm">
              <span className="material-symbols-outlined text-[22px]">military_tech</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h2 className="font-headline-md text-headline-md uppercase text-on-surface leading-none">
                  Comodines & Recompensas
                </h2>
                <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-[10px] font-bold text-primary">
                  LPF ÉLITE
                </span>
              </div>
              <span className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                Ventajas tácticas y progreso dinámico de la temporada
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Cerrar ventana"
            className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* 3 Interactive Tabs */}
        <div className="flex items-center gap-1 px-space-md pt-space-xs bg-surface-container-low border-b border-surface-container-high/60 shrink-0">
          <button
            onClick={() => setActiveTab('comodines')}
            className={`py-2 px-3 font-headline-sm text-sm uppercase tracking-wider transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'comodines'
                ? 'border-primary text-primary font-bold'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">token</span>
            Comodines (4)
          </button>

          <button
            onClick={() => setActiveTab('recompensas')}
            className={`py-2 px-3 font-headline-sm text-sm uppercase tracking-wider transition-colors border-b-2 flex items-center gap-1.5 relative ${
              activeTab === 'recompensas'
                ? 'border-primary text-primary font-bold'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">stars</span>
            Recompensas & XP
            {/* Notification pulse if rewards are waiting */}
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          </button>

          <button
            onClick={() => setActiveTab('historial')}
            className={`py-2 px-3 font-headline-sm text-sm uppercase tracking-wider transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'historial'
                ? 'border-primary text-primary font-bold'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[17px]">history</span>
            Historial
          </button>
        </div>

        {/* Scrollable Content Container */}
        <div className="p-space-md overflow-y-auto space-y-space-md flex-1">
          
          {/* TAB 1: COMODINES TÁCTICOS */}
          {activeTab === 'comodines' && (
            <div className="space-y-space-sm">
              {/* Active Chip Banner Status */}
              {team.activeChip ? (
                <div className="bg-primary/10 border border-primary/30 p-3 rounded-2xl flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-primary text-[24px]">verified</span>
                    <div>
                      <span className="font-headline-sm text-xs font-bold text-primary uppercase block">
                        Comodín activo en esta jornada
                      </span>
                      <span className="text-xs text-on-surface font-medium">
                        {chipsConfig.find(c => c.id === team.activeChip)?.name}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => onDeactivateChip(team.activeChip!)}
                    className="px-2.5 py-1 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-error text-xs font-bold uppercase transition-colors"
                  >
                    Desactivar
                  </button>
                </div>
              ) : (
                <div className="bg-surface-container-low p-3 rounded-2xl border border-surface-container-high/50 flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-amber-400 text-[18px]">info</span>
                  <span>
                    Puedes activar <strong>1 comodín táctico</strong> para la jornada vigente antes del cierre de alineaciones.
                  </span>
                </div>
              )}

              {/* List of 4 Chips */}
              <div className="space-y-space-sm">
                {chipsConfig.map(chip => {
                  const unlocked = isChipUnlocked(team, chip.id);
                  const isActive = team.activeChip === chip.id;
                  const milestone = milestones.find(m => m.chipRewardId === chip.id);
                  const pointsNeeded = milestone ? Math.max(0, milestone.thresholdPoints - mastery.currentXp) : 0;

                  return (
                    <div
                      key={chip.id}
                      className={`p-space-sm rounded-2xl transition-all border ${
                        isActive
                          ? 'bg-surface-container-low border-primary shadow-[0_0_20px_rgba(0,229,155,0.15)] ring-1 ring-primary/40'
                          : unlocked
                          ? 'bg-surface-container-low border-surface-container-high/60 hover:border-surface-container-highest shadow-sm'
                          : 'bg-surface-container-low/60 border-surface-container-high/30 opacity-80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                            isActive ? 'bg-primary text-surface-container-lowest font-bold shadow' : 'bg-surface-container-high'
                          }`}>
                            <span className={`material-symbols-outlined text-[20px] ${isActive ? 'text-surface-container-lowest' : chip.accentColor}`}>
                              {chip.icon}
                            </span>
                          </div>
                          <div>
                            <h3 className="font-headline-sm text-sm uppercase text-on-surface font-bold">
                              {chip.name}
                            </h3>
                            <span className="text-[11px] text-primary font-medium block">
                              {chip.effectBenefit}
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span
                          className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${
                            isActive
                              ? 'bg-primary text-surface-container-lowest border-primary'
                              : unlocked
                              ? chip.badgeBg
                              : 'bg-surface-container-highest text-on-surface-variant border-transparent'
                          }`}
                        >
                          {isActive ? 'ACTIVADO' : unlocked ? 'DISPONIBLE' : 'BLOQUEADO'}
                        </span>
                      </div>

                      <p className="font-body-sm text-xs text-on-surface-variant mt-2 leading-relaxed">
                        {chip.description}
                      </p>

                      {/* Bottom action or unlock progress */}
                      <div className="mt-3 pt-2.5 border-t border-surface-container-high/50 flex items-center justify-between gap-2">
                        {unlocked ? (
                          <>
                            <span className="text-[11px] text-on-surface-variant">
                              {isActive ? 'Beneficio activo para esta jornada' : 'Listo para activar'}
                            </span>
                            {isActive ? (
                              <button
                                onClick={() => onDeactivateChip(chip.id)}
                                className="px-3 py-1.5 rounded-xl bg-error/15 text-error hover:bg-error/25 font-headline-sm text-xs uppercase tracking-wider font-bold transition-all"
                              >
                                Desactivar
                              </button>
                            ) : (
                              <button
                                onClick={() => onActivateChip(chip.id)}
                                className="px-3.5 py-1.5 rounded-xl bg-primary text-surface-container-lowest hover:brightness-110 font-headline-sm text-xs uppercase tracking-wider font-bold shadow-md active:scale-95 transition-all"
                              >
                                Activar para la jornada
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="w-full flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="text-[11px] font-bold text-amber-400">
                                Requiere {milestone?.thresholdPoints} pts en la liga
                              </span>
                              <span className="text-[10px] text-on-surface-variant">
                                Actual: {mastery.currentXp} pts (Te faltan {pointsNeeded} pts)
                              </span>
                            </div>
                            <button
                              onClick={() => setActiveTab('recompensas')}
                              className="px-2.5 py-1 rounded-lg bg-surface-container-high text-on-surface text-xs font-bold uppercase hover:bg-surface-container-highest flex items-center gap-1"
                            >
                              <span>Ver Retos</span>
                              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: SISTEMA DE RECOMPENSAS & MAESTRÍA */}
          {activeTab === 'recompensas' && (
            <div className="space-y-space-md">
              
              {/* Manager Level Card */}
              <div className="bg-surface-container-low rounded-2xl p-4 border border-surface-container-high/70 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none" />
                
                <div className="flex items-center justify-between mb-3 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-primary to-emerald-400 p-0.5 shadow-md">
                      <div className="w-full h-full bg-surface-container-low rounded-2xl flex items-center justify-center">
                        <span className="font-headline-md text-lg font-black text-primary">
                          {mastery.level}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-headline-sm text-sm font-bold text-on-surface uppercase">
                          {mastery.title}
                        </h3>
                        <span className="px-1.5 py-0.2 rounded bg-primary/20 text-primary text-[9px] font-mono font-bold">
                          {mastery.badge}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant font-mono">
                        {mastery.currentXp} Puntos de Maestría Acumulados
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-on-surface-variant uppercase block">Próximo Nivel</span>
                    <span className="font-headline-sm text-xs font-bold text-primary">
                      {mastery.xpToNextLevel > 0 ? `-${mastery.xpToNextLevel} pts` : 'Nivel Máximo'}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-surface-container-highest rounded-full h-2.5 overflow-hidden p-0.5">
                  <div
                    className="bg-gradient-to-r from-emerald-400 to-primary h-full rounded-full transition-all duration-500"
                    style={{ width: `${mastery.progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-on-surface-variant mt-1.5 font-mono">
                  <span>{mastery.minXp} pts</span>
                  <span className="text-primary font-bold">{mastery.progressPercent}% completado</span>
                  <span>{mastery.maxXp} pts</span>
                </div>
              </div>

              {/* Tactical Gameweek Mystery Chest Drop */}
              <div className="bg-gradient-to-br from-surface-container-low via-surface-container-low to-surface-container-high rounded-2xl p-4 border border-amber-400/40 shadow-md relative overflow-hidden">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/40 flex items-center justify-center text-amber-400 text-[26px] shadow-sm shrink-0">
                      <span className="material-symbols-outlined text-[28px]">lock_clock</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-headline-sm text-sm font-bold text-on-surface uppercase">
                          Cofre táctico de la jornada
                        </h4>
                        <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-400 text-[9px] font-bold">
                          RECOMPENSA ACTIVA
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        Recompensa por fidelidad y actividad antes del cierre del mercado.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3.5 pt-3 border-t border-surface-container-high/60 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-on-surface-variant font-mono">
                    <span className="material-symbols-outlined text-[15px] text-primary">timer</span>
                    <span>Disponible cuando exista una jornada oficial abierta</span>
                  </div>

                  <button
                    onClick={onClaimChest}
                    disabled={isChestAlreadyClaimed}
                    className={`px-4 py-2 rounded-xl font-headline-sm text-xs uppercase font-bold tracking-wider transition-all flex items-center gap-1.5 shadow-md active:scale-95 ${
                      isChestAlreadyClaimed
                        ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed'
                        : 'bg-gradient-to-r from-amber-400 to-amber-500 text-surface-container-lowest font-black hover:brightness-105'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {isChestAlreadyClaimed ? 'check' : 'package_2'}
                    </span>
                    {isChestAlreadyClaimed ? 'Cofre Reclamado' : 'Abrir Cofre (+XP)'}
                  </button>
                </div>
              </div>

              {/* Dynamic Weekly Quests */}
              <div className="space-y-space-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-headline-sm text-xs uppercase tracking-wider text-on-surface-variant font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-primary text-[16px]">task_alt</span>
                    Misiones Tácticas de la Jornada
                  </h4>
                  <span className="text-[11px] text-primary font-bold">
                    Suma XP para desbloquear comodines
                  </span>
                </div>

                <div className="space-y-2">
                  {weeklyQuests.length === 0 && <p className="text-sm text-on-surface-variant">No hay misiones oficiales configuradas para la jornada.</p>}
                  {weeklyQuests.map(quest => (
                    <div
                      key={quest.id}
                      className="bg-surface-container-low p-3 rounded-xl border border-surface-container-high/50 flex items-center justify-between gap-3 shadow-sm"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          quest.isClaimed ? 'bg-primary/20 text-primary' : 'bg-surface-container-high text-on-surface-variant'
                        }`}>
                          <span className="material-symbols-outlined text-[18px]">
                            {quest.icon}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <h5 className="font-headline-sm text-xs text-on-surface font-bold truncate">
                            {quest.title}
                          </h5>
                          <p className="text-[11px] text-on-surface-variant truncate">
                            {quest.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono font-bold text-amber-400">
                          +{quest.xpReward} XP
                        </span>
                        <button
                          onClick={() => handleQuestClaim(quest)}
                          disabled={quest.isClaimed}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase transition-all ${
                            quest.isClaimed
                              ? 'bg-surface-container-highest text-on-surface-variant cursor-default'
                              : 'bg-primary text-surface-container-lowest hover:brightness-110 shadow-sm active:scale-95'
                          }`}
                        >
                          {quest.isClaimed ? 'Reclamado' : 'Reclamar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Milestones Roadmap */}
              <div className="space-y-2 pt-2">
                <h4 className="font-headline-sm text-xs uppercase tracking-wider text-on-surface-variant font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined text-secondary text-[16px]">route</span>
                  Ruta de Desbloqueo por Puntos de Liga
                </h4>

                <div className="space-y-2">
                  {milestones.map(m => {
                    const progressRatio = Math.min(1, mastery.currentXp / m.thresholdPoints);
                    return (
                      <div
                        key={m.id}
                        className="bg-surface-container-low p-3 rounded-xl border border-surface-container-high/40 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className={`material-symbols-outlined text-[20px] ${
                            m.isUnlocked ? 'text-primary' : 'text-on-surface-variant'
                          }`}>
                            {m.isUnlocked ? 'check_circle' : 'lock'}
                          </span>
                          <div>
                            <span className="font-headline-sm text-xs font-bold text-on-surface block">
                              {m.title}
                            </span>
                            <span className="text-[10px] text-on-surface-variant">
                              Objetivo: {m.thresholdPoints} pts · {m.effectSummary}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
                            m.isUnlocked
                              ? 'bg-primary/20 text-primary'
                              : 'bg-surface-container-highest text-on-surface-variant'
                          }`}>
                            {m.isUnlocked ? 'Desbloqueado' : `${Math.round(progressRatio * 100)}%`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: HISTORIAL DE FICHAJES */}
          {activeTab === 'historial' && (
            <div className="space-y-space-xs">
              {transferHistory.length > 0 ? (
                transferHistory.map((h) => (
                  <div key={h.id} className="bg-surface-container-low p-space-sm rounded-xl space-y-1 shadow-sm border border-surface-container-high/50">
                    <div className="flex items-center justify-between">
                      <span className="font-headline-sm text-headline-sm uppercase text-on-surface font-bold">
                        {h.gameweek}
                      </span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant">{h.dateStr}</span>
                    </div>
                    <p className="font-body-md text-body-md text-primary font-medium">
                      {h.playerOutName} (OUT) ⇄ {h.playerInName} (IN)
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-on-surface-variant pt-1 border-t border-surface-container-high/50">
                      <span>Coste: <strong className={h.pointsCost > 0 ? 'text-error' : 'text-primary'}>{h.auditTag || (h.pointsCost > 0 ? `-${h.pointsCost} pts` : '0 pts')}</strong></span>
                      <span>Diferencia: {h.balanceDiff >= 0 ? `+$${h.balanceDiff.toFixed(1)}M` : `-$${Math.abs(h.balanceDiff).toFixed(1)}M`}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-space-md text-center bg-surface-container-low rounded-xl text-on-surface-variant font-body-sm">
                  No hay transferencias registradas todavía.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-space-md bg-surface-container-low border-t border-surface-container-high/60 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-on-surface-variant font-medium truncate">
            {team.activeChip ? (
              <span className="text-primary font-bold">
                ✓ Comodín {chipsConfig.find(c => c.id === team.activeChip)?.name} activado
              </span>
            ) : (
              <span>Sin comodín activo para la jornada</span>
            )}
          </div>
          
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-primary text-surface-container-lowest font-headline-sm text-xs font-black uppercase tracking-wider shadow-md hover:brightness-105 active:scale-95 transition-all shrink-0"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};
