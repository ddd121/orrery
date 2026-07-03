'use client';

/**
 * Connect — "How are A and B connected?"
 *
 * Two entity pickers (A, B) + a confidence control, then a BFS shortest path
 * (findPath, confidence-filtered) rendered as a left-to-right sourced chain:
 * each node (clickable → its dossier) and, between consecutive nodes, the
 * connecting statement rendered `—[ rel · amount? · conf% ]→` with the source
 * beneath. Below the chain, a small focused ForceGraph paints the route.
 *
 * The line we hold: a connection is a sourced public-record fact, never an
 * allegation; British English; every hop shows its source + confidence. When no
 * path exists at the chosen threshold we offer to include weaker links rather
 * than imply the two are unconnected.
 */
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { MagnifyingGlass, X, ArrowLeft, ArrowRight, Path, ArrowCounterClockwise, Info, SmileySad } from '@phosphor-icons/react';
import {
  GOLD, VERM, TEXT, MUTE, HAIR, PANEL, MONO, POSITIVE, SIGNAL, BRASS, TYPO, RADIUS,
  typeColor, typeIcon, confColor, findPath, idOf,
} from '@/lib/graph-utils';
import ForceGraph from '../components/ForceGraph';

const DEFAULT_THRESH = 40; // matches the Explore slider default

/* entities ranked so the most "look-worthy" surface first in autocomplete —
   mirrors rankNodes in OrreryApp / the hero + header search. */
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

/** Find the statement joining two node ids in EITHER direction. */
function linkBetween(aId, bId, links) {
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    if ((s === aId && t === bId) || (s === bId && t === aId)) return l;
  }
  return null;
}

