import React, { useState, useMemo, useEffect, useRef } from 'react';
import { LeagueMember, Player, Formation, FantasyTeam } from '../../types/fantasy';
import { RivalSquadModal } from '../modals/RivalSquadModal';
import { leagueService, PrivateLeagueRecord } from '../../services/leagueService';
import {
  Users,
  Plus,
  Copy,
  Check,
  Share2,
  Trophy,
  Shield,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react';

interface ClasificacionViewProps {
  allPlayers?: Player[];
  onOpenPlayerDetail?: (player: Player) => void;
  onGoToMyTeam?: () => void;
  currentUserId?: string;
  userTeam?: FantasyTeam;
  userAvatarUrl?: string;
  managerName?: string;
  tournamentId?: string;
  inviteCode?: string;
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

export const ClasificacionView: React.FC<ClasificacionViewProps> = ({
  allPlayers = [],
  onOpenPlayerDetail = (_p: Player) => {},
  onGoToMyTeam,
  currentUserId = '',
  userTeam,
  userAvatarUrl,
  managerName,
  tournamentId = '',
  inviteCode = '',
  userSquadOverride
}) => {
  const [leagues, setLeagues] = useState<PrivateLeagueRecord[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'total' | 'jornada'>('total');
  const [copiedCode, setCopiedCode] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [inputCode, setInputCode] = useState(inviteCode);
  const [newLeagueNameInput, setNewLeagueNameInput] = useState('');
  const [feedbackToast, setFeedbackToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedMember, setSelectedMember] = useState<LeagueMember | null>(null);
  const [leaderboardMembers, setLeaderboardMembers] = useState<LeagueMember[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(true);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [isSubmittingLeague, setIsSubmittingLeague] = useState(false);
  const inviteHandled = useRef(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setFeedbackToast({ message, type });
    setTimeout(() => {
      setFeedbackToast(previous => (previous?.message === message ? null : previous));
    }, 3000);
  };

  // Reload user's leagues from leagueService
  const refreshLeagues = async () => {
    if (!currentUserId || !tournamentId) return;
    setIsLoadingLeagues(true);
    setLeagueError(null);
    try {
      const userLeagues = await leagueService.loadUserLeagues(tournamentId);
      setLeagues(userLeagues);
      if (userLeagues.length > 0 && (!selectedLeagueId || !userLeagues.some(l => l.id === selectedLeagueId))) {
        setSelectedLeagueId(userLeagues[0].id);
      }
    } catch (error) {
      setLeagueError(error instanceof Error ? error.message : 'No se pudieron cargar tus ligas.');
    } finally {
      setIsLoadingLeagues(false);
    }
  };

  useEffect(() => {
    void refreshLeagues();
  }, [currentUserId, tournamentId]);

  useEffect(() => {
    if (!inviteHandled.current && inviteCode) {
      inviteHandled.current = true;
      setInputCode(inviteCode);
      setIsJoinModalOpen(true);
    }
  }, [inviteCode]);

  const activeLeague = useMemo(() => {
    return leagues.find(l => l.id === selectedLeagueId) || leagues[0] || null;
  }, [leagues, selectedLeagueId]);

  useEffect(() => {
    if (!activeLeague || !currentUserId) { setLeaderboardMembers([]); return; }
    let active = true;
    setIsLoadingLeaderboard(true);
    setLeagueError(null);
    void leagueService.getLeaderboard(activeLeague.id, currentUserId)
      .then(members => { if (active) setLeaderboardMembers(members); })
      .catch(error => { if (active) { setLeaderboardMembers([]); setLeagueError(error instanceof Error ? error.message : 'No se pudo cargar la clasificación.'); } })
      .finally(() => { if (active) setIsLoadingLeaderboard(false); });
    return () => { active = false; };
  }, [activeLeague, currentUserId, userSquadOverride]);

  // Sort based on current view mode
  const sortedMembers = useMemo(() => {
    const list = [...leaderboardMembers];
    if (viewMode === 'jornada') {
      list.sort((a, b) => b.gwPoints - a.gwPoints);
    } else {
      list.sort((a, b) => b.totalPoints - a.totalPoints);
    }
    list.forEach((m, idx) => {
      m.position = idx + 1;
    });
    return list;
  }, [leaderboardMembers, viewMode]);

  const currentUserMember = sortedMembers.find(m => m.isCurrentUser);
  const leader = sortedMembers[0];
  const userRank = currentUserMember ? currentUserMember.position : 1;
  const ptsToLeader = leader && currentUserMember ? leader.totalPoints - currentUserMember.totalPoints : 0;

  const handleCopy = () => {
    if (!activeLeague) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(activeLeague.code);
    }
    setCopiedCode(true);
    showToast(`¡Código ${activeLeague.code} copiado al portapapeles!`);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleShare = () => {
    if (!activeLeague) return;
    if (navigator.share) {
      navigator.share({
        title: activeLeague.name,
        text: `¡Únete a mi liga privada en Fantasy LPF! Código: ${activeLeague.code}`,
        url: `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(activeLeague.code)}`
      }).catch(() => handleCopy());
    } else {
      handleCopy();
    }
  };

  const handleJoinLeague = async () => {
    if (isSubmittingLeague || !inputCode.trim() || !userTeam || !currentUserId) return;
    setIsSubmittingLeague(true);
    const cleanCode = inputCode.trim().toUpperCase().replace(/^#/, '');

    const res = await leagueService.joinLeague({
      userId: currentUserId,
      team: userTeam,
      managerName: managerName || userTeam.managerName,
      avatarUrl: userAvatarUrl || '',
      code: cleanCode
    });

    if (!res.success || !res.league) {
      showToast(res.error || 'Código no encontrado.', 'error');
      setIsSubmittingLeague(false);
      return;
    }

    setIsJoinModalOpen(false);
    setInputCode('');
    await refreshLeagues();
    setSelectedLeagueId(res.league.id);
    showToast(`¡Te has unido exitosamente a "${res.league.name}"!`);
    setIsSubmittingLeague(false);
  };

  const handleCreateLeague = async () => {
    if (isSubmittingLeague || !newLeagueNameInput.trim() || !userTeam || !currentUserId) return;
    setIsSubmittingLeague(true);

    const res = await leagueService.createLeague({
      userId: currentUserId,
      team: userTeam,
      managerName: managerName || userTeam.managerName,
      avatarUrl: userAvatarUrl || '',
      leagueName: newLeagueNameInput.trim(),
      tournamentId,
    });

    if (!res.success || !res.league) {
      showToast(res.error || 'Error al crear la liga.', 'error');
      setIsSubmittingLeague(false);
      return;
    }

    setIsCreateModalOpen(false);
    setNewLeagueNameInput('');
    await refreshLeagues();
    setSelectedLeagueId(res.league.id);
    showToast(`¡Liga "${res.league.name}" creada con código ${res.league.code}!`);
    setIsSubmittingLeague(false);
  };

  return (
    <div className="flex flex-col w-full px-4 gap-4 pb-32 pt-2">
      {/* Toast Feedback */}
      {feedbackToast && (
        <div role={feedbackToast.type === 'error' ? 'alert' : 'status'} className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider shadow-2xl border flex items-center gap-2 ${feedbackToast.type === 'error' ? 'bg-rose-950 text-rose-100 border-rose-400/60' : 'bg-[#161b22] text-emerald-400 border-emerald-500/40'}`}>
          <span className="material-symbols-outlined text-[17px]">{feedbackToast.type === 'error' ? 'cancel' : 'check_circle'}</span>
          <span>{feedbackToast.message}</span>
        </div>
      )}

      {leagueError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 flex items-center justify-between gap-3">
          <span>{leagueError}</span>
          <button type="button" onClick={() => void refreshLeagues()} className="font-bold uppercase">Reintentar</button>
        </div>
      )}

      {/* If User has 0 private leagues: Show Clean Empty State */}
      {isLoadingLeagues ? (
        <div className="w-full p-8 text-center text-sm text-zinc-400">Cargando tus ligas…</div>
      ) : leagues.length === 0 ? (
        <div className="w-full bg-[#161b22] border border-white/10 rounded-3xl p-8 text-center flex flex-col items-center max-w-md mx-auto my-6 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-2">
            <Users className="w-8 h-8" />
          </div>

          <h2 className="text-xl font-black text-white">Ligas Privadas</h2>
          <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
            Aún no perteneces a ninguna liga privada. Crea tu propio torneo con amigos o únete con un código de invitación.
          </p>

          <div className="w-full space-y-2.5 pt-2">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Crear una Liga Privada</span>
            </button>
            <button
              onClick={() => setIsJoinModalOpen(true)}
              className="w-full py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Users className="w-4 h-4 text-teal-400" />
              <span>Unirme con Código</span>
            </button>
          </div>
        </div>
      ) : (
        /* If User has leagues: Show full active league dashboard */
        <>
          {/* League Selector (if member of multiple leagues) */}
          {leagues.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {leagues.map(l => (
                <button
                  key={l.id}
                  onClick={() => setSelectedLeagueId(l.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    l.id === activeLeague?.id
                      ? 'bg-emerald-500 text-black shadow-md'
                      : 'bg-[#161b22] border border-white/10 text-zinc-400 hover:text-white'
                  }`}
                >
                  {l.name}
                </button>
              ))}
            </div>
          )}

          {/* League Header Card */}
          {activeLeague && (
            <div className="flex flex-col w-full rounded-3xl bg-[#161b22] p-5 gap-3 border border-white/10 shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 truncate">
                      <h1 className="text-base font-black uppercase text-white truncate">
                        {activeLeague.name}
                      </h1>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full shrink-0">
                        PRIVADA
                      </span>
                    </div>
                    <span className="text-xs text-zinc-400 mt-0.5 truncate">
                      {activeLeague.memberCount ?? activeLeague.members.length} {(activeLeague.memberCount ?? activeLeague.members.length) === 1 ? 'miembro' : 'miembros'}
                    </span>
                  </div>
                </div>

                {/* Share / Invite Button */}
                <button
                  onClick={handleShare}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs uppercase tracking-wider shadow-sm active:scale-95 transition-all shrink-0 cursor-pointer"
                  title="Compartir código"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copiado' : 'Invitar'}</span>
                </button>
              </div>

              {/* League Code Box */}
              <div className="flex items-center justify-between bg-black/40 rounded-2xl px-3.5 py-2 border border-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                    Código de Invitación:
                  </span>
                  <span className="font-mono font-black text-emerald-400 tracking-widest text-sm">
                    {activeLeague.code}
                  </span>
                </div>

                <button
                  onClick={handleCopy}
                  className="text-zinc-400 hover:text-emerald-400 transition-colors flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar</span>
                </button>
              </div>

              {/* Quick Actions (Create another or Join another) */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => setIsJoinModalOpen(true)}
                  className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer text-center"
                >
                  Unirme a Otra Liga
                </button>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer text-center"
                >
                  Crear Otra Liga
                </button>
              </div>
            </div>
          )}

          {/* User Ranking Summary Card */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-[#161b22] to-teal-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500 text-black font-black text-sm flex items-center justify-center shadow-md">
                #{userRank}
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  {currentUserMember?.teamName || userTeam?.name || 'Tu Equipo'}
                </span>
                <span className="text-[11px] text-zinc-400">
                  {currentUserMember?.totalPoints ?? 0} pts acumulados
                </span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                Diferencia con Líder
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                {ptsToLeader === 0 ? '¡Eres el líder!' : `-${ptsToLeader} pts`}
              </span>
            </div>
          </div>

          {/* View Mode Switcher (Total vs Jornada) */}
          <div className="flex bg-[#161b22] p-1 rounded-2xl border border-white/10">
            <button
              onClick={() => setViewMode('total')}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'total'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Clasificación General (Total)
            </button>
            <button
              onClick={() => setViewMode('jornada')}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'jornada'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Puntos Última Jornada
            </button>
          </div>

          {/* Leaderboard Table */}
          <div className="bg-[#161b22] border border-white/10 rounded-3xl overflow-hidden shadow-lg">
            <div className="p-3.5 border-b border-white/10 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              <div className="flex items-center gap-3">
                <span className="w-6 text-center">Pos</span>
                <span>Mánager / Equipo</span>
              </div>
              <div className="flex items-center gap-6 pr-2">
                <span className="w-12 text-right">Jornada</span>
                <span className="w-12 text-right">Total</span>
              </div>
            </div>

            <div className="divide-y divide-white/5">
              {isLoadingLeaderboard ? (
                <div className="p-6 text-center text-xs text-zinc-400">Cargando clasificación…</div>
              ) : sortedMembers.map((member, idx) => (
                <div
                  key={member.id || member.managerName + idx}
                  onClick={() => member.starters?.length ? setSelectedMember(member) : undefined}
                  className={`p-3.5 flex items-center justify-between transition-colors ${member.starters?.length ? 'cursor-pointer hover:bg-white/[0.04]' : ''} ${
                    member.isCurrentUser ? 'bg-emerald-500/10 border-l-4 border-l-emerald-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-6 text-center font-black text-xs ${
                      member.position === 1 ? 'text-amber-400' :
                      member.position === 2 ? 'text-zinc-300' :
                      member.position === 3 ? 'text-amber-600' : 'text-zinc-500'
                    }`}>
                      {member.position}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-xs font-bold text-white truncate">
                          {member.teamName}
                        </span>
                        {member.isCurrentUser && (
                          <span className="text-[10px] bg-emerald-500 text-black font-black px-1.5 py-0.2 rounded shrink-0">
                            TÚ
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400 block truncate">
                        {member.managerName}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 pr-2">
                    <span className="w-12 text-right font-mono text-xs text-zinc-400">
                      {member.gwPoints} pts
                    </span>
                    <span className="w-12 text-right font-mono text-xs font-black text-emerald-400">
                      {member.totalPoints}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Modal: Join League with Code */}
      {isJoinModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#161b22] border border-white/10 rounded-3xl p-6 space-y-4 text-white">
            <h3 className="text-base font-extrabold uppercase">Unirme a una Liga Privada</h3>
            <p className="text-xs text-zinc-400">
              Introduce el código de 6 caracteres que te compartió el creador de la liga.
            </p>

            <input
              type="text"
              maxLength={10}
              value={inputCode}
              onChange={e => setInputCode(e.target.value.toUpperCase())}
              placeholder="Ej: G7K9LP"
              className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white font-mono font-black text-center tracking-widest text-lg focus:border-emerald-500 focus:outline-none uppercase"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsJoinModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 font-bold text-xs transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleJoinLeague}
                disabled={!inputCode.trim() || isSubmittingLeague}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmittingLeague ? 'Uniéndome…' : 'Unirme'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create League */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#161b22] border border-white/10 rounded-3xl p-6 space-y-4 text-white">
            <h3 className="text-base font-extrabold uppercase">Crear Liga Privada</h3>
            <p className="text-xs text-zinc-400">
              Se creará un código único para que tus amigos puedan unirse con su Fantasy Team.
            </p>

            <div>
              <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Nombre de la Liga
              </label>
              <input
                type="text"
                value={newLeagueNameInput}
                onChange={e => setNewLeagueNameInput(e.target.value)}
                placeholder="Ej: Liga de Amigos LPF"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 font-bold text-xs transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateLeague}
                disabled={newLeagueNameInput.trim().length < 3 || isSubmittingLeague}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40"
              >
                {isSubmittingLeague ? 'Creando…' : 'Crear Liga'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Rival Squad */}
      {selectedMember && (
        <RivalSquadModal
          member={selectedMember}
          allPlayers={allPlayers}
          onClose={() => setSelectedMember(null)}
          onOpenPlayerDetail={p => {
            setSelectedMember(null);
            onOpenPlayerDetail(p);
          }}
          onGoToMyTeam={onGoToMyTeam}
          userSquadOverride={userSquadOverride}
        />
      )}
    </div>
  );
};
