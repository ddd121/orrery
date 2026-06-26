'use client';

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { Search, X, Share2, Newspaper, AlertTriangle, Info, Crosshair, Landmark, User, Building2, Flag, Users, Briefcase, ChevronUp, ChevronDown, Filter } from 'lucide-react';

/* ---------- design tokens: "orrery" — a working model of how power orbits ---------- */
const GOLD = '#E8B65A';
const VERM = '#E5654B';
const TEXT = '#E8ECF6';
const MUTE = '#8A93AD';
const HAIR = 'rgba(190,200,230,0.10)';
const PANEL = 'rgba(13,18,34,0.92)';
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
const SANS = '"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif';

const TYPE = {
  minister:   { label: 'Minister',   color: '#E8B65A', icon: Landmark },
  mp:         { label: 'MP',         color: '#D9C27A', icon: Landmark },
  donor:      { label: 'Donor',      color: '#E08AAE', icon: User },
  company:    { label: 'Company',    color: '#6FC3B8', icon: Building2 },
  party:      { label: 'Party',      color: '#9C8BD8', icon: Flag },
  appg:       { label: 'APPG',       color: '#7CC58E', icon: Users },
  department: { label: 'Department', color: '#6F9BD8', icon: Landmark },
  lobbyist:   { label: 'Lobbying',   color: '#E5654B', icon: Briefcase },
};
const TAG = { Scrutiny: VERM, Funding: GOLD, Contract: '#6FC3B8', Donation: '#E08AAE', Mention: MUTE, Appointment: '#9C8BD8' };
/* entity-type icons resolved by name (entity_types.ui_icon from the database) */
const ICONS = { Landmark, User, Building2, Flag, Users, Briefcase };

