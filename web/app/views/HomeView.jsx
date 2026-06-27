'use client';

/**
 * Home — the findings-first, search-led landing.
 *
 * No hairball: a hero search, a board of computed leads (conflicts of interest +
 * the money behind the parties), a quiet credibility strip, and a cheap drifting
 * graph backdrop behind the hero. Everything is sourced and clicks through to a
 * dossier. The line we hold: facts, not verdicts — conflicts read "merits a look".
 */
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Search, ArrowRight, AlertTriangle, Coins, Users, GitCompareArrows, ShieldCheck } from 'lucide-react';
import {
  GOLD, VERM, TEXT, MUTE, HAIR, PANEL, MONO,
  typeColor, typeIcon, leads,
} from '@/lib/graph-utils';
import ForceGraph from '../components/ForceGraph';

/* pick a representative, well-connected subset for the decorative backdrop */
function backdropSubset(nodes, links, leadData, cap = 80) {
  const degree = {};
  for (const l of links) {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    degree[s] = (degree[s] || 0) + 1;
    degree[t] = (degree[t] || 0) + 1;
  }
  const keep = new Set();
  // seed with the leads so the backdrop quietly mirrors the board
  leadData.conflicts.slice(0, 12).forEach((c) => keep.add(c.node.id));
  leadData.money.slice(0, 8).forEach((m) => { keep.add(m.donor.id); keep.add(m.party.id); });
  // fill out with the most-connected nodes
  [...nodes]
    .sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0))
    .forEach((n) => { if (keep.size < cap) keep.add(n.id); });

  const subNodes = nodes.filter((n) => keep.has(n.id));
  const subLinks = links.filter((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    return keep.has(s) && keep.has(t);
  });
  return { subNodes, subLinks };
}

