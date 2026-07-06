'use client';

/**
 * FindingView: the finding permalink page (DESIGN_SPEC_V2 "Step 6: Findings ledger +
 * Finding page + the Cutting + Collections"; plan Wave 3).
 *
 * A finding's own destination: the full-size mini orrery, its plain-English headline,
 * THE EVIDENCE (its member statements rendered as Tie Rows), WHY THIS SURFACED (one
 * sentence built from the finding's own sourced numbers), and actions to carry the
 * finding elsewhere (cutting image, link, Connect, Explore). Deal cards, the ledger
 * and the dossier spark all land HERE: the story is never dropped at a click-through.
 *
 * Facts, not verdicts: every number on this page is read straight off the finding row;
 * nothing here infers or predicts.
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft, Path, Compass, LinkSimple, Check } from '@phosphor-icons/react';
import {
  TEXT_1, TEXT_2, TEXT_3, HAIRLINE, INK_1, BRASS, RADIUS, TYPO, SPACE,
  confTier, idOf,
} from '@/lib/graph-utils';
import { headlineFor, shapeLabel, pivotEntityId } from '@/lib/deal';
import MiniOrrery from '../components/MiniOrrery';
import TieRow from '../components/TieRow';
import { CuttingButton } from '../components/Cutting';

const EVIDENCE_CAP = 12;

export default function FindingView({ finding, nodes, links, types, onOpenEntity, onConnect, onExplore, onBack }) {
  const nodesById = useMemo(() => {
    const m = {};
    (nodes || []).forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  const [showAll, setShowAll] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const pivotId = finding ? pivotEntityId(finding, nodesById) : null;

  /* THE EVIDENCE: the finding's member statements as ties, resolved against the graph's
     links. Current data carries no `id` on link rows, so member_statement_ids cannot be
     matched directly, so fall back to every link whose BOTH endpoints sit inside the
     finding's member set, which is the honest approximation until statement ids flow
     through loadGraph (Wave 2 note). If a future `links` shape DOES carry `id`, prefer
     matching member_statement_ids directly so this upgrades for free. */
  const evidence = useMemo(() => {
    if (!finding || !links || !nodes) return [];
    const memberIds = new Set(finding.member_entity_ids || []);
    const stmtIds = new Set(finding.member_statement_ids || []);
    const hasLinkIds = stmtIds.size > 0 && links.some((l) => l.id != null);

    const candidates = hasLinkIds
      ? links.filter((l) => stmtIds.has(l.id))
      : links.filter((l) => memberIds.has(idOf(l.source)) && memberIds.has(idOf(l.target)));

    const ties = [];
    for (const l of candidates) {
      const a = idOf(l.source);
      const b = idOf(l.target);
      // orient the tie away from the pivot when the pivot is one endpoint; otherwise
      // away from whichever endpoint sorts first, so every row still reads as a fact.
      const subjectId = pivotId && (a === pivotId || b === pivotId) ? pivotId : a;
      const otherId = subjectId === a ? b : a;
      const other = nodesById[otherId];
      if (!other) continue;
      ties.push({
        other,
        rel: l.rel,
        amount: l.amount,
        confidence: l.confidence,
        strength: l.strength,
        method: l.method,
        direction: subjectId === a ? 'out' : 'in',
      });
    }
    // strongest, most confident evidence first
    const score = (t) => t.strength * 2 + t.confidence;
    return ties.sort((x, y) => score(y) - score(x));
  }, [finding, links, nodes, nodesById, pivotId]);

  const visibleEvidence = showAll ? evidence : evidence.slice(0, EVIDENCE_CAP);

  const whyLine = useMemo(() => (finding ? buildWhyLine(finding) : ''), [finding]);

  const copyLink = async () => {
    if (!finding) return;
    const url = `${window.location.origin}${window.location.pathname}#finding=${finding.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      /* clipboard unavailable (insecure context): leave state unchanged */
    }
  };

  const traceInConnect = () => {
    if (!finding || !onConnect) return;
    const otherMember = (finding.member_entity_ids || []).find((id) => id !== pivotId);
    if (pivotId && otherMember) onConnect(pivotId, otherMember);
    else if (pivotId) onConnect(pivotId);
  };

  const seeOnMap = () => {
    if (pivotId && onExplore) onExplore(pivotId);
  };

  if (!finding) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px' }}>
        <BackBtn onBack={onBack} />
        <p style={{ ...TYPO.body, color: TEXT_2, marginTop: 24 }}>
          That finding could not be found. It may have been recomputed.
        </p>
      </div>
    );
  }

  const tier = confTier(finding.min_confidence);
  const pct = Math.round(finding.min_confidence * 100);
  const registerCount = typeof finding.slots?.n_registers === 'number' ? finding.slots.n_registers : null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '18px 16px 72px' }}>
      <BackBtn onBack={onBack} />

      {/* --------------------------- hero: orrery + headline + stamps --------------------------- */}
      <div style={{ textAlign: 'center', marginTop: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <MiniOrrery finding={finding} nodesById={nodesById} size={280} showLabels />
        </div>
        <p style={{ ...TYPO.display, color: TEXT_1, margin: '20px auto 0', maxWidth: 640 }}>
          {headlineFor(finding)}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 18 }}>
          <Stamp color={BRASS}>{shapeLabel(finding.shape_code)}</Stamp>
          <Stamp color={tier.color}>{tier.label.toUpperCase()} &middot; {pct}%</Stamp>
          {registerCount != null && (
            <Stamp color={TEXT_2}>{registerCount} {registerCount === 1 ? 'REGISTER' : 'REGISTERS'}</Stamp>
          )}
        </div>
      </div>

      {/* --------------------------------- the evidence --------------------------------- */}
      <section style={{ marginTop: 48 }}>
        <SectionHeader>The evidence</SectionHeader>
        {evidence.length === 0 ? (
          <p style={{ ...TYPO.body, color: TEXT_2, marginTop: 14 }}>
            No sourced statements resolved for this finding.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {visibleEvidence.map((tie, i) => (
                <TieRow
                  key={`${tie.other.id}-${i}`}
                  tie={tie}
                  types={types}
                  onOpen={() => onOpenEntity && onOpenEntity(tie.other.id)}
                />
              ))}
            </div>
            {!showAll && evidence.length > EVIDENCE_CAP && (
              <button
                onClick={() => setShowAll(true)}
                style={{
                  marginTop: 14, display: 'inline-flex', alignItems: 'center', height: 44,
                  padding: '0 16px', borderRadius: RADIUS.sm, background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${HAIRLINE}`, color: TEXT_1, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Show all {evidence.length}
              </button>
            )}
          </>
        )}
      </section>

      {/* ------------------------------ why this surfaced ------------------------------ */}
      <section style={{ marginTop: 40 }}>
        <SectionHeader>Why this surfaced</SectionHeader>
        <p style={{ ...TYPO.body, color: TEXT_1, marginTop: 14, maxWidth: 640 }}>{whyLine}</p>
        <p style={{ ...TYPO.caption, color: TEXT_3, marginTop: 10 }}>
          A structural overlap drawn from public records. It is a prompt to look, not an allegation.
        </p>
      </section>

      {/* --------------------------------- actions --------------------------------- */}
      <section style={{ marginTop: 40, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <CuttingButton finding={finding} nodesById={nodesById} />
        <ActionButton onClick={copyLink} icon={linkCopied ? Check : LinkSimple} accent={linkCopied}>
          {linkCopied ? 'Link copied' : 'Copy link'}
        </ActionButton>
        {onConnect && (
          <ActionButton onClick={traceInConnect} icon={Path}>
            Trace it in Connect
          </ActionButton>
        )}
        {onExplore && (
          <ActionButton onClick={seeOnMap} icon={Compass}>
            See it on the map
          </ActionButton>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ why-line builder ------------------------------ */
/* Assembled purely from the finding's own numbers; every clause is conditional on the
   relevant slot existing, so a sparse finding still reads as a complete honest sentence
   rather than printing "undefined". Never a verdict, only a description of the pattern. */
function buildWhyLine(finding) {
  const s = finding.slots || {};
  const clauses = [];

  const registers = typeof s.n_registers === 'number' ? s.n_registers : null;
  if (registers != null) clauses.push(`crosses ${registers} public ${registers === 1 ? 'register' : 'registers'}`);

  const moneyRaw = s.amount_gbp ?? s.donation_gbp ?? null;
  if (moneyRaw != null && !isNaN(Number(moneyRaw))) {
    const money = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(Number(moneyRaw));
    clauses.push(`involves £${money} of declared political money`);
  }

  if (typeof finding.surprise === 'number' && finding.surprise > 0) {
    clauses.push('is one of the rarer shapes in the data');
  }

  if (clauses.length === 0) {
    return 'This pattern is a sourced structural overlap in the public registers.';
  }
  const sentence = clauses.length === 1
    ? clauses[0]
    : clauses.slice(0, -1).join(', ') + ' and ' + clauses[clauses.length - 1];
  return `This pattern ${sentence}.`;
}

/* --------------------------------- small pieces --------------------------------- */
function SectionHeader({ children }) {
  return (
    <h2 style={{ ...TYPO.title2, color: TEXT_1, margin: 0, paddingBottom: SPACE.sm, borderBottom: `1px solid ${HAIRLINE}` }}>
      {children}
    </h2>
  );
}

function Stamp({ color, children }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: RADIUS.xs,
        background: `${color}1A`, border: `1px solid ${color}55`, ...TYPO.dataLabel, color, letterSpacing: '.06em',
      }}
    >
      {children}
    </span>
  );
}

function ActionButton({ onClick, icon: Icon, accent, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 16px',
        borderRadius: RADIUS.sm, cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
        background: accent ? 'rgba(99,185,139,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${accent ? 'rgba(99,185,139,0.5)' : HAIRLINE}`,
        color: accent ? '#63B98B' : TEXT_1,
      }}
    >
      <Icon size={16} />
      {children}
    </button>
  );
}

function BackBtn({ onBack }) {
  return (
    <button
      onClick={onBack}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: RADIUS.sm,
        background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIRLINE}`, color: TEXT_2, cursor: 'pointer',
        fontSize: 13, fontWeight: 600,
      }}
    >
      <ArrowLeft size={15} /> Findings
    </button>
  );
}
