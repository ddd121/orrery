'use client';

/**
 * Explore — the constellation view (DESIGN_SPEC_V2 "Step 5: Explore = constellation").
 *
 * Never renders the whole graph. On entry (no focus) it shows a curated "constellation":
 * every finding member, the endpoints of the top 25 donations, and the top 50 nodes by
 * degree — capped at 300 nodes / 900 edges (see `buildConstellation` in lib/graph-utils).
 * Searching or clicking a node switches to "focus" mode: the node plus its neighbourhood
 * within N hops (capped at 150), with everything else removed from the data outright
 * (dimming still reads as a hairball at this scale). A "Widen" control steps the hop
 * radius 1→2→3.
 *
 * This view no longer owns the page chrome — OrreryApp renders the shared header and an
 * explore breadcrumb above it, and this component fills the remaining height. It keeps
 * its own in-canvas overlays: the confidence dial, type filters, trace mode, the honesty
 * chip and the entity inspector (a docked right panel on desktop, a full-screen push
 * panel on mobile).
 */
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  MagnifyingGlass, X, ShareNetwork, WarningDiamond, Info, Crosshair, CaretUp, CaretDown,
  FunnelSimple, ArrowsOutSimple, ArrowSquareOut,
} from '@phosphor-icons/react';
import {
  findPath, idOf, typeColor, typeIcon,
  buildConstellation, buildFocusSubgraph, hashIdSet,
  TEXT_1, TEXT_2, HAIRLINE, BRASS, SIGNAL, MONO, SANS,
} from '@/lib/graph-utils';
import TieRow from './components/TieRow';

/* OrreryCanvas touches `window` (canvas + d3-force), so it's client-only. */
const OrreryCanvas = dynamic(() => import('./components/OrreryCanvas'), { ssr: false });

/* ---------- v2 tokens (aliased to the names this file already used) ---------- */
const GOLD = BRASS;
const VERM = SIGNAL;
const TEXT = TEXT_1;
const MUTE = TEXT_2;
const HAIR = HAIRLINE;
const PANEL = 'rgba(13,18,34,0.92)';

/* ------------------------------ helpers ------------------------------ */
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const MOBILE_BREAK = 720;

