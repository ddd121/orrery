'use client';

/**
 * Explore — the full-network view. The whole graph (~2,000 nodes / ~5,800 links) is
 * rendered on a canvas by react-force-graph-2d (see ./components/OrreryCanvas), which
 * owns the force simulation, pan and zoom. Everything around the canvas — the header,
 * confidence dial, browse/search panel, filters, trace mode and the bottom-sheet
 * inspector — lives here and drives the canvas through plain props + a small imperative
 * ref (focus an entity, refit to screen).
 *
 * This replaces the original hand-rolled SVG + per-tick d3 render, which pinned the CPU
 * at full-Commons scale. The library idles when the layout settles; React does no work
 * per frame. All visual treatments (type colours, conflict ring, scrutiny halo,
 * dotted-weak edges, the gold trace path, "merits a look") are preserved on canvas.
 */
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Search, X, Share2, Newspaper, AlertTriangle, Info, Crosshair, Landmark, User, Building2, Flag, Users, Briefcase, ChevronUp, ChevronDown, Filter } from 'lucide-react';
import { findPath, idOf, radius, confColor as confColorShared, typeColor, typeIcon } from '@/lib/graph-utils';

/* OrreryCanvas touches `window` (canvas + d3-force), so it's client-only. */
const OrreryCanvas = dynamic(() => import('./components/OrreryCanvas'), { ssr: false });

/* ---------- design tokens: "orrery" — a working model of how power orbits ---------- */
const GOLD = '#E8B65A';
const VERM = '#E5654B';
const TEXT = '#E8ECF6';
const MUTE = '#8A93AD';
const HAIR = 'rgba(190,200,230,0.10)';
const PANEL = 'rgba(13,18,34,0.92)';
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
const SANS = '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';

const TAG = { Scrutiny: VERM, Funding: GOLD, Contract: '#6FC3B8', Donation: '#E08AAE', Mention: MUTE, Appointment: '#9C8BD8' };
/* entity-type icons resolved by name (entity_types.ui_icon from the database) */
const ICONS = { Landmark, User, Building2, Flag, Users, Briefcase };

/* ------------------------------ helpers ------------------------------ */
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

const PEEK = 150; // px of sheet visible when collapsed

