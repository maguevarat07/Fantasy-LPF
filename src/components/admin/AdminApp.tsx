import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, jsonBody } from '../../services/apiClient';
import { authService } from '../../services/authService';
import { LPF_LOGO_URL } from '../../data/assets';
import { positionLabel } from '../../domain/positionLabels';

type State = { mfaConfigured: boolean; adminSession: boolean };
type AdminUser = { id: string; email: string; username: string; name: string; createdAt: string; lastActivity?: string | null; teamCount?: number };
type Team = { id: string; name: string; tournamentName?: string; totalPoints: number; bankCents: number | string; formation: string };
type Player = { id: string; name: string; position: 'GK'|'DEF'|'MID'|'FWD'; club: string; imageUrl?: string;
  currentPriceCents: number; purchasePriceCents: number; sellingPriceCents: number };
type TeamDetail = { team: Team | null; players: Player[]; lineup: null | {
  formation: string; captainId: string; viceCaptainId: string; slots: { playerId: string; role: string; slot: number }[];
}; economy: { currentSquadValueCents: number; sellingSquadValueCents: number; totalAvailableValueCents: number } };
const millions = (cents: number | string) => `$${(Number(cents) / 100_000_000).toFixed(1)}M`;

export function AdminApp() {
  const [state, setState] = useState<State | null>(null);
  const [denied, setDenied] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [section, setSection] = useState<'overview'|'users'|'system'>('overview');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [teamDetail, setTeamDetail] = useState<TeamDetail | null>(null);
  const [transfers, setTransfers] = useState<Record<string, unknown>[]>([]);
  const [leagues, setLeagues] = useState<Record<string, unknown>[]>([]);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [uri, setUri] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const result = await api<State>('/admin/state');
      setState(result); setDenied(false);
    } catch (error) { setState(null); setDenied(error instanceof ApiError && error.status === 403); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!state?.adminSession || selected) return;
    const path = section === 'overview' ? '/admin/overview' : section === 'system' ? '/admin/system/status'
      : `/admin/users?page=${page}&search=${encodeURIComponent(search)}&filter=${filter}`;
    void api<unknown>(path).then(setData).catch(e => setError(e.message));
  }, [state?.adminSession, section, page, search, filter, selected]);
  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la solicitud.'); }
    finally { setBusy(false); }
  }
  async function openUser(target: AdminUser) {
    setSelected(target); setError('');
    try {
      const [detail, team, transfersResult, memberships, gameweeks] = await Promise.all([
        api<{ user: AdminUser; teams: Team[] }>(`/admin/users/${target.id}`),
        api<TeamDetail>(`/admin/users/${target.id}/team`),
        api<{ transfers: Record<string, unknown>[] }>(`/admin/users/${target.id}/transfers`),
        api<{ leagues: Record<string, unknown>[] }>(`/admin/users/${target.id}/leagues`),
        api<{ gameweeks: Record<string, unknown>[] }>(`/admin/users/${target.id}/history`),
      ]);
      setUser(detail.user); setTeamDetail(team); setTransfers(transfersResult.transfers);
      setLeagues(memberships.leagues); setHistory(gameweeks.gameweeks);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar el usuario.'); }
  }
  const card = 'rounded-2xl border border-surface-container-high bg-surface-container-low p-5';
  const button = 'rounded-xl bg-primary-container px-5 py-2 font-bold text-on-primary-container disabled:opacity-50';
  if (denied) return <main className="min-h-screen bg-background text-on-surface grid place-items-center p-6">
    <div className={card + ' max-w-md'}><h1 className="text-xl font-bold">Acceso administrativo denegado</h1>
      <p className="my-3">Esta cuenta no tiene autorización administrativa.</p><a className="underline" href="/">Volver a Fantasy LPF</a></div>
  </main>;
  if (state === null) return <main className="min-h-screen bg-background p-6 text-on-surface grid place-items-center">
    <div className={card + ' max-w-md w-full'}><img src={LPF_LOGO_URL} alt="LPF" className="h-14 mb-5" />
      <h1 className="text-2xl font-bold mb-2">Administración Fantasy LPF</h1>
      <p className="text-on-surface-variant mb-4">Inicia sesión con una cuenta administrativa autorizada.</p>
      <form onSubmit={e => void submit(e, async () => {
        const result = await authService.signIn(login, password);
        if (!result.success) throw new Error(result.error ?? 'Credenciales inválidas.');
        setPassword(''); await refresh();
      })} className="grid gap-3">
        <input aria-label="Correo o usuario" value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" className="p-3 rounded-lg bg-surface-container-high" required />
        <input aria-label="Contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="p-3 rounded-lg bg-surface-container-high" required />
        <button className={button} disabled={busy}>Entrar</button>
      </form>{error && <p role="alert" className="mt-3 text-error">{error}</p>}</div>
  </main>;

  if (!state.adminSession) return <main className="min-h-screen bg-background p-6 text-on-surface grid place-items-center">
    <div className={card + ' max-w-md w-full'}><img src={LPF_LOGO_URL} alt="LPF" className="h-14 mb-5" />
      <h1 className="text-2xl font-bold mb-2">Verificación administrativa</h1>
      <p className="text-on-surface-variant mb-4">{state.mfaConfigured ? 'Introduce el código de tu aplicación autenticadora.' : 'Configura MFA antes de acceder al panel.'}</p>
      {!state.mfaConfigured && !uri && <form onSubmit={e => void submit(e, async () => {
        const result = await api<{ uri: string; secret: string }>('/admin/mfa/setup', { method: 'POST', ...jsonBody({ password }) });
        setUri(result.uri); setSetupSecret(result.secret); setPassword('');
      })} className="grid gap-3">
        <input aria-label="Confirma tu contraseña" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="p-3 rounded-lg bg-surface-container-high" required />
        <button className={button} disabled={busy}>Configurar MFA</button>
      </form>}
      {uri && <div className="mb-4 break-all text-sm"><p>Agrega una cuenta TOTP en tu autenticador con esta clave:</p>
        <code className="block my-2 p-2 rounded bg-surface-container-high select-all">{setupSecret}</code>
        <p className="text-on-surface-variant">El secreto se muestra únicamente durante el registro. No lo compartas.</p></div>}
      {(state.mfaConfigured || uri) && <form onSubmit={e => void submit(e, async () => {
        await api(state.mfaConfigured ? '/admin/mfa/verify' : '/admin/mfa/confirm', { method: 'POST', ...jsonBody({ code }) });
        setCode(''); setUri(''); setSetupSecret(''); await refresh();
      })} className="grid gap-3">
        <input aria-label="Código de seis dígitos" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" className="p-3 rounded-lg bg-surface-container-high" required />
        <button className={button} disabled={busy}>Verificar código</button>
      </form>}
      {error && <p role="alert" className="mt-3 text-error">{error}</p>}</div>
  </main>;

  const overview = data as { users?: number; activeUsers?: number; newUsersToday?: number; newUsersLast7Days?: number;
    onboardingComplete?: number; onboardingIncomplete?: number; teams?: number; leagues?: number; transfers?: number; tournament?: { name: string } } | null;
  const list = data as { users?: AdminUser[]; page?: number } | null;
  const system = data as { latestRun?: Record<string, unknown> } | null;
  return <main className="min-h-screen bg-background text-on-surface p-4 md:p-8">
    <header className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-3 border-b border-surface-container-high pb-5 mb-6">
      <div className="flex items-center gap-3"><img src={LPF_LOGO_URL} alt="LPF" className="h-12" />
        <div><h1 className="text-2xl font-bold">Administración Fantasy LPF</h1><p className="text-sm text-on-surface-variant">Panel de observación · solo lectura</p></div></div>
      <button className="rounded-lg border border-surface-container-high px-4 py-2" onClick={() => void api('/admin/logout',{method:'POST'}).then(()=>{setState(null);setSelected(null);}).catch(e=>setError(e.message))}>Cerrar sesión administrativa</button>
    </header>
    <div className="mx-auto max-w-6xl grid md:grid-cols-[180px_1fr] gap-6">
      <nav aria-label="Secciones administrativas" className="flex md:flex-col gap-2">{(['overview','users','system'] as const).map(s =>
        <button key={s} className={`rounded-lg px-4 py-2 text-left ${section===s ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container'}`}
          onClick={()=>{setSection(s);setSelected(null);setUser(null);setData(null);}}>{ { overview:'Overview',users:'Users',system:'System' }[s]}</button>)}</nav>
      <section>{error && <p role="alert" className="mb-4 text-error">{error}</p>}
        {selected ? <div className="space-y-5"><button className="underline" onClick={()=>{setSelected(null);setUser(null);}}>← Volver a usuarios</button>
          <div className={card}><h2 className="text-xl font-bold">{user?.name ?? selected.name}</h2>
            <p>{user?.email ?? selected.email}</p><p className="text-sm text-on-surface-variant">ID: {selected.id} · Alta: {user?.createdAt} · Última actividad: {user?.lastActivity ?? 'Sin registro'}</p></div>
          <div className={card}><h3 className="text-lg font-bold mb-2">Fantasy Team</h3>{teamDetail?.team ? <>
            <p>{teamDetail.team.name} · Formación {teamDetail.lineup?.formation ?? teamDetail.team.formation} · {teamDetail.team.totalPoints} puntos</p>
            <p>Banco: {millions(teamDetail.team.bankCents)} · Valor actual: {millions(teamDetail.economy.currentSquadValueCents)} · Valor de venta: {millions(teamDetail.economy.sellingSquadValueCents)}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">{teamDetail.players.map(player => { const slot = teamDetail.lineup?.slots.find(item=>item.playerId===player.id);
              return <div key={player.id} className="rounded-lg bg-surface-container p-3 flex gap-2 items-center">
                {player.imageUrl && <img src={player.imageUrl} alt="" className="h-9 w-9 rounded-full object-cover" />}
                <div><p className="font-semibold">{player.name} {teamDetail.lineup?.captainId===player.id ? '©' : teamDetail.lineup?.viceCaptainId===player.id ? 'V' : ''}</p>
                <p className="text-xs text-on-surface-variant">{positionLabel(player.position)} · {player.club} · {slot?.role==='STARTER'?'XI':'Banca'}</p>
                <p className="text-xs">Compra {millions(player.purchasePriceCents)} · Actual {millions(player.currentPriceCents)} · Venta {millions(player.sellingPriceCents)}</p></div></div>; })}</div></> : <p>Sin equipo.</p>}</div>
          <div className={card}><h3 className="text-lg font-bold">Transferencias</h3><p>{transfers.length} registros recientes</p>
            {transfers.map((t,i)=><p key={String(t.id)+i} className="border-t border-surface-container-high py-2 text-sm">{String(t.gameweekId)} · {String(t.playerOutName)} → {String(t.playerInName)} · Venta {millions(String(t.sellPriceCents))} · Compra {millions(String(t.buyPriceCents))} · {String(t.createdAt)}</p>)}</div>
          <div className={card}><h3 className="text-lg font-bold">Ligas privadas</h3>{leagues.map(l=><p key={String(l.id)}>{String(l.name)} · Posición {String(l.position)} / {String(l.memberCount)} · {String(l.points)} puntos</p>)}</div>
          <div className={card}><h3 className="text-lg font-bold">Historial de jornadas</h3>{history.map(h=><p key={String(h.gameweekId)}>
            {String(h.gameweekId)} · Puntos {String(h.playerPoints)} · Capitán +{String(h.captainBonus)} · Penalización {String(h.transferPenalty)} · Total {String(h.totalPoints)}</p>)}</div>
        </div> : section==='overview' ? <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {([['Usuarios',overview?.users],['Activos (7 días)',overview?.activeUsers],['Nuevos hoy (UTC)',overview?.newUsersToday],
            ['Nuevos 7 días',overview?.newUsersLast7Days],['Onboarding completo',overview?.onboardingComplete],
            ['Onboarding incompleto',overview?.onboardingIncomplete],['Equipos',overview?.teams],
            ['Ligas privadas',overview?.leagues],['Transferencias',overview?.transfers],['Torneo activo',overview?.tournament?.name]] as const)
            .map(([label,value])=><div key={label} className={card}><p className="text-on-surface-variant">{label}</p><p className="text-2xl font-bold">{value ?? '—'}</p></div>)}</div>
        : section==='users' ? <div className={card}><h2 className="text-xl font-bold mb-3">Usuarios</h2>
          <input aria-label="Buscar usuarios" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Nombre o correo"
            className="w-full p-3 rounded-lg bg-surface-container mb-3" maxLength={80} />
          <select aria-label="Filtrar usuarios" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}
            className="w-full p-3 rounded-lg bg-surface-container mb-3">
            {([['all','Todos'],['active','Activos (7 días)'],['inactive','Inactivos'],
              ['onboarding-complete','Onboarding completo'],['onboarding-incomplete','Onboarding incompleto'],
              ['has-team','Con equipo'],['no-team','Sin equipo']] as const).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
          <div className="space-y-2">{list?.users?.map(u=><button key={u.id} onClick={()=>void openUser(u)} className="block w-full text-left rounded-lg bg-surface-container p-3 hover:bg-surface-container-high">
            <strong>{u.name}</strong> · {u.email}<span className="block text-sm text-on-surface-variant">{u.teamCount ? 'Con equipo' : 'Sin equipo'} · Alta {u.createdAt}</span></button>)}</div>
          <div className="flex gap-3 mt-4"><button disabled={page===1} onClick={()=>setPage(n=>n-1)}>Anterior</button><span>Página {page}</span><button disabled={(list?.users?.length ?? 0)<25} onClick={()=>setPage(n=>n+1)}>Siguiente</button></div></div>
        : <div className={card}><h2 className="text-xl font-bold mb-3">Estado del sistema</h2>
          {system?.latestRun ? Object.entries(system.latestRun).map(([key,value])=><p key={key} className="border-b border-surface-container-high py-2"><strong>{key}:</strong> {String(value ?? '—')}</p>) : <p>Sin ejecuciones registradas.</p>}</div>}
      </section>
    </div>
  </main>;
}