/* ----------------------------- SAMPLE DATA (fictional) ----------------------------- */
const RAW_NODES = [
  { id:'vance', name:'Rt Hon Eleanor Vance', type:'minister', role:'Sec. of State for Transport', importance:10, news:[
    { h:'Vance faces questions over Transport framework awards', s:'openDemocracy', t:'2 days ago', tag:'Scrutiny' },
    { h:'Minister chairs energy group part-funded by industry', s:'The Ferret', t:'1 week ago', tag:'Funding' },
    { h:'Declared £45,000 from financier Marcus Helmsworth', s:'Register of Interests', t:'3 weeks ago', tag:'Donation' },
  ]},
  { id:'aldridge', name:'Tom Aldridge MP', type:'mp', role:'Treasury Select Committee', importance:7, news:[
    { h:'Committee member’s media hospitality queried', s:'Byline Times', t:'6 days ago', tag:'Scrutiny' },
  ]},
  { id:'okonkwo', name:'Daniel Okonkwo MP', type:'mp', role:'Chair, APPG for Infrastructure', importance:6, news:[] },
  { id:'castellane', name:'Fiona Castellane MP', type:'mp', role:'Backbench', importance:5, news:[] },
  { id:'greaves', name:'Rupert Greaves MP', type:'mp', role:'Backbench', importance:5, news:[] },
  { id:'crewe', name:'Penelope Crewe', type:'lobbyist', role:'Senior adviser, Kingsway Public Affairs', importance:8, news:[
    { h:'The advisers shuttling between Whitehall and industry', s:'Bureau of Investigative Journalism', t:'5 days ago', tag:'Mention' },
  ]},
  { id:'helmsworth', name:'Sir Marcus Helmsworth', type:'donor', role:'Financier', importance:7, news:[
    { h:'Helmsworth among largest individual party donors', s:'Tortoise', t:'2 weeks ago', tag:'Funding' },
  ]},
  { id:'dray', name:'Olivia Dray', type:'donor', role:'Property developer', importance:5, news:[] },
  { id:'voss', name:'Henrik Voss', type:'donor', role:'Overseas investor', importance:6, news:[
    { h:'Overseas-linked donations under fresh scrutiny', s:'The Guardian', t:'4 days ago', tag:'Scrutiny' },
  ]},
  { id:'brightwater', name:'Brightwater Capital Ltd', type:'company', role:'Investment · Co. 08842211', importance:6, news:[] },
  { id:'aurora', name:'Aurora Infrastructure plc', type:'company', role:'Govt contractor · Co. 07120934', importance:8, news:[
    { h:'Aurora wins £12.4m Transport framework', s:'Contracts Finder', t:'1 month ago', tag:'Contract' },
  ]},
  { id:'meridian', name:'Meridian Holdings Ltd', type:'company', role:'Holding company · Co. 09551020', importance:5, news:[] },
  { id:'cobalt', name:'Cobalt Energy Partners', type:'company', role:'Energy · Co. 10233415', importance:5, news:[] },
  { id:'halcyon', name:'Halcyon Media Group', type:'company', role:'Media', importance:4, news:[] },
  { id:'kingsway', name:'Kingsway Public Affairs', type:'lobbyist', role:'Public affairs / lobbying', importance:6, news:[
    { h:'One firm runs secretariats for multiple APPGs', s:'openDemocracy', t:'2 weeks ago', tag:'Mention' },
  ]},
  { id:'partyA', name:'Unity Party', type:'party', role:'Governing party', importance:8, news:[] },
  { id:'partyB', name:'Progress Party', type:'party', role:'Opposition', importance:6, news:[] },
  { id:'appgEnergy', name:'APPG for Future Energy', type:'appg', role:'All-party group', importance:5, news:[] },
  { id:'appgInfra', name:'APPG for Infrastructure', type:'appg', role:'All-party group', importance:4, news:[] },
  { id:'dft', name:'Dept for Transport', type:'department', role:'Government department', importance:7, news:[] },
  { id:'desnz', name:'Dept for Energy', type:'department', role:'Government department', importance:6, news:[] },
];
const RAW_LINKS = [
  { source:'helmsworth', target:'vance', rel:'Donation', amount:'£45,000', strength:.85, confidence:.92, method:'Electoral Commission record' },
  { source:'helmsworth', target:'partyA', rel:'Donation', amount:'£200,000', strength:.9, confidence:.90, method:'Electoral Commission record' },
  { source:'helmsworth', target:'brightwater', rel:'Director', strength:.9, confidence:.98, method:'Companies House appointment' },
  { source:'voss', target:'brightwater', rel:'Shareholder', strength:.5, confidence:.60, method:'PSC filing (partial)' },
  { source:'voss', target:'partyA', rel:'Donation', amount:'£150,000', strength:.8, confidence:.75, method:'Electoral Commission (name match)' },
  { source:'brightwater', target:'aurora', rel:'Shared director', strength:.55, confidence:.71, method:'Fuzzy name match · 2 common officers' },
  { source:'meridian', target:'aurora', rel:'Shared director', strength:.45, confidence:.60, method:'Fuzzy name match · 1 common officer' },
  { source:'dray', target:'meridian', rel:'Director', strength:.85, confidence:.95, method:'Companies House appointment' },
  { source:'dray', target:'aldridge', rel:'Donation', amount:'£8,000', strength:.5, confidence:.80, method:'Electoral Commission record' },
  { source:'aurora', target:'dft', rel:'Govt contract', amount:'£12.4m', strength:.8, confidence:.88, method:'Contracts Finder award' },
  { source:'cobalt', target:'desnz', rel:'Govt contract', amount:'£6.1m', strength:.7, confidence:.82, method:'Contracts Finder award' },
  { source:'vance', target:'dft', rel:'Ministerial role', strength:1, confidence:1, method:'gov.uk ministerial list' },
  { source:'vance', target:'appgEnergy', rel:'Chair', strength:.9, confidence:.95, method:'APPG register' },
  { source:'okonkwo', target:'appgInfra', rel:'Chair', strength:.9, confidence:.95, method:'APPG register' },
  { source:'kingsway', target:'appgEnergy', rel:'Secretariat', strength:.7, confidence:.85, method:'APPG register' },
  { source:'kingsway', target:'appgInfra', rel:'Secretariat', strength:.7, confidence:.80, method:'APPG register' },
  { source:'cobalt', target:'appgEnergy', rel:'Funds group', amount:'£18,000', strength:.6, confidence:.80, method:'APPG register' },
  { source:'aurora', target:'appgInfra', rel:'Funds group', amount:'£15,000', strength:.6, confidence:.75, method:'APPG register' },
  { source:'crewe', target:'kingsway', rel:'Senior adviser', strength:.8, confidence:.90, method:'Company filings' },
  { source:'crewe', target:'vance', rel:'Former adviser', strength:.6, confidence:.70, method:'Press reports (unverified)' },
  { source:'crewe', target:'aurora', rel:'Board adviser', strength:.6, confidence:.65, method:'Press reports (unverified)' },
  { source:'crewe', target:'aldridge', rel:'Associate', strength:.4, confidence:.50, method:'Fuzzy match · social data' },
  { source:'halcyon', target:'vance', rel:'Hospitality', amount:'£3,500', strength:.45, confidence:.85, method:'Register of Interests' },
  { source:'halcyon', target:'aldridge', rel:'Hospitality', amount:'£2,200', strength:.4, confidence:.80, method:'Register of Interests' },
  { source:'vance', target:'partyA', rel:'Member', strength:.8, confidence:1, method:'Public record' },
  { source:'aldridge', target:'partyA', rel:'Member', strength:.8, confidence:1, method:'Public record' },
  { source:'castellane', target:'partyA', rel:'Member', strength:.8, confidence:1, method:'Public record' },
  { source:'okonkwo', target:'partyB', rel:'Member', strength:.8, confidence:1, method:'Public record' },
  { source:'greaves', target:'partyB', rel:'Member', strength:.8, confidence:1, method:'Public record' },
];

