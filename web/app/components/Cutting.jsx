'use client';

/**
 * Cutting: the shareable image (DESIGN_SPEC_V2 "Step 6: THE CUTTING"; plan Wave 3).
 *
 * "Copy as cutting" renders a finding as a 1200x630 PNG, dark register ground, the
 * mini orrery geometry redrawn as raw SVG primitives (no React component inside the
 * SVG string), a Newsreader headline, its stamps, and a footer citing the register
 * and date. Pure client-side: SVG string -> Image -> canvas -> toBlob -> ClipboardItem,
 * with a download fallback if the clipboard image write throws. Never a verdict: the
 * image carries exactly the same facts and sources as the page it was copied from.
 */
import React, { useState, useCallback } from 'react';
import { Copy, Check } from '@phosphor-icons/react';
import { RADIUS, HAIRLINE, TEXT_1, TEXT_2, TEXT_3, BRASS, INK_0, INK_1, POSITIVE, SIGNAL, confTier, typeColor } from '@/lib/graph-utils';
import { headlineFor, shapeLabel, pivotEntityId } from '@/lib/deal';

const CUT_W = 1200;
const CUT_H = 630;

export function CuttingButton({ finding, nodesById, label = 'Copy as cutting' }) {
  const [state, setState] = useState('idle'); // idle | working | copied | downloaded | error

  const handleClick = useCallback(async () => {
    if (!finding || typeof window === 'undefined') return;
    setState('working');
    try {
      const blob = await renderCuttingPng(finding, nodesById);
      if (!blob) throw new Error('render failed');

      let copied = false;
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
          copied = true;
        }
      } catch {
        copied = false;
      }

      if (copied) {
        setState('copied');
      } else {
        // download fallback: an <a download> of the blob URL
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'orrery-cutting.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setState('downloaded');
      }
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  }, [finding, nodesById]);

  const text = state === 'copied' ? 'Cutting copied'
    : state === 'downloaded' ? 'Downloaded'
    : state === 'error' ? 'Could not copy'
    : state === 'working' ? 'Rendering…'
    : label;
  const success = state === 'copied' || state === 'downloaded';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'working'}
      aria-live="polite"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 16px',
        borderRadius: RADIUS.sm, cursor: state === 'working' ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 600,
        background: success ? 'rgba(99,185,139,0.12)' : 'rgba(217,166,72,0.08)',
        border: `1px solid ${success ? 'rgba(99,185,139,0.5)' : 'rgba(217,166,72,0.35)'}`,
        color: success ? POSITIVE : BRASS,
        opacity: state === 'working' ? 0.7 : 1,
      }}
    >
      {success ? <Check size={16} /> : <Copy size={16} />}
      {text}
    </button>
  );
}

/* ------------------------------ SVG -> PNG blob ------------------------------ */
/** Builds the 1200x630 cutting as an SVG string, waits for webfonts, rasterises to a
 *  canvas, and resolves a PNG Blob. Returns null on any client-side failure so the
 *  caller can fall back to an error state rather than throw uncaught. */
async function renderCuttingPng(finding, nodesById) {
  if (typeof document === 'undefined') return null;

  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch {
    /* webfont readiness is best-effort; rasterise with whatever is loaded */
  }

  const svg = buildCuttingSvg(finding, nodesById);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('svg image load failed'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = CUT_W;
  canvas.height = CUT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, CUT_W, CUT_H);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/* ------------------------------ SVG string builder ------------------------------ */
const FONT_SANS_STACK = '"Public Sans", Arial, sans-serif';
const FONT_DISPLAY_STACK = '"Newsreader", Georgia, serif';
const FONT_MONO_STACK = 'ui-monospace, Consolas, monospace';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Manual word-wrap to ~maxChars per line, capped at maxLines (last line ellipsised). */
function wrapText(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = w;
      if (lines.length === maxLines) break;
    } else {
      current = next;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (last.length > maxChars) lines[maxLines - 1] = `${last.slice(0, maxChars - 1)}…`;
  }
  return lines;
}

/** The mini-orrery geometry, drawn as raw SVG primitives (rings + centre + orbiters +
 *  money arc). Deliberately re-implemented rather than importing MiniOrrery.jsx: this
 *  string is rasterised outside React, so only primitives travel. Mirrors the same
 *  proportions as components/MiniOrrery.jsx at a fixed size. */
