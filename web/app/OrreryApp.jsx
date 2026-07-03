'use client';

/**
 * ORRERY shell — the client root the server `page.tsx` mounts.
 *
 * Holds the resolved graph ({nodes, links, types}) once and a single `view`:
 *   'home'    — the findings-first landing (search + leads board + drifting backdrop)
 *   'entity'  — an entity dossier (grouped sourced ties + focused ego-graph)
 *   'explore' — the opt-in full network (the original OrreryGraph, lazy-loaded)
 *
 * It renders a slim shared header (logo + a global entity search that jumps
 * straight to a dossier) and routes between the views. The heavy Explore graph
 * is code-split so it never weighs down the landing.
 */
import React, { useMemo, useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Search, X, Compass, ArrowLeft, BookOpen, GitCompareArrows } from 'lucide-react';
import {
  GOLD, VERM, TEXT, MUTE, HAIR, PANEL, MONO, SANS, BG,
  typeColor,
} from '@/lib/graph-utils';
import HomeView from './views/HomeView';
import EntityView from './views/EntityView';
import ConnectView from './views/ConnectView';

const OrreryGraph = lazy(() => import('./OrreryGraph'));

/* entities ranked by what merits a look — conflicts first, then scrutiny, then
   connectedness. Shared by the header search suggestions. */
function rankNodes(nodes) {
  const sr = { strong: 0, medium: 1, low: 2 };
  const crank = (n) => (n.conflict ? (sr[n.conflictStrength] ?? 1) : 3);
  return [...nodes].sort(
    (a, b) =>
      crank(a) - crank(b) ||
      (b.scrutiny || 0) - (a.scrutiny || 0) ||
      b.importance - a.importance ||
      a.name.localeCompare(b.name),
  );
}

