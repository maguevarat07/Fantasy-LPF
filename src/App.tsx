import React, { useState, useMemo, useEffect } from 'react';
import { Header } from './components/Header';
import { BottomNav, TabKey } from './components/BottomNav';
import { EquipoView } from './components/views/EquipoView';
import { DashboardView } from './components/views/DashboardView';
import { MercadoView } from './components/views/MercadoView';
import { FichajesView } from './components/views/FichajesView';
import { ClasificacionView } from './components/views/ClasificacionView';
import { LandingView } from './components/views/LandingView';

import { AuthModal } from './components/auth/AuthModal';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { CanonicalAuditModal } from './components/modals/CanonicalAuditModal';

import { PlayerDetailModal } from './components/modals/PlayerDetailModal';
import { CaptainModal } from './components/modals/CaptainModal';
import { SubstitutionModal } from './components/modals/SubstitutionModal';
import { MarketFiltersModal, MarketFilterValues } from './components/modals/MarketFiltersModal';
import { ConfirmOperationModal } from './components/modals/ConfirmOperationModal';
import { ComodinesModal } from './components/modals/ComodinesModal';
import { PresupuestoModal } from './components/modals/PresupuestoModal';
import { ReglasModal } from './components/modals/ReglasModal';
import { CanonicalDataModal } from './components/modals/CanonicalDataModal';
import { GameweekStatusModal } from './components/modals/GameweekStatusModal';
import { ManagerProfileModal } from './components/modals/ManagerProfileModal';

import { Player, Formation, FantasyTeam, TransferHistoryRecord, UserProfile, UserAccountData, ChipId } from './types/fantasy';
import { createNewUserAccount, userDatabase } from './services/userDatabase';
import { authService, AuthUser } from './services/authService';
import { lpfDataService, type ApiMatch } from './services/lpfDataService';
import { ApiError } from './services/apiClient';
import { arrangeLineupForFormation } from './domain/lineupFormation';

