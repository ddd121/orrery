'use client';

/**
 * Home: the Deal (DESIGN_SPEC_V2 "Step 2: Home = the Deal").
 *
 * Left: The Register masthead, search, "Find your MP", START WITH chips. Right:
 * THE DEAL, a hero finding rendered as a mini orrery + headline + stamps, three
 * smaller text-only cards, "Deal another". Below: the credibility strip and a
 * From The Ledger teaser (top 6 by surprise). The three-column conflicts/money
 * board (`leads()`) moves to the Findings page later; its components are kept
 * below, unused, so that move is a clean cut rather than a rewrite.
 *
 * The line we hold: facts, not verdicts. Every headline is a plain-English fact
 * built from a finding's sourced `slots` (see `lib/deal.js`), never an allegation.
 */
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { MagnifyingGlass, ArrowsClockwise, SealCheck, IdentificationBadge } from '@phosphor-icons/react';
import {
  BRASS, TEXT_1, TEXT_2, TEXT_3, HAIRLINE, INK_1, INK_2, RADIUS, TYPO,
  typeColor, typeIcon, confTier,
} from '@/lib/graph-utils';
import { getOrCreateVisitorId, todayISODate, dealHand, headlineFor, shapeLabel, pivotEntityId } from '@/lib/deal';
import { insightSentence, topInsight } from '@/lib/insights';
import MiniOrrery from '../components/MiniOrrery';

/* real entities the START WITH chips resolve against; hidden if absent from this dataset */
const START_WITH_NAMES = ['Ecotricity Group Limited', 'IPGL Limited', 'GB News', 'Dale Vince'];
const CONNECT_CHIP = { a: 'Dale Vince', b: 'Labour' };

export default function HomeView({ nodes, links, types, findings = [], pairs = [], stats = {}, insightsByEntity = {}, onOpenEntity, onOpenFinding, onOpenLedger, onExplore, onConnect }) {
  const nodesById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);
  const registerCount = useMemo(() => {
    const regSet = new Set();
    for (const l of links) if (l.method) for (const part of l.method.split(' + ')) regSet.add(part.trim());
    return regSet.size || 6;
  }, [links]);

  return (
    <div>
      <div className="home-grid">
        {/* ------------------------------- LEFT: MASTHEAD ------------------------------- */}
        <section className="home-masthead">
          <Eyebrow>A public-record map of UK political influence</Eyebrow>
          <h1 style={{ ...TYPO.display, color: TEXT_1, margin: '10px 0 14px' }}>
            Who funds whom in British politics, with receipts.
          </h1>
          <p style={{ ...TYPO.body, color: TEXT_2, maxWidth: 480, margin: '0 0 24px' }}>
            Every connection between public figures, companies and political money is drawn from a
            public register, and carries its source and an honest confidence score.
          </p>

          <HeroSearch nodes={nodes} types={types} findings={findings} insightsByEntity={insightsByEntity} onOpenEntity={onOpenEntity} />
          <MPFinder nodes={nodes} onOpenEntity={onOpenEntity} />
          <StartWithChips nodes={nodes} types={types} onOpenEntity={onOpenEntity} onConnect={onConnect} />
        </section>

        {/* ---------------------------------- RIGHT: THE DEAL ---------------------------------- */}
        <section className="home-deal">
          <TheDeal nodes={nodes} nodesById={nodesById} findings={findings} onOpenFinding={onOpenFinding} />
        </section>
      </div>

      <StateOfTheRegister stats={stats} nodesById={nodesById} onOpenEntity={onOpenEntity} onOpenLedger={onOpenLedger} />
      <CredibilityStrip total={nodes.length} registerCount={registerCount} findingCount={findings.length} />
      <FromTheLedger findings={findings} nodesById={nodesById} onOpenFinding={onOpenFinding} />

      <style>{`
        .home-grid {
          display: grid; grid-template-columns: 1.1fr 1fr; gap: 40px;
          max-width: 1160px; margin: 0 auto; padding: 56px 20px 40px; align-items: start;
        }
        .home-masthead { padding-top: 8px; }
        @media (max-width: 860px) {
          .home-grid { grid-template-columns: 1fr; padding: 32px 16px 24px; gap: 32px; }
          .home-masthead { padding-top: 0; }
        }
      `}</style>
    </div>
  );
}

