'use client';

/**
 * MiniOrrery: the signature visual (DESIGN_SPEC_V2 "Step 2: Home = the Deal").
 *
 * A pure, static SVG that draws one finding as a small planetary model: a pivotal
 * CENTRE entity (BRASS halo) with its member entities orbiting on a ring, all
 * type-coloured. No animation, no simulation: every position is a deterministic
 * function of the finding's member list, so it renders identically at 220px (hero)
 * and ~90px (thumbnail). The geometry is meant to read as an orrery, not a bubble
 * chart: thin hairline rings, precise dots, one warm accent at the centre.
 */
import React from 'react';
import { HAIRLINE, BRASS, TYPO, TEXT_2, typeColor } from '@/lib/graph-utils';
import { pivotEntityId, truncate } from '@/lib/deal';

const MAX_ORBITERS = 6;

export default function MiniOrrery({ finding, nodesById, size = 220, showLabels = true }) {
  const memberIds = finding.member_entity_ids || [];
  const centreId = pivotEntityId(finding, nodesById);
  const centre = centreId ? nodesById[centreId] : null;
  const orbiterIds = memberIds.filter((id) => id !== centreId);
  const shown = orbiterIds.slice(0, MAX_ORBITERS);
  const overflow = Math.max(0, orbiterIds.length - MAX_ORBITERS);
  const labelsOn = showLabels && size >= 200;

  const cx = size / 2;
  const cy = size / 2;
  const ringOuterR = size * 0.40;
  const ringInnerR = size * 0.26;
  const centreR = Math.max(7, size * 0.052);
  const orbiterR = Math.max(4, size * 0.03);

  // evenly distribute orbiters by angle, starting at -90deg (12 o'clock) so the
  // layout feels intentional rather than scattered.
  const n = shown.length || 1;
  const positions = shown.map((id, i) => {
    const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return {
      id,
      node: nodesById[id],
      x: cx + Math.cos(angle) * ringOuterR,
      y: cy + Math.sin(angle) * ringOuterR,
      angle,
    };
  });

  const isLoop = finding.shape_code === 'LOOP_CLOSED';
  const centreCol = centre ? typeColor(centre.type) : TEXT_2;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Mini orrery: ${centre?.name ?? 'finding'} with ${shown.length} connected ${shown.length === 1 ? 'entity' : 'entities'}`}
    >
      {/* the two register rings */}
      <ellipse cx={cx} cy={cy} rx={ringOuterR} ry={ringOuterR * 0.98} fill="none" stroke={HAIRLINE} strokeWidth={1} />
      <ellipse cx={cx} cy={cy} rx={ringInnerR} ry={ringInnerR * 0.98} fill="none" stroke={HAIRLINE} strokeWidth={1} />

      {/* LOOP_CLOSED: two thin arcs closing the loop between the centre and its orbiters
          (money out, money back): the geometry IS the finding. Subtle, BRASS, 60% opacity. */}
      {isLoop && positions.length > 0 && (
        <g stroke={BRASS} strokeOpacity={0.6} fill="none" strokeWidth={1.25}>
          {positions.map((p) => {
            const midX = cx + (p.x - cx) * 0.5;
            const midY = cy + (p.y - cy) * 0.5 - 10;
            return <path key={`arc-${p.id}`} d={`M ${cx} ${cy} Q ${midX} ${midY} ${p.x} ${p.y}`} />;
          })}
        </g>
      )}

      {/* centre: soft BRASS halo ring, then the body in its own type colour */}
      {centre && (
        <g>
          <circle cx={cx} cy={cy} r={centreR + 5} fill="none" stroke={BRASS} strokeOpacity={0.45} strokeWidth={2} />
          <circle cx={cx} cy={cy} r={centreR} fill={centreCol} stroke="rgba(255,255,255,0.75)" strokeWidth={1} />
        </g>
      )}

      {/* orbiters */}
      {positions.map((p) => {
        const col = p.node ? typeColor(p.node.type) : TEXT_2;
        return (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={orbiterR} fill={col} stroke="rgba(255,255,255,0.6)" strokeWidth={0.75} />
            {labelsOn && p.node && (
              <text
                x={p.x + (Math.cos(p.angle) >= 0 ? orbiterR + 5 : -(orbiterR + 5))}
                y={p.y + 3}
                textAnchor={Math.cos(p.angle) >= 0 ? 'start' : 'end'}
                style={{ ...TYPO.dataLabel, fontSize: 9.5, textTransform: 'none', letterSpacing: 0 }}
                fill={TEXT_2}
              >
                {truncate(p.node.name, 16)}
              </text>
            )}
          </g>
        );
      })}

      {/* overflow marker for findings with more than MAX_ORBITERS members */}
      {overflow > 0 && (
        <g>
          <circle
            cx={cx + Math.cos(-Math.PI / 2 + (n - 0.5) / n * 2 * Math.PI) * (ringOuterR + 14)}
            cy={cy + Math.sin(-Math.PI / 2 + (n - 0.5) / n * 2 * Math.PI) * (ringOuterR + 14)}
            r={orbiterR + 3}
            fill="none"
            stroke={HAIRLINE}
            strokeWidth={1}
          />
          <text
            x={cx + Math.cos(-Math.PI / 2 + (n - 0.5) / n * 2 * Math.PI) * (ringOuterR + 14)}
            y={cy + Math.sin(-Math.PI / 2 + (n - 0.5) / n * 2 * Math.PI) * (ringOuterR + 14) + 3}
            textAnchor="middle"
            style={{ ...TYPO.dataLabel, fontSize: 8.5 }}
            fill={TEXT_2}
          >
            +{overflow}
          </text>
        </g>
      )}
    </svg>
  );
}
