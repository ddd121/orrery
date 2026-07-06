'use client';

/**
 * LedgerView: the Findings ledger (DESIGN_SPEC_V2 "Step 6: Findings ledger + Finding
 * page + the Cutting + Collections"; plan Wave 3).
 *
 * The single ranked list of every publishable finding (surprise desc by default), a
 * filter rail (shape + sort), four editorial Collections as one-click pre-filters, and
 * a cheap virtualisation (render 60, "Show more"). Every row's destination is the
 * finding permalink page: the story is never dropped at a click-through.
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { TEXT_1, TEXT_2, TEXT_3, HAIRLINE, INK_1, BRASS, RADIUS, TYPO, SPACE, confTier } from '@/lib/graph-utils';
import { headlineFor, shapeLabel } from '@/lib/deal';

const PAGE_SIZE = 60;

const SORTS = [
  { code: 'surprise', label: 'Surprise' },
  { code: 'money', label: 'Money' },
  { code: 'newest', label: 'Newest' },
];

const COLLECTIONS = [
  { code: 'LOOP_CLOSED', title: 'The Contract Loop' },
  { code: 'SHARED_BENCH', title: 'The Media Bench' },
  { code: 'FAMILY_DESK', title: 'Family Business' },
  { code: 'BIG_MONEY', title: 'The £5m Club', minAmount: 5000000 },
];

function moneyValue(finding) {
  const s = finding.slots || {};
  const v = s.amount_gbp ?? s.donation_gbp ?? 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function newestValue(finding) {
  const s = finding.slots || {};
  if (s.valid_from) {
    const t = new Date(s.valid_from).getTime();
    if (!isNaN(t)) return t;
  }
  return null; // no date: keep surprise order for this row (handled by stable sort below)
}

export default function LedgerView({ findings = [], nodes = [], types, onOpenFinding, onOpenEntity, onBack }) {
  const [shapeFilter, setShapeFilter] = useState('ALL');
  const [collection, setCollection] = useState(null); // one of COLLECTIONS[].code, or null
  const [sortBy, setSortBy] = useState('surprise');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const shapesPresent = useMemo(() => {
    const set = new Set(findings.map((f) => f.shape_code));
    return [...set];
  }, [findings]);

  const filtered = useMemo(() => {
    let list = findings;
    if (collection) {
      const def = COLLECTIONS.find((c) => c.code === collection);
      list = list.filter((f) => f.shape_code === collection);
      if (def?.minAmount != null) list = list.filter((f) => moneyValue(f) >= def.minAmount);
    } else if (shapeFilter !== 'ALL') {
      list = list.filter((f) => f.shape_code === shapeFilter);
    }
    return list;
  }, [findings, shapeFilter, collection]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortBy === 'money') {
      list.sort((a, b) => moneyValue(b) - moneyValue(a));
    } else if (sortBy === 'newest') {
      // rows with a valid_from sort newest-first; rows without one keep their relative
      // (already surprise-desc) order and fall after every dated row.
      list.sort((a, b) => {
        const av = newestValue(a);
        const bv = newestValue(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
    } else {
      list.sort((a, b) => b.surprise - a.surprise);
    }
    return list;
  }, [filtered, sortBy]);

  const visible = sorted.slice(0, visibleCount);
  const clearFilters = () => {
    setShapeFilter('ALL');
    setCollection(null);
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 16px 72px' }}>
      <BackBtn onBack={onBack} />

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
        <h1 style={{ ...TYPO.title1, color: TEXT_1, margin: 0 }}>Findings</h1>
        <span style={{ ...TYPO.dataValue, color: TEXT_2 }}>{findings.length.toLocaleString('en-GB')} findings</span>
      </div>

      {/* --------------------------------- collections --------------------------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 22 }}>
        {COLLECTIONS.map((c) => (
          <Chip
            key={c.code}
            active={collection === c.code}
            onClick={() => { setCollection(collection === c.code ? null : c.code); setShapeFilter('ALL'); setVisibleCount(PAGE_SIZE); }}
          >
            {c.title}
          </Chip>
        ))}
      </div>

      {/* --------------------------------- filter rail --------------------------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${HAIRLINE}` }}>
        <Chip
          active={!collection && shapeFilter === 'ALL'}
          onClick={() => { setShapeFilter('ALL'); setCollection(null); setVisibleCount(PAGE_SIZE); }}
        >
          All
        </Chip>
        {shapesPresent.map((code) => (
          <Chip
            key={code}
            active={!collection && shapeFilter === code}
            onClick={() => { setShapeFilter(code); setCollection(null); setVisibleCount(PAGE_SIZE); }}
          >
            {shapeLabel(code)}
          </Chip>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        {SORTS.map((s) => (
          <Chip key={s.code} active={sortBy === s.code} onClick={() => setSortBy(s.code)} muted>
            {s.label}
          </Chip>
        ))}
      </div>

      {/* ----------------------------------- the list ----------------------------------- */}
      <div style={{ marginTop: 22 }}>
        {sorted.length === 0 ? (
          <EmptyState onClear={clearFilters} />
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visible.map((f, i) => (
                <FindingRow key={f.id} finding={f} rank={i + 1} onOpen={() => onOpenFinding && onOpenFinding(f)} />
              ))}
            </div>
            {visibleCount < sorted.length && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                style={{
                  marginTop: 16, display: 'inline-flex', alignItems: 'center', height: 44,
                  padding: '0 16px', borderRadius: RADIUS.sm, background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${HAIRLINE}`, color: TEXT_1, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Show more ({sorted.length - visibleCount} left)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- finding row --------------------------------- */
function FindingRow({ finding, rank, onOpen }) {
  const tier = confTier(finding.min_confidence);
  const pct = Math.round(finding.min_confidence * 100);
  const registers = typeof finding.slots?.n_registers === 'number' ? finding.slots.n_registers : null;

  return (
    <button
      onClick={onOpen}
      className="ledger-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '14px 16px', borderRadius: RADIUS.md, background: INK_1,
        border: `1px solid ${HAIRLINE}`, borderLeft: `2px solid ${BRASS}`, color: TEXT_1,
      }}
    >
      <span style={{ ...TYPO.dataValue, color: TEXT_3, width: 28, flex: '0 0 auto' }}>{rank}</span>
      <span style={{ flex: '0 0 auto' }}>
        <Stamp color={BRASS} small>{shapeLabel(finding.shape_code)}</Stamp>
      </span>
      <span style={{ ...TYPO.title3, color: TEXT_1, flex: 1, minWidth: 0 }} className="ledger-headline">
        {headlineFor(finding)}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
        <Stamp color={tier.color} small>{tier.label.toUpperCase()} &middot; {pct}%</Stamp>
        {registers != null && (
          <Stamp color={TEXT_2} small>{registers} {registers === 1 ? 'REGISTER' : 'REGISTERS'}</Stamp>
        )}
      </span>

      <style>{`
        @media (max-width: 560px) {
          .ledger-row { flex-wrap: wrap; }
          .ledger-headline { flex-basis: 100%; order: 3; margin-top: 4px; white-space: normal; }
        }
      `}</style>
    </button>
  );
}

/* --------------------------------- small pieces --------------------------------- */
function Chip({ active, onClick, children, muted }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 14px', borderRadius: RADIUS.sm,
        cursor: 'pointer', fontSize: 13, fontWeight: 600,
        background: active ? 'rgba(217,166,72,0.10)' : 'transparent',
        border: `1px solid ${active ? BRASS : HAIRLINE}`,
        color: active ? TEXT_1 : (muted ? TEXT_3 : TEXT_2),
      }}
    >
      {children}
    </button>
  );
}

function Stamp({ color, children, small }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
        padding: small ? '2px 6px' : '3px 8px', borderRadius: RADIUS.xs,
        background: `${color}1A`, border: `1px solid ${color}55`, ...TYPO.dataLabel, color, letterSpacing: '.06em',
        fontSize: small ? 9.5 : 10.5,
      }}
    >
      {children}
    </span>
  );
}

function EmptyState({ onClear }) {
  return (
    <div style={{ padding: '32px 20px', textAlign: 'center', border: `1px solid ${HAIRLINE}`, borderRadius: RADIUS.md }}>
      <p style={{ ...TYPO.body, color: TEXT_2, margin: '0 0 14px' }}>No findings match. Clear the filters.</p>
      <button
        onClick={onClear}
        style={{
          display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 16px', borderRadius: RADIUS.sm,
          background: 'rgba(217,166,72,0.08)', border: '1px solid rgba(217,166,72,0.35)', color: BRASS,
          fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Clear
      </button>
    </div>
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
      <ArrowLeft size={15} /> Back
    </button>
  );
}