/* ================================ APP ================================ */
export default function OrreryGraph({
  nodes: RAW_NODES, links: RAW_LINKS, types: TYPES, findings: RAW_FINDINGS,
  initialFocusId = null, autoWelcome = true, onOpenEntity,
}) {
  const findings = RAW_FINDINGS || [];
  const allNodes = RAW_NODES || [];
  const allLinks = RAW_LINKS || [];

  const nodeById = useMemo(() => { const m = {}; allNodes.forEach((n) => (m[n.id] = n)); return m; }, [allNodes]);
  const TYPE = TYPES || {};

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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  /* focus state: null = constellation (default). A focused entity id + a hop radius
     that "Widen" steps 1 -> 2 -> 3. */
  const [focusEntityId, setFocusEntityId] = useState(initialFocusId || null);
  const [hops, setHops] = useState(2);

  const canvasRef = useRef(null);

  /* render the canvas only after mount — it needs the DOM (window/canvas). */
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAK);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /* ---------- the constellation / focus subgraph (never the whole network) ---------- */
  const subgraph = useMemo(() => {
    if (focusEntityId && nodeById[focusEntityId]) {
      const { nodeIds, edges } = buildFocusSubgraph(focusEntityId, allNodes, allLinks, hops);
      return { nodeIds, edges, findingMemberIds: new Set(), mode: 'focus' };
    }
    const { nodeIds, edges, findingMemberIds } = buildConstellation(allNodes, allLinks, findings);
    return { nodeIds, edges, findingMemberIds, mode: 'constellation' };
  }, [focusEntityId, hops, allNodes, allLinks, findings, nodeById]);

  const nodes = useMemo(
    () => allNodes.filter((n) => subgraph.nodeIds.has(n.id)).map((n) => ({ ...n, isFindingMember: subgraph.findingMemberIds.has(n.id) })),
    [allNodes, subgraph],
  );
  const links = useMemo(() => subgraph.edges.map((l) => ({ ...l })), [subgraph]);
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);
  /* cache key for this exact node-set: OrreryCanvas restores/saves layout under it so
     returning to the same constellation or focus is instant, never re-simulated. */
  const layoutKey = useMemo(() => `orrery-explore-layout:${hashIdSet(subgraph.nodeIds)}`, [subgraph.nodeIds]);

  const scopedNodeById = useMemo(() => { const m = {}; nodes.forEach((n) => (m[n.id] = n)); return m; }, [nodes]);

  /* selection / trace activation (a ref so the canvas click handler always reads live state) */
  const activateRef = useRef(() => {});
  activateRef.current = (d) => {
    if (traceMode && traceFrom && traceFrom !== d.id) {
      setTracePath(findPath(traceFrom, d.id, links, threshold));
      setTraceMode(false); setSelected(d.id); setInspectorOpen(true);
      return;
    }
    if (traceMode && !traceFrom) { setTraceFrom(d.id); setSelected(d.id); return; }
    focusOn(d.id);
  };

  // first-time visitors get the welcome automatically (once); the ⓘ button reopens it.
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
  const matchesId = useCallback((id) => { const n = scopedNodeById[id]; return !!n && sq !== '' && n.name.toLowerCase().includes(sq); }, [scopedNodeById, sq]);

  const neighbours = useMemo(() => {
    const s = new Set(); if (!selected) return s;
    links.forEach((l) => {
      const a = idOf(l.source), b = idOf(l.target);
      if (l.confidence * 100 < threshold || !scopedNodeById[a] || !scopedNodeById[b] || !isOn(scopedNodeById[a].type) || !isOn(scopedNodeById[b].type)) return;
      if (a === selected) s.add(b); if (b === selected) s.add(a);
    });
    return s;
  }, [selected, threshold, active, links, scopedNodeById, isOn]);

  const tracePairs = useMemo(() => { const s = new Set(); if (tracePath) for (let i = 0; i < tracePath.length - 1; i++) s.add(pairKey(tracePath[i], tracePath[i + 1])); return s; }, [tracePath]);
  const traceSet = useMemo(() => new Set(tracePath || []), [tracePath]);
  const hiddenCount = useMemo(() => links.filter((l) => l.confidence * 100 < threshold).length, [links, threshold]);
  const focusId = selected;

  const selNode = selected ? scopedNodeById[selected] : null;
  const selConns = useMemo(() => {
    if (!selected) return [];
    return links.filter((l) => idOf(l.source) === selected || idOf(l.target) === selected)
      .map((l) => { const o = idOf(l.source) === selected ? idOf(l.target) : idOf(l.source); return { other: scopedNodeById[o], rel: l.rel, amount: l.amount, strength: l.strength, confidence: l.confidence, method: l.method }; })
      .filter((c) => c.other)
      .sort((a, b) => b.strength - a.strength);
  }, [selected, links, scopedNodeById]);
  const findLink = (a, b) => links.find((l) => (idOf(l.source) === a && idOf(l.target) === b) || (idOf(l.source) === b && idOf(l.target) === a));

  /* the live snapshot the canvas paints from — bundled so OrreryCanvas reads one object. */
  const ui = useMemo(() => ({
    types: TYPE,
    nodeById: scopedNodeById,
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
  }), [TYPE, scopedNodeById, threshold, selected, focusId, traceSet, tracePairs, neighbours, sq, isOn, matchesId]);

  const startTrace = () => { if (!selected) return; setTraceMode(true); setTraceFrom(selected); setTracePath(null); setInspectorOpen(false); };
  const clearTrace = () => { setTracePath(null); setTraceMode(false); setTraceFrom(null); };
  const toggleType = (t) => setActive((p) => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  /* enter focus mode on an entity: swap the graph data to its neighbourhood and select it. */
  const focusOn = useCallback((id) => {
    if (!nodeById[id]) return;
    setFocusEntityId(id);
    setHops(2);
    setSelected(id);
    setInspectorOpen(true);
    setSearchOpen(false);
    setSearch('');
  }, [nodeById]);

  const clearFocus = useCallback(() => {
    setFocusEntityId(null);
    setSelected(null);
    setInspectorOpen(false);
    clearTrace();
  }, []);

  const widen = useCallback(() => setHops((h) => Math.min(3, h + 1)), []);

  const recenter = useCallback(() => { canvasRef.current?.fit(600, 56); }, []);

  /* when launched from "Explore in the full network", land focused on that entity. */
  const focusedOnceRef = useRef(false);
  useEffect(() => {
    if (focusedOnceRef.current || !initialFocusId) return;
    focusOn(initialFocusId);
    focusedOnceRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocusId]);

  /* search results, scoped to whatever is currently on the canvas plus a full-graph
     fallback so searching for a name outside the constellation still focuses it. */
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allNodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 40);
  }, [search, allNodes]);

  const SAFE = { fontFamily: SANS };

  const totalEntities = allNodes.length;
  const shownEntities = nodes.length;
  const honestyText = subgraph.mode === 'focus' && selNode
    ? `SHOWING ${shownEntities} WITHIN ${hops} STEP${hops === 1 ? '' : 'S'} OF ${selNode.name.toUpperCase()}`
    : `SHOWING ${shownEntities} OF ${totalEntities} ENTITIES · FOCUS A NAME TO GO DEEPER`;

  if (!mounted) return <div style={{ position: 'relative', flex: 1, background: 'radial-gradient(900px 640px at 50% -10%, #131b34 0%, #0B1020 54%, #070a16 100%)' }} />;

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, ...SAFE, color: TEXT, overflow: 'hidden', display: 'flex', flexDirection: 'column',
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

      {/* ---------- CONFIDENCE BAR + toolbar ---------- */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 14, padding: '9px 14px', borderBottom: `1px solid ${HAIR}`, zIndex: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
            <span className="eb">Min confidence</span>
            <span style={{ fontFamily: MONO, fontSize: 12.5, color: GOLD, fontWeight: 700 }}>{threshold}% · <span style={{ color: MUTE }}>{hiddenCount} hidden</span></span>
          </div>
          <input type="range" min="0" max="100" value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="rng"
            style={{ width: '100%', background: `linear-gradient(90deg, ${GOLD} ${threshold}%, rgba(255,255,255,.12) ${threshold}%)` }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <IconBtn onClick={() => setSearchOpen((s) => !s)} active={searchOpen}><MagnifyingGlass size={17} /></IconBtn>
          <IconBtn onClick={() => setFiltersOpen((s) => !s)} active={filtersOpen}><FunnelSimple size={17} /></IconBtn>
          <IconBtn onClick={() => setShowInfo(true)}><Info size={17} /></IconBtn>
        </div>
      </div>

      {/* ---------- GRAPH ---------- */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'none', cursor: traceMode ? 'crosshair' : 'default' }}>
        <OrreryCanvas
          ref={canvasRef}
          graphData={graphData}
          types={TYPE}
          ui={ui}
          layoutKey={layoutKey}
          onNodeClick={(n) => activateRef.current(n)}
          onBackgroundClick={() => { setSelected(null); setInspectorOpen(false); setFiltersOpen(false); }}
          onEngineStop={() => setSettled(true)}
        />

        {/* recenter */}
        <button onClick={recenter} style={{ position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center',
          background: PANEL, border: `1px solid ${HAIR}`, color: GOLD, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 10 }}>
          <Crosshair size={18} />
        </button>

        {/* focus banner: shows we've left the constellation + lets you widen or return */}
        {subgraph.mode === 'focus' && selNode && (
          <div className="in" style={{ position: 'absolute', top: 12, left: 12, zIndex: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 11,
            background: 'rgba(20,16,8,0.92)', border: `1px solid rgba(232,182,90,0.4)`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor(selNode.type, TYPE), flex: '0 0 auto' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selNode.name}</span>
            {hops < 3 && (
              <button onClick={widen} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, background: 'rgba(232,182,90,0.14)', border: `1px solid rgba(232,182,90,0.4)`, color: GOLD, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                <ArrowsOutSimple size={12} /> Widen
              </button>
            )}
            <button onClick={clearFocus} title="Back to the full constellation" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: `1px solid ${HAIR}`, color: MUTE, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                <X size={12} /> Clear
            </button>
          </div>
        )}

        {/* ---------- SEARCH PANEL ---------- */}
        {searchOpen && (
          <div className="in" style={{ position: 'absolute', top: 12, left: 12, bottom: 12, width: 296, zIndex: 30, display: 'flex', flexDirection: 'column', borderRadius: 14, background: PANEL, border: `1px solid ${HAIR}`, backdropFilter: 'blur(13px)', WebkitBackdropFilter: 'blur(13px)', overflow: 'hidden', boxShadow: '0 18px 55px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '11px 11px 9px', borderBottom: `1px solid ${HAIR}` }}>
              <div style={{ position: 'relative' }}>
                <MagnifyingGlass size={14} color={MUTE} style={{ position: 'absolute', left: 10, top: 11 }} />
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people, companies, MPs…"
                  style={{ width: '100%', height: 36, padding: '0 30px', borderRadius: 9, color: TEXT, fontSize: 13.5, background: 'rgba(255,255,255,0.06)', border: `1px solid ${HAIR}`, outline: 'none', boxSizing: 'border-box' }} />
                {search && <X size={15} color={MUTE} onClick={() => setSearch('')} style={{ position: 'absolute', right: 9, top: 10, cursor: 'pointer' }} />}
              </div>
              <div className="eb" style={{ marginTop: 10 }}>
                {search.trim() ? `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'}` : 'Focus a name to see its neighbourhood'}
              </div>
            </div>
            <div className="sc" style={{ flex: 1, overflowY: 'auto', padding: '5px' }}>
              {searchResults.map((n) => (
                <div key={n.id} onClick={() => focusOn(n.id)} title={n.role}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9, cursor: 'pointer', background: focusEntityId === n.id ? 'rgba(232,182,90,0.16)' : 'transparent' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: typeColor(n.type, TYPE) }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.role}</span>
                  </span>
                  {n.conflict ? <WarningDiamond size={13} color={VERM} style={{ flex: '0 0 auto', opacity: n.conflictStrength === 'low' ? 0.4 : 1 }} /> : null}
                </div>
              ))}
              {search.trim() && !searchResults.length && <div style={{ padding: '16px 10px', fontSize: 12.5, color: MUTE }}>No match. Try a surname, a company, or a party.</div>}
              {!search.trim() && <div style={{ padding: '16px 10px', fontSize: 12.5, color: MUTE }}>Type a name to focus its neighbourhood. Everything else is the constellation: findings, the biggest donations and the best-connected entities.</div>}
            </div>
          </div>
        )}

        {/* trace status / result */}
        {(traceMode || tracePath) && (
          <div className="in sc" style={{ position: 'absolute', top: subgraph.mode === 'focus' && selNode ? 62 : 12, left: 12, right: 66, maxHeight: 70, overflowX: 'auto',
            padding: '9px 12px', borderRadius: 12, background: 'rgba(20,16,8,0.92)', border: `1px solid rgba(232,182,90,0.45)`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', zIndex: 12 }}>
            {traceMode ? (
              <span style={{ fontSize: 13, color: GOLD, fontWeight: 600 }}>{traceFrom ? 'Tap a second entity…' : 'Tap a starting entity…'}</span>
            ) : tracePath && tracePath.length > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flex: 1, overflowX: 'auto' }} className="sc">
                  {tracePath.map((id, i) => {
                    const n = scopedNodeById[id]; const lk = i < tracePath.length - 1 ? findLink(id, tracePath[i + 1]) : null;
                    if (!n) return null;
                    return (
                      <React.Fragment key={id}>
                        <span onClick={() => { setSelected(id); setInspectorOpen(true); canvasRef.current?.centerOnNode(n, 1.6, 600); }} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor(n.type, TYPE) }} />
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{n.name}</span>
                        </span>
                        {lk && <span style={{ fontFamily: MONO, fontSize: 10, color: lk.confidence >= 0.8 ? '#63B98B' : lk.confidence >= 0.5 ? GOLD : VERM }}>·{Math.round(lk.confidence * 100)}%→</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
                <X size={16} color={MUTE} onClick={clearTrace} style={{ flex: '0 0 auto' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: MUTE }}>No trail at this confidence, or the two entities are outside this view. Lower the dial or widen.</span>
                <X size={15} color={MUTE} onClick={clearTrace} style={{ flex: '0 0 auto' }} />
              </div>
            )}
          </div>
        )}

        {/* honesty chip — always on, bottom-left, real counts */}
        <div className="eb" style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 12, padding: '7px 11px', borderRadius: 9,
          background: 'rgba(8,11,20,0.82)', border: `1px solid ${HAIR}`, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', letterSpacing: '.12em', pointerEvents: 'none' }}>
          {honestyText}
        </div>

        {/* ---------- INSPECTOR: docked right panel (desktop) / full-screen push (mobile) ---------- */}
        {selNode && (
          <div style={isMobile ? {
            position: 'absolute', inset: 0, zIndex: 30,
            transform: inspectorOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
            background: PANEL, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            display: 'flex', flexDirection: 'column',
          } : {
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, zIndex: 30,
            transform: inspectorOpen ? 'translateX(0)' : 'translateX(calc(100% - 44px))', transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
            background: PANEL, borderLeft: `1px solid ${HAIR}`, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
            boxShadow: '-16px 0 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
          }}>
            {/* collapse tab (desktop only — mobile is fully off/on screen) */}
            {!isMobile && (
              <button onClick={() => setInspectorOpen((s) => !s)} title={inspectorOpen ? 'Collapse' : 'Expand'}
                style={{ position: 'absolute', left: -32, top: 16, width: 32, height: 64, borderRadius: '10px 0 0 10px', border: `1px solid ${HAIR}`, borderRight: 'none',
                  background: PANEL, color: GOLD, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                {inspectorOpen ? <CaretDown size={16} style={{ transform: 'rotate(90deg)' }} /> : <CaretUp size={16} style={{ transform: 'rotate(90deg)' }} />}
              </button>
            )}

            {/* header (always visible) */}
            <div style={{ flex: '0 0 auto', padding: '16px 18px 14px', borderBottom: `1px solid ${HAIR}` }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${typeColor(selNode.type, TYPE)}22`, border: `1px solid ${typeColor(selNode.type, TYPE)}66` }}>
                  {React.createElement(typeIcon(selNode.type, TYPE), { size: 20, color: typeColor(selNode.type, TYPE) })}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{selNode.name}</div>
                  <div style={{ fontSize: 12.5, color: MUTE, marginTop: 3 }}>{selNode.role}</div>
                  {selNode.scrutiny >= 0.7 && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, padding: '3px 9px', borderRadius: 6, background: 'rgba(229,101,75,0.14)', border: '1px solid rgba(229,101,75,0.5)', color: '#F0A593', fontSize: 11, fontFamily: MONO }}>
                      <WarningDiamond size={12} /> Merits a look{selNode.scrutinyMoney ? ` · ${selNode.scrutinyMoney} in political money nearby` : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                  <IconBtn small onClick={(e) => { e.stopPropagation(); startTrace(); }}><ShareNetwork size={16} /></IconBtn>
                  <IconBtn small onClick={(e) => { e.stopPropagation(); setSelected(null); setInspectorOpen(false); }}><X size={16} /></IconBtn>
                </div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10.5, color: MUTE, marginTop: 11 }}>{selConns.length} connections in this view</div>
            </div>

            {/* scrollable detail */}
            <div className="sc" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 28px' }}>
              {selNode.conflict && (() => {
                const low = selNode.conflictStrength === 'low';
                const strong = selNode.conflictStrength === 'strong';
                const acc = low ? '#9AA0AD' : VERM;
                const head = strong ? `Strong signal · ${selNode.conflictOverlap} overlap`
                  : low ? 'Flagged · lower priority' : 'Worth a look';
                return (
                  <div style={{ display: 'flex', gap: 9, padding: '12px 13px', marginBottom: 16, borderRadius: 11, background: low ? 'rgba(154,160,173,0.10)' : 'rgba(229,101,75,0.12)', border: `1px solid ${low ? 'rgba(154,160,173,0.40)' : 'rgba(229,101,75,0.5)'}` }}>
                    <WarningDiamond size={16} color={acc} style={{ flex: '0 0 auto', marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: low ? '#AEB4C0' : '#F0A593', letterSpacing: '.12em', textTransform: 'uppercase' }}>Conflict-shaped · {head}</div>
                      <div style={{ fontSize: 13, color: low ? '#C7CBD3' : '#E8C7BC', lineHeight: 1.5, marginTop: 5 }}>{selNode.conflictReason}</div>
                    </div>
                  </div>
                );
              })()}

              <button onClick={startTrace} style={{ width: '100%', height: 42, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 18,
                background: 'rgba(232,182,90,0.12)', border: `1px solid rgba(232,182,90,0.4)`, color: GOLD, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                <ShareNetwork size={16} /> Trace a path from here
              </button>

              {/* connections — TieRow, same grammar as the dossier */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}>
                <span className="eb">Connections</span><span style={{ fontFamily: MONO, fontSize: 11, color: MUTE }}>{selConns.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {selConns.map((c, i) => (
                  <TieRow
                    key={`${c.other.id}-${i}`}
                    tie={{ other: c.other, rel: c.rel, amount: c.amount, confidence: c.confidence, strength: c.strength, method: c.method }}
                    types={TYPE}
                    onOpen={() => focusOn(c.other.id)}
                  />
                ))}
                {!selConns.length && <div style={{ fontSize: 13, color: MUTE, fontStyle: 'italic' }}>No connections visible at this confidence threshold.</div>}
              </div>

              <button
                onClick={() => onOpenEntity && onOpenEntity(selNode.id)}
                style={{ width: '100%', height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 18,
                  background: 'rgba(255,255,255,0.04)', border: `1px solid ${HAIR}`, color: TEXT, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                <ArrowSquareOut size={15} /> Open full dossier
              </button>

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
              <Key svg={<circle cx="15" cy="5" r="4" fill="none" stroke={GOLD} strokeWidth="1.6" strokeOpacity="0.6" />} label="Faint brass ring = a finding" />
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
              <div style={{ fontSize: 20, fontWeight: 800 }}>Reading the constellation</div>
              <X size={22} color={MUTE} onClick={() => setShowInfo(false)} />
            </div>
            <Para><b style={{ color: GOLD }}>This is a curated view, not the whole network.</b> By default you see every entity behind a finding, the largest donations and the best-connected entities: the field is organised around what merits attention.</Para>
            <Para><b style={{ color: GOLD }}>Search or click a name</b> to focus it. You'll see just that entity and its neighbourhood, ranked by how strong each tie is. A <b>Widen</b> control steps out one more hop.</Para>
            <Para><b style={{ color: GOLD }}>Move around.</b> Drag the background to pan, scroll or pinch to zoom, drag a node to nudge it. A <span style={{ color: VERM, fontWeight: 700 }}>red ring</span> flags an entity that merits a look; a faint <span style={{ color: GOLD, fontWeight: 700 }}>brass ring</span> marks a finding member. The <Crosshair size={13} style={{ verticalAlign: '-2px' }} /> button refits everything to screen.</Para>
            <Para><b style={{ color: GOLD }}>Confidence.</b> Solid lines are confirmed; dotted are suspected. The dial hides anything below your threshold.</Para>
            <Para><b style={{ color: GOLD }}>Trails.</b> Trace a path between two figures to see exactly how they're joined, step by step.</Para>
            <div style={{ padding: '11px 13px', borderRadius: 10, background: 'rgba(229,101,75,0.08)', border: '1px solid rgba(229,101,75,0.25)', fontSize: 12.5, color: '#F0A593', display: 'flex', gap: 9 }}>
              <WarningDiamond size={15} style={{ flex: '0 0 auto', marginTop: 1 }} />Drawn from public records: Companies House, the Electoral Commission and the UK Parliament. A connection is a sourced public-record fact, not a judgement or any allegation of wrongdoing.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------- small components -------------------------- */
function IconBtn({ children, onClick, active, small }) {
  const s = small ? 34 : 38;
  return (
    <button onClick={onClick} style={{ width: s, height: s, flex: '0 0 auto', borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer',
      background: active ? 'rgba(232,182,90,0.16)' : 'rgba(255,255,255,0.05)', border: `1px solid ${active ? 'rgba(232,182,90,0.45)' : HAIR}`, color: active ? GOLD : MUTE }}>
      {children}
    </button>
  );
}
function Key({ svg, label }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}><svg width="30" height="10" style={{ flex: '0 0 auto', overflow: 'visible' }}>{svg}</svg><span style={{ fontSize: 12.5, color: MUTE }}>{label}</span></div>;
}
function Para({ children }) {
  return <p style={{ fontSize: 14, lineHeight: 1.66, color: '#C7CEDF', marginBottom: 15 }}>{children}</p>;
}