export default function ConnectView({ nodes, links, types, onOpenEntity, onBack, initialFromId }) {
  const nodeById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);
  const ranked = useMemo(() => rankNodes(nodes), [nodes]);

  const [fromId, setFromId] = useState(initialFromId && nodeById[initialFromId] ? initialFromId : null);
  const [toId, setToId] = useState(null);
  const [thresh, setThresh] = useState(DEFAULT_THRESH);

  // keep A in sync if the view is re-opened from a different dossier
  useEffect(() => {
    if (initialFromId && nodeById[initialFromId]) setFromId(initialFromId);
  }, [initialFromId, nodeById]);

  const from = fromId ? nodeById[fromId] : null;
  const to = toId ? nodeById[toId] : null;
  const ready = !!(from && to && from.id !== to.id);

  // the path at the current threshold (only when both ends chosen & distinct)
  const path = useMemo(
    () => (ready ? findPath(from.id, to.id, links, thresh) : null),
    [ready, from, to, links, thresh],
  );

  // resolve each hop's connecting statement once
  const hops = useMemo(() => {
    if (!path || path.length < 2) return [];
    const out = [];
    for (let i = 0; i < path.length - 1; i++) {
      out.push({ a: path[i], b: path[i + 1], link: linkBetween(path[i], path[i + 1], links) });
    }
    return out;
  }, [path, links]);

  // nodes + links for the focused picture of the route
  const pathGraph = useMemo(() => {
    if (!path || path.length < 1) return { nodes: [], links: [] };
    const set = new Set(path);
    const gNodes = nodes.filter((n) => set.has(n.id));
    const gLinks = hops.filter((h) => h.link).map((h) => h.link);
    return { nodes: gNodes, links: gLinks };
  }, [path, hops, nodes]);

  // plain-English summary: steps · weakest link · sources
  const summary = useMemo(() => {
    if (!hops.length) return null;
    const confs = hops.map((h) => (h.link ? h.link.confidence : 0));
    const weakest = Math.round(Math.min(...confs) * 100);
    const srcSet = new Set();
    hops.forEach((h) => { if (h.link?.method) h.link.method.split(' + ').forEach((m) => srcSet.add(m)); });
    const steps = hops.length;
    return {
      steps,
      weakest,
      sources: [...srcSet],
    };
  }, [hops]);

  const reset = () => { setToId(null); setThresh(DEFAULT_THRESH); };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 16px 72px' }}>
      <button
        onClick={onBack}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIR}`, color: MUTE, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
      >
        <ArrowLeft size={15} /> Findings
      </button>

      {/* ----------------------------- header ----------------------------- */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: 'rgba(232,182,90,0.12)', border: `1px solid rgba(232,182,90,0.4)` }}>
            <Path size={20} color={GOLD} />
          </span>
          <div>
            <h1 style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 800, margin: 0, lineHeight: 1.18 }}>How are they connected?</h1>
            <p style={{ fontSize: 13, color: MUTE, margin: '4px 0 0' }}>Pick two names — we trace the shortest sourced route between them.</p>
          </div>
        </div>
      </div>

      {/* ----------------------------- pickers ----------------------------- */}
      <div className="connect-pickers" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, marginTop: 22, alignItems: 'end' }}>
        <Picker
          label="From"
          accent={GOLD}
          ranked={ranked}
          types={types}
          picked={from}
          onPick={setFromId}
          onClear={() => setFromId(null)}
        />
        <div className="connect-arrow" style={{ display: 'none', placeItems: 'center', paddingBottom: 10 }}>
          <ArrowRight size={18} color={MUTE} />
        </div>
        <Picker
          label="To"
          accent="#E08AAE"
          ranked={ranked}
          types={types}
          picked={to}
          onPick={setToId}
          onClear={() => setToId(null)}
        />
      </div>

      {/* ----------------------------- confidence ----------------------------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: MUTE }}>Minimum confidence</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={thresh}
          onChange={(e) => setThresh(Number(e.target.value))}
          aria-label="Minimum confidence for the path"
          style={{ flex: 1, minWidth: 160, accentColor: GOLD, cursor: 'pointer' }}
        />
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: confColor(thresh / 100), minWidth: 42, textAlign: 'right' }}>{thresh}%</span>
        <button
          onClick={reset}
          title="Reset"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${HAIR}`, color: MUTE, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          <ArrowCounterClockwise size={13} /> Reset
        </button>
      </div>

      {/* ----------------------------- result ----------------------------- */}
      <div style={{ marginTop: 26 }}>
        {!ready && <Prompt from={from} to={to} sameEntity={!!(from && to && from.id === to.id)} />}

        {ready && path && (
          <PathResult
            path={path}
            hops={hops}
            pathGraph={pathGraph}
            summary={summary}
            types={types}
            nodeById={nodeById}
            onOpenEntity={onOpenEntity}
          />
        )}

        {ready && !path && (
          <NoPath
            thresh={thresh}
            from={from}
            to={to}
            onLower={() => setThresh(0)}
          />
        )}
      </div>

      <style>{`
        @media (min-width: 720px) {
          .connect-pickers { grid-template-columns: 1fr auto 1fr !important; }
          .connect-arrow { display: grid !important; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------- entity picker ------------------------------- */
function Picker({ label, accent, ranked, types, picked, onPick, onClear }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
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
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: accent, marginBottom: 7 }}>{label}</div>

      {picked ? (
        <EntityChip node={picked} types={types} accent={accent} onClear={onClear} />
      ) : (
        <div ref={boxRef} style={{ position: 'relative' }}>
          <MagnifyingGlass size={15} color={MUTE} style={{ position: 'absolute', left: 12, top: 13 }} />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search a person, company or party…"
            aria-label={`Search the ${label.toLowerCase()} entity`}
            style={{
              width: '100%', height: 44, padding: '0 14px 0 36px', borderRadius: 11, color: TEXT, fontSize: 14.5,
              background: 'rgba(13,18,34,0.85)', border: `1px solid ${accent}55`, outline: 'none',
            }}
          />
          {open && results.length > 0 && (
            <div
              className="sc in"
              style={{ position: 'absolute', top: 50, left: 0, right: 0, zIndex: 30, maxHeight: 320, overflowY: 'auto', borderRadius: 12, background: PANEL, border: `1px solid ${HAIR}`, boxShadow: '0 18px 55px rgba(0,0,0,0.55)', padding: 5 }}
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
            <div style={{ position: 'absolute', top: 50, left: 0, right: 0, zIndex: 30, borderRadius: 12, background: PANEL, border: `1px solid ${HAIR}`, padding: '14px 12px', fontSize: 12.5, color: MUTE }}>
              No match. Try a surname, a company, or a party.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EntityChip({ node, types, accent, onClear }) {
  const col = typeColor(node.type, types);
  const Icon = typeIcon(node.type, types);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 8px 0 12px', borderRadius: 11, background: `${accent}14`, border: `1px solid ${accent}66` }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${col}22`, border: `1px solid ${col}55` }}>
        <Icon size={14} color={col} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        <span style={{ display: 'block', fontSize: 10.5, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.role}</span>
      </span>
      <button
        onClick={onClear}
        title="Clear"
        aria-label="Clear this entity"
        style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: 'transparent', border: 'none', color: MUTE, cursor: 'pointer' }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/* ------------------------------- prompt / empty ------------------------------- */