function buildOrreryGeometry(finding, nodesById, cx, cy, size) {
  const MAX_ORBITERS = 6;
  const memberIds = finding.member_entity_ids || [];
  const centreId = pivotEntityId(finding, nodesById);
  const centre = centreId ? nodesById[centreId] : null;
  const orbiterIds = memberIds.filter((id) => id !== centreId).slice(0, MAX_ORBITERS);

  const ringOuterR = size * 0.40;
  const ringInnerR = size * 0.26;
  const centreR = Math.max(7, size * 0.052);
  const orbiterR = Math.max(4, size * 0.03);

  const n = orbiterIds.length || 1;
  const positions = orbiterIds.map((id, i) => {
    const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return { id, node: nodesById[id], x: cx + Math.cos(angle) * ringOuterR, y: cy + Math.sin(angle) * ringOuterR };
  });

  const isLoop = finding.shape_code === 'LOOP_CLOSED';
  const centreCol = centre ? typeColor(centre.type) : TEXT_2;
  const money = finding.slots?.amount_gbp ?? finding.slots?.donation_gbp ?? null;
  const flow = !isLoop && money != null && positions.length ? positions[0] : null;

  let out = '';
  out += `<ellipse cx="${cx}" cy="${cy}" rx="${ringOuterR}" ry="${ringOuterR * 0.98}" fill="none" stroke="${HAIRLINE}" stroke-width="1" />`;
  out += `<ellipse cx="${cx}" cy="${cy}" rx="${ringInnerR}" ry="${ringInnerR * 0.98}" fill="none" stroke="${HAIRLINE}" stroke-width="1" />`;

  if (flow) {
    const midX = cx + (flow.x - cx) * 0.5;
    const midY = cy + (flow.y - cy) * 0.5 - 14;
    out += `<path d="M ${cx} ${cy} Q ${midX} ${midY} ${flow.x} ${flow.y}" fill="none" stroke="${BRASS}" stroke-opacity="0.7" stroke-width="1.5" />`;
  }
  if (isLoop) {
    for (const p of positions) {
      const midX = cx + (p.x - cx) * 0.5;
      const midY = cy + (p.y - cy) * 0.5 - 10;
      out += `<path d="M ${cx} ${cy} Q ${midX} ${midY} ${p.x} ${p.y}" fill="none" stroke="${BRASS}" stroke-opacity="0.6" stroke-width="1.25" />`;
    }
  }
  if (centre) {
    out += `<circle cx="${cx}" cy="${cy}" r="${centreR + 5}" fill="none" stroke="${BRASS}" stroke-opacity="0.45" stroke-width="2" />`;
    out += `<circle cx="${cx}" cy="${cy}" r="${centreR}" fill="${centreCol}" stroke="rgba(255,255,255,0.75)" stroke-width="1" />`;
  }
  for (const p of positions) {
    const col = p.node ? typeColor(p.node.type) : TEXT_2;
    out += `<circle cx="${p.x}" cy="${p.y}" r="${orbiterR}" fill="${col}" stroke="rgba(255,255,255,0.6)" stroke-width="0.75" />`;
  }
  return out;
}

/** Builds the full 1200x630 cutting SVG string. */
function buildCuttingSvg(finding, nodesById) {
  const headline = headlineFor(finding);
  const shape = shapeLabel(finding.shape_code);
  const tier = confTier(finding.min_confidence);
  const pct = Math.round(finding.min_confidence * 100);
  const registers = typeof finding.slots?.n_registers === 'number' ? finding.slots.n_registers : null;

  const orreryCx = 150;
  const orreryCy = CUT_H / 2 + 10;
  const orreryGeom = buildOrreryGeometry(finding, nodesById, orreryCx, orreryCy, 300);

  const rightX = 340;
  const headlineLines = wrapText(headline, 26, 5);
  const headlineStartY = 150;
  const headlineLineHeight = 52;

  const headlineTspans = headlineLines
    .map((line, i) => `<tspan x="${rightX}" y="${headlineStartY + i * headlineLineHeight}">${esc(line)}</tspan>`)
    .join('');

  const stampsY = headlineStartY + headlineLines.length * headlineLineHeight + 36;

  const stamps = [
    { text: shape, color: BRASS },
    { text: `${tier.label.toUpperCase()} · ${pct}%`, color: tier.color },
    ...(registers != null ? [{ text: `${registers} ${registers === 1 ? 'REGISTER' : 'REGISTERS'}`, color: TEXT_2 }] : []),
  ];
  let stampX = rightX;
  const stampEls = stamps.map((s) => {
    const w = 22 + s.text.length * 8.5;
    const el = `<rect x="${stampX}" y="${stampsY}" width="${w}" height="30" rx="4" fill="${s.color}1A" stroke="${s.color}55" stroke-width="1" />` +
      `<text x="${stampX + w / 2}" y="${stampsY + 20}" text-anchor="middle" font-family='${FONT_MONO_STACK}' font-size="13" letter-spacing="0.06em" fill="${s.color}">${esc(s.text)}</text>`;
    stampX += w + 10;
    return el;
  }).join('');

  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CUT_W}" height="${CUT_H}" viewBox="0 0 ${CUT_W} ${CUT_H}">
    <rect x="0" y="0" width="${CUT_W}" height="${CUT_H}" fill="${INK_0}" />
    <line x1="60" y1="56" x2="${CUT_W - 60}" y2="56" stroke="${HAIRLINE}" stroke-width="1" />
    <text x="60" y="42" font-family='${FONT_MONO_STACK}' font-size="15" letter-spacing="0.18em" fill="${BRASS}">ORRERY</text>
    <text x="${CUT_W - 60}" y="42" text-anchor="end" font-family='${FONT_MONO_STACK}' font-size="12" letter-spacing="0.08em" fill="${TEXT_3}">DRAWN FROM THE PUBLIC REGISTERS</text>
    ${orreryGeom}
    <text font-family='${FONT_DISPLAY_STACK}' font-size="44" font-weight="600" fill="${TEXT_1}">${headlineTspans}</text>
    ${stampEls}
    <line x1="60" y1="${CUT_H - 56}" x2="${CUT_W - 60}" y2="${CUT_H - 56}" stroke="${HAIRLINE}" stroke-width="1" />
    <text x="60" y="${CUT_H - 30}" font-family='${FONT_MONO_STACK}' font-size="16" fill="${TEXT_3}">ORRERY &#183; drawn from the public registers &#183; ${esc(dateStr)}</text>
  </svg>`;
}
