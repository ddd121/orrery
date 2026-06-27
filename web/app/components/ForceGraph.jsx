'use client';

/**
 * A small, reusable force-directed graph. Two variants, both laid out ONCE with a
 * synchronous headless pre-warm — there is never a running d3 timer (a live sim over
 * the full network pinned the CPU/fan; this lays positions out once, then paints).
 *
 *   variant="backdrop" — decorative. ~60–90 nodes, dimmed + blurred, non-interactive,
 *      drifts via a slow CSS transform only (no JS animation). The home "wow".
 *   variant="focused"  — legible. A small subset (≤ ~40 nodes), labelled, interactive:
 *      clicking a node calls onNodeClick(id). Used by the dossier ego-graph.
 *
 * Styling (node fill, conflict ring, scrutiny ring, edge weight/opacity) mirrors the
 * full Explore graph so the three views read as one tool.
 */
import React, { useMemo, useRef, useState, useEffect } from 'react';
import * as d3 from 'd3';
import { radius, idOf, typeColor, GOLD, VERM, TEXT } from '@/lib/graph-utils';

/* Lay out a copy of the nodes/links headlessly and return positioned nodes.
   Deterministic seed positions (no Math.random) so SSR and the client agree and
   there's no hydration mismatch — and so the same input always lays out the same. */
function prewarm(rawNodes, rawLinks, width, height, ticks) {
  const cx = width / 2;
  const cy = height / 2;
  const nodes = rawNodes.map((n, i) => ({
    ...n,
    x: cx + Math.cos(i * 1.3) * (Math.min(width, height) * 0.32) + ((i % 7) - 3) * 6,
    y: cy + Math.sin(i * 1.3) * (Math.min(width, height) * 0.32) + ((i % 5) - 2) * 6,
  }));
  const links = rawLinks.map((l) => ({ ...l, source: idOf(l.source), target: idOf(l.target) }));

  const sim = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance((l) => 46 + (1 - (l.strength || 0.5)) * 60)
        .strength((l) => 0.15 + (l.strength || 0.5) * 0.35),
    )
    .force('charge', d3.forceManyBody().strength((d) => -180 - (d.importance || 5) * 26).distanceMax(width))
    .force('collide', d3.forceCollide((d) => radius(d) + 8))
    .force('x', d3.forceX(cx).strength(0.08))
    .force('y', d3.forceY(cy).strength(0.09))
    .stop();
  for (let i = 0; i < ticks; i++) sim.tick();
  sim.stop();

  // fit positions into the viewport with a margin
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    const r = radius(n);
    minX = Math.min(minX, n.x - r); maxX = Math.max(maxX, n.x + r);
    minY = Math.min(minY, n.y - r); maxY = Math.max(maxY, n.y + r);
  });
  const pad = 26;
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const k = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh);
  const ox = (width - bw * k) / 2 - minX * k;
  const oy = (height - bh * k) / 2 - minY * k;
  nodes.forEach((n) => { n.x = n.x * k + ox; n.y = n.y * k + oy; });

  return { nodes, links, scale: k };
}

