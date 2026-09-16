import React, { useEffect, useState } from 'react';
import { LPF_LOGO_URL } from '../../data/assets';
import { lpfDataService } from '../../services/lpfDataService';
import { ArrowRight, Check } from 'lucide-react';

interface LandingViewProps {
  onOpenSignUp: () => void;
  onOpenSignIn: () => void;
  onQuickDemo?: () => void;
}

const NAV_LINKS = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#clubes', label: 'Los 12 clubes' },
  { href: '#vista', label: 'La app' },
  { href: '#ligas', label: 'Ligas privadas' },
];

const STEPS = [
  { n: '01', title: 'Crea tu cuenta', body: 'Correo y contraseña. Gratis y en menos de un minuto.' },
  { n: '02', title: 'Ficha 15 jugadores', body: 'Futbolistas reales de los 12 clubes con $100M de presupuesto y máximo 3 por club.' },
  { n: '03', title: 'Define tu XI', body: 'Elige titulares, cuatro suplentes, capitán y vicecapitán antes del cierre de jornada.' },
  { n: '04', title: 'Invita a tu gente', body: 'Abre una liga privada o entra con un código de seis caracteres.' },
  { n: '05', title: 'Suma puntos reales', body: 'Goles, asistencias, porterías a cero y minutos de la LPF alimentan tu marcador.' },
];

const LEAGUE_PERKS = [
  'Ligas ilimitadas con el mismo equipo.',
  'Clasificación por jornada y acumulada.',
  'Entra a la liga de un amigo con su código.',
];

const DEMO_STANDINGS = [
  { pos: 1, team: 'Los del Chorrillo', pts: 812 },
  { pos: 2, team: 'DT de Sofá', pts: 799 },
  { pos: 3, team: 'Coclé Power', pts: 774 },
  { pos: 4, team: 'Tu equipo', pts: 761 },
  { pos: 5, team: 'Barrio Balboa', pts: 740 },
];

// Illustrative example lineup for the "Tu XI de la jornada" preview, built from real club branding.
const DEMO_LINEUP: { code: string; pos: 'POR' | 'DEF' | 'MED' | 'DEL'; pts: number; captain?: boolean }[] = [
  { code: 'PLA', pos: 'POR', pts: 6 },
  { code: 'TAU', pos: 'DEF', pts: 8 },
  { code: 'SFC', pos: 'DEF', pts: 4 },
  { code: 'DAU', pos: 'DEF', pts: 11 },
  { code: 'VER', pos: 'DEF', pts: 2 },
  { code: 'CAI', pos: 'MED', pts: 9, captain: true },
  { code: 'ALI', pos: 'MED', pts: 7 },
  { code: 'SSM', pos: 'MED', pts: 3 },
  { code: 'UME', pos: 'MED', pts: 5 },
  { code: 'HER', pos: 'DEL', pts: 12 },
  { code: 'CDU', pos: 'DEL', pts: 7 },
];

const LINEUP_ROWS: { code: string; pos: string; pts: number; captain?: boolean }[][] = [
  [DEMO_LINEUP[0]],
  DEMO_LINEUP.slice(1, 5),
  DEMO_LINEUP.slice(5, 9),
  DEMO_LINEUP.slice(9, 11),
];