/* ================================ APP ================================ */
export default function OrreryGraph({ nodes: RAW_NODES, links: RAW_LINKS, types: TYPES, initialFocusId = null, autoWelcome = true }) {
  /* Clone once so react-force-graph can attach x/y/vx/vy without mutating the caller's
     arrays. Links keep string source/target ids; the library resolves them to node refs. */
  const nodes = useMemo(() => RAW_NODES.map((n) => ({ ...n })), [RAW_NODES]);
  const links = useMemo(() => RAW_LINKS.map((l) => ({ ...l })), [RAW_LINKS]);
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const [selected, setSelected] = useState(null);
  const [threshold, setThreshold] = useState(40);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState(() => new Set(Object.keys(TYPES || {})));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [traceMode, setTraceMode] = useState(false);
  const [traceFrom, setTraceFrom] = useState(null);
  const [tracePath, setTracePath] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [sheetUp, setSheetUp] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);

  const canvasRef = useRef(null);

  const nodeById = useMemo(() => { const m = {}; nodes.forEach((n) => (m[n.id] = n)); return m; }, [nodes]);
  const TYPE = TYPES || {};

  /* render the canvas only after mount — it needs the DOM (window/canvas). */
  useEffect(() => { setMounted(true); }, []);

  /* selection / trace activation (a ref so the canvas click handler always reads live state) */
  const activateRef = useRef(() => {});
  activateRef.current = (d) => {
    if (traceMode && traceFrom && traceFrom !== d.id) {
      setTracePath(findPath(traceFrom, d.id, links, threshold));
      setTraceMode(false); setSelected(d.id); setSheetUp(false);
      return;
    }
    if (traceMode && !traceFrom) { setTraceFrom(d.id); setSelected(d.id); return; }
    setSelected(d.id); setSheetUp(false);
  };

  // first-time visitors get the welcome automatically (once); the ⓘ button reopens it.
  // Suppressed when embedded as the opt-in Explore view — the redesign drops the
  // auto-welcome there (its "how to read" lives in the app header instead).
  useEffect(() => {
    if (!autoWelcome) return;
    try {
      if (!localStorage.getItem('orrery_welcomed')) {
        setShowInfo(true);
        localStorage.setItem('orrery_welcomed', '1');
      }
    } catch { /* private mode / SSR */ }
  }, [autoWelcome]);

  /* derived */
  const isOn = useCallback((t) => active.has(t), [active]);
  const sq = search.trim().toLowerCase();
  const matches = useCallback((n) => sq !== '' && n.name.toLowerCase().includes(sq), [sq]);
  const matchesId = useCallback((id) => { const n = nodeById[id]; return !!n && sq !== '' && n.name.toLowerCase().includes(sq); }, [nodeById, sq]);

  const neighbours = useMemo(() => {
    const s = new Set(); if (!selected) return s;
    links.forEach((l) => {
      const a = idOf(l.source), b = idOf(l.target);
      if (l.confidence * 100 < threshold || !nodeById[a] || !nodeById[b] || !isOn(nodeById[a].type) || !isOn(nodeById[b].type)) return;
      if (a === selected) s.add(b); if (b === selected) s.add(a);
    });
    return s;
  }, [selected, threshold, active, links, nodeById, isOn]);

  const tracePairs = useMemo(() => { const s = new Set(); if (tracePath) for (let i = 0; i < tracePath.length - 1; i++) s.add(pairKey(tracePath[i], tracePath[i + 1])); return s; }, [tracePath]);
  const traceSet = useMemo(() => new Set(tracePath || []), [tracePath]);
  const hiddenCount = useMemo(() => links.filter((l) => l.confidence * 100 < threshold).length, [links, threshold]);
  const focusId = selected;

  const selNode = selected ? nodeById[selected] : null;
  const selConns = useMemo(() => {
    if (!selected) return [];
    return links.filter((l) => idOf(l.source) === selected || idOf(l.target) === selected)
      .map((l) => { const o = idOf(l.source) === selected ? idOf(l.target) : idOf(l.source); return { other: nodeById[o], rel: l.rel, amount: l.amount, strength: l.strength, confidence: l.confidence, method: l.method }; })
      .filter((c) => c.other)
      .sort((a, b) => b.strength - a.strength);
  }, [selected, links, nodeById]);
  const findLink = (a, b) => links.find((l) => (idOf(l.source) === a && idOf(l.target) === b) || (idOf(l.source) === b && idOf(l.target) === a));
  const confColor = confColorShared;

  /* the live snapshot the canvas paints from — bundled so OrreryCanvas reads one object. */
  const ui = useMemo(() => ({
    types: TYPE,
    nodeById,
    threshold,
    selectedId: selected,
    focusId,
    traceSet,
    tracePairs,
    neighbours,
    hasSearch: sq !== '',
    isOn,
    matchesId,
    pairKey,
  }), [TYPE, nodeById, threshold, selected, focusId, traceSet, tracePairs, neighbours, sq, isOn, matchesId]);

  const runExample = () => {
    const ranked = [...nodes].sort((a, b) => b.importance - a.importance);
    const start = ranked[0]; if (!start) return;
    for (const o of ranked) {
      if (o.id === start.id) continue;
      const p = findPath(start.id, o.id, links, 0);
      if (p && p.length >= 3) {
        setSelected(start.id); setTracePath(p); setTraceMode(false); setTraceFrom(null); setSheetUp(false);
        canvasRef.current?.centerOnNode(nodeById[start.id], 1.1, 800);
        return;
      }
    }
  };
  const startTrace = () => { if (!selected) return; setTraceMode(true); setTraceFrom(selected); setTracePath(null); setSheetUp(false); };
  const clearTrace = () => { setTracePath(null); setTraceMode(false); setTraceFrom(null); };
  const toggleType = (t) => setActive((p) => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  /* fly to an entity and select it (used by the browse/search panel + dossier hand-off) */
  const focusOn = useCallback((id) => {
    const n = nodeById[id]; if (!n) return;
    setSelected(id); setSheetUp(false);
    canvasRef.current?.centerOnNode(n, 1.7, 700);
  }, [nodeById]);

  const recenter = useCallback(() => { canvasRef.current?.fit(600, 56); }, []);

  /* when launched from "Explore in the full network", land focused on that entity.
     Fire once, after the layout has settled (nodes have positions) and the canvas exists.
     A timeout fallback covers the case where the engine is still cooling down on a big
     graph — nodes already have usable positions after warmup, so we don't need a full stop.
     Guarded by a ref so it never re-runs. */
  const focusedOnceRef = useRef(false);
  useEffect(() => {
    if (focusedOnceRef.current || !initialFocusId) return;
    const tryFocus = () => {
      if (focusedOnceRef.current) return;
      const n = nodeById[initialFocusId];
      if (!n || n.x == null) return;
      focusOn(initialFocusId);
      focusedOnceRef.current = true;
    };
    if (settled) { tryFocus(); return; }
    const t = setTimeout(tryFocus, 1400);
    return () => clearTimeout(t);
  }, [initialFocusId, settled, nodeById, focusOn]);

  /* entities ranked by what merits a look: conflicts first, then scrutiny, then connectedness */
  const ranked = useMemo(() => {
    const sr = { strong: 0, medium: 1, low: 2 };
    const crank = (n) => (n.conflict ? (sr[n.conflictStrength] ?? 1) : 3);
    const l = [...nodes];
    l.sort((a, b) =>
      (crank(a) - crank(b)) ||
      ((b.scrutiny || 0) - (a.scrutiny || 0)) ||
      (b.importance - a.importance) ||
      a.name.localeCompare(b.name));
    return l;
  }, [nodes]);
  const panelList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? ranked.filter((n) => n.name.toLowerCase().includes(q)) : ranked).slice(0, 80);
  }, [ranked, search]);

  const SAFE = { fontFamily: SANS };

  if (!mounted) return <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(900px 640px at 50% -10%, #131b34 0%, #0B1020 54%, #070a16 100%)' }} />;

  return (
    <div style={{ position: 'fixed', inset: 0, ...SAFE, color: TEXT, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: 'radial-gradient(900px 640px at 50% -10%, #131b34 0%, #0B1020 54%, #070a16 100%)' }}>
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input { font-family: ${SANS}; }
        button { font-family: ${SANS}; }
        .rng { -webkit-appearance:none; appearance:none; height:5px; border-radius:5px; outline:none; cursor:pointer; }
        .rng::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:24px; height:24px; border-radius:50%; background:#fff; border:3px solid ${GOLD}; box-shadow:0 0 12px rgba(232,182,90,.9); cursor:pointer; }
        .rng::-moz-range-thumb { width:24px; height:24px; border-radius:50%; background:#fff; border:3px solid ${GOLD}; box-shadow:0 0 12px rgba(232,182,90,.9); cursor:pointer; }
        .in { animation: fin .3s ease both; }
        @keyframes fin { from{ opacity:0; transform:translateY(8px) } to{ opacity:1; transform:none } }
        .sc::-webkit-scrollbar { width:7px; height:7px; }
        .sc::-webkit-scrollbar-thumb { background:rgba(190,200,230,.18); border-radius:7px; }
        .eb { font-family:${MONO}; font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:${MUTE}; }
      `}</style>

      {/* ---------- HEADER ---------- */}
      <div style={{ flex: '0 0 auto', height: 52, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', borderBottom: `1px solid ${HAIR}`, zIndex: 20 }}>
        <svg width="24" height="24" viewBox="0 0 26 26" style={{ flex: '0 0 auto' }}>
          <circle cx="13" cy="13" r="11" fill="none" stroke={GOLD} strokeOpacity=".35" />
          <circle cx="13" cy="13" r="6.5" fill="none" stroke={GOLD} strokeOpacity=".25" />
          <circle cx="13" cy="13" r="2.6" fill={GOLD} />
          <circle cx="24" cy="13" r="2" fill="#E08AAE" /><circle cx="6.5" cy="3.4" r="1.7" fill="#6FC3B8" /><circle cx="3.5" cy="19" r="1.7" fill="#9C8BD8" />
        </svg>
        <div style={{ lineHeight: 1, flex: 1 }}>
          <div style={{ fontWeight: 800, letterSpacing: '.15em', fontSize: 15 }}>ORRERY</div>
          <div className="eb" style={{ marginTop: 2 }}>influence, mapped</div>
        </div>
        <IconBtn onClick={() => setSearchOpen((s) => !s)} active={searchOpen}><Search size={18} /></IconBtn>
        <IconBtn onClick={() => setFiltersOpen((s) => !s)} active={filtersOpen}><Filter size={18} /></IconBtn>
        <IconBtn onClick={() => setShowInfo(true)}><Info size={18} /></IconBtn>
      </div>

      {/* ---------- CONFIDENCE BAR ---------- */}
      <div style={{ flex: '0 0 auto', padding: '9px 16px 11px', borderBottom: `1px solid ${HAIR}`, zIndex: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
          <span className="eb">Min confidence</span>
          <span style={{ fontFamily: MONO, fontSize: 13, color: GOLD, fontWeight: 700 }}>{threshold}% · <span style={{ color: MUTE }}>{hiddenCount} hidden</span></span>
        </div>
        <input type="range" min="0" max="100" value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="rng"
          style={{ width: '100%', background: `linear-gradient(90deg, ${GOLD} ${threshold}%, rgba(255,255,255,.12) ${threshold}%)` }} />
      </div>

      {/* ---------- GRAPH ---------- */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'none', cursor: traceMode ? 'crosshair' : 'default' }}>
        <OrreryCanvas
          ref={canvasRef}
          graphData={graphData}
          types={TYPE}
          ui={ui}
          onNodeClick={(n) => activateRef.current(n)}
          onBackgroundClick={() => { setSelected(null); setSheetUp(false); setFiltersOpen(false); }}
          onEngineStop={() => setSettled(true)}
        />

        {/* recenter */}
        <button onClick={recenter} style={{ position: 'absolute', top: 12, right: 12, width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center',
          background: PANEL, border: `1px solid ${HAIR}`, color: GOLD, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 10 }}>
          <Crosshair size={19} />
        </button>

        {/* ---------- BROWSE / SEARCH PANEL — the way in ---------- */}
        {searchOpen && (
          <div className="in" style={{ position: 'absolute', top: 12, left: 12, bottom: 12, width: 296, zIndex: 30, display: 'flex', flexDirection: 'column', borderRadius: 14, background: PANEL, border: `1px solid ${HAIR}`, backdropFilter: 'blur(13px)', WebkitBackdropFilter: 'blur(13px)', overflow: 'hidden', boxShadow: '0 18px 55px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '11px 11px 9px', borderBottom: `1px solid ${HAIR}` }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} color={MUTE} style={{ position: 'absolute', left: 10, top: 11 }} />
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people, companies, MPs…"
                  style={{ width: '100%', height: 36, padding: '0 30px', borderRadius: 9, color: TEXT, fontSize: 13.5, background: 'rgba(255,255,255,0.06)', border: `1px solid ${HAIR}`, outline: 'none', boxSizing: 'border-box' }} />
                {search && <X size={15} color={MUTE} onClick={() => setSearch('')} style={{ position: 'absolute', right: 9, top: 10, cursor: 'pointer' }} />}
              </div>
              <div className="eb" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                {search.trim()
                  ? `${panelList.length} match${panelList.length === 1 ? '' : 'es'}`
                  : <><AlertTriangle size={11} color={VERM} /> Start at the top — sorted by what merits a look</>}
              </div>
            </div>
            <div className="sc" style={{ flex: 1, overflowY: 'auto', padding: '5px' }}>
              {panelList.map((n) => (
                <div key={n.id} onClick={() => focusOn(n.id)} title={n.role}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9, cursor: 'pointer', background: selected === n.id ? 'rgba(232,182,90,0.16)' : 'transparent' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: typeColor(n.type, TYPE) }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.role}</span>
                  </span>
                  {n.conflict ? <AlertTriangle size={13} color={VERM} style={{ flex: '0 0 auto', opacity: n.conflictStrength === 'low' ? 0.4 : 1 }} />
                    : n.scrutiny >= 0.7 ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: VERM, opacity: 0.75, flex: '0 0 auto' }} /> : null}
                </div>
              ))}
              {!panelList.length && <div style={{ padding: '16px 10px', fontSize: 12.5, color: MUTE }}>No match. Try a surname, a company, or a party.</div>}
            </div>
          </div>
        )}

        {/* trace status / result — top of graph, clear of the sheet */}
        {(traceMode || tracePath) && (
          <div className="in sc" style={{ position: 'absolute', top: 12, left: 12, right: 66, maxHeight: 70, overflowX: 'auto',
            padding: '9px 12px', borderRadius: 12, background: 'rgba(20,16,8,0.92)', border: `1px solid rgba(232,182,90,0.45)`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 12 }}>
            {traceMode ? (
              <span style={{ fontSize: 13, color: GOLD, fontWeight: 600 }}>{traceFrom ? 'Tap a second entity…' : 'Tap a starting entity…'}</span>
            ) : tracePath && tracePath.length > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flex: 1, overflowX: 'auto' }} className="sc">
                  {tracePath.map((id, i) => {
                    const n = nodeById[id]; const lk = i < tracePath.length - 1 ? findLink(id, tracePath[i + 1]) : null;
                    if (!n) return null;
                    return (
                      <React.Fragment key={id}>
                        <span onClick={() => { setSelected(id); canvasRef.current?.centerOnNode(nodeById[id], 1.6, 600); }} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor(n.type, TYPE) }} />
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{n.name}</span>
                        </span>
                        {lk && <span style={{ fontFamily: MONO, fontSize: 10, color: confColor(lk.confidence) }}>·{Math.round(lk.confidence * 100)}%→</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
                <X size={16} color={MUTE} onClick={clearTrace} style={{ flex: '0 0 auto' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: MUTE }}>No trail at this confidence — lower the dial.</span>
                <X size={15} color={MUTE} onClick={clearTrace} style={{ flex: '0 0 auto' }} />
              </div>
            )}
          </div>
        )}

        {/* hint + example (only when nothing selected) */}
        {!selNode && !traceMode && (
          <div className="in" style={{ position: 'absolute', bottom: 16, left: 12, right: 12, display: 'flex', gap: 9, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', zIndex: 12 }}>
            {!searchOpen && (
              <button onClick={() => setSearchOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 20, background: GOLD, border: `1px solid ${GOLD}`, color: '#1A1206', fontSize: 13, fontWeight: 700 }}>
                <Search size={15} /> Start here · search &amp; leads
              </button>
            )}
            <button onClick={runExample} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 20, background: 'rgba(232,182,90,0.14)', border: `1px solid rgba(232,182,90,0.45)`, color: GOLD, fontSize: 13, fontWeight: 600 }}>
              <Share2 size={15} /> Example trail
            </button>
          </div>
        )}

        {/* ---------- BOTTOM SHEET ---------- */}
        {selNode && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '80vh', zIndex: 30,
            transform: sheetUp ? 'translateY(0)' : `translateY(calc(80vh - ${PEEK}px))`, transition: 'transform .3s cubic-bezier(.4,0,.2,1)',
            background: PANEL, borderTop: `1px solid ${HAIR}`, borderRadius: '18px 18px 0 0', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            boxShadow: '0 -16px 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}>
            {/* handle + header (always within peek window) */}
            <div onClick={() => setSheetUp((s) => !s)} style={{ flex: '0 0 auto', padding: '10px 18px 14px', cursor: 'pointer' }}>
              <div style={{ width: 38, height: 4, borderRadius: 4, background: 'rgba(190,200,230,0.3)', margin: '0 auto 14px' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${typeColor(selNode.type, TYPE)}22`, border: `1px solid ${typeColor(selNode.type, TYPE)}66` }}>
                  {React.createElement(typeIcon(selNode.type, TYPE) || User, { size: 20, color: typeColor(selNode.type, TYPE) })}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{selNode.name}</div>
                  <div style={{ fontSize: 12.5, color: MUTE, marginTop: 3 }}>{selNode.role}</div>
                  {selNode.scrutiny >= 0.7 && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, padding: '3px 9px', borderRadius: 6, background: 'rgba(229,101,75,0.14)', border: '1px solid rgba(229,101,75,0.5)', color: '#F0A593', fontSize: 11, fontFamily: MONO }}>
                      <AlertTriangle size={12} /> Merits a look{selNode.scrutinyMoney ? ` · ${selNode.scrutinyMoney} in political money nearby` : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                  <IconBtn small onClick={(e) => { e.stopPropagation(); startTrace(); }}><Share2 size={16} /></IconBtn>
                  <IconBtn small onClick={(e) => { e.stopPropagation(); setSelected(null); setSheetUp(false); }}><X size={16} /></IconBtn>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 11 }}>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTE }}>{selConns.length} connections{selNode.news && selNode.news.length ? ' · in the news' : ''}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: GOLD }}>
                  {sheetUp ? <>Less <ChevronDown size={14} /></> : <>Details <ChevronUp size={14} /></>}
                </span>
              </div>
            </div>

            {/* scrollable detail */}
            <div className="sc" style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 28px' }}>
              {selNode.conflict && (() => {
                const low = selNode.conflictStrength === 'low';
                const strong = selNode.conflictStrength === 'strong';
                const acc = low ? '#9AA0AD' : VERM;
                const head = strong ? `Strong signal · ${selNode.conflictOverlap} overlap`
                  : low ? 'Flagged · lower priority' : 'Worth a look';
                return (
                  <div style={{ display: 'flex', gap: 9, padding: '12px 13px', marginBottom: 16, borderRadius: 11, background: low ? 'rgba(154,160,173,0.10)' : 'rgba(229,101,75,0.12)', border: `1px solid ${low ? 'rgba(154,160,173,0.40)' : 'rgba(229,101,75,0.5)'}` }}>
                    <AlertTriangle size={16} color={acc} style={{ flex: '0 0 auto', marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: low ? '#AEB4C0' : '#F0A593', letterSpacing: '.12em', textTransform: 'uppercase' }}>Conflict-shaped · {head}</div>
                      <div style={{ fontSize: 13, color: low ? '#C7CBD3' : '#E8C7BC', lineHeight: 1.5, marginTop: 5 }}>{selNode.conflictReason}</div>
                    </div>
                  </div>
                );
              })()}
              {/* trace from here (full width) */}
              <button onClick={startTrace} style={{ width: '100%', height: 42, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 18,
                background: 'rgba(232,182,90,0.12)', border: `1px solid rgba(232,182,90,0.4)`, color: GOLD, fontSize: 14, fontWeight: 600 }}>
                <Share2 size={16} /> Trace a path from here
              </button>

              {/* news */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><Newspaper size={14} color={MUTE} /><span className="eb">Recent coverage</span></div>
              {!selNode.news || selNode.news.length === 0 ? (
                <div style={{ fontSize: 13, color: MUTE, fontStyle: 'italic', marginBottom: 22 }}>No coverage indexed yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginBottom: 24 }}>
                  {selNode.news.map((a, i) => (
                    <div key={i} style={{ borderLeft: `2px solid ${TAG[a.tag]}`, paddingLeft: 12 }}>
                      <div style={{ fontSize: 14, lineHeight: 1.4, fontWeight: 500 }}>{a.h}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTE }}>{a.s} · {a.t}</span>
                        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: TAG[a.tag], padding: '2px 7px', borderRadius: 5, background: `${TAG[a.tag]}1A` }}>{a.tag}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* connections */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}>
                <span className="eb">Connections</span><span style={{ fontFamily: MONO, fontSize: 11, color: MUTE }}>{selConns.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {selConns.map((c, i) => (
                  <div key={i} onClick={() => { setSelected(c.other.id); canvasRef.current?.centerOnNode(c.other, 1.6, 600); }} style={{ padding: '12px 13px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${HAIR}`, cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: typeColor(c.other.type, TYPE), flex: '0 0 auto' }} />
                        <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.other.name}</span>
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: confColor(c.confidence), flex: '0 0 auto' }}>{Math.round(c.confidence * 100)}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, fontFamily: MONO, fontSize: 11, color: MUTE }}>
                      <span style={{ color: '#B9C2D8' }}>{c.rel}</span>{c.amount && <span>· {c.amount}</span>}
                    </div>
                    <div style={{ height: 3, borderRadius: 3, marginTop: 8, background: 'rgba(255,255,255,0.08)' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${c.strength * 100}%`, background: typeColor(c.other.type, TYPE), opacity: 0.85 }} />
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: MUTE, marginTop: 7, opacity: 0.85 }}>via {c.method}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, fontSize: 12, color: MUTE, lineHeight: 1.55, display: 'flex', gap: 8 }}>
                <Info size={13} style={{ flex: '0 0 auto', marginTop: 1 }} />Every connection cites a source. A link is a public-record fact, not a judgement.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* sample marker (bottom-pinned, subtle) */}
      <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none',
        fontFamily: MONO, fontSize: 9, letterSpacing: '.16em', color: 'rgba(240,165,147,0.5)' }}>PUBLIC RECORDS · COMPANIES HOUSE · ELECTORAL COMMISSION · PARLIAMENT</div>

      {/* ---------- FILTERS POPOVER ---------- */}
      {filtersOpen && (
        <>
          <div onClick={() => setFiltersOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 35 }} />
          <div className="in" style={{ position: 'absolute', top: 56, right: 12, zIndex: 36, width: 210, padding: 15, borderRadius: 14, background: '#0E1426', border: `1px solid ${HAIR}`, boxShadow: '0 16px 50px rgba(0,0,0,0.5)' }}>
            <div className="eb" style={{ marginBottom: 11 }}>Entities</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {Object.entries(TYPE).map(([k, v]) => {
                const onn = active.has(k);
                return (
                  <div key={k} onClick={() => toggleType(k)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', opacity: onn ? 1 : 0.4 }}>
                    <span style={{ width: 11, height: 11, borderRadius: '50%', background: v.color, boxShadow: onn ? `0 0 7px ${v.color}` : 'none', flex: '0 0 auto' }} />
                    <span style={{ fontSize: 14, color: onn ? TEXT : MUTE }}>{v.label}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, paddingTop: 13, borderTop: `1px solid ${HAIR}` }}>
              <div className="eb" style={{ marginBottom: 9 }}>Lines</div>
              <Key svg={<line x1="0" y1="5" x2="30" y2="5" stroke="rgba(150,170,210,1)" strokeWidth="3.4" strokeLinecap="round" />} label="Thicker = stronger" />
              <Key svg={<line x1="0" y1="5" x2="30" y2="5" stroke="rgba(150,170,210,.85)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />} label="Dotted = unconfirmed" />
              <Key svg={<line x1="0" y1="5" x2="30" y2="5" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />} label="Gold = traced" />
            </div>
          </div>
        </>
      )}

      {/* ---------- INFO MODAL ---------- */}
      {showInfo && (
        <div onClick={() => setShowInfo(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(4,6,14,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', padding: 0 }}>
          <div onClick={(e) => e.stopPropagation()} className="in sc" style={{ width: '100%', maxHeight: '86vh', overflowY: 'auto', padding: '24px 22px 30px', borderRadius: '18px 18px 0 0', background: '#0E1426', border: `1px solid ${HAIR}` }}>
            <div style={{ width: 38, height: 4, borderRadius: 4, background: 'rgba(190,200,230,0.3)', margin: '0 auto 18px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>What is ORRERY?</div>
              <X size={22} color={MUTE} onClick={() => setShowInfo(false)} />
            </div>
            <Para><b style={{ color: GOLD }}>It maps the money and companies around UK politics.</b> Every dot is a person, company or party; every line is a connection drawn from a public register. Every link cites its source.</Para>
            <Para><b style={{ color: GOLD }}>What you can find.</b> Which MPs hold business interests that overlap the laws they are shaping; who funds each party, and the people behind those companies; and the path connecting any two figures.</Para>
            <div onClick={() => { setShowInfo(false); setSearchOpen(true); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', margin: '6px 0 18px', borderRadius: 12, background: GOLD, color: '#1A1206', cursor: 'pointer', fontWeight: 800, fontSize: 15.5 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span>Show me the leads →</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, opacity: 0.82 }}>connections ranked by what merits a look — start at the top</span>
              </span>
              <Search size={18} style={{ flex: '0 0 auto' }} />
            </div>
            <Para><b style={{ color: GOLD }}>Move around.</b> Drag the background to pan, scroll or pinch to zoom, drag a node to pull the web apart. A <span style={{ color: VERM, fontWeight: 700 }}>red ring</span> flags an entity that merits a look. The <Crosshair size={13} style={{ verticalAlign: '-2px' }} /> button refits everything to screen.</Para>
            <Para><b style={{ color: GOLD }}>Tap a node.</b> A panel slides up with who funds it, who sits where, and what’s been written. Tap the handle to expand it; tap the background to dismiss.</Para>
            <Para><b style={{ color: GOLD }}>Confidence.</b> A fuzzy name match is weaker than a Companies House ID. Solid lines are confirmed; dotted are suspected. The dial up top hides anything below your threshold.</Para>
            <Para><b style={{ color: GOLD }}>Trails.</b> Trace a path between two figures to see exactly how they’re joined, step by step. Raise the dial and a weak link can break the chain; lower it and a hidden one completes it.</Para>
            <Para><b style={{ color: GOLD }}>The line we hold.</b> ORRERY surfaces public-record connections and lets you draw your own conclusion. It never alleges wrongdoing — a connection is a fact with a source attached.</Para>
            <div style={{ padding: '11px 13px', borderRadius: 10, background: 'rgba(229,101,75,0.08)', border: '1px solid rgba(229,101,75,0.25)', fontSize: 12.5, color: '#F0A593', display: 'flex', gap: 9 }}>
              <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 1 }} />Drawn from public records — Companies House, the Electoral Commission and the UK Parliament. A connection is a sourced public-record fact, not a judgement or any allegation of wrongdoing.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------- small components -------------------------- */
function IconBtn({ children, onClick, active, small }) {
  const s = small ? 34 : 40;
  return (
    <button onClick={onClick} style={{ width: s, height: s, flex: '0 0 auto', borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer',
      background: active ? 'rgba(232,182,90,0.16)' : 'rgba(255,255,255,0.05)', border: `1px solid ${active ? 'rgba(232,182,90,0.45)' : HAIR}`, color: active ? GOLD : MUTE }}>
      {children}
    </button>
  );
}
function Key({ svg, label }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}><svg width="30" height="10" style={{ flex: '0 0 auto' }}>{svg}</svg><span style={{ fontSize: 12.5, color: MUTE }}>{label}</span></div>;
}
function Para({ children }) {
  return <p style={{ fontSize: 14, lineHeight: 1.66, color: '#C7CEDF', marginBottom: 15 }}>{children}</p>;
}
