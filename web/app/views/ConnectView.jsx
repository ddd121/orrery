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
  GOLD, VERM, TEXT, MUTE, HAIR, PANEL, MONO, POSITIVE, SIGNAL, BRASS, TYPO, RADIUS, TEXT_1, TEXT_2,
  typeColor, typeIcon, confColor, confTier, findPath, idOf,
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

export default function ConnectView({ nodes, links, types, onOpenEntity, onBack, initialFromId, initialToId, pairs }) {
  const nodeById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);
  const ranked = useMemo(() => rankNodes(nodes), [nodes]);

  const [fromId, setFromId] = useState(initialFromId && nodeById[initialFromId] ? initialFromId : null);
  const [toId, setToId] = useState(initialToId && nodeById[initialToId] ? initialToId : null);
  const [thresh, setThresh] = useState(DEFAULT_THRESH);

  // keep A/B in sync if the view is re-opened from a different dossier / finding
  useEffect(() => {
    if (initialFromId && nodeById[initialFromId]) setFromId(initialFromId);
  }, [initialFromId, nodeById]);
  useEffect(() => {
    if (initialToId && nodeById[initialToId]) setToId(initialToId);
  }, [initialToId, nodeById]);

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
            <p style={{ fontSize: 13, color: MUTE, margin: '4px 0 0' }}>Pick two names. We trace the shortest sourced route between them.</p>
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

      {/* ----------------------------- suggested pairs ----------------------------- */}
      {!from && !to && pairs && pairs.length > 0 && (
        <SuggestedPairs
          pairs={pairs}
          nodeById={nodeById}
          onPick={(a, b) => { setFromId(a); setToId(b); }}
        />
      )}

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

/* ------------------------------- suggested pairs ------------------------------- */
/* Cross-register endpoint pairs worth tracing (public.suggested_pairs, fetched in
   loadFindings but never rendered until now). Shown only while both pickers are
   empty, as a fast way in rather than typing two names cold. */
function SuggestedPairs({ pairs, nodeById, onPick }) {
  const chips = useMemo(
    () =>
      pairs
        .map((p) => ({ ...p, a: nodeById[p.from_entity_id], b: nodeById[p.to_entity_id] }))
        .filter((p) => p.a && p.b)
        .slice(0, 3),
    [pairs, nodeById],
  );
  if (chips.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ ...TYPO.dataLabel, marginBottom: 8 }}>Try one of these</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {chips.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p.a.id, p.b.id)}
            title={p.why || undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: RADIUS.md,
              background: 'rgba(255,255,255,0.04)', border: `1px solid ${HAIR}`, color: TEXT_1, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${GOLD}66`)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = HAIR)}
          >
            {p.a.name} and {p.b.name}
          </button>
        ))}
      </div>
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
  if (sameEntity) msg = 'That is the same name twice. Pick two different entities.';
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
          <>There is no route between <b style={{ color: TEXT }}>{from.name}</b> and <b style={{ color: TEXT }}>{to.name}</b> in any register we hold, even at the weakest link. That can change as sources are added.</>
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

      {/* confidence legend — how to read the per-hop stamps below */}
      <ConfidenceLegend />

      {/* vertical evidence chain: node pill, then an indented connector card carrying
          the hop's fact + confidence stamp, at every breakpoint (no horizontal wrap). */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {path.map((id, i) => {
          const node = nodeById[id];
          const hop = i < hops.length ? hops[i] : null;
          return (
            <React.Fragment key={`${id}-${i}`}>
              <EvidenceNode node={node} onOpen={() => onOpenEntity(id)} types={types} />
              {hop && <EvidenceConnector hop={hop} />}
            </React.Fragment>
          );
        })}
      </div>

      {/* the route as a small picture, below the chain */}
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

/* a node in the vertical evidence chain: type glyph + name, clickable to its dossier. */
function EvidenceNode({ node, types, onOpen }) {
  if (!node) return null;
  const col = typeColor(node.type, types);
  const Icon = typeIcon(node.type, types);
  return (
    <button
      onClick={onOpen}
      title={node.role}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: RADIUS.md, cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${col}55`, color: TEXT, width: '100%', textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${col}aa`)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = `${col}55`)}
    >
      <span style={{ width: 28, height: 28, borderRadius: RADIUS.sm, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${col}22`, border: `1px solid ${col}55` }}>
        <Icon size={15} color={col} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ ...TYPO.title3, display: 'block', color: TEXT_1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        {node.conflict && <span style={{ display: 'block', fontFamily: MONO, fontSize: 8.5, letterSpacing: '.08em', textTransform: 'uppercase', color: VERM, opacity: node.conflictStrength === 'low' ? 0.55 : 1, marginTop: 2 }}>merits a look</span>}
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

/* the connector card between two chain nodes: a left rail (solid for Established/
   Probable, dashed for Lead, coloured by tier), the hop's fact (rel + amount), a
   squared confidence stamp, and the source method. */
function EvidenceConnector({ hop }) {
  const { link } = hop;
  if (!link) {
    // shouldn't happen on a real path, but render an honest placeholder
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0 10px 14px', color: MUTE, fontFamily: MONO, fontSize: 11 }}>
        <span style={{ width: 2, alignSelf: 'stretch', background: HAIR, flex: '0 0 auto' }} />
        linked
      </div>
    );
  }
  const tier = confTier(link.confidence);
  const pct = Math.round(link.confidence * 100);
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0 10px 3px' }}>
      {/* the vertical rail: solid in tier colour for Established/Probable, dashed for Lead */}
      <div
        style={{
          width: 2, alignSelf: 'stretch', flex: '0 0 auto', marginLeft: 11,
          background: tier.solid ? tier.color : 'transparent',
          borderLeft: tier.solid ? 'none' : `2px dashed ${tier.color}`,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, padding: '10px 14px', borderRadius: RADIUS.md, background: 'rgba(255,255,255,0.025)', border: `1px solid ${HAIR}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ ...TYPO.bodySm, color: TEXT_1, fontWeight: 600 }}>{link.rel}</span>
          {link.amount && <span style={{ ...TYPO.bodySm, color: GOLD, fontWeight: 600 }}>{link.amount}</span>}
          <span
            style={{
              ...TYPO.dataLabel, color: tier.color, background: `${tier.color}1a`, border: `1px solid ${tier.color}55`,
              borderRadius: RADIUS.xs, padding: '2px 7px', marginLeft: 'auto',
            }}
          >
            {tier.label} · {pct}%
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          <span style={{ ...TYPO.dataLabel }}>Via </span>
          <span style={{ ...TYPO.dataValue, color: TEXT_2 }}>{link.method}</span>
        </div>
      </div>
    </div>
  );
}