/* ------------------------------ helpers ------------------------------ */
const radius = (d) => 8 + Math.sqrt(d.importance) * 5.5;
const idOf = (e) => (typeof e === 'object' && e !== null ? e.id : e);
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const centroid = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

function findPath(fromId, toId, links, thresh) {
  const adj = {};
  links.forEach((l) => {
    if (l.confidence * 100 < thresh) return;
    const a = idOf(l.source), b = idOf(l.target);
    if (!adj[a]) adj[a] = []; if (!adj[b]) adj[b] = [];
    adj[a].push(b); adj[b].push(a);
  });
  const q = [[fromId]]; const seen = new Set([fromId]);
  while (q.length) {
    const path = q.shift(); const last = path[path.length - 1];
    if (last === toId) return path;
    (adj[last] || []).forEach((n) => { if (!seen.has(n)) { seen.add(n); q.push([...path, n]); } });
  }
  return null;
}

const PEEK = 150; // px of sheet visible when collapsed

/* ================================ APP ================================ */
export default function OrreryGraph({ nodes: RAW_NODES, links: RAW_LINKS, types: TYPE }) {
  const nodes = useMemo(() => RAW_NODES.map((n, i) => ({
    ...n, x: 600 + Math.cos(i * 1.3) * 150 + Math.random() * 24, y: 400 + Math.sin(i * 1.3) * 150 + Math.random() * 24,
  })), []);
  const links = useMemo(() => RAW_LINKS.map((l) => ({ ...l })), []);

  const [selected, setSelected] = useState(null);
  const [threshold, setThreshold] = useState(40);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState(() => new Set(Object.keys(TYPE)));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [traceMode, setTraceMode] = useState(false);
  const [traceFrom, setTraceFrom] = useState(null);
  const [tracePath, setTracePath] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [sheetUp, setSheetUp] = useState(false);
  const [dims, setDims] = useState({ w: 390, h: 640 });
  const [vp, setVp] = useState({ k: 1, x: 0, y: 0 });
  const [, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  const graphRef = useRef(null);
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const vpRef = useRef({ k: 1, x: 0, y: 0 });
  const dragRef = useRef(null);
  const rectRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const activateRef = useRef(() => {});
  const gestureRef = useRef(null);
  const fittedRef = useRef(false);

  const nodeById = useMemo(() => { const m = {}; nodes.forEach((n) => (m[n.id] = n)); return m; }, [nodes]);
  const applyVp = useCallback((next) => { vpRef.current = next; setVp(next); }, []);

  /* render the force graph only after mount — its initial positions use Math.random(),
     which would otherwise mismatch between server and client (hydration warning) */
  useEffect(() => { setMounted(true); }, []);

  /* selection / trace activation (refreshed each render to read live state) */
  activateRef.current = (d) => {
    if (traceMode && traceFrom && traceFrom !== d.id) {
      setTracePath(findPath(traceFrom, d.id, links, threshold));
      setTraceMode(false); setSelected(d.id); setSheetUp(false);
      return;
    }
    if (traceMode && !traceFrom) { setTraceFrom(d.id); setSelected(d.id); return; }
    setSelected(d.id); setSheetUp(false);
  };

  /* simulation */
  useEffect(() => {
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => 70 + (1 - l.strength) * 88).strength((l) => 0.15 + l.strength * 0.35))
      .force('charge', d3.forceManyBody().strength((d) => -420 - d.importance * 55).distanceMax(900))
      .force('collide', d3.forceCollide((d) => radius(d) + 16))
      .force('x', d3.forceX(600).strength(0.07))
      .force('y', d3.forceY(400).strength(0.08))
      .on('tick', () => setTick((t) => (t + 1) % 1e6));
    simRef.current = sim;
    return () => sim.stop();
  }, [nodes, links]);

  useEffect(() => {
    const el = graphRef.current; if (!el) return;
    const ro = new ResizeObserver((es) => { const r = es[0].contentRect; setDims({ w: r.width, h: r.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  /* fit graph to screen */
  const fit = useCallback(() => {
    const w = dims.w, h = dims.h; if (!w) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => { const r = radius(n); minX = Math.min(minX, n.x - r); maxX = Math.max(maxX, n.x + r); minY = Math.min(minY, n.y - r); maxY = Math.max(maxY, n.y + r); });
    if (!isFinite(minX)) return;
    const bw = maxX - minX, bh = maxY - minY, pad = 40;
    const k = clamp(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh), 0.35, 1.5);
    applyVp({ k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k });
  }, [dims.w, dims.h, nodes, applyVp]);

  useEffect(() => {
    if (!dims.w) return;
    // (re)fit when the viewport width changes meaningfully. Fixes the graph fitting to a
    // stale (mobile-sized) viewport on first paint and leaving a desktop screen mostly empty;
    // also refits on window resize.
    const t = setTimeout(() => {
      if (Math.abs(dims.w - (fittedRef.current || 0)) > 40) { fit(); fittedRef.current = dims.w; }
    }, 600);
    return () => clearTimeout(t);
  }, [dims.w, dims.h, fit]);

  /* ---- node drag (screen → sim coords through current viewport) ---- */
  const nodeMove = useCallback((e) => {
    const d = dragRef.current; if (!d) return;
    const r = rectRef.current, t = vpRef.current;
    d.fx = (e.clientX - r.left - t.x) / t.k;
    d.fy = (e.clientY - r.top - t.y) / t.k;
    if (Math.hypot(e.clientX - startRef.current.x, e.clientY - startRef.current.y) > 5) movedRef.current = true;
  }, []);
  const nodeUp = useCallback(() => {
    window.removeEventListener('pointermove', nodeMove);
    window.removeEventListener('pointerup', nodeUp);
    const d = dragRef.current;
    if (simRef.current) simRef.current.alphaTarget(0);
    if (d) { d.fx = null; d.fy = null; if (!movedRef.current) activateRef.current(d); }
    dragRef.current = null;
  }, [nodeMove]);
  const nodeDown = useCallback((e, d) => {
    e.stopPropagation();
    rectRef.current = svgRef.current.getBoundingClientRect();
    dragRef.current = d; movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    if (simRef.current) simRef.current.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
    window.addEventListener('pointermove', nodeMove);
    window.addEventListener('pointerup', nodeUp);
  }, [nodeMove, nodeUp]);

  /* ---- background pan + pinch-zoom ---- */
  const panMove = useCallback((e) => {
    const g = gestureRef.current; if (!g || !g.pts.has(e.pointerId)) return;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...g.pts.values()];
    const c = centroid(pts);
    const dx = c.x - g.lastC.x, dy = c.y - g.lastC.y;
    const old = vpRef.current;
    let nk = old.k, nx = old.x + dx, ny = old.y + dy;
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (g.lastDist) {
        nk = clamp(old.k * (dist / g.lastDist), 0.3, 3.2);
        const lx = c.x - g.rect.left, ly = c.y - g.rect.top;
        nx = lx - (lx - (old.x + dx)) * (nk / old.k);
        ny = ly - (ly - (old.y + dy)) * (nk / old.k);
      }
      g.lastDist = dist;
    }
    g.lastC = c;
    if (Math.hypot(c.x - g.startC.x, c.y - g.startC.y) > 6) g.moved = true;
    applyVp({ k: nk, x: nx, y: ny });
  }, [applyVp]);
  const panUp = useCallback((e) => {
    const g = gestureRef.current; if (!g) return;
    g.pts.delete(e.pointerId);
    if (g.pts.size === 0) {
      if (!g.moved) { setSelected(null); setSheetUp(false); setFiltersOpen(false); }
      window.removeEventListener('pointermove', panMove);
      window.removeEventListener('pointerup', panUp);
      window.removeEventListener('pointercancel', panUp);
      gestureRef.current = null;
    } else {
      const pts = [...g.pts.values()];
      g.lastC = centroid(pts);
      g.lastDist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null;
    }
  }, [panMove]);
  const panDown = useCallback((e) => {
    if (!gestureRef.current) {
      gestureRef.current = { pts: new Map(), lastC: { x: e.clientX, y: e.clientY }, startC: { x: e.clientX, y: e.clientY }, lastDist: null, rect: svgRef.current.getBoundingClientRect(), moved: false };
      window.addEventListener('pointermove', panMove);
      window.addEventListener('pointerup', panUp);
      window.addEventListener('pointercancel', panUp);
    }
    const g = gestureRef.current;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...g.pts.values()];
    g.lastC = centroid(pts);
    g.lastDist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : null;
  }, [panMove, panUp]);

  /* derived */
  const isOn = (t) => active.has(t);
  const sq = search.trim().toLowerCase();
  const matches = (n) => sq !== '' && n.name.toLowerCase().includes(sq);
  const neighbours = useMemo(() => {
    const s = new Set(); if (!selected) return s;
    links.forEach((l) => {
      const a = idOf(l.source), b = idOf(l.target);
      if (l.confidence * 100 < threshold || !isOn(nodeById[a].type) || !isOn(nodeById[b].type)) return;
      if (a === selected) s.add(b); if (b === selected) s.add(a);
    });
    return s;
  }, [selected, threshold, active, links, nodeById]);
  const tracePairs = useMemo(() => { const s = new Set(); if (tracePath) for (let i = 0; i < tracePath.length - 1; i++) s.add(pairKey(tracePath[i], tracePath[i + 1])); return s; }, [tracePath]);
  const traceSet = useMemo(() => new Set(tracePath || []), [tracePath]);
  const hiddenCount = links.filter((l) => l.confidence * 100 < threshold).length;
  const focusId = selected;

  const selNode = selected ? nodeById[selected] : null;
  const selConns = useMemo(() => {
    if (!selected) return [];
    return links.filter((l) => idOf(l.source) === selected || idOf(l.target) === selected)
      .map((l) => { const o = idOf(l.source) === selected ? idOf(l.target) : idOf(l.source); return { other: nodeById[o], rel: l.rel, amount: l.amount, strength: l.strength, confidence: l.confidence, method: l.method }; })
      .sort((a, b) => b.strength - a.strength);
  }, [selected, links, nodeById]);
  const findLink = (a, b) => links.find((l) => (idOf(l.source) === a && idOf(l.target) === b) || (idOf(l.source) === b && idOf(l.target) === a));
  const confColor = (c) => (c >= 0.8 ? '#7CC58E' : c >= 0.5 ? GOLD : VERM);

  const runExample = () => {
    const ranked = [...nodes].sort((a, b) => b.importance - a.importance);
    const start = ranked[0]; if (!start) return;
    for (const o of ranked) {
      if (o.id === start.id) continue;
      const p = findPath(start.id, o.id, links, 0);
      if (p && p.length >= 3) { setSelected(start.id); setTracePath(p); setTraceMode(false); setTraceFrom(null); setSheetUp(false); return; }
    }
  };
  const startTrace = () => { if (!selected) return; setTraceMode(true); setTraceFrom(selected); setTracePath(null); setSheetUp(false); };
  const clearTrace = () => { setTracePath(null); setTraceMode(false); setTraceFrom(null); };
  const toggleType = (t) => setActive((p) => { const n = new Set(p); n.has(t) ? n.delete(t) : n.add(t); return n; });

  /* fly to an entity and select it (used by the browse/search panel) */
  const focusOn = (id) => {
    const n = nodeById[id]; if (!n) return;
    const k = 1.15;
    applyVp({ k, x: dims.w / 2 - (n.x || 0) * k, y: dims.h / 2 - (n.y || 0) * k });
    setSelected(id); setSheetUp(false);
  };
  /* entities ranked by what merits a look: conflicts first, then scrutiny, then connectedness */
  const ranked = useMemo(() => {
    const l = [...nodes];
    l.sort((a, b) =>
      (Number(!!b.conflict) - Number(!!a.conflict)) ||
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
        .flow { stroke-dasharray:7 7; animation: flow .6s linear infinite; }
        @keyframes flow { to { stroke-dashoffset:-28; } }
        @keyframes tw { 0%,100%{ opacity:.15 } 50%{ opacity:.32 } }
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

      {/* search/browse panel renders inside the graph area (below) */}

      {/* ---------- GRAPH ---------- */}
      <div ref={graphRef} style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'none', cursor: traceMode ? 'crosshair' : 'default' }}>
        <svg ref={svgRef} width={dims.w} height={dims.h} style={{ display: 'block' }}>
          <rect data-bg="1" x="0" y="0" width={dims.w} height={dims.h} fill="transparent" onPointerDown={panDown} />
          <g transform={`translate(${vp.x},${vp.y}) scale(${vp.k})`}>
            {/* orrery rings */}
            <g style={{ pointerEvents: 'none' }}>
              {[150, 300, 460, 640].map((r) => <circle key={r} cx={600} cy={400} r={r} fill="none" stroke={GOLD} strokeOpacity="0.05" />)}
            </g>
            {/* edges */}
            <g style={{ pointerEvents: 'none' }}>
              {links.map((l, i) => {
                const a = idOf(l.source), b = idOf(l.target);
                const sN = nodeById[a], tN = nodeById[b];
                if (l.confidence * 100 < threshold || !isOn(sN.type) || !isOn(tN.type)) return null;
                const key = pairKey(a, b);
                const inTrace = tracePairs.has(key);
                const inFocus = focusId && (a === focusId || b === focusId);
                const dim = (focusId && !inFocus && !inTrace) || (sq && !matches(sN) && !matches(tN) && !inTrace);
                const weak = l.confidence < 0.55;
                let stroke = 'rgba(150,170,210,1)', op = 0.16 + l.confidence * 0.42, w = 1 + l.strength * 3.4;
                if (inTrace) { stroke = GOLD; op = 0.95; w += 1.4; } else if (inFocus) { stroke = GOLD; op = 0.7; w += 0.6; }
                if (dim) op *= 0.16;
                return <line key={i} x1={sN.x || 0} y1={sN.y || 0} x2={tN.x || 0} y2={tN.y || 0} stroke={stroke} strokeOpacity={op} strokeWidth={w} strokeLinecap="round"
                  className={inTrace ? 'flow' : undefined} strokeDasharray={inTrace ? undefined : weak ? '2 6' : undefined} />;
              })}
            </g>
            {/* nodes */}
            <g>
              {nodes.map((n) => {
                const on = isOn(n.type), r = radius(n), c = TYPE[n.type].color;
                const isSel = selected === n.id, isNb = neighbours.has(n.id), inTrace = traceSet.has(n.id);
                const dim = on && ((focusId && !isSel && !isNb && !inTrace) || (sq && !matches(n) && !inTrace));
                const op = !on ? 0.06 : dim ? 0.2 : 1;
                const showLabel = on && (n.importance >= 6 || isSel || inTrace || matches(n));
                return (
                  <g key={n.id} transform={`translate(${n.x || 0},${n.y || 0})`} opacity={op}
                    style={{ cursor: on ? 'grab' : 'default', pointerEvents: on ? 'auto' : 'none' }}
                    onPointerDown={(e) => nodeDown(e, n)}>
                    <circle r={Math.max(r, 22)} fill="transparent" />
                    <circle r={r * 2.3} fill={c} opacity={isSel || inTrace ? 0.3 : 0.12} style={n.importance >= 8 ? { animation: 'tw 4s ease-in-out infinite' } : undefined} />
                    {(isSel || inTrace) && <circle r={r + 6} fill="none" stroke={inTrace ? GOLD : c} strokeOpacity="0.9" strokeWidth="1.8" />}
                    {n.scrutiny >= 0.7 && <circle r={r + 9} fill="none" stroke={VERM} strokeOpacity="0.85" strokeWidth="1.6" strokeDasharray="2 3" />}
                    {n.conflict && <circle r={r + 12} fill="none" stroke={VERM} strokeOpacity="0.95" strokeWidth="2.4" />}
                    <circle r={r} fill={c} stroke="rgba(255,255,255,0.7)" strokeWidth={isSel ? 2 : 1} />
                    <circle r={r * 0.42} cx={-r * 0.22} cy={-r * 0.22} fill="#fff" opacity="0.22" />
                    {showLabel && (
                      <text y={r + 16} textAnchor="middle" fontSize={n.importance >= 8 ? 14 : 12} fontWeight={n.importance >= 7 ? 700 : 500} fill={TEXT}
                        style={{ paintOrder: 'stroke', stroke: 'rgba(7,10,22,0.92)', strokeWidth: 3.5, strokeLinejoin: 'round', pointerEvents: 'none' }}>{n.name}</text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* recenter */}
        <button onClick={fit} style={{ position: 'absolute', top: 12, right: 12, width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center',
          background: PANEL, border: `1px solid ${HAIR}`, color: GOLD, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
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
                  <span style={{ width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: (TYPE[n.type] || {}).color || MUTE }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.role}</span>
                  </span>
                  {n.conflict ? <AlertTriangle size={13} color={VERM} style={{ flex: '0 0 auto' }} />
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
            padding: '9px 12px', borderRadius: 12, background: 'rgba(20,16,8,0.92)', border: `1px solid rgba(232,182,90,0.45)`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
            {traceMode ? (
              <span style={{ fontSize: 13, color: GOLD, fontWeight: 600 }}>{traceFrom ? 'Tap a second entity…' : 'Tap a starting entity…'}</span>
            ) : tracePath && tracePath.length > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flex: 1, overflowX: 'auto' }} className="sc">
                  {tracePath.map((id, i) => {
                    const n = nodeById[id]; const lk = i < tracePath.length - 1 ? findLink(id, tracePath[i + 1]) : null;
                    return (
                      <React.Fragment key={id}>
                        <span onClick={() => setSelected(id)} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE[n.type].color }} />
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
          <div className="in" style={{ position: 'absolute', bottom: 16, left: 12, right: 12, display: 'flex', gap: 9, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
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
                <div style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${TYPE[selNode.type].color}22`, border: `1px solid ${TYPE[selNode.type].color}66` }}>
                  {React.createElement(ICONS[TYPE[selNode.type] && TYPE[selNode.type].icon] || User, { size: 20, color: TYPE[selNode.type].color })}
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
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTE }}>{selConns.length} connections{selNode.news.length ? ' · in the news' : ''}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: GOLD }}>
                  {sheetUp ? <>Less <ChevronDown size={14} /></> : <>Details <ChevronUp size={14} /></>}
                </span>
              </div>
            </div>

            {/* scrollable detail */}
            <div className="sc" style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 28px' }}>
              {selNode.conflict && (
                <div style={{ display: 'flex', gap: 9, padding: '12px 13px', marginBottom: 16, borderRadius: 11, background: 'rgba(229,101,75,0.12)', border: '1px solid rgba(229,101,75,0.5)' }}>
                  <AlertTriangle size={16} color={VERM} style={{ flex: '0 0 auto', marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#F0A593', letterSpacing: '.12em', textTransform: 'uppercase' }}>Conflict-shaped · merits a look</div>
                    <div style={{ fontSize: 13, color: '#E8C7BC', lineHeight: 1.5, marginTop: 5 }}>{selNode.conflictReason}</div>
                  </div>
                </div>
              )}
              {/* trace from here (full width) */}
              <button onClick={startTrace} style={{ width: '100%', height: 42, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 18,
                background: 'rgba(232,182,90,0.12)', border: `1px solid rgba(232,182,90,0.4)`, color: GOLD, fontSize: 14, fontWeight: 600 }}>
                <Share2 size={16} /> Trace a path from here
              </button>

              {/* news */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><Newspaper size={14} color={MUTE} /><span className="eb">Recent coverage</span></div>
              {selNode.news.length === 0 ? (
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
                  <div key={i} onClick={() => { setSelected(c.other.id); }} style={{ padding: '12px 13px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: `1px solid ${HAIR}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: TYPE[c.other.type].color, flex: '0 0 auto' }} />
                        <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.other.name}</span>
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: confColor(c.confidence), flex: '0 0 auto' }}>{Math.round(c.confidence * 100)}%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, fontFamily: MONO, fontSize: 11, color: MUTE }}>
                      <span style={{ color: '#B9C2D8' }}>{c.rel}</span>{c.amount && <span>· {c.amount}</span>}
                    </div>
                    <div style={{ height: 3, borderRadius: 3, marginTop: 8, background: 'rgba(255,255,255,0.08)' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${c.strength * 100}%`, background: TYPE[c.other.type].color, opacity: 0.85 }} />
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
        fontFamily: MONO, fontSize: 9, letterSpacing: '.16em', color: 'rgba(240,165,147,0.5)' }}>PUBLIC RECORDS · COMPANIES HOUSE</div>

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
              <div style={{ fontSize: 19, fontWeight: 800 }}>How to read ORRERY</div>
              <X size={22} color={MUTE} onClick={() => setShowInfo(false)} />
            </div>
            <Para><b style={{ color: GOLD }}>Move around.</b> Drag the background to pan, pinch to zoom, drag a node to pull the web apart. The <Crosshair size={13} style={{ verticalAlign: '-2px' }} /> button refits everything to screen.</Para>
            <Para><b style={{ color: GOLD }}>Tap a node.</b> A panel slides up with who funds it, who sits where, and what’s been written. Tap the handle to expand it; tap the background to dismiss.</Para>
            <Para><b style={{ color: GOLD }}>Confidence.</b> A fuzzy name match is weaker than a Companies House ID. Solid lines are confirmed; dotted are suspected. The dial up top hides anything below your threshold.</Para>
            <Para><b style={{ color: GOLD }}>Trails.</b> Trace a path between two figures to see exactly how they’re joined, step by step. Raise the dial and a weak link can break the chain; lower it and a hidden one completes it.</Para>
            <Para><b style={{ color: GOLD }}>The line we hold.</b> ORRERY surfaces public-record connections and lets you draw your own conclusion. It never alleges wrongdoing — a connection is a fact with a source attached.</Para>
            <div style={{ padding: '11px 13px', borderRadius: 10, background: 'rgba(229,101,75,0.08)', border: '1px solid rgba(229,101,75,0.25)', fontSize: 12.5, color: '#F0A593', display: 'flex', gap: 9 }}>
              <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 1 }} />Drawn from public Companies House records (officers and persons with significant control). A connection is a sourced public-record fact — not a judgement or any allegation of wrongdoing.
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