export default function App() {
  const inviteCode = useMemo(() => new URLSearchParams(window.location.search).get('join')?.trim().toUpperCase() ?? '', []);
  const initialAccount = useMemo(() => createNewUserAccount({
    id: '', name: '', username: '', email: '', createdAt: new Date(0).toISOString(),
  }), []);
  // Current Authenticated User
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [tournamentId, setTournamentId] = useState('');
  const [gameweekId, setGameweekId] = useState('current');
  const [deadlinePassed, setDeadlinePassed] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signup');
  const [isCanonicalAuditOpen, setIsCanonicalAuditOpen] = useState(false);

  // Active navigation tab
  const [currentTab, setCurrentTab] = useState<TabKey>('equipo');

  const [currentUserAccount, setCurrentUserAccount] = useState<UserAccountData>(initialAccount);

  const [team, setTeam] = useState<FantasyTeam>(initialAccount.squad);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [isRefreshingMatches, setIsRefreshingMatches] = useState(false);
  const [matchesUpdatedAt, setMatchesUpdatedAt] = useState<Date | null>(null);
  const [transferHistory, setTransferHistory] = useState<TransferHistoryRecord[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>(initialAccount.profile);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const catalog = await lpfDataService.loadCatalog();
        if (!active) return;
        setPlayers(lpfDataService.getAllPlayers());
        if (!catalog.tournament) {
          setStartupError('La base canónica todavía no contiene un torneo activo. Ejecuta la sincronización LPF.');
          return;
        }
        const nextTournamentId = catalog.tournament.id;
        const nextGameweekId = catalog.currentGameweek?.id || 'current';
        setTournamentId(nextTournamentId);
        setGameweekId(nextGameweekId);
        setCurrentGameweek(catalog.currentGameweek?.weekNumber ?? null);
        setDeadlinePassed(!catalog.currentGameweek || catalog.currentGameweek.status !== 'OPEN' ||
          !catalog.currentGameweek.deadlineAt || Date.parse(catalog.currentGameweek.deadlineAt) <= Date.now());
        const user = await authService.restoreSession();
        if (!active || !user) return;
        await userDatabase.loadUserAccount(user, nextTournamentId, nextGameweekId);
        const account = await userDatabase.loadGameState(nextTournamentId, nextGameweekId);
        if (!active) return;
        const readyUser = { ...user, onboardingCompleted: userDatabase.isUserOnboardingComplete(user.id) };
        setMatches(await lpfDataService.loadMatches(nextTournamentId, nextGameweekId));
        setCurrentUser(readyUser);
        setCurrentUserAccount(account); setTeam(account.squad); setTransferHistory(account.transferHistory); setUserProfile(account.profile);
        setLastSavedLineup({ starters: [...account.squad.starters], bench: [...account.squad.bench], formation: account.squad.formation, captainId: account.squad.captainId, viceCaptainId: account.squad.viceCaptainId });
      } catch (error) {
        if (active) setStartupError(error instanceof Error ? error.message : 'No se pudo iniciar Fantasy LPF.');
      } finally { if (active) setIsBooting(false); }
    })();
    return () => { active = false; };
  }, []);

  // Last saved lineup baseline (to detect real tactical changes)
  const [lastSavedLineup, setLastSavedLineup] = useState<{
    starters: string[];
    bench: string[];
    formation: Formation;
    captainId: string;
    viceCaptainId: string;
  }>({
    starters: [...currentUserAccount.squad.starters],
    bench: [...currentUserAccount.squad.bench],
    formation: currentUserAccount.squad.formation,
    captainId: currentUserAccount.squad.captainId,
    viceCaptainId: currentUserAccount.squad.viceCaptainId
  });

  // Calculate if there are actual differences between current lineup and last saved state
  const hasLineupChanges = useMemo(() => {
    if (team.formation !== lastSavedLineup.formation) return true;
    if (team.captainId !== lastSavedLineup.captainId) return true;
    if (team.viceCaptainId !== lastSavedLineup.viceCaptainId) return true;
    if (team.starters.length !== lastSavedLineup.starters.length) return true;
    for (let i = 0; i < team.starters.length; i++) {
      if (team.starters[i] !== lastSavedLineup.starters[i]) return true;
    }
    if (team.bench.length !== lastSavedLineup.bench.length) return true;
    for (let i = 0; i < team.bench.length; i++) {
      if (team.bench[i] !== lastSavedLineup.bench[i]) return true;
    }
    return false;
  }, [team.formation, team.captainId, team.viceCaptainId, team.starters, team.bench, lastSavedLineup]);

  const handleSaveLineup = async () => {
    const squadUpdate = {
      starters: [...team.starters],
      bench: [...team.bench],
      formation: team.formation,
      captainId: team.captainId,
      viceCaptainId: team.viceCaptainId
    };
    try {
      const updatedAcc = await userDatabase.updateUserSquad(currentUserAccount.id, squadUpdate, tournamentId, gameweekId);
      setLastSavedLineup(squadUpdate); setCurrentUserAccount(updatedAcc); setTeam(updatedAcc.squad);
      showToast('¡Cambios guardados con éxito en tu alineación!');
    } catch (error) { showToast(error instanceof Error ? error.message : 'No se pudo guardar la alineación.', 'error'); }
  };

  // Modals state
  const [selectedPlayerForDetail, setSelectedPlayerForDetail] = useState<Player | null>(null);
  const [playerForSub, setPlayerForSub] = useState<Player | null>(null);
  const [playerForPurchase, setPlayerForPurchase] = useState<Player | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isCaptainModalOpen, setIsCaptainModalOpen] = useState(false);
  const [isFiltersModalOpen, setIsFiltersModalOpen] = useState(false);
  const [isComodinesModalOpen, setIsComodinesModalOpen] = useState(false);
  const [isPresupuestoModalOpen, setIsPresupuestoModalOpen] = useState(false);
  const [isReglasModalOpen, setIsReglasModalOpen] = useState(false);
  const [isCanonicalModalOpen, setIsCanonicalModalOpen] = useState(false);
  const [currentGameweek, setCurrentGameweek] = useState<number | null>(null);
  const [isGameweekModalOpen, setIsGameweekModalOpen] = useState(false);

  // Active filters from modal
  const [activeFilters, setActiveFilters] = useState<MarketFilterValues | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(previous => (previous?.message === message ? null : previous));
    }, 3000);
  };

  const refreshMatches = async (silent = false) => {
    if (!tournamentId) return;
    if (!silent) setIsRefreshingMatches(true);
    try {
      setMatches(await lpfDataService.loadMatches(tournamentId, gameweekId));
      setMatchesUpdatedAt(new Date());
    } catch (error) {
      if (!silent) showToast(error instanceof Error ? error.message : 'No se pudieron actualizar los partidos.', 'error');
    } finally {
      if (!silent) setIsRefreshingMatches(false);
    }
  };

  // Refetch fixtures whenever the jornadas tab is opened, then keep polling while it stays open
  // so a score confirmed by the canonical sync shows up without needing a full page reload.
  useEffect(() => {
    if (currentTab !== 'jornadas' || !tournamentId) return;
    void refreshMatches(true);
    const interval = setInterval(() => void refreshMatches(true), 60_000);
    return () => clearInterval(interval);
  }, [currentTab, tournamentId, gameweekId]);

  const handleSaveProfile = async (updated: UserProfile) => {
    try {
      const updatedAcc = await userDatabase.updateUserProfile(currentUserAccount.id, updated);
      setUserProfile(updatedAcc.profile); setCurrentUserAccount(updatedAcc);
      setTeam(prev => ({ ...prev, managerName: updated.managerName }));
      showToast('¡Perfil de mánager actualizado con éxito!');
    } catch (error) { showToast(error instanceof Error ? error.message : 'No se pudo actualizar el perfil.', 'error'); }
  };

  const handleLogout = async () => {
    await authService.signOut();
    userDatabase.clear();
    setCurrentUser(null);
    setIsProfileModalOpen(false);
    showToast('Has cerrado sesión en Fantasy LPF');
  };

  const handleAuthSuccess = async (user: AuthUser) => {
    try {
      if (!tournamentId) throw new Error('No hay un torneo activo disponible.');
      let acc = await userDatabase.loadUserAccount(user, tournamentId, gameweekId);
      if (acc.squad.id) acc = await userDatabase.loadGameState(tournamentId, gameweekId);
      setMatches(await lpfDataService.loadMatches(tournamentId, gameweekId));
      const readyUser = { ...user, onboardingCompleted: userDatabase.isUserOnboardingComplete(user.id) };
      setCurrentUser(readyUser); setCurrentUserAccount(acc); setTeam(acc.squad);
      setTransferHistory(acc.transferHistory); setUserProfile(acc.profile); setIsAuthModalOpen(false);
      showToast(readyUser.onboardingCompleted ? `¡Bienvenido de vuelta, ${user.name}!` : '¡Cuenta creada! Comencemos el armado de tu plantilla.');
    } catch (error) { showToast(error instanceof Error ? error.message : 'No se pudo cargar la cuenta.', 'error'); }
  };

  const handleOnboardingComplete = async () => {
    if (!currentUser) return;
    await userDatabase.loadUserAccount(currentUser, tournamentId, gameweekId);
    const acc = await userDatabase.loadGameState(tournamentId, gameweekId);
    setMatches(await lpfDataService.loadMatches(tournamentId, gameweekId));
    setCurrentUser({ ...currentUser, onboardingCompleted: true });
    setCurrentUserAccount(acc); setTeam(acc.squad); setTransferHistory(acc.transferHistory); setUserProfile(acc.profile);
    setCurrentTab('equipo');
    showToast('¡Plantilla confirmada! Bienvenido a la Liga Panameña de Fútbol.');
  };

  const playersWithEconomy = useMemo(() => {
    const ownership = currentUserAccount.ownedPlayerEconomy ?? {};
    return players.map(player => {
      const owned = ownership[player.id];
      if (!owned) return player;
      const currentPrice = owned.currentPrice ?? player.currentPrice ?? player.price;
      return {
        ...player,
        price: currentPrice,
        currentPrice,
        purchasePrice: owned.purchasePrice,
        sellingPrice: owned.sellingPrice,
        priceChange: owned.priceChange ?? player.priceChange,
      };
    });
  }, [players, currentUserAccount.ownedPlayerEconomy]);

  // Map of all players by ID
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    playersWithEconomy.forEach(p => map.set(p.id, p));
    return map;
  }, [playersWithEconomy]);

  // Map of all clubs by ID, for rendering crests on the fixtures list
  const clubById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof lpfDataService.getClubs>[number]>();
    lpfDataService.getClubs().forEach(c => map.set(c.id, c));
    return map;
  }, [players]);

  // Starters and bench objects
  const starters = useMemo(() => {
    return team.starters.map(id => playerMap.get(id)).filter((p): p is Player => !!p);
  }, [team.starters, playerMap]);

  const bench = useMemo(() => {
    return team.bench.map(id => playerMap.get(id)).filter((p): p is Player => !!p);
  }, [team.bench, playerMap]);

  const allSquadPlayers = useMemo(() => [...starters, ...bench], [starters, bench]);

  const captainPlayer = useMemo(() => playerMap.get(team.captainId), [team.captainId, playerMap]);
  const vicePlayer = useMemo(() => playerMap.get(team.viceCaptainId), [team.viceCaptainId, playerMap]);

  // Total pitch budget calculation
  const totalPitchBudget = useMemo(() => {
    return starters.reduce((acc, p) => acc + p.price, 0);
  }, [starters]);

  // Filtered players for market if activeFilters are applied
  const marketPlayers = useMemo(() => {
    if (!activeFilters) return playersWithEconomy;
    return playersWithEconomy.filter(p => {
      if (activeFilters.position !== 'ALL' && p.position !== activeFilters.position) return false;
      if (p.price > activeFilters.maxPrice) return false;
      if (activeFilters.clubId !== 'ALL' && p.clubId !== activeFilters.clubId) return false;
      if (activeFilters.excludeInjured && p.status === 'INJURED') return false;
      if (activeFilters.onlyStarters && p.matchesPlayed === 0) return false;
      if (activeFilters.highFormOnly && p.recentForm < 6.0) return false;
      return true;
    }).sort((a, b) => {
      if (activeFilters.sortBy === 'precio') return b.price - a.price;
      if (activeFilters.sortBy === 'forma') return b.recentForm - a.recentForm;
      return b.totalPoints - a.totalPoints;
    });
  }, [playersWithEconomy, activeFilters]);

  // Handle tactical substitution
  const handleConfirmSub = (outPlayer: Player, inPlayer: Player) => {
    setTeam(prev => {
      const isOutStarter = prev.starters.includes(outPlayer.id);
      let newStarters = [...prev.starters];
      let newBench = [...prev.bench];

      if (isOutStarter) {
        newStarters = newStarters.map(id => (id === outPlayer.id ? inPlayer.id : id));
        newBench = newBench.map(id => (id === inPlayer.id ? outPlayer.id : id));
      } else {
        newBench = newBench.map(id => (id === outPlayer.id ? inPlayer.id : id));
        newStarters = newStarters.map(id => (id === inPlayer.id ? outPlayer.id : id));
      }

      return {
        ...prev,
        starters: newStarters,
        bench: newBench
      };
    });
    setPlayerForSub(null);
    showToast(`Cambio táctico: Entra ${inPlayer.displayName}, sale ${outPlayer.displayName}`);
  };

  // Handle captaincy selection
  const handleSaveCaptaincy = (capId: string, viceId: string) => {
    setTeam(prev => ({
      ...prev,
      captainId: capId,
      viceCaptainId: viceId
    }));
    setIsCaptainModalOpen(false);
    showToast('Capitán y Vice-Capitán actualizados');
  };

  // Handle formation change
  const handleSelectFormation = (newFormation: Formation) => {
    setTeam(prev => ({
      ...prev,
      ...arrangeLineupForFormation({
        formation: newFormation,
        starters: prev.starters,
        bench: prev.bench,
        players: allSquadPlayers,
        captainId: prev.captainId,
        viceCaptainId: prev.viceCaptainId,
      }),
      formation: newFormation,
    }));
    showToast(`Nueva formación táctica: ${newFormation}`);
  };

  // Handle Auto-Pick
  const handleAutoPick = () => {
    const strongestFirst = (left: Player, right: Player) => right.recentForm - left.recentForm || right.totalPoints - left.totalPoints;
    const gks = allSquadPlayers.filter(p => p.position === 'GK').sort(strongestFirst);
    const defs = allSquadPlayers.filter(p => p.position === 'DEF').sort(strongestFirst);
    const mids = allSquadPlayers.filter(p => p.position === 'MID').sort(strongestFirst);
    const fwds = allSquadPlayers.filter(p => p.position === 'FWD').sort(strongestFirst);

    const [defCount, midCount, fwdCount] = team.formation.split('-').map(Number);

    const newStarters: string[] = [
      gks[0]?.id,
      ...defs.slice(0, defCount).map(p => p.id),
      ...mids.slice(0, midCount).map(p => p.id),
      ...fwds.slice(0, fwdCount).map(p => p.id)
    ].filter(Boolean);

    const newBench: string[] = [
      gks[1]?.id,
      ...defs.slice(defCount).map(p => p.id),
      ...mids.slice(midCount).map(p => p.id),
      ...fwds.slice(fwdCount).map(p => p.id)
    ].filter(Boolean);

    setTeam(prev => ({
      ...prev,
      starters: newStarters,
      bench: newBench
    }));

    showToast('Alineación optimizada automáticamente por estado de forma');
  };

  const handleConfirmPurchase = async (playerToBuy: Player, playerToSell: Player) => {
    setTransferError(null);
    try {
      const account = await userDatabase.executeTransfer(
        currentUserAccount.id, tournamentId, gameweekId, playerToSell.id, playerToBuy.id,
        Math.round((playerToBuy.currentPrice ?? playerToBuy.price) * 100_000_000),
        Math.round((playerToSell.sellingPrice ?? playerToSell.currentPrice ?? playerToSell.price) * 100_000_000),
      );
      setCurrentUserAccount(account); setTeam(account.squad); setTransferHistory(account.transferHistory);
      setPlayerForPurchase(null);
      showToast(`¡Fichaje exitoso! ${playerToBuy.displayName} se incorpora a tu plantilla.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo procesar el fichaje.';
      setTransferError(message);
      showToast(message, 'error');
      if (error instanceof ApiError && error.code === 'PRICE_CHANGED') {
        const [catalog, account] = await Promise.all([
          lpfDataService.loadCatalog(),
          userDatabase.loadGameState(tournamentId, gameweekId),
        ]);
        const refreshedPlayers = lpfDataService.getAllPlayers();
        setPlayers(refreshedPlayers);
        setCurrentUserAccount(account); setTeam(account.squad); setTransferHistory(account.transferHistory);
        const refreshedPurchase = refreshedPlayers.find(player => player.id === playerToBuy.id);
        if (catalog.tournament && refreshedPurchase) setPlayerForPurchase(refreshedPurchase);
      }
      throw error;
    }
  };

  // Chip activation handler
  const handleActivateChip = async (chipId: ChipId) => {
    try {
      const account = await userDatabase.setActiveChip(tournamentId, gameweekId, chipId, true);
      setCurrentUserAccount(account); setTeam(account.squad);
      showToast('¡Comodín activado para esta jornada!');
    } catch (error) { showToast(error instanceof Error ? error.message : 'No se pudo activar el comodín.', 'error'); }
  };

  // Chip deactivation handler
  const handleDeactivateChip = async () => {
    if (!team.activeChip) return;
    try {
      const account = await userDatabase.setActiveChip(tournamentId, gameweekId, team.activeChip, false);
      setCurrentUserAccount(account); setTeam(account.squad); showToast('Comodín cancelado.');
    } catch (error) { showToast(error instanceof Error ? error.message : 'No se pudo cancelar el comodín.', 'error'); }
  };

  const handleClaimChest = () => {
    showToast('Los cofres se habilitarán cuando exista una jornada oficial sincronizada.', 'info');
  };

  const handleClaimQuest = (_questId: string) => {
    showToast('Las misiones se habilitarán con datos oficiales de la jornada.', 'info');
  };

  if (isBooting) {
    return <div className="min-h-screen bg-[#0d1117] text-white grid place-items-center text-sm">Cargando Fantasy LPF…</div>;
  }

  // ==========================================
  // UNATHENTICATED STATE: Render Landing View
  // ==========================================
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-white">
        {startupError && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-xl rounded-xl border border-amber-400/40 bg-amber-950/95 px-4 py-3 text-xs text-amber-100 shadow-xl">
            {startupError}
          </div>
        )}
        <LandingView
          onOpenSignUp={() => {
            setAuthModalMode('signup');
            setIsAuthModalOpen(true);
          }}
          onOpenSignIn={() => {
            setAuthModalMode('signin');
            setIsAuthModalOpen(true);
          }}
        />

        <AuthModal
          isOpen={isAuthModalOpen}
          initialMode={authModalMode}
          onClose={() => setIsAuthModalOpen(false)}
          onSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  // ==========================================
  // ONBOARDING STATE: Render 6-step Wizard
  // ==========================================
  if (!currentUser.onboardingCompleted) {
    return (
      <OnboardingWizard
        user={currentUser}
        tournamentId={tournamentId}
        gameweekId={gameweekId}
        inviteCode={inviteCode}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  // ==========================================
  // AUTHENTICATED & READY: Main Application
  // ==========================================
  return (
    <div className="min-h-screen bg-surface-container-lowest text-on-surface flex flex-col font-sans selection:bg-primary/20 selection:text-primary">
      {/* Header */}
      <Header
        title={
          currentTab === 'equipo'
            ? 'Mi Once Titular'
            : currentTab === 'dashboard'
            ? 'Panel de Mánager'
            : currentTab === 'mercado'
            ? 'Mercado de Fichajes'
            : currentTab === 'fichajes'
            ? 'Traspasos'
            : currentTab === 'jornadas'
            ? 'Jornadas LPF'
            : 'Liga'
        }
        showBack={currentTab === 'dashboard'}
        onBack={() => setCurrentTab('equipo')}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenComodines={() => setIsComodinesModalOpen(true)}
        onOpenFinances={() => setIsPresupuestoModalOpen(true)}
        budgetRemaining={team.budgetRemaining}
        currentGameweek={currentGameweek}
        onOpenGameweekModal={() => currentGameweek ? setIsGameweekModalOpen(true) : showToast('La jornada oficial aún no está verificada en la base canónica.', 'info')}
        userAvatarUrl={userProfile.avatarUrl}
        activeChip={team.activeChip}
      />

      {/* Main Screen Content */}
      <main className="flex-1 w-full max-w-2xl mx-auto pt-16 flex flex-col">
        {/* Dynamic Views */}
        {currentTab === 'equipo' && (
          <EquipoView
            formation={team.formation}
            onSelectFormation={handleSelectFormation}
            starters={starters}
            bench={bench}
            captainId={team.captainId}
            viceCaptainId={team.viceCaptainId}
            onOpenPlayerDetail={p => setSelectedPlayerForDetail(p)}
            onOpenSubstitution={p => setPlayerForSub(p)}
            onDirectSub={handleConfirmSub}
            onOpenCaptainModal={() => setIsCaptainModalOpen(true)}
            onOpenDashboard={() => setCurrentTab('dashboard')}
            onSaveLineup={handleSaveLineup}
            hasLineupChanges={hasLineupChanges}
            onAutoPick={handleAutoPick}
            totalPitchBudget={totalPitchBudget}
            activeChip={team.activeChip}
            isTripleCaptain={team.tripleCaptainActiveInGw || team.activeChip === 'triple_cap'}
            isBenchBoost={team.benchBoostActiveInGw || team.activeChip === 'bench_boost'}
          />
        )}

        {currentTab === 'dashboard' && (
          <DashboardView
            team={team}
            captainPlayer={captainPlayer}
            vicePlayer={vicePlayer}
            onGoToField={() => setCurrentTab('equipo')}
            onGoToMarket={() => setCurrentTab('mercado')}
            onGoToLeague={() => setCurrentTab('clasificacion')}
            onOpenCaptainModal={() => setIsCaptainModalOpen(true)}
            onOpenFinances={() => setIsPresupuestoModalOpen(true)}
          />
        )}

        {currentTab === 'mercado' && (
          <MercadoView
            players={marketPlayers}
            userStarterIds={team.starters}
            userBenchIds={team.bench}
            budgetRemaining={team.budgetRemaining}
            onOpenPlayerDetail={p => setSelectedPlayerForDetail(p)}
            onFicharPlayer={p => { setTransferError(null); setPlayerForPurchase(p); }}
            onGoToTransfers={() => setCurrentTab('fichajes')}
            onOpenFiltersModal={() => setIsFiltersModalOpen(true)}
          />
        )}

        {currentTab === 'fichajes' && (
          <FichajesView
            team={team}
            allPlayers={allSquadPlayers}
            transferHistory={transferHistory}
            onGoToMarket={() => setCurrentTab('mercado')}
            onOpenComodines={() => setIsComodinesModalOpen(true)}
            currentGameweek={currentGameweek}
          />
        )}

        {currentTab === 'jornadas' && (
          <div className="m-4 space-y-3 pb-28">
            <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-black uppercase text-primary">Jornada {currentGameweek ?? 'actual'}</h2>
                <p className="text-sm text-on-surface-variant">Calendario y resultados sincronizados desde la base canónica.</p>
                {matchesUpdatedAt && (
                  <p className="text-xs text-on-surface-variant mt-1">
                    Última actualización: {matchesUpdatedAt.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void refreshMatches(false)}
                disabled={isRefreshingMatches}
                className="shrink-0 flex items-center gap-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 text-primary px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-[16px] ${isRefreshingMatches ? 'animate-spin' : ''}`}>refresh</span>
                {isRefreshingMatches ? 'Actualizando…' : 'Actualizar'}
              </button>
            </div>
            {matches.length ? matches.map(match => {
              const homeClub = match.homeClubId ? clubById.get(match.homeClubId) : undefined;
              const awayClub = match.awayClubId ? clubById.get(match.awayClubId) : undefined;
              return (
                <div key={match.id} className="rounded-xl border border-surface-container-high bg-surface-container p-4">
                  <div className="flex items-center justify-between gap-3 font-bold">
                    <span className="flex flex-1 items-center justify-end gap-2 text-right">
                      <span className="truncate">{match.homeClubName}</span>
                      {homeClub?.logoUrl ? (
                        <img src={homeClub.logoUrl} alt="" className="w-7 h-7 object-contain shrink-0" />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-surface-container-high shrink-0" />
                      )}
                    </span>
                    <span className="rounded-lg bg-surface-container-high px-3 py-1 font-mono text-primary shrink-0">
                      {match.homeScore === null || match.awayScore === null ? 'vs' : `${match.homeScore} - ${match.awayScore}`}
                    </span>
                    <span className="flex flex-1 items-center gap-2">
                      {awayClub?.logoUrl ? (
                        <img src={awayClub.logoUrl} alt="" className="w-7 h-7 object-contain shrink-0" />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-surface-container-high shrink-0" />
                      )}
                      <span className="truncate">{match.awayClubName}</span>
                    </span>
                  </div>
                  <p className="mt-2 text-center text-xs text-on-surface-variant">
                    {match.startsAt ? new Date(match.startsAt).toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' }) : 'Horario por confirmar'}
                  </p>
                </div>
              );
            }) : <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-6 text-center text-sm text-amber-100">
              La jornada aún no tiene partidos verificados.
            </div>}
          </div>
        )}

        {(currentTab === 'clasificacion' || currentTab === 'liga') && (
          <ClasificacionView
            allPlayers={players}
            onOpenPlayerDetail={p => setSelectedPlayerForDetail(p)}
            onGoToMyTeam={() => setCurrentTab('equipo')}
            currentUserId={currentUserAccount.id}
            userTeam={team}
            userAvatarUrl={userProfile.avatarUrl}
            managerName={userProfile.managerName}
            tournamentId={tournamentId}
            inviteCode={inviteCode}
            userSquadOverride={{
              starters: team.starters,
              bench: team.bench,
              formation: team.formation,
              captainId: team.captainId,
              viceCaptainId: team.viceCaptainId,
              totalPoints: team.totalPoints,
              lastGwPoints: team.lastGwPoints
            }}
          />
        )}
      </main>

      {/* Fixed Google Stitch Bottom Navigation */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={tab => setCurrentTab(tab)}
      />

      {/* Floating Toast Feedback */}
      {toast && (
        <div role={toast.type === 'error' ? 'alert' : 'status'} className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-space-md py-2.5 rounded-xl backdrop-blur-md font-headline-sm text-headline-sm uppercase tracking-wider shadow-2xl border flex items-center gap-2 animate-fade-in max-w-[90vw] ${
          toast.type === 'error'
            ? 'bg-rose-950/95 text-rose-100 border-rose-400/60'
            : toast.type === 'info'
              ? 'bg-surface-container-highest/95 text-secondary border-secondary/40'
              : 'bg-surface-container-highest/95 text-primary border-primary/40'
        }`}>
          <span className="material-symbols-outlined text-[18px]">{toast.type === 'error' ? 'cancel' : toast.type === 'info' ? 'info' : 'check_circle'}</span>
          <span className="truncate">{toast.message}</span>
        </div>
      )}

      {/* Modals */}
      {selectedPlayerForDetail && (
        <PlayerDetailModal
          player={selectedPlayerForDetail}
          onClose={() => setSelectedPlayerForDetail(null)}
          onMakeCaptain={
            allSquadPlayers.some(p => p.id === selectedPlayerForDetail.id)
              ? p => handleSaveCaptaincy(p.id, team.viceCaptainId)
              : undefined
          }
          onSubstitute={
            allSquadPlayers.some(p => p.id === selectedPlayerForDetail.id)
              ? p => {
                  setSelectedPlayerForDetail(null);
                  setPlayerForSub(p);
                }
              : undefined
          }
          onTransfer={
            allSquadPlayers.some(p => p.id === selectedPlayerForDetail.id)
              ? p => {
                  setSelectedPlayerForDetail(null);
                  setCurrentTab('mercado');
                  showToast(`Selecciona un jugador del mercado para transferir a ${p.displayName}`);
                }
              : undefined
          }
          onFichar={p => { setTransferError(null); setPlayerForPurchase(p); }}
          isOwned={allSquadPlayers.some(p => p.id === selectedPlayerForDetail.id)}
          isCaptain={selectedPlayerForDetail.id === team.captainId}
        />
      )}

      {playerForSub && (
        <SubstitutionModal
          playerToSubOut={playerForSub}
          bench={bench}
          onConfirmSub={handleConfirmSub}
          onClose={() => setPlayerForSub(null)}
        />
      )}

      {isCaptainModalOpen && (
        <CaptainModal
          starters={starters}
          captainId={team.captainId}
          viceCaptainId={team.viceCaptainId}
          onSave={handleSaveCaptaincy}
          onClose={() => setIsCaptainModalOpen(false)}
        />
      )}

      {isFiltersModalOpen && (
        <MarketFiltersModal
          onClose={() => setIsFiltersModalOpen(false)}
          onApply={filters => {
            setActiveFilters(filters);
            showToast('Filtros del mercado aplicados');
          }}
        />
      )}

      {playerForPurchase && (
        <ConfirmOperationModal
          playerToBuy={playerForPurchase}
          currentSquad={allSquadPlayers}
          budgetRemaining={team.budgetRemaining}
          freeTransfers={team.freeTransfers}
          comodinActive={team.comodinActiveInGw}
          deadlinePassed={deadlinePassed}
          serverError={transferError}
          onConfirmPurchase={handleConfirmPurchase}
          onClose={() => { setTransferError(null); setPlayerForPurchase(null); }}
        />
      )}

      {isComodinesModalOpen && (
        <ComodinesModal
          team={team}
          transferHistory={transferHistory}
          onClose={() => setIsComodinesModalOpen(false)}
          onActivateChip={handleActivateChip}
          onDeactivateChip={handleDeactivateChip}
          onClaimChest={handleClaimChest}
          onClaimQuest={handleClaimQuest}
        />
      )}

      {isPresupuestoModalOpen && (
        <PresupuestoModal
          team={team}
          transferHistory={transferHistory}
          onClose={() => setIsPresupuestoModalOpen(false)}
          onGoToMarket={() => {
            setIsPresupuestoModalOpen(false);
            setCurrentTab('mercado');
          }}
        />
      )}

      {isReglasModalOpen && (
        <ReglasModal onClose={() => setIsReglasModalOpen(false)} />
      )}

      {isCanonicalModalOpen && (
        <CanonicalDataModal onClose={() => setIsCanonicalModalOpen(false)} />
      )}

      {isCanonicalAuditOpen && (
        <CanonicalAuditModal
          isOpen={isCanonicalAuditOpen}
          onClose={() => setIsCanonicalAuditOpen(false)}
        />
      )}

      {isGameweekModalOpen && currentGameweek !== null && (
        <GameweekStatusModal
          currentGameweek={currentGameweek}
          deadlineAt={lpfDataService.getCurrentGameweek()?.deadlineAt}
          status={lpfDataService.getCurrentGameweek()?.status}
          onClose={() => setIsGameweekModalOpen(false)}
          onGoToFixtures={() => {
            setIsGameweekModalOpen(false);
            setCurrentTab('jornadas');
          }}
        />
      )}

      {/* Manager Profile Panel Modal */}
      {isProfileModalOpen && (
        <ManagerProfileModal
          userProfile={userProfile}
          totalPoints={team.totalPoints}
          globalRank={team.rankGlobal}
          onClose={() => setIsProfileModalOpen(false)}
          onSaveProfile={handleSaveProfile}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