export default function ForceGraph({
  nodes: rawNodes = [],
  links: rawLinks = [],
  types,
  variant = 'focused',
  onNodeClick,
  height,
}) {
  const backdrop = variant === 'backdrop';
  const W = 1000;
  const H = height || (backdrop ? 700 : 460);

  // Render only after mount: keeps the (cheap, deterministic) layout off the server
  // render path and guarantees the SVG sizes against a real container.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const ticks = backdrop ? 200 : 240;
  const layout = useMemo(
    () => prewarm(rawNodes, rawLinks, W, H, ticks),
    [rawNodes, rawLinks, H, ticks],
  );
  const nodeById = useMemo(() => {
    const m = {};
    layout.nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [layout]);

  const [hover, setHover] = useState(null);

  if (!mounted) {
    return <div style={{ width: '100%', height: '100%' }} aria-hidden />;
  }

  const labelFor = (n) => {
    if (backdrop) return false;
    // in focused mode, label everything that isn't tiny / show the most important
    return true;
  };

  const svg = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden={backdrop ? true : undefined}
    >
      {/* faint orrery rings echo the brand mark */}
      <g style={{ pointerEvents: 'none' }}>
        {[H * 0.22, H * 0.36, H * 0.5].map((r, i) => (
          <circle key={i} cx={W / 2} cy={H / 2} r={r} fill="none" stroke={GOLD} strokeOpacity={backdrop ? 0.05 : 0.06} />
        ))}
      </g>

      {/* edges */}
      <g style={{ pointerEvents: 'none' }}>
        {layout.links.map((l, i) => {
          const s = nodeById[idOf(l.source)];
          const t = nodeById[idOf(l.target)];
          if (!s || !t) return null;
          const conf = l.confidence ?? 0.6;
          const weak = conf < 0.55;
          const focusOnHover = hover && (idOf(l.source) === hover || idOf(l.target) === hover);
          let op = 0.14 + conf * 0.4;
          let w = 0.8 + (l.strength || 0.4) * 2.6;
          let stroke = 'rgba(150,170,210,1)';
          if (focusOnHover) { stroke = GOLD; op = 0.85; w += 0.6; }
          return (
            <line
              key={i}
              x1={s.x} y1={s.y} x2={t.x} y2={t.y}
              stroke={stroke}
              strokeOpacity={op}
              strokeWidth={w}
              strokeLinecap="round"
              strokeDasharray={!focusOnHover && weak ? '2 5' : undefined}
            />
          );
        })}
      </g>

      {/* nodes */}
      <g>
        {layout.nodes.map((n) => {
          const r = radius(n);
          const c = typeColor(n.type, types);
          const interactive = !backdrop && typeof onNodeClick === 'function';
          const isHover = hover === n.id;
          const showLabel =
            labelFor(n) && (n.importance >= 5 || isHover || layout.nodes.length <= 22);
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              style={{ cursor: interactive ? 'pointer' : 'default' }}
              onClick={interactive ? () => onNodeClick(n.id) : undefined}
              onMouseEnter={!backdrop ? () => setHover(n.id) : undefined}
              onMouseLeave={!backdrop ? () => setHover(null) : undefined}
            >
              {interactive && <circle r={Math.max(r, 18)} fill="transparent" />}
              <circle r={r * 2.2} fill={c} opacity={isHover ? 0.26 : backdrop ? 0.1 : 0.12} />
              {isHover && <circle r={r + 5} fill="none" stroke={c} strokeOpacity="0.9" strokeWidth="1.6" />}
              {n.scrutiny >= 0.7 && !backdrop && (
                <circle r={r + 8} fill="none" stroke={VERM} strokeOpacity="0.8" strokeWidth="1.4" strokeDasharray="2 3" />
              )}
              {n.conflict && !backdrop && (
                <circle
                  r={r + 11}
                  fill="none"
                  stroke={VERM}
                  strokeOpacity={n.conflictStrength === 'low' ? 0.4 : n.conflictStrength === 'strong' ? 1 : 0.8}
                  strokeWidth={n.conflictStrength === 'strong' ? 2.6 : 1.8}
                />
              )}
              <circle r={r} fill={c} stroke="rgba(255,255,255,0.7)" strokeWidth={isHover ? 2 : 1} />
              <circle r={r * 0.42} cx={-r * 0.22} cy={-r * 0.22} fill="#fff" opacity="0.22" />
              {showLabel && (
                <text
                  y={r + 14}
                  textAnchor="middle"
                  fontSize={n.importance >= 7 ? 13 : 11.5}
                  fontWeight={n.importance >= 7 ? 700 : 500}
                  fill={TEXT}
                  style={{
                    paintOrder: 'stroke',
                    stroke: 'rgba(7,10,22,0.92)',
                    strokeWidth: 3.5,
                    strokeLinejoin: 'round',
                    pointerEvents: 'none',
                  }}
                >
                  {n.name}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );

  if (backdrop) {
    // dimmed + blurred + slow CSS drift; non-interactive. No JS loop — the only
    // motion is a 60s CSS transform, so the CPU stays idle at rest.
    return (
      <div
        aria-hidden
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}
      >
        <style>{`
          @keyframes orreryDrift {
            0%   { transform: translate(-2%, -1%) rotate(0deg) scale(1.06); }
            50%  { transform: translate(2%, 1.5%) rotate(0.6deg) scale(1.1); }
            100% { transform: translate(-2%, -1%) rotate(0deg) scale(1.06); }
          }
          @media (prefers-reduced-motion: reduce) {
            .orrery-backdrop { animation: none !important; }
          }
        `}</style>
        <div
          className="orrery-backdrop"
          style={{
            position: 'absolute',
            inset: '-6%',
            opacity: 0.5,
            filter: 'blur(1.5px) saturate(0.85)',
            animation: 'orreryDrift 60s ease-in-out infinite',
            willChange: 'transform',
            maskImage: 'radial-gradient(120% 90% at 50% 35%, #000 55%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(120% 90% at 50% 35%, #000 55%, transparent 100%)',
          }}
        >
          {svg}
        </div>
      </div>
    );
  }

  return <div style={{ width: '100%', height: '100%' }}>{svg}</div>;
}