export default function OrreryApp({ nodes, links, types }) {
  const [view, setView] = useState('home');
  const [entityId, setEntityId] = useState(null);
  const [exploreFocus, setExploreFocus] = useState(null);
  const [connectFrom, setConnectFrom] = useState(null);

  const ranked = useMemo(() => rankNodes(nodes), [nodes]);
  const nodeById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  /* Reflect the current finding in the URL hash so a dossier / path / node can be shared and
     restored. replaceState keeps history clean and does NOT fire hashchange, so writing here
     never loops back into navigation. */
  const setHash = (h) => {
    if (typeof window === 'undefined') return;
    const url = h ? `#${h}` : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  };
  // Deep-links key on the entity NAME, not its canonical id: ids are regenerated on every
  // pipeline recompute, so a name-based link stays valid across rebuilds (and reads cleanly
  // when shared, e.g. #entity=Ecotricity Group Limited).
  const nameOf = (id) => (id && nodeById[id] ? nodeById[id].name : null);
  const nodeByName = (name) => nodes.find((n) => n.name === name) || null;

  const openEntity = (id) => {
    if (!nodeById[id]) return;
    setEntityId(id);
    setView('entity');
    setHash(`entity=${encodeURIComponent(nodeById[id].name)}`);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };
  const openHome = () => { setView('home'); setEntityId(null); setHash(''); };
  const openExplore = (focusId) => {
    setExploreFocus(focusId || null);
    setView('explore');
    const nm = nameOf(focusId);
    setHash(nm ? `explore=${encodeURIComponent(nm)}` : 'explore');
  };
  const goConnect = (initialFromId) => {
    const from = initialFromId && nodeById[initialFromId] ? initialFromId : null;
    setConnectFrom(from);
    setView('connect');
    const nm = nameOf(from);
    setHash(nm ? `connect=${encodeURIComponent(nm)}` : 'connect');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  /* Deep-link restore: on first load (and back/forward), open whatever the hash names — matched
     by entity name so a shared link survives pipeline recomputes. */
  useEffect(() => {
    const applyHash = () => {
      const h = window.location.hash.replace(/^#/, '');
      const eq = h.indexOf('=');
      const k = eq === -1 ? h : h.slice(0, eq);
      const v = eq === -1 ? null : decodeURIComponent(h.slice(eq + 1));
      if (k === 'entity' && v) {
        const n = nodeByName(v);
        if (n) { setEntityId(n.id); setView('entity'); return; }
        setView('home'); setEntityId(null);
      } else if (k === 'connect') {
        const n = v ? nodeByName(v) : null;
        setConnectFrom(n ? n.id : null); setView('connect');
      } else if (k === 'explore') {
        const n = v ? nodeByName(v) : null;
        setExploreFocus(n ? n.id : null); setView('explore');
      } else {
        setView('home'); setEntityId(null);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  /* ---- Explore is the full-screen original graph; render it bare (it owns the
     viewport, header and all) so we don't double up chrome. ---- */
  if (view === 'explore') {
    return (
      <Suspense
        fallback={
          <div style={{ position: 'fixed', inset: 0, background: BG, color: MUTE, display: 'grid', placeItems: 'center', fontFamily: SANS }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <Spinner />
              <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '.12em' }}>LOADING THE FULL NETWORK…</span>
            </div>
          </div>
        }
      >
        <div style={{ position: 'fixed', inset: 0 }}>
          <OrreryGraph nodes={nodes} links={links} types={types} initialFocusId={exploreFocus} autoWelcome={false} />
          <button
            onClick={openHome}
            style={{
              position: 'fixed', left: 12, bottom: 12, zIndex: 60,
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 20,
              background: PANEL, border: `1px solid ${HAIR}`, color: GOLD, fontFamily: SANS, fontSize: 13, fontWeight: 700,
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', cursor: 'pointer',
            }}
          >
            <ArrowLeft size={15} /> Findings
          </button>
        </div>
      </Suspense>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh', color: TEXT, background: BG, fontFamily: SANS,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <GlobalStyle />
      <Header
        ranked={ranked}
        types={types}
        onPick={openEntity}
        onHome={openHome}
        onExplore={() => openExplore(null)}
        onConnect={() => goConnect(null)}
      />
      <main style={{ flex: 1, width: '100%' }}>
        {view === 'home' && (
          <HomeView
            nodes={nodes}
            links={links}
            types={types}
            onOpenEntity={openEntity}
            onExplore={() => openExplore(null)}
            onConnect={() => goConnect(null)}
          />
        )}
        {view === 'entity' && entityId && (
          <EntityView
            entityId={entityId}
            nodes={nodes}
            links={links}
            types={types}
            onOpenEntity={openEntity}
            onBack={openHome}
            onExplore={() => openExplore(entityId)}
            onConnect={() => goConnect(entityId)}
          />
        )}
        {view === 'connect' && (
          <ConnectView
            nodes={nodes}
            links={links}
            types={types}
            onOpenEntity={openEntity}
            onBack={openHome}
            initialFromId={connectFrom}
          />
        )}
      </main>
    </div>
  );
}

/* ----------------------------- shared header ----------------------------- */
function Header({ ranked, types, onPick, onHome, onExplore, onConnect }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const boxRef = useRef(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ranked.filter((n) => n.name.toLowerCase().includes(s)).slice(0, 8);
  }, [q, ranked]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (id) => { onPick(id); setQ(''); setOpen(false); };

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', height: 56,
        borderBottom: `1px solid ${HAIR}`, background: 'rgba(9,12,22,0.82)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <button
        onClick={onHome}
        title="ORRERY — home"
        style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: TEXT }}
      >
        <BrandMark />
        <span style={{ lineHeight: 1, textAlign: 'left' }}>
          <span style={{ display: 'block', fontWeight: 800, letterSpacing: '.15em', fontSize: 15 }}>ORRERY</span>
          <span style={{ display: 'block', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.2em', textTransform: 'uppercase', color: MUTE, marginTop: 2 }}>influence, mapped</span>
        </span>
      </button>

      {/* global search — suggests entities, jumps to the dossier on select */}
      <div ref={boxRef} style={{ position: 'relative', flex: 1, maxWidth: 460, marginLeft: 'auto' }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} color={MUTE} style={{ position: 'absolute', left: 11, top: 10 }} />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search a person, company or party…"
            aria-label="Search a person, company or party"
            style={{
              width: '100%', height: 36, padding: '0 30px', borderRadius: 9, color: TEXT, fontSize: 13.5,
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${HAIR}`, outline: 'none',
            }}
          />
          {q && <X size={15} color={MUTE} onClick={() => { setQ(''); setOpen(false); }} style={{ position: 'absolute', right: 9, top: 10, cursor: 'pointer' }} />}
        </div>
        {open && results.length > 0 && (
          <div
            className="sc"
            style={{
              position: 'absolute', top: 42, left: 0, right: 0, zIndex: 50, maxHeight: 340, overflowY: 'auto',
              borderRadius: 11, background: PANEL, border: `1px solid ${HAIR}`,
              backdropFilter: 'blur(13px)', WebkitBackdropFilter: 'blur(13px)', boxShadow: '0 18px 55px rgba(0,0,0,0.5)', padding: 5,
            }}
          >
            {results.map((n) => (
              <div
                key={n.id}
                onClick={() => pick(n.id)}
                title={n.role}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9, cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(232,182,90,0.12)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: typeColor(n.type, types) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.role}</span>
                </span>
                {n.conflict && <span style={{ fontFamily: MONO, fontSize: 9, color: VERM, flex: '0 0 auto', opacity: n.conflictStrength === 'low' ? 0.5 : 1 }}>merits a look</span>}
              </div>
            ))}
          </div>
        )}
        {open && q.trim() && results.length === 0 && (
          <div style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 50, borderRadius: 11, background: PANEL, border: `1px solid ${HAIR}`, padding: '14px 12px', fontSize: 12.5, color: MUTE }}>
            No match. Try a surname, a company, or a party.
          </div>
        )}
      </div>

      <button
        onClick={onConnect}
        title="Find the connection between two names"
        style={{
          display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 12px', borderRadius: 9,
          background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIR}`, color: MUTE, cursor: 'pointer', fontSize: 13, fontWeight: 600, flex: '0 0 auto',
        }}
      >
        <GitCompareArrows size={16} /> <span className="hide-sm">Connect</span>
      </button>
      <button
        onClick={onExplore}
        title="Open the full network"
        style={{
          display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 12px', borderRadius: 9,
          background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIR}`, color: MUTE, cursor: 'pointer', fontSize: 13, fontWeight: 600, flex: '0 0 auto',
        }}
      >
        <Compass size={16} /> <span className="hide-sm">Explore</span>
      </button>
      <button
        onClick={() => setShowHelp(true)}
        title="How to read ORRERY"
        aria-label="How to read ORRERY"
        style={{
          width: 36, height: 36, borderRadius: 9, display: 'grid', placeItems: 'center', flex: '0 0 auto',
          background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIR}`, color: MUTE, cursor: 'pointer',
        }}
      >
        <BookOpen size={16} />
      </button>

      {showHelp && <HelpSheet onClose={() => setShowHelp(false)} />}
    </header>
  );
}

/* a quiet "how to read" sheet — replaces the old auto-opening welcome modal */
function HelpSheet({ onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(4,6,14,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sc"
        style={{ width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto', padding: '24px 22px 28px', borderRadius: 16, background: '#0E1426', border: `1px solid ${HAIR}` }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>How to read ORRERY</div>
          <X size={22} color={MUTE} onClick={onClose} style={{ cursor: 'pointer' }} />
        </div>
        <HelpPara><b style={{ color: GOLD }}>It maps the money and companies around UK politics.</b> Every entity is a person, company or party; every connection is drawn from a public register, and each one cites its source.</HelpPara>
        <HelpPara><b style={{ color: GOLD }}>Start with the findings.</b> The board surfaces conflicts of interest worth a look and the money behind the parties. Open any card, or search a name, to see that entity's sourced connections. <b>Connect</b> traces a path between any two names.</HelpPara>

        <HelpHead>The registers we read</HelpHead>
        <ul style={{ margin: '0 0 15px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <SourceItem name="Companies House">directors, shareholders and persons with significant control of UK companies.</SourceItem>
          <SourceItem name="Electoral Commission">donations to political parties and holders of elected office.</SourceItem>
          <SourceItem name="Parliament (Members)">MPs, their party and their committee seats.</SourceItem>
          <SourceItem name="Register of Members' Financial Interests">the earnings, directorships, shareholdings and gifts MPs must declare.</SourceItem>
          <SourceItem name="Contracts Finder">public contracts awarded to companies. Framework and dynamic-purchasing values are the buyer's published <i>ceiling</i>, not guaranteed spend.</SourceItem>
        </ul>

        <HelpHead>What “merits a look” means</HelpHead>
        <HelpPara>A structural overlap drawn from those records — for instance an MP who sits on a committee overseeing a sector while also directing a company in it. We show the overlap with its receipts and rank how closely the two sides align. It is a prompt to look, never an allegation.</HelpPara>

        <HelpHead>Confidence, and strength</HelpHead>
        <HelpPara><b style={{ color: GOLD }}>Confidence</b> is how sure we are a link is real and correctly identified — a shared Companies House number is near-certain; a name-only match is weaker and shown as such. <b style={{ color: GOLD }}>Strength</b> is how meaningful the tie is once it's real. Links established on an official identifier render solid; anything inferred renders dotted, and nothing uncertain about a named person is ever stated as fact.</HelpPara>

        <HelpPara><b style={{ color: GOLD }}>Explore</b> opens the full network for the curious — but you never need it to get an answer.</HelpPara>
        <div style={{ padding: '11px 13px', borderRadius: 10, background: 'rgba(229,101,75,0.08)', border: '1px solid rgba(229,101,75,0.25)', fontSize: 12.5, color: '#F0A593', lineHeight: 1.55 }}>
          A connection is a sourced public-record fact, not a judgement or any allegation of wrongdoing. ORRERY surfaces overlaps and lets you draw your own conclusion.
        </div>
      </div>
    </div>
  );
}
function HelpPara({ children }) {
  return <p style={{ fontSize: 14, lineHeight: 1.64, color: '#C7CEDF', marginBottom: 15 }}>{children}</p>;
}
function HelpHead({ children }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: GOLD, opacity: 0.85, margin: '4px 0 10px' }}>{children}</div>
  );
}
function SourceItem({ name, children }) {
  return (
    <li style={{ fontSize: 13, lineHeight: 1.5, color: '#C7CEDF', paddingLeft: 13, position: 'relative' }}>
      <span style={{ position: 'absolute', left: 0, top: 7, width: 5, height: 5, borderRadius: '50%', background: GOLD, opacity: 0.7 }} />
      <b style={{ color: '#E7ECF7', fontWeight: 700 }}>{name}</b> — {children}
    </li>
  );
}

/* --------------------------------- bits --------------------------------- */
export function BrandMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" style={{ flex: '0 0 auto' }} aria-hidden>
      <circle cx="13" cy="13" r="11" fill="none" stroke={GOLD} strokeOpacity=".35" />
      <circle cx="13" cy="13" r="6.5" fill="none" stroke={GOLD} strokeOpacity=".25" />
      <circle cx="13" cy="13" r="2.6" fill={GOLD} />
      <circle cx="24" cy="13" r="2" fill="#E08AAE" />
      <circle cx="6.5" cy="3.4" r="1.7" fill="#6FC3B8" />
      <circle cx="3.5" cy="19" r="1.7" fill="#9C8BD8" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" style={{ animation: 'spin 1s linear infinite' }} aria-hidden>
      <circle cx="13" cy="13" r="10" fill="none" stroke={HAIR} strokeWidth="2.5" />
      <path d="M13 3 a10 10 0 0 1 10 10" fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { margin: 0; }
      input, button { font-family: ${SANS}; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .sc::-webkit-scrollbar { width: 7px; height: 7px; }
      .sc::-webkit-scrollbar-thumb { background: rgba(190,200,230,.18); border-radius: 7px; }
      .eb { font-family: ${MONO}; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: ${MUTE}; }
      .in { animation: fin .3s ease both; }
      @keyframes fin { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @media (max-width: 560px) { .hide-sm { display: none; } }
    `}</style>
  );
}