function Prompt({ from, to, sameEntity }) {
  let msg = 'Pick two names above to trace the connection between them.';
  if (sameEntity) msg = 'That is the same entity on both sides — pick two different names.';
  else if (from && !to) msg = 'Now pick a second name to trace the route to.';
  else if (!from && to) msg = 'Now pick the first name to trace the route from.';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 16px', borderRadius: 13, background: 'rgba(255,255,255,0.025)', border: `1px dashed ${HAIR}`, color: MUTE, fontSize: 13.5 }}>
      <Info size={15} style={{ flex: '0 0 auto' }} /> {msg}
    </div>
  );
}

function NoPath({ thresh, from, to, onLower }) {
  const atZero = thresh === 0;
  return (
    <div style={{ padding: '22px 18px', borderRadius: 14, background: 'rgba(229,101,75,0.06)', border: '1px solid rgba(229,101,75,0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
        <SmileySad size={18} color={VERM} />
        <span style={{ fontSize: 15.5, fontWeight: 700 }}>
          {atZero ? 'Not connected in the current data' : `No connection found at ${thresh}% confidence`}
        </span>
      </div>
      <p style={{ fontSize: 13.5, color: '#E8C7BC', lineHeight: 1.55, margin: '0 0 14px' }}>
        {atZero ? (
          <>There is no route between <b style={{ color: TEXT }}>{from.name}</b> and <b style={{ color: TEXT }}>{to.name}</b> through any link we hold — even the weakest. They are not connected in the registers loaded so far. That can change as new sources are added.</>
        ) : (
          <>A route may still exist through lower-confidence links. Include weaker links to widen the search.</>
        )}
      </p>
      {!atZero && (
        <button
          onClick={onLower}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, background: 'rgba(232,182,90,0.14)', border: `1px solid rgba(232,182,90,0.45)`, color: GOLD, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
        >
          <ArrowCounterClockwise size={15} /> Include weaker links (search at 0%)
        </button>
      )}
    </div>
  );
}

/* ------------------------------- path result ------------------------------- */
function PathResult({ path, hops, pathGraph, summary, types, nodeById, onOpenEntity }) {
  return (
    <div className="in">
      {/* summary line */}
      {summary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: TEXT }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: GOLD }} />
            {summary.steps} step{summary.steps === 1 ? '' : 's'}
          </span>
          <span style={{ color: 'rgba(190,200,230,0.3)' }}>·</span>
          <span style={{ fontFamily: MONO, fontSize: 12 }}>
            weakest link <b style={{ color: confColor(summary.weakest / 100) }}>{summary.weakest}%</b>
          </span>
          {summary.sources.length > 0 && (
            <>
              <span style={{ color: 'rgba(190,200,230,0.3)' }}>·</span>
              <span style={{ fontFamily: MONO, fontSize: 12, color: MUTE }}>via {summary.sources.join(' + ')}</span>
            </>
          )}
        </div>
      )}

      {/* confidence legend — how to read the per-hop % below */}
      <ConfidenceLegend />

      {/* left-to-right sourced chain (wraps on mobile) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 10, rowGap: 16 }}>
        {path.map((id, i) => {
          const node = nodeById[id];
          const hop = i < hops.length ? hops[i] : null;
          return (
            <React.Fragment key={`${id}-${i}`}>
              <NodePill node={node} types={types} onOpen={() => onOpenEntity(id)} />
              {hop && <HopConnector hop={hop} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* the route as a small picture */}
      <div style={{ marginTop: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>The route</h2>
          <span style={{ height: 1, flex: 1, background: HAIR }} />
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTE }}>tap a node to open it</span>
        </div>
        <div style={{ borderRadius: 14, background: 'rgba(7,10,22,0.55)', border: `1px solid ${HAIR}`, overflow: 'hidden', height: 320 }}>
          <ForceGraph
            nodes={pathGraph.nodes}
            links={pathGraph.links}
            types={types}
            variant="focused"
            height={320}
            onNodeClick={(id) => onOpenEntity(id)}
          />
        </div>
      </div>

      {/* the line we hold */}
      <div style={{ marginTop: 18, fontSize: 12, color: MUTE, lineHeight: 1.55, display: 'flex', gap: 8 }}>
        <Info size={13} style={{ flex: '0 0 auto', marginTop: 1 }} />
        Each hop is a sourced public-record fact, shown with its confidence and where it came from. A connection is not a judgement or any allegation of wrongdoing.
      </div>
    </div>
  );
}

