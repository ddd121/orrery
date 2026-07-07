'use client';

/**
 * InTheNews: the "recent coverage mentioning this name" panel (plan Wave B.2), shared
 * between the dossier (EntityView) and the finding page (FindingView) so the two read
 * identically. Framing is name-mention only: a headline that MENTIONS a name is never
 * asserted to be ABOUT our entity. Hidden entirely when there are no rows — no panel,
 * no placeholder, nothing invented.
 */
import React from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { TEXT_1, TEXT_2, TEXT_3, HAIRLINE, RADIUS, TYPO } from '@/lib/graph-utils';
import { truncate } from '@/lib/deal';

/** GDELT `seendate` arrives as a compact "YYYYMMDDHHMMSS"-style string; parse the date
 *  part defensively and fall back to the raw string rather than showing "Invalid Date". */
function formatSeenDate(seendate) {
  if (!seendate) return '';
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(seendate));
  const d = m
    ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    : new Date(seendate);
  if (isNaN(d.getTime())) return String(seendate);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function InTheNews({ rows, caption = 'Recent coverage mentioning this name.', cap = 3 }) {
  const shown = (rows || []).slice(0, cap);
  if (shown.length === 0) return null;

  return (
    <div>
      <div style={{ ...TYPO.dataLabel }}>IN THE NEWS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
        {shown.map((r) => (
          <a
            key={r.id ?? r.url}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, textDecoration: 'none',
              padding: '9px 11px', borderRadius: RADIUS.sm, background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${HAIRLINE}`, color: TEXT_1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(217,166,72,0.4)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = HAIRLINE)}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ ...TYPO.bodySm, display: 'block', color: TEXT_1 }}>{truncate(r.title, 70)}</span>
              <span style={{ ...TYPO.caption, display: 'block', color: TEXT_3, marginTop: 3 }}>
                {r.domain}{r.domain && r.seendate ? ' · ' : ''}{formatSeenDate(r.seendate)}
              </span>
            </span>
            <ArrowSquareOut size={13} color={TEXT_2} style={{ flex: '0 0 auto', marginTop: 2 }} />
          </a>
        ))}
      </div>
      <p style={{ ...TYPO.caption, color: TEXT_3, marginTop: 8, marginBottom: 0 }}>{caption}</p>
    </div>
  );
}
