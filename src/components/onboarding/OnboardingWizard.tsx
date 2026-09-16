import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { AuthUser } from '../../services/authService';
import { userDatabase } from '../../services/userDatabase';
import { leagueService, PrivateLeagueRecord } from '../../services/leagueService';
import { lpfDataService } from '../../services/lpfDataService';
import { Player, Position, Formation } from '../../types/fantasy';
import { PitchPlayerCard, pitchCardSpringTransition } from '../shared/PitchPlayerCard';
import {
  Shield,
  Users,
  DollarSign,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Search,
  Plus,
  Trash2,
  AlertTriangle,
  Award,
  Crown,
  Sparkles,
  Copy,
  Check,
  ArrowRight
} from 'lucide-react';

interface OnboardingWizardProps {
  user: AuthUser;
  tournamentId: string;
  gameweekId: string;
  inviteCode?: string;
  onComplete: () => void | Promise<void>;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ user, tournamentId, gameweekId, inviteCode = '', onComplete }) => {
  const draftReady = useRef(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);

  // Step 1: Profile & Identity
  const [teamName, setTeamName] = useState(`${user.name.split(' ')[0]} FC`);
  const [favoriteClubId, setFavoriteClubId] = useState(user.favoriteClubId || '');
  const [province, setProvince] = useState('Panamá');

  // Step 2: 15 Players Squad Selection
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [marketSearch, setMarketSearch] = useState('');
  const [marketPosition, setMarketPosition] = useState<Position | 'ALL'>('ALL');
  const [marketClub, setMarketClub] = useState<string>('ALL');

  // Step 3: Formation & Starting XI
  const [formation, setFormation] = useState<Formation>('4-3-3');
  const [starterIds, setStarterIds] = useState<string[]>([]);
  const [benchIds, setBenchIds] = useState<string[]>([]);

  // Step 4: Captain & Vice-Captain
  const [captainId, setCaptainId] = useState<string>('');
  const [viceCaptainId, setViceCaptainId] = useState<string>('');

  // Step 6: Leagues
  const [leagueMode, setLeagueMode] = useState<'create' | 'join' | null>(null);
  const [newLeagueName, setNewLeagueName] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState(inviteCode);
  const [createdLeague, setCreatedLeague] = useState<PrivateLeagueRecord | null>(null);
  const [joinedLeague, setJoinedLeague] = useState<PrivateLeagueRecord | null>(null);
  const [leagueFeedback, setLeagueFeedback] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isConfirmingTeam, setIsConfirmingTeam] = useState(false);
  const [isSubmittingLeague, setIsSubmittingLeague] = useState(false);

  useEffect(() => {
    let active = true;
    void userDatabase.loadOnboardingDraft(tournamentId).then(draft => {
      if (!active) return;
      if (draft) {
        setCurrentStep(Math.min(6, Math.max(1, draft.step)) as 1 | 2 | 3 | 4 | 5 | 6);
        setTeamName(draft.teamName || `${user.name.split(' ')[0]} FC`);
        setProvince(draft.province || 'Panamá');
        setFavoriteClubId(draft.favoriteClubId || '');
        setFormation(draft.formation || '4-3-3');
        setSelectedPlayerIds(draft.selectedPlayerIds || []);
        setStarterIds(draft.starters || []); setBenchIds(draft.bench || []);
        setCaptainId(draft.captainId || ''); setViceCaptainId(draft.viceCaptainId || '');
      }
      draftReady.current = true;
    }).catch(() => { draftReady.current = true; });
    return () => { active = false; };
  }, [tournamentId, user.name]);

  useEffect(() => {
    if (!draftReady.current || currentStep === 6) return;
    const timer = window.setTimeout(() => {
      void userDatabase.saveOnboardingDraft({ tournamentId, step: currentStep, teamName, province,
        favoriteClubId, formation, selectedPlayerIds, starters: starterIds, bench: benchIds,
        captainId, viceCaptainId }).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [tournamentId, currentStep, teamName, province, favoriteClubId, formation,
    selectedPlayerIds, starterIds, benchIds, captainId, viceCaptainId]);

  const clubs = lpfDataService.getClubs();
  const allPlayers = lpfDataService.getAllPlayers();

  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    allPlayers.forEach(p => map.set(p.id, p));
    return map;
  }, [allPlayers]);

  const selectedPlayers = useMemo(() => {
    return selectedPlayerIds.map(id => playerMap.get(id)).filter((p): p is Player => !!p);
  }, [selectedPlayerIds, playerMap]);

  // Squad Metrics
  const totalSpent = useMemo(() => {
    return selectedPlayers.reduce((acc, p) => acc + p.price, 0);
  }, [selectedPlayers]);

  const budgetRemaining = Math.round((100.0 - totalSpent) * 10) / 10;

  const posCounts = useMemo(() => {
    const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    selectedPlayers.forEach(p => {
      counts[p.position]++;
    });
    return counts;
  }, [selectedPlayers]);

  const clubCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    selectedPlayers.forEach(p => {
      counts[p.clubId] = (counts[p.clubId] || 0) + 1;
    });
    return counts;
  }, [selectedPlayers]);

  // Filtered market list
  const filteredPlayers = useMemo(() => {
    return allPlayers.filter(p => {
      if (selectedPlayerIds.includes(p.id)) return false;
      if (marketPosition !== 'ALL' && p.position !== marketPosition) return false;
      if (marketClub !== 'ALL' && p.clubId !== marketClub) return false;
      if (marketSearch.trim()) {
        const q = marketSearch.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q);
        const matchesClub = p.clubName.toLowerCase().includes(q);
        if (!matchesName && !matchesClub) return false;
      }
      return true;
    });
  }, [allPlayers, selectedPlayerIds, marketPosition, marketClub, marketSearch]);

  // Add player to squad
  const handleAddPlayer = (p: Player) => {
    if (selectedPlayerIds.length >= 15) return;
    if (totalSpent + p.price > 100.0) return;
    if ((clubCounts[p.clubId] || 0) >= 3) return;

    const maxPos: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
    if (posCounts[p.position] >= maxPos[p.position]) return;

    setSelectedPlayerIds(prev => [...prev, p.id]);
  };

  // Remove player from squad
  const handleRemovePlayer = (playerId: string) => {
    setSelectedPlayerIds(prev => prev.filter(id => id !== playerId));
    // Clear from XI or bench if already assigned
    setStarterIds(prev => prev.filter(id => id !== playerId));
    setBenchIds(prev => prev.filter(id => id !== playerId));
    if (captainId === playerId) setCaptainId('');
    if (viceCaptainId === playerId) setViceCaptainId('');
  };

  // Auto-arrange XI and Bench based on chosen formation
  const autoArrangeLineup = (targetFormation: Formation) => {
    const gks = selectedPlayers.filter(p => p.position === 'GK');
    const defs = selectedPlayers.filter(p => p.position === 'DEF');
    const mids = selectedPlayers.filter(p => p.position === 'MID');
    const fwds = selectedPlayers.filter(p => p.position === 'FWD');

    const [dCount, mCount, fCount] = targetFormation.split('-').map(Number);

    const starters: string[] = [
      gks[0]?.id,
      ...defs.slice(0, dCount).map(p => p.id),
      ...mids.slice(0, mCount).map(p => p.id),
      ...fwds.slice(0, fCount).map(p => p.id)
    ].filter(Boolean);

    const bench: string[] = [
      gks[1]?.id,
      ...defs.slice(dCount).map(p => p.id),
      ...mids.slice(mCount).map(p => p.id),
      ...fwds.slice(fCount).map(p => p.id)
    ].filter(Boolean);

    setStarterIds(starters);
    setBenchIds(bench);

    if (!captainId && starters.length > 0) {
      setCaptainId(starters[0]);
    }
    if (!viceCaptainId && starters.length > 1) {
      setViceCaptainId(starters[1]);
    }
  };

  const swapStarterWithBench = (playerId: string) => {
    const player = playerMap.get(playerId);
    if (!player) return;
    const playerIsStarter = starterIds.includes(playerId);
    const counterpartId = (playerIsStarter ? benchIds : starterIds)
      .find(id => playerMap.get(id)?.position === player.position);
    if (!counterpartId) return;
    setStarterIds(current => current.map(id => id === (playerIsStarter ? playerId : counterpartId)
      ? (playerIsStarter ? counterpartId : playerId) : id));
    setBenchIds(current => current.map(id => id === (playerIsStarter ? counterpartId : playerId)
      ? (playerIsStarter ? playerId : counterpartId) : id));
    if (playerIsStarter && captainId === playerId) setCaptainId('');
    if (playerIsStarter && viceCaptainId === playerId) setViceCaptainId('');
  };

  // Step 2 -> Step 3 transition
  const handleProceedToLineup = () => {
    if (selectedPlayerIds.length !== 15) return;
    if (totalSpent > 100.0) return;
    autoArrangeLineup(formation);
    setCurrentStep(3);
  };

  // Step 3 -> Step 4
  const handleProceedToCaptaincy = () => {
    if (starterIds.length !== 11 || benchIds.length !== 4) {
      autoArrangeLineup(formation);
    }
    if (!captainId && starterIds.length > 0) setCaptainId(starterIds[0]);
    if (!viceCaptainId && starterIds.length > 1) setViceCaptainId(starterIds[1]);
    setCurrentStep(4);
  };

  // Step 4 -> Step 5
  const handleProceedToReview = () => {
    if (!captainId || !viceCaptainId || captainId === viceCaptainId) return;
    setCurrentStep(5);
  };

  // Step 5: Atomic confirmation and database save
  const handleConfirmTeam = async () => {
    if (isConfirmingTeam) return;
    setIsConfirmingTeam(true);
    const res = await userDatabase.completeUserOnboarding({
      userId: user.id,
      tournamentId,
      gameweekId,
      teamName,
      province,
      favoriteClubId: favoriteClubId || clubs[0]?.id || '',
      formation,
      starters: starterIds,
      bench: benchIds,
      captainId,
      viceCaptainId,
      budgetRemaining
    });

    if (!res.success) {
      alert(res.error || 'Error al confirmar equipo');
      setIsConfirmingTeam(false);
      return;
    }

    setIsConfirmingTeam(false);
    if (inviteCode) setLeagueMode('join');
    setCurrentStep(6);
  };

  // Step 6: League creation
  const handleCreateLeagueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingLeague) return;
    setIsSubmittingLeague(true);
    setLeagueFeedback(null);
    const acc = userDatabase.getUserAccount(user.id);
    if (!acc) return;

    const res = await leagueService.createLeague({
      userId: user.id,
      team: acc.squad,
      managerName: acc.profile.managerName,
      avatarUrl: acc.profile.avatarUrl,
      leagueName: newLeagueName,
      tournamentId,
    });

    if (!res.success || !res.league) {
      setLeagueFeedback(res.error || 'Error al crear la liga.');
      setIsSubmittingLeague(false);
      return;
    }

    setCreatedLeague(res.league);
    setLeagueFeedback('¡Liga creada con éxito! Comparte el código con tus amigos.');
    setIsSubmittingLeague(false);
  };

  // Step 6: League joining
  const handleJoinLeagueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingLeague) return;
    setIsSubmittingLeague(true);
    setLeagueFeedback(null);
    const acc = userDatabase.getUserAccount(user.id);
    if (!acc) return;

    const res = await leagueService.joinLeague({
      userId: user.id,
      team: acc.squad,
      managerName: acc.profile.managerName,
      avatarUrl: acc.profile.avatarUrl,
      code: joinCodeInput
    });

    if (!res.success || !res.league) {
      setLeagueFeedback(res.error || 'Código de liga inválido.');
      setIsSubmittingLeague(false);
      return;
    }

    setJoinedLeague(res.league);
    setLeagueFeedback(`¡Te has unido exitosamente a "${res.league.name}"!`);
    setIsSubmittingLeague(false);
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col font-sans">
      {/* Top Wizard Bar */}
      <div className="w-full bg-[#161b22] border-b border-white/10 sticky top-0 z-30 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-xs tracking-wider uppercase bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
              Onboarding Fantasy LPF
            </span>
            <span className="text-zinc-500 text-xs">·</span>
            <span className="text-xs font-bold text-zinc-300">Paso {currentStep} de 6</span>
          </div>

          {/* Stepper Dots */}
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5, 6].map(s => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  s === currentStep
                    ? 'w-6 bg-emerald-500'
                    : s < currentStep
                    ? 'w-3 bg-emerald-500/50'
                    : 'w-3 bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Main Step Container */}
      <div className="max-w-4xl mx-auto w-full p-4 flex-1 flex flex-col">
        {/* ================= STEP 1: IDENTIDAD ================= */}
        {currentStep === 1 && (
          <div className="max-w-lg mx-auto w-full py-8 space-y-6">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-4">
                <Shield className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-black">Nombra a tu Club Fantasy</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Este será el nombre con el que competirás en la LPF y en tus ligas de amigos.
              </p>
            </div>

            <div className="bg-[#161b22] p-6 rounded-3xl border border-white/10 space-y-4">
              <div>
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Nombre de tu Equipo
                </label>
                <input
                  type="text"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  placeholder="Ej: Canaleros FC, Marea Roja FC"
                  className="w-full px-3.5 py-3 rounded-xl bg-black/40 border border-white/10 text-white text-sm font-bold focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Club Favorito de la LPF
                </label>
                <select
                  value={favoriteClubId}
                  onChange={e => setFavoriteClubId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-emerald-500 focus:outline-none"
                >
                  {clubs.map(c => (
                    <option key={c.id} value={c.id} className="bg-[#161b22]">
                      {c.name} ({c.shortName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Provincia
                </label>
                <select
                  value={province}
                  onChange={e => setProvince(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-emerald-500 focus:outline-none"
                >
                  {['Panamá', 'Colón', 'Panamá Oeste', 'Chiriquí', 'Herrera', 'Veraguas', 'Coclé', 'Bocas del Toro', 'Los Santos', 'Darién'].map(p => (
                    <option key={p} value={p} className="bg-[#161b22]">
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>
                  Recibirás <strong>$100.0M</strong> de presupuesto oficial para fichar tus 15 futbolistas en el siguiente paso.
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (teamName.trim().length >= 3) {
                    setCurrentStep(2);
                  }
                }}
                disabled={teamName.trim().length < 3}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
              >
                <span>Continuar al Armado de Plantilla</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: CONSTRUCCIÓN DE 15 JUGADORES ================= */}
        {currentStep === 2 && (
          <div className="py-4 flex flex-col gap-4">
            {/* Top Squad Metrics Bar */}
            <div className="bg-[#161b22] border border-white/10 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 sticky top-14 z-20 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Plantilla</span>
                  <span className={`text-base font-black ${selectedPlayerIds.length === 15 ? 'text-emerald-400' : 'text-white'}`}>
                    {selectedPlayerIds.length} / 15
                  </span>
                </div>

                <div className="h-8 w-px bg-white/10" />

                <div>
                  <span className="text-[10px] uppercase font-bold text-zinc-400 block">Presupuesto Restante</span>
                  <span className={`text-base font-black font-mono ${budgetRemaining < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    ${budgetRemaining.toFixed(1)}M
                  </span>
                </div>

                <div className="h-8 w-px bg-white/10" />

                {/* Position Quotas */}
                <div className="flex items-center gap-2 text-xs">
                  <span className={`px-2 py-1 rounded-lg border ${posCounts.GK === 2 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
                    POR: {posCounts.GK}/2
                  </span>
                  <span className={`px-2 py-1 rounded-lg border ${posCounts.DEF === 5 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
                    DEF: {posCounts.DEF}/5
                  </span>
                  <span className={`px-2 py-1 rounded-lg border ${posCounts.MID === 5 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
                    MED: {posCounts.MID}/5
                  </span>
                  <span className={`px-2 py-1 rounded-lg border ${posCounts.FWD === 3 ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
                    DEL: {posCounts.FWD}/3
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-3 py-2 text-xs text-zinc-400 hover:text-white rounded-xl hover:bg-white/5 transition-all cursor-pointer"
                >
                  Atrás
                </button>
                <button
                  type="button"
                  onClick={handleProceedToLineup}
                  disabled={selectedPlayerIds.length !== 15 || budgetRemaining < 0}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <span>Alinear Once Titular</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Split layout: Left My Selection / Right Market Pool */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Selected Players Column */}
              <div className="lg:col-span-5 bg-[#161b22] border border-white/10 rounded-3xl p-4 flex flex-col h-[580px]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Tu Selección ({selectedPlayerIds.length}/15)</span>
                  </h3>
                  <span className="text-[11px] text-zinc-500">Máx 3 por club</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {selectedPlayers.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                      <Users className="w-10 h-10 mb-2 stroke-1 text-zinc-600" />
                      <p className="text-xs font-semibold">Tu plantilla está vacía.</p>
                      <p className="text-[11px] text-zinc-500 mt-1">
                        Selecciona futbolistas del catálogo derecho para completar los 15 requeridos.
                      </p>
                    </div>
                  ) : (
                    selectedPlayers.map(p => (
                      <div
                        key={p.id}
                        className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between hover:border-white/20 transition-all"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className={`w-7 text-center py-0.5 rounded text-[10px] font-black ${
                            p.position === 'GK' ? 'bg-amber-500/20 text-amber-300' :
                            p.position === 'DEF' ? 'bg-blue-500/20 text-blue-300' :
                            p.position === 'MID' ? 'bg-emerald-500/20 text-emerald-300' :
                            'bg-rose-500/20 text-rose-300'
                          }`}>
                            {p.position}
                          </span>
                          <div>
                            <span className="text-xs font-bold text-white block leading-tight">
                              {p.displayName}
                            </span>
                            <span className="text-[10px] text-zinc-400">
                              {p.clubName} · Form: {p.recentForm}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-emerald-400">
                            ${p.price.toFixed(1)}M
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemovePlayer(p.id)}
                            className="w-7 h-7 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition-all cursor-pointer"
                            title="Quitar de la plantilla"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Market Catalog Column */}
              <div className="lg:col-span-7 bg-[#161b22] border border-white/10 rounded-3xl p-4 flex flex-col h-[580px]">
                {/* Search & Filters */}
                <div className="space-y-2.5 mb-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                      <input
                        type="text"
                        value={marketSearch}
                        onChange={e => setMarketSearch(e.target.value)}
                        placeholder="Buscar jugador o club..."
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <select
                      value={marketClub}
                      onChange={e => setMarketClub(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="ALL">Todos los Clubes</option>
                      {clubs.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.shortName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Position Filter Tabs */}
                  <div className="flex gap-1 bg-black/30 p-1 rounded-xl">
                    {(['ALL', 'GK', 'DEF', 'MID', 'FWD'] as const).map(pos => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => setMarketPosition(pos)}
                        className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                          marketPosition === pos
                            ? 'bg-emerald-500 text-black shadow-sm'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {pos === 'ALL' ? 'TODOS' : pos === 'GK' ? 'POR' : pos}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Players List */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {filteredPlayers.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center p-6 text-zinc-500 text-xs">
                      No se encontraron futbolistas con los filtros actuales.
                    </div>
                  ) : (
                    filteredPlayers.map(p => {
                      const maxClubReached = (clubCounts[p.clubId] || 0) >= 3;
                      const maxPos: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
                      const maxPosReached = posCounts[p.position] >= maxPos[p.position];
                      const overBudget = totalSpent + p.price > 100.0;
                      const squadFull = selectedPlayerIds.length >= 15;
                      const cannotAdd = maxClubReached || maxPosReached || overBudget || squadFull;

                      return (
                        <div
                          key={p.id}
                          className="p-2.5 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between hover:border-white/20 transition-all"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`w-7 text-center py-0.5 rounded text-[10px] font-black ${
                              p.position === 'GK' ? 'bg-amber-500/20 text-amber-300' :
                              p.position === 'DEF' ? 'bg-blue-500/20 text-blue-300' :
                              p.position === 'MID' ? 'bg-emerald-500/20 text-emerald-300' :
                              'bg-rose-500/20 text-rose-300'
                            }`}>
                              {p.position}
                            </span>
                            <div>
                              <span className="text-xs font-bold text-white block leading-tight">
                                {p.name}
                              </span>
                              <span className="text-[10px] text-zinc-400">
                                {p.clubName} · {p.totalPoints} pts
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs font-bold text-zinc-300">
                              ${p.price.toFixed(1)}M
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAddPlayer(p)}
                              disabled={cannotAdd}
                              title={
                                maxClubReached ? 'Máximo 3 jugadores de este club' :
                                maxPosReached ? `Cupo de ${p.position} completado` :
                                overBudget ? 'Presupuesto insuficiente' :
                                squadFull ? 'Plantilla de 15 llena' : 'Agregar'
                              }
                              className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs transition-all cursor-pointer ${
                                cannotAdd
                                  ? 'bg-white/5 text-zinc-600 opacity-40 cursor-not-allowed'
                                  : 'bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-black'
                              }`}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 3: FORMACIÓN Y XI TITULAR ================= */}
        {currentStep === 3 && (
          <div className="py-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black">Define tu Once Titular</h2>
                <p className="text-xs text-zinc-400">
                  Toca a un titular en la cancha para mandarlo al banquillo, o a un suplente para que entre en su lugar.
                </p>
              </div>

              {/* Formation Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-zinc-400">Formación:</span>
                <select
                  value={formation}
                  onChange={e => {
                    const f = e.target.value as Formation;
                    setFormation(f);
                    autoArrangeLineup(f);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#161b22] border border-white/10 text-white text-xs font-bold focus:border-emerald-500 focus:outline-none"
                >
                  {['4-3-3', '4-4-2', '3-5-2', '3-4-3', '4-5-1', '5-3-2'].map(f => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Interactive Tactical Football Pitch — same look as the in-game field */}
            <LayoutGroup id="onboarding-pitch">
              <div
                className="relative w-full max-w-[560px] mx-auto rounded-2xl overflow-hidden shadow-2xl bg-surface-container-lowest border border-surface-container-high/40"
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
                  {/* FWD */}
                  <div className="w-full relative flex items-center justify-around">
                    <AnimatePresence mode="popLayout">
                      {starterIds
                        .map(id => playerMap.get(id))
                        .filter((p): p is Player => p?.position === 'FWD')
                        .map(p => (
                          <PitchPlayerCard
                            key={p.id}
                            player={p}
                            isCaptain={false}
                            isVice={false}
                            onSelect={() => swapStarterWithBench(p.id)}
                            onSwap={() => swapStarterWithBench(p.id)}
                          />
                        ))}
                    </AnimatePresence>
                  </div>

                  {/* MID */}
                  <div className="w-full relative flex items-center justify-around px-0.5">
                    <AnimatePresence mode="popLayout">
                      {starterIds
                        .map(id => playerMap.get(id))
                        .filter((p): p is Player => p?.position === 'MID')
                        .map(p => (
                          <PitchPlayerCard
                            key={p.id}
                            player={p}
                            isCaptain={false}
                            isVice={false}
                            onSelect={() => swapStarterWithBench(p.id)}
                            onSwap={() => swapStarterWithBench(p.id)}
                            isCompact={formation.split('-')[1] === '5'}
                          />
                        ))}
                    </AnimatePresence>
                  </div>

                  {/* DEF */}
                  <div className="w-full relative flex items-center justify-around px-1">
                    <AnimatePresence mode="popLayout">
                      {starterIds
                        .map(id => playerMap.get(id))
                        .filter((p): p is Player => p?.position === 'DEF')
                        .map(p => (
                          <PitchPlayerCard
                            key={p.id}
                            player={p}
                            isCaptain={false}
                            isVice={false}
                            onSelect={() => swapStarterWithBench(p.id)}
                            onSwap={() => swapStarterWithBench(p.id)}
                            isCompact={formation.split('-')[0] === '5'}
                          />
                        ))}
                    </AnimatePresence>
                  </div>

                  {/* GK */}
                  <div className="w-full relative flex items-center justify-center">
                    <AnimatePresence mode="popLayout">
                      {starterIds
                        .map(id => playerMap.get(id))
                        .filter((p): p is Player => p?.position === 'GK')
                        .map(p => (
                          <PitchPlayerCard
                            key={p.id}
                            player={p}
                            isCaptain={false}
                            isVice={false}
                            onSelect={() => swapStarterWithBench(p.id)}
                            onSwap={() => swapStarterWithBench(p.id)}
                            showGkBadge
                          />
                        ))}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </LayoutGroup>

            {/* Bench Bar — same photo cards as the in-game bench */}
            <div className="bg-surface-container-low border border-surface-container-high/40 rounded-2xl p-space-sm">
              <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-on-surface-variant block mb-space-xs">
                Banquillo de Suplentes (4 Jugadores)
              </span>
              <motion.div layout className="grid grid-cols-4 gap-space-xs">
                <AnimatePresence mode="popLayout">
                  {benchIds.map((id, idx) => {
                    const p = playerMap.get(id);
                    if (!p) return null;
                    return (
                      <motion.button
                        type="button"
                        layout
                        layoutId={`player-card-${p.id}`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={pitchCardSpringTransition}
                        onClick={() => swapStarterWithBench(p.id)}
                        title="Subir al once titular"
                        key={p.id}
                        className="bench-card flex flex-col items-center p-space-2xs rounded-lg bg-surface-container hover:bg-surface-container-high transition-all active:scale-95 cursor-pointer relative"
                      >
                        <div className="relative">
                          <div className="w-10 h-10 rounded-full bg-surface-container-high overflow-hidden shadow-inner">
                            <img className="w-full h-full object-cover" src={p.imageUrl} alt={p.name} />
                          </div>
                          <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-surface-container-highest text-[9px] font-bold text-on-surface flex items-center justify-center shadow">
                            {idx + 1}
                          </span>
                        </div>
                        <span className="font-headline-sm text-label-md mt-1 truncate w-full text-center text-on-surface">
                          {p.displayName}
                        </span>
                        <div className="flex items-center justify-between w-full font-label-sm text-[9px] mt-0.5 px-0.5">
                          <span className="font-bold text-on-surface-variant">{p.position}</span>
                          <span className="text-primary font-bold">${p.price.toFixed(1)}M</span>
                        </div>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="px-4 py-2.5 text-xs text-zinc-400 hover:text-white rounded-xl hover:bg-white/5 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Modificar 15 Jugadores</span>
              </button>
              <button
                type="button"
                onClick={handleProceedToCaptaincy}
                className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center gap-1.5"
              >
                <span>Designar Capitanes</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 4: CAPITÁN Y VICE-CAPITÁN ================= */}
        {currentStep === 4 && (
          <div className="max-w-xl mx-auto w-full py-8 space-y-6">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-4">
                <Crown className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-black">Elige tu Capitán y Vice-Capitán</h2>
              <p className="text-xs text-zinc-400 mt-1">
                El Capitán sumará el <strong className="text-amber-400">doble de puntos (2x)</strong>. Si no juega ningún minuto, la bonificación pasa al Vice-Capitán.
              </p>
            </div>

            <div className="bg-[#161b22] border border-white/10 rounded-3xl p-6 space-y-4">
              <div>
                <label className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block mb-1 flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5" />
                  <span>Capitán Titular (2x Puntos)</span>
                </label>
                <select
                  value={captainId}
                  onChange={e => setCaptainId(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-xl bg-black/40 border border-amber-500/40 text-white text-xs font-bold focus:border-amber-400 focus:outline-none"
                >
                  <option value="">Selecciona Capitán...</option>
                  {starterIds.map(id => {
                    const p = playerMap.get(id);
                    if (!p) return null;
                    return (
                      <option key={p.id} value={p.id} className="bg-[#161b22]">
                        {p.displayName} ({p.position} · {p.clubName} · Form: {p.recentForm})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5" />
                  <span>Vice-Capitán (Respaldo)</span>
                </label>
                <select
                  value={viceCaptainId}
                  onChange={e => setViceCaptainId(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-xl bg-black/40 border border-white/10 text-white text-xs font-bold focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">Selecciona Vice-Capitán...</option>
                  {starterIds.map(id => {
                    const p = playerMap.get(id);
                    if (!p) return null;
                    return (
                      <option key={p.id} value={p.id} disabled={p.id === captainId} className="bg-[#161b22]">
                        {p.displayName} ({p.position} · {p.clubName}) {p.id === captainId ? '— [Ya es Capitán]' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="flex items-center justify-between pt-4">
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="px-4 py-2.5 text-xs text-zinc-400 hover:text-white rounded-xl hover:bg-white/5 transition-all cursor-pointer"
                >
                  Atrás
                </button>
                <button
                  type="button"
                  onClick={handleProceedToReview}
                  disabled={!captainId || !viceCaptainId || captainId === viceCaptainId}
                  className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <span>Revisar Plantilla</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 5: REVISIÓN FINAL Y CONFIRMACIÓN ================= */}
        {currentStep === 5 && (
          <div className="max-w-xl mx-auto w-full py-6 space-y-6">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-black">Tu Equipo Está Listo</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Revisa los datos de tu club antes de guardar tu registro oficial en la LPF.
              </p>
            </div>

            <div className="bg-[#161b22] border border-white/10 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Club Fantasy</span>
                  <span className="text-lg font-black text-white">{teamName}</span>
                  <span className="text-xs text-emerald-400 block mt-0.5">DT: {user.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Caja Restante</span>
                  <span className="font-mono text-base font-black text-emerald-400">${budgetRemaining.toFixed(1)}M</span>
                  <span className="text-[11px] text-zinc-500 block">Formación: {formation}</span>
                </div>
              </div>

              {/* Captain & Vice Badges */}
              <div className="grid grid-cols-2 gap-3 py-2">
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-2.5">
                  <Crown className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <span className="text-[10px] uppercase font-bold text-amber-400 block">Capitán (2x)</span>
                    <span className="text-xs font-bold text-white truncate">
                      {playerMap.get(captainId)?.displayName || 'No asignado'}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-2.5">
                  <Award className="w-5 h-5 text-zinc-400 shrink-0" />
                  <div>
                    <span className="text-[10px] uppercase font-bold text-zinc-400 block">Vice-Capitán</span>
                    <span className="text-xs font-bold text-white truncate">
                      {playerMap.get(viceCaptainId)?.displayName || 'No asignado'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status List */}
              <div className="space-y-2 text-xs text-zinc-300">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>15 Jugadores registrados reglamentariamente</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Máximo 3 jugadores por club cumplido</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Presupuesto dentro del límite de $100.0M</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setCurrentStep(4)}
                  className="px-4 py-2.5 text-xs text-zinc-400 hover:text-white rounded-xl hover:bg-white/5 transition-all cursor-pointer"
                >
                  Atrás
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTeam}
                  disabled={isConfirmingTeam}
                  className="px-6 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-xl shadow-emerald-500/25 active:scale-95 flex items-center gap-2"
                >
                  <span>{isConfirmingTeam ? 'Guardando Equipo…' : 'Confirmar Mi Equipo'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 6: COMPITE CON TUS AMIGOS ================= */}
        {currentStep === 6 && (
          <div className="max-w-xl mx-auto w-full py-8 space-y-6">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 mx-auto mb-4">
                <Users className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-black">¡Equipo Registrado! Ahora Compite</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Tu Fantasy Team <strong>{teamName}</strong> ya está activo. Crea una liga privada para retar a tus amigos o únete con un código.
              </p>
            </div>

            {leagueFeedback && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
                <span>{leagueFeedback}</span>
              </div>
            )}

            {/* Created League Box */}
            {createdLeague && (
              <div className="p-5 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 block">
                  Liga Creada: {createdLeague.name}
                </span>
                <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-black/60 border border-emerald-500/40">
                  <span className="font-mono text-2xl font-black text-white tracking-widest">
                    {createdLeague.code}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(createdLeague.code)}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
                    title="Copiar código de liga"
                  >
                    {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Pásale este código a tus amigos para que se unan a tu tabla de clasificación.
                </p>
              </div>
            )}

            {/* Main Action Cards */}
            {!createdLeague && !joinedLeague && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Create League Option */}
                <div
                  onClick={() => setLeagueMode('create')}
                  className={`p-6 rounded-3xl border transition-all cursor-pointer flex flex-col items-center text-center ${
                    leagueMode === 'create'
                      ? 'bg-emerald-500/10 border-emerald-500/40 ring-2 ring-emerald-500/30'
                      : 'bg-[#161b22] border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
                    <Plus className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-sm text-white mb-1">Crear una Liga</h3>
                  <p className="text-xs text-zinc-400">
                    Genera un código único de 6 caracteres e invita a tu grupo.
                  </p>
                </div>

                {/* Join League Option */}
                <div
                  onClick={() => setLeagueMode('join')}
                  className={`p-6 rounded-3xl border transition-all cursor-pointer flex flex-col items-center text-center ${
                    leagueMode === 'join'
                      ? 'bg-teal-500/10 border-teal-500/40 ring-2 ring-teal-500/30'
                      : 'bg-[#161b22] border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-teal-500/20 text-teal-400 flex items-center justify-center mb-3">
                    <Users className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-sm text-white mb-1">Unirme a una Liga</h3>
                  <p className="text-xs text-zinc-400">
                    Ingresa el código que te compartieron tus amigos.
                  </p>
                </div>
              </div>
            )}

            {/* Create Form */}
            {leagueMode === 'create' && !createdLeague && (
              <form onSubmit={handleCreateLeagueSubmit} className="bg-[#161b22] p-5 rounded-3xl border border-white/10 space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Nombre de tu Liga Privada
                  </label>
                  <input
                    type="text"
                    required
                    value={newLeagueName}
                    onChange={e => setNewLeagueName(e.target.value)}
                    placeholder="Ej: Amigos del Trabajo, Torneo Chiriquí"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmittingLeague}
                  className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md active:scale-95"
                >
                  {isSubmittingLeague ? 'Creando Liga…' : 'Generar Código de Invitación'}
                </button>
              </form>
            )}

            {/* Join Form */}
            {leagueMode === 'join' && !joinedLeague && (
              <form onSubmit={handleJoinLeagueSubmit} className="bg-[#161b22] p-5 rounded-3xl border border-white/10 space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                    Código de Invitación (6 Caracteres)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={joinCodeInput}
                    onChange={e => setJoinCodeInput(e.target.value.toUpperCase())}
                    placeholder="Ej: G7K9LP"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs font-mono font-bold tracking-widest uppercase focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmittingLeague}
                  className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md active:scale-95"
                >
                  {isSubmittingLeague ? 'Uniéndome…' : 'Unirse con este Código'}
                </button>
              </form>
            )}

            {/* Final Action */}
            <div className="pt-4 text-center">
              <button
                type="button"
                onClick={onComplete}
                className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-xl shadow-emerald-500/25 active:scale-95"
              >
                Ir a Mi Panel de Mánager (Dashboard)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