function NodePill({ node, types, onOpen }) {
  if (!node) return null;
  const col = typeColor(node.type, types);
  const Icon = typeIcon(node.type, types);
  return (
    <button
      onClick={onOpen}
      title={node.role}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px', borderRadius: 12, cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${col}55`, color: TEXT, maxWidth: 220, flex: '0 0 auto',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${col}aa`)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = `${col}55`)}
    >
      <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${col}22`, border: `1px solid ${col}55` }}>
        <Icon size={14} color={col} />
      </span>
      <span style={{ minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        {node.conflict && <span style={{ display: 'block', fontFamily: MONO, fontSize: 8.5, letterSpacing: '.08em', textTransform: 'uppercase', color: VERM, opacity: node.conflictStrength === 'low' ? 0.55 : 1 }}>merits a look</span>}
      </span>
    </button>
  );
}

/* a compact key to the per-hop confidence tiers (mirrors confTier's bands). */
function ConfidenceLegend() {
  const items = [
    { c: POSITIVE, label: 'Established, 80% and above', hint: 'matched on an official identifier' },
    { c: BRASS, label: 'Probable, 50 to 79%' },
    { c: SIGNAL, label: 'Lead, below 50%', hint: 'weaker: treat as a pointer, not a fact' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18, padding: '8px 12px', borderRadius: RADIUS.sm, background: 'rgba(255,255,255,0.025)', border: `1px solid ${HAIR}` }}>
      <span style={{ ...TYPO.dataLabel }}>Confidence</span>
      {items.map((it) => (
        <span key={it.label} title={it.hint || ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...TYPO.dataValue, color: TEXT }}>
          <span style={{ width: 9, height: 9, borderRadius: RADIUS.xs, background: it.c, flex: '0 0 auto' }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* the `—[ rel · amount? · conf% ]→` connector with the source beneath. */
function HopConnector({ hop }) {
  const { link } = hop;
  if (!link) {
    // shouldn't happen on a real path, but render an honest placeholder
    return (
      <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center', flex: '0 0 auto', color: MUTE, fontFamily: MONO, fontSize: 11 }}>
        —[ linked ]→
      </div>
    );
  }
  const pct = Math.round(link.confidence * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, flex: '0 0 auto', alignSelf: 'center', minWidth: 96 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 11.5, color: '#B9C2D8' }}>
        <span style={{ color: MUTE }}>—[</span>
        <span style={{ color: '#D7DEEE', fontWeight: 600 }}>{link.rel}</span>
        {link.amount && <><span style={{ color: 'rgba(190,200,230,0.3)' }}>·</span><span style={{ color: GOLD }}>{link.amount}</span></>}
        <span style={{ color: 'rgba(190,200,230,0.3)' }}>·</span>
        <span style={{ color: confColor(link.confidence), fontWeight: 700 }}>{pct}%</span>
        <span style={{ color: MUTE }}>]→</span>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, color: MUTE, opacity: 0.85, maxWidth: 160, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        via {link.method}
      </div>
    </div>
  );
}
