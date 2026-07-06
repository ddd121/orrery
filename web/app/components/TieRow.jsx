'use client';

/**
 * TieRow: the confidence row (DESIGN_SPEC.md "The Tie Row"; DESIGN_SPEC_V2 section 4
 * "gauge out, fact in").
 *
 * Confidence (epistemic: is this link real and correctly identified) renders as a
 * named tier + exact percentage in a squared stamp, coloured by tier. Strength no
 * longer gets its own row grammar here: it still drives sort order and the data
 * model, but a discrete 1-4 gauge read as flat/inverted at current data, so the
 * per-row visual has been replaced by the concrete fact itself (the rel + amount
 * + counterpart role, already on line 2).
 *
 * Facts, not verdicts: every row is a sourced public-record connection, not a
 * judgement. Reused across the dossier, Connect hops and the Explore inspector.
 */
import React from 'react';
import { ArrowSquareOut, WarningDiamond } from '@phosphor-icons/react';
import {
  TEXT_1, TEXT_2, TEXT_3, HAIRLINE, BRASS, SIGNAL, RADIUS, TYPO,
  typeColor, typeIcon, confTier,
} from '@/lib/graph-utils';

export default function TieRow({ tie, types, onOpen }) {
  const { other, rel, amount, confidence, method } = tie;
  const col = typeColor(other.type, types);
  const Icon = typeIcon(other.type, types);
  const tier = confTier(confidence);
  const pct = Math.round(confidence * 100);

  return (
    <button
      onClick={onOpen}
      style={{
        textAlign: 'left', width: '100%', cursor: 'pointer', display: 'block',
        padding: '12px 14px 12px 12px', borderRadius: RADIUS.sm,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `2px ${tier.solid ? 'solid' : 'dashed'} ${tier.color}`,
        color: TEXT_1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${col}66`)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = HAIRLINE)}
    >
      {/* L1: type glyph + name + confidence stamp */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <Icon size={15} color={col} style={{ flex: '0 0 auto' }} />
        <span
          style={{
            ...TYPO.title3, flex: 1, minWidth: 0, color: TEXT_1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {other.name}
        </span>
        {other.conflict && (
          <WarningDiamond
            size={13}
            color={SIGNAL}
            style={{ flex: '0 0 auto', opacity: other.conflictStrength === 'low' ? 0.45 : 1 }}
          />
        )}
        <ConfidenceStamp tier={tier} pct={pct} />
      </div>

      {/* L2: the fact */}
      <div style={{ ...TYPO.bodySm, color: TEXT_2, marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span>{rel}</span>
        {amount && (
          <>
            <span style={{ color: TEXT_3 }}>&middot;</span>
            <span style={{ ...TYPO.dataValue, color: BRASS }}>{amount}</span>
          </>
        )}
        <span style={{ color: TEXT_3 }}>&middot;</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{other.role}</span>
      </div>

      {/* L3: metrics line */}
      <div className="tie-metrics" style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ ...TYPO.dataLabel }}>CONFIDENCE</span>
          <span
            style={{ ...TYPO.dataValue, color: tier.color }}
            title="Confidence is how sure we are a link is real and correctly identified. A shared Companies House number is near-certain; a name-only match is weaker, and is shown as such."
          >
            {pct}%
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ ...TYPO.dataLabel }}>VIA</span>
          <span style={{ ...TYPO.dataValue, color: TEXT_2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {method}
            {tie.sourceUrl && <ArrowSquareOut size={12} color={TEXT_2} />}
          </span>
        </span>
      </div>
    </button>
  );
}

/* Squared confidence stamp: tier word + exact percentage, coloured by tier.
   Under 420px the tier word drops (percentage + colour still carry the tier). */
function ConfidenceStamp({ tier, pct }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto',
        padding: '2px 7px', borderRadius: RADIUS.xs,
        background: `${tier.color}1A`, border: `1px solid ${tier.color}55`,
        ...TYPO.dataLabel, color: tier.color, letterSpacing: '.06em',
      }}
    >
      <span className="tie-stamp-word">{tier.label.toUpperCase()}</span>
      <span className="tie-stamp-word">&middot;</span>
      <span style={{ fontFamily: TYPO.dataValue.fontFamily, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
    </span>
  );
}