export const LandingView: React.FC<LandingViewProps> = ({
  onOpenSignUp,
  onOpenSignIn,
  onQuickDemo
}) => {
  const clubs = lpfDataService.getClubs();
  const clubByCode = (code: string) => clubs.find(c => c.code === code);
  const marqueeClubs = [...clubs, ...clubs];

  const [demoPoints, setDemoPoints] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDemoPoints(74);
      return;
    }
    const target = 74;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      const eased = 1 - Math.pow(1 - t, 3);
      setDemoPoints(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="min-h-screen bg-[#05080F] text-[#E8EDF7] font-sans overflow-x-hidden selection:bg-[#E11D3A] selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#05080F]/82 backdrop-blur-xl">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 min-h-[68px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0 overflow-hidden">
            <img src={LPF_LOGO_URL} alt="Liga Panameña de Fútbol" className="h-6.5 w-auto object-contain shrink-0" />
            <span className="hidden sm:block w-px h-6.5 bg-white/[0.16] shrink-0" />
            <span className="hidden sm:block font-['Orbitron'] font-black text-[16px] tracking-[.08em] uppercase text-white whitespace-nowrap">
              Fantasy
            </span>
          </div>

          <nav aria-label="Secciones" className="hidden lg:flex items-center gap-7">
            {NAV_LINKS.map(link => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-semibold text-[#A9B4C7] tracking-wide hover:text-white transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenSignIn}
              className="px-3.5 py-2.5 min-h-11 whitespace-nowrap font-['Barlow_Condensed'] text-sm font-bold tracking-[.08em] uppercase text-[#D3DBE9] bg-transparent border border-white/[0.14] rounded-lg cursor-pointer hover:text-white hover:border-white/35 transition-colors"
            >
              <span className="hidden sm:inline">Iniciar sesión</span>
              <span className="sm:hidden">Entrar</span>
            </button>
            <button
              type="button"
              onClick={onOpenSignUp}
              className="px-4 py-2.5 min-h-11 whitespace-nowrap font-['Barlow_Condensed'] text-sm font-extrabold tracking-[.08em] uppercase text-white bg-[#E11D3A] border-none rounded-lg cursor-pointer shadow-[0_8px_24px_-8px_rgba(225,29,58,.8)] hover:bg-[#F52D4A] transition-colors"
            >
              <span className="hidden sm:inline">Crear cuenta</span>
              <span className="sm:hidden">Crear</span>
            </button>
          </div>
        </div>

        <nav aria-label="Secciones" className="flex lg:hidden gap-2 overflow-x-auto no-scrollbar px-4 pb-2.5 border-t border-white/[0.06]">
          {NAV_LINKS.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="shrink-0 px-3.5 py-2 min-h-[38px] inline-flex items-center rounded-full border border-white/[0.14] bg-white/[0.04] text-xs font-bold tracking-wide text-[#D3DBE9] whitespace-nowrap"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      {/* Hero */}
      <section
        aria-labelledby="hero-title"
        className="relative overflow-hidden border-b border-white/[0.07]"
        style={{ background: 'radial-gradient(120% 90% at 50% -10%, #12233F 0%, #0A1122 45%, #05080F 100%)' }}
      >
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <img
            src="/hero-campeon-lpf.png"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-55"
            style={{ objectPosition: '50% 42%', filter: 'saturate(.92) contrast(1.04)' }}
          />
          <div className="absolute inset-0 bg-[#05080F]/50" />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(90deg, rgba(5,8,15,.88) 0%, rgba(5,8,15,.72) 34%, rgba(5,8,15,.32) 66%, rgba(5,8,15,.06) 100%)' }}
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(5,8,15,.42) 0%, rgba(5,8,15,.08) 24%, rgba(5,8,15,.08) 74%, rgba(5,8,15,.8) 94%, #05080F 100%)' }}
          />
          <div className="animate-lpf-beam absolute -top-40 left-[8%] w-[340px] h-[620px] blur-[26px]" style={{ background: 'linear-gradient(180deg, rgba(196,224,255,.20), rgba(196,224,255,0) 70%)', transform: 'skewX(-16deg)' }} />
          <div className="animate-lpf-beam absolute -top-[190px] right-[6%] w-[300px] h-[660px] blur-[30px]" style={{ background: 'linear-gradient(180deg, rgba(0,229,155,.16), rgba(0,229,155,0) 68%)', transform: 'skewX(13deg)', animationDelay: '.8s' }} />
        </div>

        <div className="relative max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 lg:py-28 flex items-center min-h-0 lg:min-h-[78vh]">
          <div className="animate-lpf-up relative w-full max-w-[780px]">
            <div className="relative z-10 inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-[#00E59B]/32 bg-[#00E59B]/[0.09] mb-5 max-w-full">
              <span className="animate-lpf-pulse w-1.5 h-1.5 rounded-full bg-[#00E59B]" />
              <span className="text-[11px] font-bold tracking-[.14em] uppercase text-[#5FE8B5]">
                Apertura 2026 · Fantasy oficial LPF
              </span>
            </div>

            <h1
              id="hero-title"
              className="relative z-10 font-['Barlow_Condensed'] font-black text-[clamp(44px,7.4vw,86px)] leading-[.92] tracking-[-.015em] uppercase text-white mb-5"
              style={{ textShadow: '0 3px 26px rgba(3,6,12,.78)' }}
            >
              Arma tu once.<br />
              <span className="text-[#5BFFC4]">Gana la jornada.</span><br />
              Manda en la LPF.
            </h1>

            <p
              className="relative z-10 max-w-[33em] text-[clamp(15px,1.6vw,18px)] leading-relaxed text-[#E4EAF5] mb-7"
              style={{ textShadow: '0 2px 16px rgba(3,6,12,.9)' }}
            >
              El Fantasy de la Liga Panameña de Fútbol con jugadores y clubes reales. Ficha 15 futbolistas con $100 millones, elige tu XI, tu capitán y compite contra tus amigos con los puntos que se ganan en la cancha.
            </p>

            <div className="relative z-10 flex flex-wrap gap-3 mb-8">
              <button
                type="button"
                onClick={onOpenSignUp}
                className="flex-1 min-w-[240px] min-h-[54px] px-6 py-3.5 inline-flex items-center justify-center gap-2.5 bg-[#E11D3A] text-white border-none rounded-[10px] font-['Barlow_Condensed'] text-xl font-extrabold tracking-[.07em] uppercase cursor-pointer shadow-[0_16px_40px_-14px_rgba(225,29,58,.95)] hover:bg-[#F52D4A] active:translate-y-px transition-colors"
              >
                Crear mi equipo gratis
                <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.4} />
              </button>
              <button
                type="button"
                onClick={onOpenSignIn}
                className="flex-none min-w-[190px] min-h-[54px] px-5.5 py-3.5 bg-white/[0.04] text-white border border-white/[0.18] rounded-[10px] font-['Barlow_Condensed'] text-xl font-bold tracking-[.07em] uppercase cursor-pointer hover:bg-white/10 hover:border-white/40 transition-colors"
              >
                Iniciar sesión
              </button>
              {onQuickDemo && (
                <button
                  type="button"
                  onClick={onQuickDemo}
                  className="flex-none min-h-[54px] px-4 py-3.5 bg-transparent text-[#8F9BB0] border border-white/[0.12] rounded-[10px] font-semibold text-xs tracking-wide cursor-pointer hover:text-white hover:border-white/30 transition-colors"
                >
                  Explorar como mánager demo
                </button>
              )}
            </div>

            <dl className="relative z-10 grid grid-cols-2 gap-px bg-white/10 border border-white/10 rounded-xl overflow-hidden">
              {[
                { dt: 'Clubes', dd: '12', color: '#fff' },
                { dt: 'Presupuesto', dd: '$100M', color: '#fff' },
                { dt: 'Plantilla', dd: '15', color: '#fff' },
                { dt: 'Costo', dd: '$0', color: '#00E59B' },
              ].map(stat => (
                <div key={stat.dt} className="bg-[#080C16]/82 backdrop-blur-sm p-3.5 sm:p-4">
                  <dt className="text-[10px] font-bold tracking-[.14em] uppercase text-[#7E8AA0] mb-1">{stat.dt}</dt>
                  <dd className="m-0 font-['Barlow_Condensed'] text-[28px] font-extrabold leading-none" style={{ color: stat.color }}>{stat.dd}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Tu XI de la jornada (pitch preview) */}
      <section
        aria-labelledby="pitch-title"
        className="relative py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-b border-white/[0.07]"
        style={{ background: 'linear-gradient(180deg,#05080F 0%,#070C16 55%,#05080F 100%)' }}
      >
        <div className="animate-lpf-up max-w-[920px] mx-auto">
          <div className="flex items-end justify-between gap-3.5 flex-wrap mb-4">
            <div className="min-w-0">
              <div className="text-[10px] font-bold tracking-[.16em] uppercase text-[#7E8AA0] mb-1.5">Así se ve tu equipo</div>
              <h2 id="pitch-title" className="m-0 font-['Barlow_Condensed'] text-[clamp(26px,3.4vw,38px)] font-black leading-none uppercase text-white">Tu XI de la jornada</h2>
            </div>
            <span className="text-[11px] font-bold tracking-[.1em] uppercase text-[#00E59B] whitespace-nowrap">11 titulares · 1 capitán</span>
          </div>

          <div className="rounded-[18px] border border-[#00E59B]/45 bg-[#080C16] overflow-hidden shadow-[0_40px_90px_-40px_rgba(0,0,0,.95),0_0_0_1px_rgba(0,229,155,.07),0_24px_94px_-30px_rgba(0,229,155,.3)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10" style={{ background: 'linear-gradient(90deg, rgba(225,29,58,.16), rgba(8,12,22,0))' }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="animate-lpf-pulse w-2 h-2 rounded-full bg-[#E11D3A] shrink-0" />
                <span className="text-[11px] font-bold tracking-[.12em] uppercase text-[#E8EDF7] whitespace-nowrap truncate">Jornada en vivo</span>
              </div>
              <span className="text-[10px] font-bold tracking-[.1em] uppercase text-[#7E8AA0] border border-white/[0.14] rounded-full px-2.5 py-1 whitespace-nowrap">Vista de ejemplo</span>
            </div>

            <div className="relative p-6 sm:p-8" style={{ background: 'linear-gradient(180deg,#0B4030 0%,#07281D 60%,#061B15 100%)' }}>
              <div aria-hidden="true" className="absolute inset-3.5 border border-white/20 rounded-md" />
              <div aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[34%] aspect-square border border-white/[0.18] rounded-full" />
              <div aria-hidden="true" className="absolute left-3.5 right-3.5 top-1/2 h-px bg-white/[0.18]" />
              <div aria-hidden="true" className="absolute inset-0" style={{ background: 'radial-gradient(70% 50% at 50% 0%, rgba(220,240,255,.14), transparent 70%)' }} />

              <div className="relative grid gap-2.5 sm:gap-4 px-1 py-2.5">
                {LINEUP_ROWS.map((row, i) => (
                  <div key={i} className="flex justify-center gap-1.5 sm:gap-3.5">
                    {row.map(entry => {
                      const club = clubByCode(entry.code);
                      return (
                        <div key={entry.code} className="flex-none w-[74px] flex flex-col items-center gap-1.5">
                          <div className="relative w-[clamp(36px,5vw,44px)] h-[clamp(36px,5vw,44px)] rounded-full bg-[#05080F]/66 border border-[#00E59B]/40 grid place-items-center p-1.5">
                            {club?.logoUrl ? (
                              <img src={club.logoUrl} alt={club.name} className="w-full h-full object-contain" />
                            ) : (
                              <span className="text-[10px] font-black text-[#00E59B]">{entry.code}</span>
                            )}
                            {entry.captain && (
                              <span
                                aria-label="Capitán"
                                className="absolute -top-1 -right-1 w-[19px] h-[19px] rounded-full bg-[#E11D3A] text-white font-['Barlow_Condensed'] text-[11px] font-extrabold grid place-items-center border-[1.5px] border-[#07281D]"
                              >
                                C
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-bold tracking-[.08em] text-white/72 uppercase">{entry.pos}</span>
                          <span className="font-['Barlow_Condensed'] text-sm font-extrabold leading-none text-[#00E59B]">{entry.pts}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-px bg-white/10">
              <div className="bg-[#080C16] px-4 py-3.5">
                <div className="text-[10px] font-bold tracking-[.12em] uppercase text-[#7E8AA0] mb-1">Puntos jornada</div>
                <div className="font-['Barlow_Condensed'] text-2xl font-extrabold leading-none text-white">{demoPoints}</div>
              </div>
              <div className="bg-[#080C16] px-4 py-3.5">
                <div className="text-[10px] font-bold tracking-[.12em] uppercase text-[#7E8AA0] mb-1">Capitán 2x</div>
                <div className="font-['Barlow_Condensed'] text-2xl font-extrabold leading-none text-[#E11D3A]">+18</div>
              </div>
              <div className="bg-[#080C16] px-4 py-3.5">
                <div className="text-[10px] font-bold tracking-[.12em] uppercase text-[#7E8AA0] mb-1">Banco</div>
                <div className="font-['Barlow_Condensed'] text-2xl font-extrabold leading-none text-[#E8EDF7]">4</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Clubs */}
      <section id="clubes" aria-labelledby="clubes-title" className="py-10 sm:py-14 border-b border-white/[0.07] bg-[#070A12]">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 pb-6 flex flex-wrap items-end justify-between gap-3.5">
          <div>
            <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[#E11D3A] mb-2">Fútbol panameño real</div>
            <h2 id="clubes-title" className="m-0 font-['Barlow_Condensed'] text-[clamp(30px,4.2vw,46px)] font-extrabold leading-none uppercase text-white">Los 12 clubes de la LPF</h2>
          </div>
          <p className="m-0 max-w-[30em] text-sm leading-relaxed text-[#8F9BB0]">
            Plantillas completas de Alianza a Veraguas. Cada jugador que fichas juega de verdad el fin de semana.
          </p>
        </div>

        <div
          aria-hidden="true"
          className="relative overflow-hidden border-y border-white/[0.08] bg-white/[0.03]"
          style={{ maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)' }}
        >
          <div className="animate-lpf-marquee flex w-max">
            {marqueeClubs.map((club, i) => (
              <div key={`${club.id}-${i}`} className="flex items-center gap-2.5 px-6 sm:px-7 py-5 border-r border-white/[0.06]">
                {club.logoUrl ? (
                  <img src={club.logoUrl} alt="" className="w-11 h-11 object-contain" />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-[#00E59B]/15 text-[#5FE8B5] grid place-items-center text-xs font-black">{club.code}</div>
                )}
                <div>
                  <div className="font-['Barlow_Condensed'] text-[22px] font-extrabold leading-none tracking-wide text-white">{club.code}</div>
                  <div className="text-[10px] font-semibold tracking-wide text-[#7E8AA0] whitespace-nowrap">{club.shortName}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <ul className="max-w-[1240px] mx-auto mt-6 px-4 sm:px-6 lg:px-8 list-none grid gap-2.5 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {clubs.map(club => (
            <li
              key={club.id}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.06] hover:border-[#00E59B]/35 transition-colors"
            >
              {club.logoUrl ? (
                <img src={club.logoUrl} alt={club.name} className="w-[30px] h-[30px] object-contain shrink-0" />
              ) : (
                <div className="w-[30px] h-[30px] rounded-full bg-[#00E59B]/15 text-[#5FE8B5] grid place-items-center text-[10px] font-black shrink-0">
                  {club.code.slice(0, 3)}
                </div>
              )}
              <span className="font-['Barlow_Condensed'] text-lg font-extrabold tracking-wide text-[#E8EDF7] truncate">{club.code}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" aria-labelledby="pasos-title" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-white/[0.07] bg-[#05080F]">
        <div className="max-w-[1240px] mx-auto">
          <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[#00E59B] mb-2">Cinco pasos</div>
          <h2 className="m-0 mb-8 font-['Barlow_Condensed'] text-[clamp(30px,4.4vw,50px)] font-extrabold leading-none uppercase text-white max-w-[20em]">
            De cero a dirigir tu equipo en cinco minutos
          </h2>

          <ol className="m-0 p-0 list-none grid gap-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(step => (
              <li key={step.n} className="relative pt-6">
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-white/10 overflow-hidden">
                  <span className="animate-lpf-sweep absolute inset-0 w-[34%]" style={{ background: 'linear-gradient(90deg, transparent, #00E59B, transparent)' }} />
                </div>
                <div className="font-['Barlow_Condensed'] text-[46px] font-black leading-[.8] text-white/[0.14] mb-3">{step.n}</div>
                <h3 className="m-0 mb-1.5 font-['Barlow_Condensed'] text-xl font-extrabold tracking-wide uppercase text-white">{step.title}</h3>
                <p className="m-0 text-[13.5px] leading-relaxed text-[#8F9BB0]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Dentro de la app */}
      <section
        id="vista"
        aria-labelledby="vista-title"
        className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-white/[0.07]"
        style={{ background: 'radial-gradient(90% 70% at 80% 0%, #0F1E36 0%, #070A12 60%)' }}
      >
        <div className="max-w-[1240px] mx-auto">
          <div className="flex flex-wrap items-end justify-between gap-3.5 mb-7">
            <div>
              <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[#E11D3A] mb-2">Dentro de la app</div>
              <h2 id="vista-title" className="m-0 font-['Barlow_Condensed'] text-[clamp(30px,4.4vw,50px)] font-extrabold leading-none uppercase text-white">
                Todo lo que manejas cada semana
              </h2>
            </div>
            <span className="text-[10px] font-bold tracking-[.1em] uppercase text-[#7E8AA0] border border-white/[0.14] rounded-full px-2.5 py-1.5">
              Vista de ejemplo · datos ilustrativos
            </span>
          </div>

          <div className="grid gap-3.5 items-start grid-cols-1 md:grid-cols-3">
            {/* Player card */}
            <div className="rounded-2xl border border-white/10 bg-[#080C16] overflow-hidden">
              <div className="px-4 py-3.5 border-b border-white/[0.08] text-[11px] font-bold tracking-[.12em] uppercase text-[#A9B4C7]">Tarjeta de jugador</div>
              <div className="p-4 flex gap-3.5 items-center">
                <div className="w-[76px] aspect-[76/90] rounded-[10px] border border-white/10 overflow-hidden shrink-0" style={{ background: 'linear-gradient(180deg,#12233F,#080C16)' }}>
                  <img src="/player-placeholder.svg" alt="Retrato de jugador de ejemplo" className="w-full h-full object-cover opacity-85" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    {clubByCode('CAI')?.logoUrl && <img src={clubByCode('CAI')!.logoUrl} alt="CAI" className="w-[22px] h-[22px] object-contain" />}
                    <span className="text-[10px] font-bold tracking-[.12em] uppercase text-[#7E8AA0]">CAI · MED · #10</span>
                  </div>
                  <div className="font-['Barlow_Condensed'] text-2xl font-extrabold leading-none text-white mb-2.5">Mediocampista</div>
                  <div className="flex gap-4">
                    <div>
                      <div className="text-[9px] font-bold tracking-[.1em] uppercase text-[#7E8AA0]">Precio</div>
                      <div className="font-['Barlow_Condensed'] text-[19px] font-extrabold text-[#E8EDF7]">$8.5M</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold tracking-[.1em] uppercase text-[#7E8AA0]">Puntos</div>
                      <div className="font-['Barlow_Condensed'] text-[19px] font-extrabold text-[#00E59B]">64</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Budget */}
            <div className="rounded-2xl border border-white/10 bg-[#080C16] overflow-hidden">
              <div className="px-4 py-3.5 border-b border-white/[0.08] text-[11px] font-bold tracking-[.12em] uppercase text-[#A9B4C7]">Presupuesto</div>
              <div className="p-4">
                <div className="flex items-end justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-bold tracking-[.1em] uppercase text-[#7E8AA0] mb-1">Disponible</div>
                    <div className="font-['Barlow_Condensed'] text-[38px] font-black leading-[.9] text-white">$6.2<span className="text-[22px]">M</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold tracking-[.1em] uppercase text-[#7E8AA0] mb-1">Plantilla</div>
                    <div className="font-['Barlow_Condensed'] text-2xl font-extrabold text-[#00E59B]">15/15</div>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-3.5">
                  <div className="w-[94%] h-full rounded-full" style={{ background: 'linear-gradient(90deg,#00E59B,#00A2FF)' }} />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[{ label: 'POR', value: 2 }, { label: 'DEF', value: 5 }, { label: 'MED', value: 5 }, { label: 'DEL', value: 3 }].map(row => (
                    <div key={row.label} className="text-center px-1 py-2.5 rounded-[9px] bg-white/[0.04] border border-white/[0.07]">
                      <div className="text-[9px] font-bold tracking-[.08em] text-[#7E8AA0]">{row.label}</div>
                      <div className="font-['Barlow_Condensed'] text-lg font-extrabold text-white">{row.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Standings */}
            <div className="rounded-2xl border border-white/10 bg-[#080C16] overflow-hidden">
              <div className="px-4 py-3.5 border-b border-white/[0.08] text-[11px] font-bold tracking-[.12em] uppercase text-[#A9B4C7]">Clasificación · liga privada</div>
              <div>
                {DEMO_STANDINGS.map(row => (
                  <div key={row.pos} className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.05] last:border-b-0">
                    <span className="font-['Barlow_Condensed'] text-[17px] font-extrabold text-[#7E8AA0] w-5 shrink-0">{row.pos}</span>
                    <span className="flex-1 min-w-0 text-[13.5px] font-semibold text-[#E8EDF7] truncate">{row.team}</span>
                    <span className="font-['Barlow_Condensed'] text-[19px] font-extrabold text-[#00E59B] shrink-0">{row.pts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ligas privadas */}
      <section id="ligas" aria-labelledby="ligas-title" className="py-12 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-white/[0.07] bg-[#05080F]">
        <div className="max-w-[1240px] mx-auto grid gap-8 sm:gap-12 grid-cols-1 lg:grid-cols-2 items-center">
          <div>
            <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[#00E59B] mb-2">Ligas privadas</div>
            <h2 id="ligas-title" className="m-0 mb-4 font-['Barlow_Condensed'] text-[clamp(30px,4.4vw,50px)] font-extrabold leading-none uppercase text-white">
              Seis caracteres y el grupo ya está compitiendo
            </h2>
            <p className="m-0 mb-5.5 max-w-[32em] text-[15px] leading-relaxed text-[#AEB9CC]">
              Crea tu liga, comparte el código de invitación y mide tu equipo contra la oficina, el barrio o la familia. Tu mismo Fantasy Team juega en todas tus ligas a la vez.
            </p>
            <ul className="m-0 mb-6.5 p-0 list-none grid gap-2.5">
              {LEAGUE_PERKS.map(perk => (
                <li key={perk} className="flex items-start gap-2.5 text-sm leading-relaxed text-[#D3DBE9]">
                  <Check className="w-[18px] h-[18px] text-[#00E59B] shrink-0 mt-0.5" strokeWidth={2.4} />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onOpenSignUp}
              className="min-h-[50px] px-6 py-3 bg-transparent text-white border border-white/[0.22] rounded-[10px] font-['Barlow_Condensed'] text-lg font-bold tracking-[.07em] uppercase cursor-pointer hover:bg-white/[0.07] hover:border-[#00E59B] transition-colors"
            >
              Crear cuenta y abrir mi liga
            </button>
          </div>

          <div
            className="rounded-[18px] border border-white/[0.12] p-6 sm:p-8 shadow-[0_40px_90px_-50px_rgba(0,0,0,.9)]"
            style={{ background: 'linear-gradient(160deg,#101B31,#080C16)' }}
          >
            <div className="text-[10px] font-bold tracking-[.14em] uppercase text-[#7E8AA0] mb-3.5">Código de invitación</div>
            <div className="flex gap-2 mb-5 flex-wrap">
              {['L', 'P', 'F', '2', '6', 'X'].map((ch, i) => (
                <span
                  key={i}
                  className="flex-1 min-w-[42px] aspect-[.86] grid place-items-center rounded-[10px] bg-white/5 border border-white/[0.16] font-['Barlow_Condensed'] text-[clamp(26px,3.4vw,36px)] font-black text-white"
                >
                  {ch}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-[11px] bg-[#00E59B]/[0.08] border border-[#00E59B]/26">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E59B] shrink-0" />
              <span className="text-xs font-semibold text-[#7FEFC5]">8 mánagers dentro · ejemplo</span>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        aria-labelledby="cta-title"
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(180deg,#0B4030 0%,#07281D 55%,#05080F 100%)' }}
      >
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(60% 80% at 50% 0%, rgba(220,240,255,.2), transparent 70%)' }} />
        </div>
        <div className="relative max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-24 text-center">
          <img src={LPF_LOGO_URL} alt="Liga Panameña de Fútbol" className="h-[30px] w-auto object-contain mx-auto mb-5.5 opacity-95" />
          <h2 id="cta-title" className="m-0 mb-4 font-['Barlow_Condensed'] text-[clamp(38px,6.6vw,76px)] font-black leading-[.94] uppercase text-white">
            La próxima jornada no espera
          </h2>
          <p className="mx-auto mb-7.5 max-w-[30em] text-[clamp(15px,1.7vw,18px)] leading-relaxed text-[#CDE6DA]">
            Arma tu equipo hoy, invita a tus amigos y demuestra cuánto sabes de la LPF.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              onClick={onOpenSignUp}
              className="flex-1 min-w-[250px] max-w-[340px] min-h-14 px-7 py-4 inline-flex items-center justify-center gap-2.5 bg-[#E11D3A] text-white border-none rounded-[10px] font-['Barlow_Condensed'] text-xl font-extrabold tracking-[.07em] uppercase cursor-pointer shadow-[0_18px_44px_-14px_rgba(225,29,58,.95)] hover:bg-[#F52D4A] transition-colors"
            >
              Crear cuenta gratis
              <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={onOpenSignIn}
              className="flex-none min-w-[200px] min-h-14 px-6 py-4 bg-black/30 text-white border border-white/28 rounded-[10px] font-['Barlow_Condensed'] text-xl font-bold tracking-[.07em] uppercase cursor-pointer hover:bg-black/50 transition-colors"
            >
              Iniciar sesión
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-7.5 px-4 sm:px-6 lg:px-8 bg-[#05080F]">
        <div className="max-w-[1240px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-[#6F7B90]">
          <div className="flex items-center gap-3">
            <img src={LPF_LOGO_URL} alt="LPF" className="h-4.5 w-auto object-contain opacity-70" />
            <span>Fantasy LPF · Apertura 2026</span>
          </div>
          <div className="flex flex-wrap items-center gap-4.5">
            <a href="#como-funciona" className="text-[#8F9BB0] font-semibold hover:text-white transition-colors">Reglamento</a>
            <a href="#clubes" className="text-[#8F9BB0] font-semibold hover:text-white transition-colors">Clubes</a>
            <a href="#ligas" className="text-[#8F9BB0] font-semibold hover:text-white transition-colors">Privacidad</a>
            <a href="#vista" className="text-[#8F9BB0] font-semibold hover:text-white transition-colors">Términos</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