export default function HomeView({ nodes, links, types, onOpenEntity, onExplore, onConnect }) {
  const leadData = useMemo(() => leads(nodes, links), [nodes, links]);
  const { subNodes, subLinks } = useMemo(
    () => backdropSubset(nodes, links, leadData),
    [nodes, links, leadData],
  );
  const conflictCount = leadData.conflicts.length;

  return (
    <div>
      {/* ---------------------------------- HERO ---------------------------------- */}
      <section style={{ position: 'relative', overflow: 'hidden', borderBottom: `1px solid ${HAIR}` }}>
        <ForceGraph nodes={subNodes} links={subLinks} types={types} variant="backdrop" height={520} />
        {/* legibility scrim over the backdrop */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(7,10,22,0.35) 0%, rgba(7,10,22,0.55) 60%, rgba(7,10,22,0.85) 100%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 880, margin: '0 auto', padding: '64px 20px 52px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 'clamp(26px, 5vw, 40px)', fontWeight: 800, lineHeight: 1.12, margin: '0 0 14px', letterSpacing: '-0.01em' }}>
            The money and companies<br />around UK politics — <span style={{ color: GOLD }}>sourced</span>.
          </h1>
          <p style={{ fontSize: 'clamp(14px, 2.4vw, 16px)', color: '#C7CEDF', lineHeight: 1.6, maxWidth: 620, margin: '0 auto 26px' }}>
            Search a public figure, company or party to see who funds them, who sits where, and how they connect — every link drawn from a public register, with an honest confidence.
          </p>
          <HeroSearch nodes={nodes} types={types} onOpenEntity={onOpenEntity} onConnect={onConnect} />
        </div>
      </section>

      {/* ------------------------------ CREDIBILITY STRIP ------------------------------ */}
      <CredibilityStrip total={nodes.length} conflictCount={conflictCount} />

      {/* -------------------------------- FINDINGS BOARD -------------------------------- */}
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 16px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, margin: '28px 2px 4px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>What merits a look</h2>
            <p style={{ fontSize: 13, color: MUTE, margin: '5px 0 0' }}>Computed from the registers — overlaps and the largest political money. Facts, not verdicts.</p>
          </div>
          <button
            onClick={onExplore}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIR}`, color: MUTE, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            Explore the full network <ArrowRight size={15} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginTop: 18, alignItems: 'start' }}>
          {/* conflicts of interest */}
          <BoardColumn
            icon={<AlertTriangle size={16} color={VERM} />}
            title="Conflicts of interest"
            sub={`${conflictCount} flagged · strong signals first`}
          >
            {leadData.conflicts.length === 0 && <EmptyNote>No conflict-shaped overlaps in this dataset yet.</EmptyNote>}
            {leadData.conflicts.slice(0, 8).map((c) => (
              <ConflictCard key={c.node.id} lead={c} types={types} onOpen={() => onOpenEntity(c.node.id)} />
            ))}
          </BoardColumn>

          {/* the money behind the parties */}
          <BoardColumn
            icon={<Coins size={16} color={GOLD} />}
            title="The money behind the parties"
            sub="Largest donations on record"
          >
            {leadData.money.length === 0 && <EmptyNote>No donations resolved in this dataset yet.</EmptyNote>}
            {leadData.money.map((m, i) => (
              <MoneyCard key={`${m.donor.id}-${m.party.id}-${i}`} lead={m} types={types} onOpen={onOpenEntity} />
            ))}
          </BoardColumn>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------- hero search ------------------------------- */
function HeroSearch({ nodes, types, onOpenEntity, onConnect }) {
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

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div ref={boxRef} style={{ position: 'relative' }}>
        <Search size={18} color={MUTE} style={{ position: 'absolute', left: 16, top: 16 }} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search a person, company or party…"
          aria-label="Search a person, company or party"
          style={{
            width: '100%', height: 52, padding: '0 18px 0 44px', borderRadius: 13, color: TEXT, fontSize: 16,
            background: 'rgba(13,18,34,0.85)', border: `1px solid rgba(232,182,90,0.35)`, outline: 'none',
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          }}
        />
        {open && results.length > 0 && (
          <div
            className="sc in"
            style={{ position: 'absolute', top: 58, left: 0, right: 0, zIndex: 30, maxHeight: 330, overflowY: 'auto', borderRadius: 13, background: PANEL, border: `1px solid ${HAIR}`, boxShadow: '0 18px 55px rgba(0,0,0,0.55)', padding: 6, textAlign: 'left' }}
          >
            {results.map((n) => (
              <div
                key={n.id}
                onClick={() => { onOpenEntity(n.id); setQ(''); setOpen(false); }}
                title={n.role}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(232,182,90,0.12)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', flex: '0 0 auto', background: typeColor(n.type, types) }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.role}</span>
                </span>
                {n.conflict && <span style={{ fontFamily: MONO, fontSize: 9, color: VERM, flex: '0 0 auto', opacity: n.conflictStrength === 'low' ? 0.5 : 1 }}>merits a look</span>}
              </div>
            ))}
          </div>
        )}
        {open && q.trim() && results.length === 0 && (
          <div style={{ position: 'absolute', top: 58, left: 0, right: 0, zIndex: 30, borderRadius: 13, background: PANEL, border: `1px solid ${HAIR}`, padding: '15px 14px', fontSize: 13, color: MUTE, textAlign: 'left' }}>
            No match. Try a surname, a company, or a party.
          </div>
        )}
      </div>

      {/* Milestone 4 — the A→B connection finder */}
      <button
        type="button"
        onClick={onConnect}
        title="Find the connection between two names"
        style={{
          marginTop: 13, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 20,
          background: 'rgba(232,182,90,0.08)', border: `1px solid rgba(232,182,90,0.35)`, color: GOLD, fontSize: 12.5, fontWeight: 600,
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(232,182,90,0.16)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(232,182,90,0.08)')}
      >
        <GitCompareArrows size={14} /> Find the connection between two names
      </button>
    </div>
  );
}

/* ----------------------------- credibility strip ----------------------------- */
function CredibilityStrip({ total, conflictCount }) {
  const items = [
    `${total.toLocaleString('en-GB')} entities`,
    '4 public registers',
    `${conflictCount} leads`,
    'every link sourced',
  ];
  return (
    <div style={{ borderBottom: `1px solid ${HAIR}`, background: 'rgba(255,255,255,0.015)' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <ShieldCheck size={14} color={MUTE} style={{ flex: '0 0 auto' }} />
        {items.map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && <span style={{ color: 'rgba(190,200,230,0.25)' }}>·</span>}
            <span style={{ fontFamily: MONO, fontSize: 11.5, letterSpacing: '.04em', color: MUTE }}>{t}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- board parts -------------------------------- */
function BoardColumn({ icon, title, sub, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        {icon}
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
      </div>
      <div className="eb" style={{ marginBottom: 12 }}>{sub}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function EmptyNote({ children }) {
  return <div style={{ fontSize: 13, color: MUTE, fontStyle: 'italic', padding: '6px 2px' }}>{children}</div>;
}

function strengthMeta(strength) {
  if (strength === 'strong') return { acc: VERM, label: 'Strong signal', op: 1 };
  if (strength === 'low') return { acc: '#9AA0AD', label: 'Lower priority', op: 0.85 };
  return { acc: VERM, label: 'Worth a look', op: 0.92 };
}

function ConflictCard({ lead, types, onOpen }) {
  const { node, reason, overlap, strength } = lead;
  const meta = strengthMeta(strength);
  const low = strength === 'low';
  const Icon = typeIcon(node.type, types);
  const col = typeColor(node.type, types);
  return (
    <button
      onClick={onOpen}
      className="in"
      style={{
        textAlign: 'left', width: '100%', cursor: 'pointer', padding: '14px 15px', borderRadius: 13,
        background: low ? 'rgba(154,160,173,0.06)' : 'rgba(229,101,75,0.07)',
        border: `1px solid ${low ? 'rgba(154,160,173,0.30)' : 'rgba(229,101,75,0.38)'}`,
        color: TEXT, display: 'block', opacity: meta.op,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = low ? 'rgba(154,160,173,0.55)' : 'rgba(229,101,75,0.7)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = low ? 'rgba(154,160,173,0.30)' : 'rgba(229,101,75,0.38)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', flex: '0 0 auto', background: `${col}22`, border: `1px solid ${col}55` }}>
          <Icon size={16} color={col} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          <span style={{ display: 'block', fontSize: 11, color: MUTE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.role}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, flex: '0 0 auto', background: low ? 'rgba(154,160,173,0.14)' : 'rgba(229,101,75,0.16)', border: `1px solid ${low ? 'rgba(154,160,173,0.4)' : 'rgba(229,101,75,0.5)'}`, color: low ? '#C7CBD3' : '#F0A593', fontFamily: MONO, fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          <AlertTriangle size={10} /> merits a look
        </span>
      </div>
      {reason && <div style={{ fontSize: 13, color: low ? '#C7CBD3' : '#E8C7BC', lineHeight: 1.5 }}>{reason}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: meta.acc, opacity: low ? 0.8 : 1 }}>{meta.label}</span>
        {overlap && (
          <>
            <span style={{ color: 'rgba(190,200,230,0.25)' }}>·</span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTE }}>{overlap} overlap</span>
          </>
        )}
      </div>
    </button>
  );
}

function MoneyCard({ lead, types, onOpen }) {
  const { donor, party, amountStr, behind } = lead;
  const donorCol = typeColor(donor.type, types);
  const partyCol = typeColor(party.type, types);
  return (
    <div
      className="in"
      style={{ padding: '14px 15px', borderRadius: 13, background: 'rgba(232,182,90,0.05)', border: `1px solid rgba(232,182,90,0.28)` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => onOpen(donor.id)} style={chipBtn(donorCol)}>
          <span style={dot(donorCol)} /> {donor.name}
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 13, fontWeight: 700, color: GOLD }}>
          {amountStr ? amountStr : '—'} <ArrowRight size={13} color={MUTE} />
        </span>
        <button onClick={() => onOpen(party.id)} style={chipBtn(partyCol)}>
          <span style={dot(partyCol)} /> {party.name}
        </button>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTE, marginTop: 9 }}>
        Donation on record · Electoral Commission
      </div>
      {behind.length > 0 && (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: `1px solid ${HAIR}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
            <Users size={12} color={MUTE} />
            <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: MUTE }}>The people behind it</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {behind.map((b) => (
              <button key={b.node.id} onClick={() => onOpen(b.node.id)} style={chipBtn(typeColor(b.node.type, types), true)} title={`${b.rel} · ${b.node.role}`}>
                <span style={dot(typeColor(b.node.type, types))} /> {b.node.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function chipBtn(color, small) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: small ? '4px 9px' : '5px 10px', borderRadius: 8,
    background: `${color}14`, border: `1px solid ${color}44`, color: TEXT, cursor: 'pointer',
    fontSize: small ? 12 : 13, fontWeight: 600, maxWidth: '100%',
  };
}
function dot(color) {
  return { width: 8, height: 8, borderRadius: '50%', background: color, flex: '0 0 auto', display: 'inline-block' };
}