function Eyebrow({ children }) {
  return <div style={{ ...TYPO.eyebrow, color: BRASS }}>{children}</div>;
}

/* ------------------------------- hero search ------------------------------- */
function HeroSearch({ nodes, types, findings = [], insightsByEntity = {}, onOpenEntity }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const ranked = useMemo(() => {
    const sr = { strong: 0, medium: 1, low: 2 };
    const crank = (n) => (n.conflict ? (sr[n.conflictStrength] ?? 1) : 3);
    return [...nodes].sort(
      (a, b) => crank(a) - crank(b) || (b.scrutiny || 0) - (a.scrutiny || 0) || b.importance - a.importance || a.name.localeCompare(b.name),
    );
  }, [nodes]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ranked.filter((n) => n.name.toLowerCase().includes(s)).slice(0, 7);
  }, [q, ranked]);
  const nodesById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);
  const suggestions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const f of findings) {
      const id = pivotEntityId(f, nodesById);
      if (!id || seen.has(id) || !nodesById[id]) continue;
      seen.add(id);
      out.push(nodesById[id]);
      if (out.length >= 3) break;
    }
    return out;
  }, [findings, nodesById]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={boxRef} style={{ position: 'relative', maxWidth: 480 }}>
      <MagnifyingGlass size={17} color={TEXT_2} style={{ position: 'absolute', left: 14, top: 14 }} />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search a person, company or party"
        aria-label="Search a person, company or party"
        style={{
          width: '100%', height: 46, padding: '0 16px 0 40px', borderRadius: RADIUS.md, color: TEXT_1, fontSize: 15,
          background: INK_1, border: `1px solid ${HAIRLINE}`, outline: 'none',
        }}
      />
      {open && results.length > 0 && (
        <div
          className="sc"
          style={{ position: 'absolute', top: 52, left: 0, right: 0, zIndex: 30, maxHeight: 320, overflowY: 'auto', borderRadius: RADIUS.md, background: INK_2, border: `1px solid ${HAIRLINE}`, boxShadow: '0 18px 55px rgba(0,0,0,0.5)', padding: 5 }}
        >
          {results.map((n) => (
            <div
              key={n.id}
              onClick={() => { onOpenEntity(n.id); setQ(''); setOpen(false); }}
              title={n.role}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: RADIUS.sm, cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(217,166,72,0.10)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: typeColor(n.type, types) }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, color: TEXT_1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: TEXT_2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(() => {
                    const list = insightsByEntity[n.id];
                    const s = list && list.length ? insightSentence(topInsight(list)).sentence : '';
                    return s || n.role;
                  })()}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {open && q.trim() && results.length === 0 && (
        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, zIndex: 30, borderRadius: RADIUS.md, background: INK_2, border: `1px solid ${HAIRLINE}`, padding: '12px', fontSize: 13, color: TEXT_2 }}>
          <div style={{ marginBottom: suggestions.length ? 9 : 0 }}>No match for that name.</div>
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {suggestions.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { onOpenEntity(n.id); setQ(''); setOpen(false); }}
                  style={{
                    display: 'block', textAlign: 'left', width: '100%', padding: '7px 8px', borderRadius: RADIUS.sm,
                    background: 'none', border: 'none', color: BRASS, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(217,166,72,0.10)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  {n.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Find your MP ------------------------------- */
/* MPs/ministers/peers are `entity_type = 'person'` with the parliamentary role carried
   in `role` (loadGraph sets role = canonical_entities.category), not in `type`, so this
   matches either, in case a future recompute starts setting entity_type directly. */
const MP_TYPES = new Set(['mp', 'minister', 'peer']);

function MPFinder({ nodes, onOpenEntity }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const mps = useMemo(
    () => nodes.filter((n) => MP_TYPES.has(n.type) || MP_TYPES.has(n.role)),
    [nodes],
  );
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return mps.filter((n) => n.name.toLowerCase().includes(s)).slice(0, 7);
  }, [q, mps]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (mps.length === 0) return null;

  return (
    <div ref={boxRef} style={{ position: 'relative', maxWidth: 480, marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IdentificationBadge size={15} color={TEXT_2} style={{ flex: '0 0 auto' }} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Find your MP"
          aria-label="Find your MP"
          style={{
            flex: 1, height: 38, padding: '0 12px', borderRadius: RADIUS.sm, color: TEXT_1, fontSize: 13.5,
            background: 'rgba(255,255,255,0.03)', border: `1px solid ${HAIRLINE}`, outline: 'none',
          }}
        />
      </div>
      {open && results.length > 0 && (
        <div
          className="sc"
          style={{ position: 'absolute', top: 44, left: 23, right: 0, zIndex: 30, maxHeight: 280, overflowY: 'auto', borderRadius: RADIUS.md, background: INK_2, border: `1px solid ${HAIRLINE}`, boxShadow: '0 18px 55px rgba(0,0,0,0.5)', padding: 5 }}
        >
          {results.map((n) => (
            <div
              key={n.id}
              onClick={() => { onOpenEntity(n.id); setQ(''); setOpen(false); }}
              title={n.role}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: RADIUS.sm, cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(217,166,72,0.10)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: typeColor(n.type) }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, color: TEXT_1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                <span style={{ display: 'block', fontSize: 10.5, color: TEXT_2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.role}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {open && q.trim() && results.length === 0 && (
        <div style={{ position: 'absolute', top: 44, left: 23, right: 0, zIndex: 30, borderRadius: RADIUS.md, background: INK_2, border: `1px solid ${HAIRLINE}`, padding: '12px', fontSize: 12.5, color: TEXT_2 }}>
          No match. Try a surname.
        </div>
      )}
    </div>
  );
}

/* ------------------------------- START WITH chips ------------------------------- */
function StartWithChips({ nodes, types, onOpenEntity, onConnect }) {
  const byName = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.name] = n));
    return m;
  }, [nodes]);

  const chips = START_WITH_NAMES.map((name) => byName[name]).filter(Boolean);
  const connectSubject = byName[CONNECT_CHIP.a];

  if (chips.length === 0 && !connectSubject) return null;

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ ...TYPO.dataLabel, marginBottom: 10 }}>START WITH</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {chips.map((n) => {
          const Icon = typeIcon(n.type, types);
          const col = typeColor(n.type, types);
          return (
            <button
              key={n.id}
              onClick={() => onOpenEntity(n.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: RADIUS.sm,
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${HAIRLINE}`, color: TEXT_1,
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              <Icon size={14} color={col} /> {n.name}
            </button>
          );
        })}
        {connectSubject && (
          <button
            onClick={() => onConnect(connectSubject.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: RADIUS.sm,
              background: 'rgba(217,166,72,0.08)', border: `1px solid rgba(217,166,72,0.35)`, color: BRASS,
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            How is {CONNECT_CHIP.a} connected to {CONNECT_CHIP.b}?
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- THE DEAL ---------------------------------- */
function TheDeal({ nodes, nodesById, findings, onOpenFinding }) {
  const [visitorId, setVisitorId] = useState(null);
  const [drawCount, setDrawCount] = useState(0);
  const [seen, setSeen] = useState(() => new Set());

  useEffect(() => {
    setVisitorId(getOrCreateVisitorId());
  }, []);

  const seedStr = visitorId ? `${visitorId}|${todayISODate()}|${drawCount}` : null;
  const hand = useMemo(() => {
    if (!seedStr || findings.length === 0) return [];
    return dealHand(findings, seedStr, seen);
  }, [seedStr, findings, seen]);

  if (findings.length === 0) {
    return (
      <div style={{ padding: '18px 0' }}>
        <div style={{ ...TYPO.dataLabel, marginBottom: 10 }}>YOUR DRAW</div>
        <div style={{ ...TYPO.body, color: TEXT_2 }}>No findings computed yet.</div>
      </div>
    );
  }
  if (hand.length === 0) return null; // visitorId not yet resolved client-side

  const dealAnother = () => {
    setSeen((prev) => {
      const next = new Set(prev);
      hand.forEach((f) => next.add(f.id));
      // if that would exhaust the pool, reset "seen" so the next hand isn't starved
      return next.size >= findings.length ? new Set() : next;
    });
    setDrawCount((c) => c + 1);
  };

  const [hero, ...rest] = hand;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ ...TYPO.dataLabel }}>YOUR DRAW</div>
        <button
          onClick={dealAnother}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: RADIUS.sm,
            background: 'rgba(217,166,72,0.08)', border: `1px solid rgba(217,166,72,0.35)`, color: BRASS,
            fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <ArrowsClockwise size={14} /> Deal another
        </button>
      </div>

      <HeroFindingCard finding={hero} nodesById={nodesById} onOpen={() => onOpenFinding && onOpenFinding(hero)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
        {rest.map((f) => (
          <SmallFindingCard key={f.id} finding={f} onOpen={() => onOpenFinding && onOpenFinding(f)} />
        ))}
      </div>

      <p style={{ ...TYPO.caption, color: TEXT_3, marginTop: 14, marginBottom: 0 }}>
        Dealt from {findings.length} findings computed from six public registers. Your draw. Press
        Deal another for a fresh one.
      </p>
    </div>
  );
}

function HeroFindingCard({ finding, nodesById, onOpen }) {
  const tier = confTier(finding.min_confidence);
  const pct = Math.round(finding.min_confidence * 100);
  const registerCount = registerCountOf(finding);
  return (
    <button
      onClick={onOpen}
      className="in"
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: 20, borderRadius: RADIUS.md, background: INK_1, border: `1px solid ${HAIRLINE}`, color: TEXT_1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(217,166,72,0.4)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = HAIRLINE)}
    >
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          <MiniOrrery finding={finding} nodesById={nodesById} size={220} showLabels />
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 220 }}>
          <p style={{ ...TYPO.title1, color: TEXT_1, margin: '0 0 14px' }}>{headlineFor(finding)}</p>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <Stamp color={BRASS}>{shapeLabel(finding.shape_code)}</Stamp>
            <Stamp color={tier.color}>{tier.label.toUpperCase()} &middot; {pct}%</Stamp>
            <Stamp color={TEXT_2}>{registerCount} {registerCount === 1 ? 'REGISTER' : 'REGISTERS'}</Stamp>
          </div>
        </div>
      </div>
    </button>
  );
}

function SmallFindingCard({ finding, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="in"
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: 14, borderRadius: RADIUS.md, background: 'rgba(255,255,255,0.02)', border: `1px solid ${HAIRLINE}`, color: TEXT_1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(217,166,72,0.35)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = HAIRLINE)}
    >
      <p style={{ ...TYPO.bodySm, color: TEXT_1, margin: '0 0 10px', lineHeight: 1.45 }}>{headlineFor(finding)}</p>
      <Stamp color={BRASS} small>{shapeLabel(finding.shape_code)}</Stamp>
    </button>
  );
}

function Stamp({ color, children, small }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', padding: small ? '2px 6px' : '3px 8px', borderRadius: RADIUS.xs,
        background: `${color}1A`, border: `1px solid ${color}55`, ...TYPO.dataLabel, color, letterSpacing: '.06em',
        fontSize: small ? 9.5 : 10.5,
      }}
    >
      {children}
    </span>
  );
}

function registerCountOf(finding) {
  const s = finding.slots || {};
  if (typeof s.n_registers === 'number') return s.n_registers;
  return 1;
}

/* ----------------------------- credibility strip ----------------------------- */
function CredibilityStrip({ total, registerCount, findingCount }) {
  const items = [
    `${total.toLocaleString('en-GB')} entities`,
    `${registerCount} public registers`,
    `${findingCount.toLocaleString('en-GB')} findings`,
    'every link cites its source',
  ];
  return (
    <div style={{ borderTop: `1px solid ${HAIRLINE}`, borderBottom: `1px solid ${HAIRLINE}`, background: 'rgba(255,255,255,0.015)' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <SealCheck size={14} color={TEXT_2} style={{ flex: '0 0 auto' }} />
        {items.map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && <span style={{ color: 'rgba(154,167,199,0.25)' }}>&middot;</span>}
            <span style={{ ...TYPO.dataLabel, color: TEXT_2 }}>{t}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- state of the register ----------------------------- */
/* Four audited numbers straight off register_stats, each clickable to somewhere useful.
   NO invented numbers: a stat that hasn't been computed simply doesn't render its card,
   rather than showing a placeholder or a zero that reads as a real fact. */
function StateOfTheRegister({ stats = {}, nodesById, onOpenEntity, onOpenLedger }) {
  const gbp = (n) => (n == null ? null : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(n));

  const cards = [];

  const totalMoney = stats.total_political_money;
  if (totalMoney && totalMoney.value != null) {
    cards.push({
      key: 'total_political_money',
      value: `£${gbp(totalMoney.value)}`,
      label: 'political money mapped',
      onClick: onOpenLedger,
    });
  }

  const biggest = stats.largest_single_donation;
  if (biggest && biggest.value != null) {
    const donor = biggest.slots?.donor_name;
    const recipient = biggest.slots?.recipient_name;
    const donorId = biggest.slots?.donor_entity_id;
    cards.push({
      key: 'largest_single_donation',
      value: `£${gbp(biggest.value)}`,
      label: 'the largest single donation',
      sub: donor && recipient ? `${donor} to ${recipient}` : undefined,
      onClick: donorId && nodesById?.[donorId] ? () => onOpenEntity(donorId) : undefined,
    });
  }

  const paidTies = stats.parliamentarians_with_paid_ties;
  if (paidTies && paidTies.value != null) {
    cards.push({
      key: 'parliamentarians_with_paid_ties',
      value: paidTies.value.toLocaleString('en-GB'),
      label: 'parliamentarians with paid corporate ties',
      onClick: onOpenLedger,
    });
  }

  const loopCos = stats.donor_and_contractor_companies;
  if (loopCos && loopCos.value != null) {
    cards.push({
      key: 'donor_and_contractor_companies',
      value: loopCos.value.toLocaleString('en-GB'),
      label: 'companies both donate and hold public contracts',
      onClick: onOpenLedger,
    });
  }

  if (cards.length === 0) return null;

  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}`, background: 'rgba(255,255,255,0.015)' }}>
      <div className="sotr-strip" style={{ maxWidth: 1160, margin: '0 auto', display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)` }}>
        {cards.map((c, i) => (
          <button
            key={c.key}
            onClick={c.onClick}
            disabled={!c.onClick}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              minHeight: 44, padding: '22px 16px', textAlign: 'center',
              background: 'none', border: 'none', borderLeft: i > 0 ? `1px solid ${HAIRLINE}` : 'none',
              cursor: c.onClick ? 'pointer' : 'default', color: TEXT_1,
            }}
            onMouseEnter={(e) => { if (c.onClick) e.currentTarget.style.background = 'rgba(217,166,72,0.05)'; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            <span style={{ ...TYPO.dataValue, fontSize: 22, color: BRASS, fontVariantNumeric: 'tabular-nums' }}>{c.value}</span>
            <span style={{ ...TYPO.dataLabel, color: TEXT_2 }}>{c.label}</span>
            {c.sub && (
              <span style={{ ...TYPO.caption, color: TEXT_3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                {c.sub}
              </span>
            )}
          </button>
        ))}
      </div>
      <style>{`
        @media (max-width: 720px) {
          .sotr-strip { grid-template-columns: repeat(2, 1fr) !important; }
          .sotr-strip > button:nth-child(3) { border-left: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ----------------------------- From The Ledger ----------------------------- */
function FromTheLedger({ findings, nodesById, onOpenFinding }) {
  const top6 = useMemo(() => findings.slice(0, 6), [findings]);
  if (top6.length === 0) return null;

  return (
    <section style={{ maxWidth: 1160, margin: '0 auto', padding: '32px 20px 64px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ ...TYPO.title2, color: TEXT_1, margin: 0 }}>From the ledger</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: RADIUS.md, overflow: 'hidden', border: `1px solid ${HAIRLINE}` }}>
        {top6.map((f, i) => {
          const tier = confTier(f.min_confidence);
          const pct = Math.round(f.min_confidence * 100);
          return (
            <button
              key={f.id}
              onClick={() => onOpenFinding && onOpenFinding(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: '13px 16px', background: INK_1, border: 'none', borderBottom: i < top6.length - 1 ? `1px solid ${HAIRLINE}` : 'none',
                color: TEXT_1,
              }}
            >
              <span style={{ ...TYPO.dataValue, color: TEXT_3, width: 20, flex: '0 0 auto' }}>{i + 1}</span>
              <Stamp color={BRASS} small>{shapeLabel(f.shape_code)}</Stamp>
              <span style={{ ...TYPO.bodySm, color: TEXT_1, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {headlineFor(f)}
              </span>
              <Stamp color={tier.color} small>{tier.label.toUpperCase()} &middot; {pct}%</Stamp>
            </button>
          );
        })}
      </div>
    </section>
  );
}
