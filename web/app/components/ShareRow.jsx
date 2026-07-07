'use client';

/**
 * ShareRow: the finding's carry-elsewhere row (DESIGN_SPEC_V2 "Step 6"; Wave C).
 *
 * A row of 44px register-styled buttons: X, WhatsApp, LinkedIn, the existing Cutting
 * (image) action, and Copy link. Every button only ever carries the SAME facts and
 * sources already on the page it was opened from, never a verdict, never a new claim.
 *
 * Labels are visible at >=560px and icon-only below that (aria-label always carries the
 * name); `compact` forces icon-only regardless of viewport, for tight layouts.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { XLogo, WhatsappLogo, LinkedinLogo, LinkSimple, Check } from '@phosphor-icons/react';
import { HAIRLINE, RADIUS, TEXT_2, TEXT_1, POSITIVE } from '@/lib/graph-utils';
import { shareText } from '@/lib/deal';
import { CuttingButton } from './Cutting';

export function ShareRow({ finding, nodesById, url, compact }) {
  const [copied, setCopied] = useState(false);
  // Resolved post-mount only (never during the render that SSR/hydration both run), so the
  // server-rendered HTML and the first client render agree — `window` is never read during
  // render itself, only inside this effect. Fixes a hydration mismatch on every share href.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!finding) return null;

  const shareUrl = url || (origin ? `${origin}/f/${finding.id}` : '');
  const text = shareText(finding);

  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (insecure context): leave state unchanged */
    }
  }, [shareUrl]);

  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${text}${shareUrl}`)}`;
  const liHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      {!compact && (
        <style>{`
          @media (max-width: 559px) {
            .orrery-share-row-label { display: none; }
          }
        `}</style>
      )}
      <ShareLink href={xHref} icon={XLogo} label="Share on X" compact={compact} />
      <ShareLink href={waHref} icon={WhatsappLogo} label="Share on WhatsApp" compact={compact} />
      <ShareLink href={liHref} icon={LinkedinLogo} label="Share on LinkedIn" compact={compact} />
      <CuttingButton finding={finding} nodesById={nodesById} />
      <button
        type="button"
        onClick={copyLink}
        aria-label={copied ? 'Link copied' : 'Copy link'}
        style={rowButtonStyle(copied)}
      >
        {copied ? <Check size={16} /> : <LinkSimple size={16} />}
        {!compact && <span className="orrery-share-row-label">{copied ? 'Link copied' : 'Copy link'}</span>}
      </button>
    </div>
  );
}

function ShareLink({ href, icon: Icon, label, compact }) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...rowButtonStyle(false), color: hover ? TEXT_1 : TEXT_2, textDecoration: 'none' }}
    >
      <Icon size={16} />
      {!compact && <span className="orrery-share-row-label">{label.replace('Share on ', '')}</span>}
    </a>
  );
}

function rowButtonStyle(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 44,
    padding: '0 16px',
    borderRadius: RADIUS.sm,
    cursor: 'pointer',
    fontSize: 13.5,
    fontWeight: 600,
    background: active ? 'rgba(99,185,139,0.12)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? 'rgba(99,185,139,0.5)' : HAIRLINE}`,
    color: active ? POSITIVE : TEXT_2,
  };
}

export default ShareRow;
