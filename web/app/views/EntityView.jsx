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
import { ArrowLeft, WarningDiamond, Info, Graph, Path, LinkSimple, Check, Copy, ArrowSquareOut } from '@phosphor-icons/react';
import {
  GOLD, VERM, SIGNAL, TEXT, MUTE, HAIR, MONO, TYPO,
  typeColor, typeIcon, typeLabel, tiesOf, idOf,
} from '@/lib/graph-utils';
import { insightSentence } from '@/lib/insights';
import { headlineFor } from '@/lib/deal';
import { copyReceipts } from '@/lib/receipts';
import ForceGraph from '../components/ForceGraph';
import TieRow from '../components/TieRow';
import MiniOrrery from '../components/MiniOrrery';
import { CuttingButton } from '../components/Cutting';
import ShareRow from '../components/ShareRow';
import InTheNews from '../components/InTheNews';

const EGO_CAP = 40;
const HEADLINE_CAP = 3;

export default function EntityView({
  entityId, nodes, links, types, insights = [], findings = [],
  coverageByEntity = {}, offshoreByEntity = {}, overseasByDonor = {},
  onOpenEntity, onOpenFinding, onBack, onExplore, onConnect,
}) {
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

  /* the entity's top 1-3 takeaways (already sorted priority desc by loadInsights). */
  const topInsights = useMemo(() => (insights || []).slice(0, HEADLINE_CAP), [insights]);

  /* the highest-surprise finding that touches this entity, if any — the SPARK. */
  const spark = useMemo(() => {
    if (!findings || findings.length === 0) return null;
    let best = null;
    for (const f of findings) {
      if ((f.member_entity_ids || []).includes(entityId)) {
        if (!best || (f.surprise || 0) > (best.surprise || 0)) best = f;
      }
    }
    return best;
  }, [findings, entityId]);

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
            {node.jurisdiction && node.jurisdiction !== 'GB' && (
              <>
                <span style={{ color: 'rgba(190,200,230,0.25)' }}>·</span>
                <HeaderStamp>Registered residence: {node.jurisdiction} &middot; via Companies House</HeaderStamp>
              </>
            )}
          </div>
        </div>
      </div>

      {/* lead chips: ICIJ offshore-name match and/or a same-name overseas-resident CH officer.
          Both are DOTTED, disclaimed leads — never merged, never stated as fact. */}
      {((offshoreByEntity[entityId] || []).length > 0 || (overseasByDonor[entityId] || []).length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {(offshoreByEntity[entityId] || []).slice(0, 1).map((lead) => (
            <LeadChip key={lead.id}>
              A company of this name appears in the {lead.source_leak} data (ICIJ). Names can coincide; this is a
              lead, not an identification.
              {lead.icij_url && (
                <a href={lead.icij_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, color: SIGNAL, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  ICIJ record <ArrowSquareOut size={11} />
                </a>
              )}
            </LeadChip>
          ))}
          {(overseasByDonor[entityId] || []).slice(0, 1).map((lead) => (
            <LeadChip key={lead.id}>
              A Companies House officer of this name is registered as resident in {lead.country}. Names can
              coincide; this is a lead, not an identification.
            </LeadChip>
          ))}
        </div>
      )}

      {/* conflict banner (strength-aware; low-priority greyed) */}
      {node.conflict && <ConflictBanner node={node} />}

      {/* scrutiny note (when flagged but not a full conflict, or alongside it) */}
      {!node.conflict && node.scrutiny >= 0.7 && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '6px 11px', borderRadius: 8, background: 'rgba(229,101,75,0.12)', border: '1px solid rgba(229,101,75,0.45)', color: '#F0A593', fontSize: 12, fontFamily: MONO }}>
          <WarningDiamond size={13} /> Merits a look{node.scrutinyMoney ? ` · ${node.scrutinyMoney} in political money nearby` : ''}
        </div>
      )}

      {/* ----------------------------- the headline ----------------------------- */}
      {(topInsights.length > 0 || spark) && (
        <section style={{ marginTop: 22 }}>
          <div style={{ ...TYPO.dataLabel, marginBottom: 10 }}>THE HEADLINE</div>
          {topInsights.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {topInsights.map((ins, i) => {
                const { sentence, cohortLine } = insightSentence(ins);
                if (!sentence) return null;
                return (
                  <div key={ins.id || i}>
                    <p style={i === 0 ? { ...TYPO.title1, color: TEXT, margin: 0 } : { ...TYPO.body, color: TEXT, margin: 0 }}>
                      {sentence}
                    </p>
                    {cohortLine && (
                      <p style={{ ...TYPO.dataLabel, color: MUTE, margin: '4px 0 0' }}>{cohortLine}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {spark && (
            <button
              onClick={() => onOpenFinding && onOpenFinding(spark)}
              className="in"
              style={{
                display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', cursor: 'pointer',
                marginTop: 16, padding: 14, borderRadius: 13, background: 'rgba(232,182,90,0.06)',
                border: '1px solid rgba(232,182,90,0.3)', color: TEXT,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(232,182,90,0.55)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(232,182,90,0.3)')}
            >
              <span style={{ flex: '0 0 auto' }}>
                <MiniOrrery finding={spark} nodesById={nodeById} size={72} showLabels={false} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 4 }}>
                  A finding touches this entity
                </span>
                <span style={{ display: 'block', fontSize: 13.5, lineHeight: 1.45 }}>{headlineFor(spark)}</span>
              </span>
            </button>
          )}
        </section>
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
              Confidence is how sure we are a link is real and correctly identified. Ties are ordered by how much they matter: the kind of tie, its size and how unusual it is.
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

            {/* in the news — hidden entirely while there is no coverage for this name */}
            {(coverageByEntity[entityId] || []).length > 0 && (
              <div style={{ marginTop: 20 }}>
                <InTheNews rows={coverageByEntity[entityId]} />
              </div>
            )}

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
              {spark ? (
                // no explicit url: ShareRow resolves its own /f/{id} link post-mount (hydration-safe)
                <ShareRow finding={spark} nodesById={nodeById} />
              ) : (
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ShareButton />
                  </div>
                </div>
              )}
              <ReceiptsButton node={node} groups={groups} />
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

/* squared, neutral header stamp — used for the jurisdiction chip alongside the type/role line. */
function HeaderStamp({ children }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${HAIR}`, fontSize: 11.5, color: MUTE,
      }}
    >
      {children}
    </span>
  );
}

/* a dotted, disclaimed lead chip (ICIJ / overseas-officer name matches): dashed SIGNAL
   border at reduced opacity, never solid — solid means established, this is a lead only. */
function LeadChip({ children }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 11,
        background: 'rgba(224,106,80,0.06)', border: `1px dashed rgba(224,106,80,0.6)`, color: '#E8C7BC',
        fontSize: 12.5, lineHeight: 1.55,
      }}
    >
      <WarningDiamond size={14} color={SIGNAL} style={{ flex: '0 0 auto', marginTop: 2 }} />
      <span>{children}</span>
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

/* "Copy the receipts": a markdown export of every sourced tie on this dossier, so a
   journalist can paste it into notes without losing the citation (lib/receipts.js). */
function ReceiptsButton({ node, groups }) {
  const [state, setState] = useState('idle'); // idle | copied | error
  const copy = async () => {
    try {
      const ties = (groups || []).flatMap((g) => g.ties);
      await copyReceipts({ title: node.name, ties, url: typeof window !== 'undefined' ? window.location.href : '' });
      setState('copied');
      setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 1800);
    }
  };
  const copied = state === 'copied';
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy every sourced tie on this dossier as markdown"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 44, borderRadius: 11, background: copied ? 'rgba(124,197,142,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${copied ? 'rgba(124,197,142,0.5)' : HAIR}`, color: copied ? '#7CC58E' : MUTE, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
    >
      {copied ? <><Check size={16} /> Receipts copied</> : <><Copy size={16} /> Copy the receipts</>}
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
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 44, borderRadius: 11, background: copied ? 'rgba(124,197,142,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${copied ? 'rgba(124,197,142,0.5)' : HAIR}`, color: copied ? '#7CC58E' : MUTE, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
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
