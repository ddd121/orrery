'use client';

/**
 * Dossier — "tell me about X".
 *
 * Header (name / type / role) + a prominent conflict banner if flagged; the
 * entity's connections grouped in plain English by relationship and direction
 * (Owns / Director of / Donated to / Funded by …), each row showing the other
 * entity (clickable), the amount, the confidence and the source ("via …"); and a
 * small, legible focused ego-graph of this entity + its direct ties.
 *
 * Reuses the inspector connection-row look from the original graph, and the same
 * conflict-box styling (vermillion; low-priority greyed). Facts, not verdicts.
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft, WarningDiamond, Info, Graph, Path, LinkSimple, Check } from '@phosphor-icons/react';
import {
  GOLD, VERM, TEXT, MUTE, HAIR, MONO, TYPO,
  typeColor, typeIcon, typeLabel, tiesOf, idOf,
} from '@/lib/graph-utils';
import ForceGraph from '../components/ForceGraph';
import TieRow from '../components/TieRow';

const EGO_CAP = 40;

export default function EntityView({ entityId, nodes, links, types, onOpenEntity, onBack, onExplore, onConnect }) {
  const nodeById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);
  const node = nodeById[entityId];

  const groups = useMemo(
    () => (node ? tiesOf(entityId, links, nodes) : []),
    [entityId, links, nodes, node],
  );
  const totalTies = useMemo(() => groups.reduce((s, g) => s + g.ties.length, 0), [groups]);

  /* focused ego-graph: this node + its direct neighbours (capped, strongest first) */
  const ego = useMemo(() => {
    if (!node) return { nodes: [], links: [] };
    const touching = links.filter((l) => idOf(l.source) === entityId || idOf(l.target) === entityId);
    const ranked = [...touching].sort((a, b) => (b.strength || 0) - (a.strength || 0)).slice(0, EGO_CAP);
    const keep = new Set([entityId]);
    ranked.forEach((l) => { keep.add(idOf(l.source)); keep.add(idOf(l.target)); });
    const egoNodes = nodes.filter((n) => keep.has(n.id));
    // include all links among the kept set so neighbours show their shared ties too
    const egoLinks = links.filter((l) => keep.has(idOf(l.source)) && keep.has(idOf(l.target)));
    return { nodes: egoNodes, links: egoLinks };
  }, [entityId, nodes, links, node]);

  if (!node) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 20px' }}>
        <BackBtn onBack={onBack} />
        <p style={{ color: MUTE, marginTop: 20 }}>That entity could not be found.</p>
      </div>
    );
  }

  const Icon = typeIcon(node.type, types);
  const col = typeColor(node.type, types);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 16px 72px' }}>
      <BackBtn onBack={onBack} />

      {/* ----------------------------- header ----------------------------- */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginTop: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: 13, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${col}22`, border: `1px solid ${col}66` }}>
          <Icon size={26} color={col} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 'clamp(20px, 4vw, 26px)', fontWeight: 800, margin: 0, lineHeight: 1.18 }}>{node.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: col }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: col }} /> {typeLabel(node.type, types)}
            </span>
            <span style={{ color: 'rgba(190,200,230,0.25)' }}>·</span>
            <span style={{ fontSize: 13, color: MUTE }}>{node.role}</span>
          </div>
        </div>
      </div>

      {/* conflict banner (strength-aware; low-priority greyed) */}
      {node.conflict && <ConflictBanner node={node} />}

      {/* scrutiny note (when flagged but not a full conflict, or alongside it) */}
      {!node.conflict && node.scrutiny >= 0.7 && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '6px 11px', borderRadius: 8, background: 'rgba(229,101,75,0.12)', border: '1px solid rgba(229,101,75,0.45)', color: '#F0A593', fontSize: 12, fontFamily: MONO }}>
          <WarningDiamond size={13} /> Merits a look{node.scrutinyMoney ? ` · ${node.scrutinyMoney} in political money nearby` : ''}
        </div>
      )}

      {/* ----------------------------- two columns ----------------------------- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 24, marginTop: 24 }} className="dossier-grid">
        {/* connections */}
        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Connections</h2>
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: MUTE }}>{totalTies} sourced · {groups.length} kinds</span>
          </div>

          {groups.length === 0 && (
            <div style={{ fontSize: 13.5, color: MUTE, fontStyle: 'italic' }}>No connections recorded for this entity yet.</div>
          )}

          {groups.length > 0 && (
            <p style={{ ...TYPO.caption, margin: '0 0 16px' }}>
              Confidence is how sure we are a link is real and correctly identified. Strength is how much the tie matters once it is real. The two are independent: a certain link can be trivial, and a strong tie can be uncertain.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {groups.map((g) => (
              <div key={g.rel}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#D7DEEE' }}>{relHeading(g.rel, g.ties[0].direction)}</span>
                  <span style={{ height: 1, flex: 1, background: HAIR }} />
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTE }}>{g.ties.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {g.ties.map((t, i) => (
                    <TieRow key={`${t.other.id}-${i}`} tie={t} types={types} onOpen={() => onOpenEntity(t.other.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 18, fontSize: 12, color: MUTE, lineHeight: 1.55, display: 'flex', gap: 8 }}>
            <Info size={13} style={{ flex: '0 0 auto', marginTop: 1 }} />
            Every connection cites a source. A link is a public-record fact, not a judgement.
          </div>
        </section>

        {/* focused ego-graph + actions */}
        <aside>
          <div style={{ position: 'sticky', top: 72 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Its immediate network</h2>
            </div>
            <div style={{ borderRadius: 14, background: 'rgba(7,10,22,0.55)', border: `1px solid ${HAIR}`, overflow: 'hidden', height: 380 }}>
              <ForceGraph nodes={ego.nodes} links={ego.links} types={types} variant="focused" height={380} onNodeClick={(id) => { if (id !== entityId) onOpenEntity(id); }} />
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: MUTE, textAlign: 'center', marginTop: 8 }}>
              {ego.nodes.length - 1 > 0 ? `${ego.nodes.length - 1} direct connection${ego.nodes.length - 1 === 1 ? '' : 's'} · tap to open` : 'No direct connections'}
            </div>

            {/* actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              <button
                onClick={onExplore}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 11, background: 'rgba(232,182,90,0.12)', border: `1px solid rgba(232,182,90,0.4)`, color: GOLD, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <Graph size={16} /> Explore in the full network
              </button>
              <button
                type="button"
                onClick={onConnect}
                title="Find a path from this entity to another"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 11, background: 'rgba(255,255,255,0.04)', border: `1px solid ${HAIR}`, color: TEXT, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(232,182,90,0.4)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = HAIR)}
              >
                <Path size={16} /> Find a path from here
              </button>
              <ShareButton />
            </div>
          </div>
        </aside>
      </div>

      <style>{`
        @media (min-width: 880px) {
          .dossier-grid { grid-template-columns: minmax(0, 1fr) 360px !important; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------ conflict banner ------------------------------ */
function ConflictBanner({ node }) {
  const low = node.conflictStrength === 'low';
  const strong = node.conflictStrength === 'strong';
  const acc = low ? '#9AA0AD' : VERM;
  const head = strong
    ? `Strong signal${node.conflictOverlap ? ` · ${node.conflictOverlap} overlap` : ''}`
    : low ? 'Flagged · lower priority' : 'Worth a look';
  return (
    <div style={{ display: 'flex', gap: 11, padding: '14px 15px', marginTop: 16, borderRadius: 12, background: low ? 'rgba(154,160,173,0.10)' : 'rgba(229,101,75,0.12)', border: `1px solid ${low ? 'rgba(154,160,173,0.40)' : 'rgba(229,101,75,0.5)'}` }}>
      <WarningDiamond size={18} color={acc} style={{ flex: '0 0 auto', marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: low ? '#AEB4C0' : '#F0A593', letterSpacing: '.12em', textTransform: 'uppercase' }}>Conflict-shaped · {head} · merits a look</div>
        {node.conflictReason && <div style={{ fontSize: 14, color: low ? '#C7CBD3' : '#E8C7BC', lineHeight: 1.55, marginTop: 6 }}>{node.conflictReason}</div>}
        <div style={{ fontSize: 11.5, color: MUTE, marginTop: 8, lineHeight: 1.5 }}>A structural overlap drawn from public records. It is a prompt to look, not an allegation.</div>
      </div>
    </div>
  );
}

/* --------------------------------- helpers --------------------------------- */
function BackBtn({ onBack }) {
  return (
    <button
      onClick={onBack}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIR}`, color: MUTE, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
    >
      <ArrowLeft size={15} /> Findings
    </button>
  );
}

/* Copy a shareable deep-link to this dossier (the URL now carries #entity=<id>). */
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (insecure context) — leave the state unchanged */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a shareable link to this dossier"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 11, background: copied ? 'rgba(124,197,142,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${copied ? 'rgba(124,197,142,0.5)' : HAIR}`, color: copied ? '#7CC58E' : MUTE, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
    >
      {copied ? <><Check size={16} /> Link copied</> : <><LinkSimple size={16} /> Copy link to this finding</>}
    </button>
  );
}

/* Make a plain-English heading from the relationship + direction. The `rel` is
   already a human label from the DB (statement_types.label); we just orient it so
   incoming reads naturally ("Donated to" by others → "Funded by"). When we don't
   have a tailored inverse we fall back to "{rel} (incoming)". */
const INVERSE = {
  'donated to': 'Funded by',
  'donation': 'Funded by',
  'owns': 'Owned by',
  'director of': 'Has as director',
  'member of': 'Has as member',
  'employs': 'Employed by',
  'funds': 'Funded by',
};
function relHeading(rel, direction) {
  if (direction === 'out') return rel;
  const inv = INVERSE[rel.toLowerCase()];
  return inv || `${rel} (incoming)`;
}
