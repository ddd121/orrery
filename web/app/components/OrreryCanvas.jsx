'use client';

/**
 * The Explore canvas — react-force-graph-2d (canvas/WebGL-ish 2d). The library owns
 * the d3-force simulation, pan and zoom; we only describe how to *paint* each node and
 * edge so the look is pixel-for-pixel the same tool as Home / Dossier / Connect (same
 * tokens, conflict ring, scrutiny halo, dotted-weak edges, gold trace path, a faint
 * brass ring on finding members).
 *
 * react-force-graph touches `window`, so OrreryGraph imports this via next/dynamic
 * with { ssr: false }. Everything stateful (selection, threshold, filters, trace)
 * lives up in OrreryGraph and arrives here as props; this component is the renderer.
 *
 * Performance (DESIGN_SPEC_V2 "Step 5"): OrreryGraph already caps the data at <=300
 * nodes / <=900 edges (the constellation/focus subgraph), so this never lays out the
 * full network. On top of that:
 *   - a bounded warmup (headless ticks) then a HARD freeze: cooldownTicks is finite
 *     and onEngineStop stops the simulation for good — no perpetual redraw loop.
 *   - the settled layout (x/y per node) is cached in sessionStorage keyed by a hash of
 *     the node-set (`layoutKey`, computed by OrreryGraph via hashIdSet) so returning to
 *     the same constellation/focus is instant and never re-simulates.
 *   - labels only draw when zoomed in (k > 1.4), or the node is well-connected
 *     (degree >= 8), or it's a finding member — otherwise label-on-hover only.
 */
import React, { useRef, useEffect, useMemo, useState, useImperativeHandle, forwardRef } from 'react';
import dynamic from 'next/dynamic';
import { radius, idOf, typeColor, GOLD, VERM, TEXT, MUTE } from '@/lib/graph-utils';

// canvas build (force-graph + d3-force) — NOT the three.js 3D build. Client-only.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const HALO_BG = 'rgba(7,10,22,0.92)'; // label outline / readability stroke, matches the SVG

/**
 * Paint one node onto the canvas. Mirrors the SVG node group exactly:
 *   soft colour glow → scrutiny halo (dashed red) → conflict ring (strength-scaled red)
 *   → selected/trace ring → the body circle + a specular highlight → label (gated).
 * `globalScale` is the current zoom; we use it to keep stroke widths/labels crisp and
 * to only show labels once they'd be legible (or when the node is selected/searched).
 */
function paintNode(node, ctx, globalScale, ui) {
  const { selectedId, traceSet, neighbours, focusId, isOn, matchesId, hoveredId, degreeById } = ui;
  const on = isOn(node.type);
  const r = radius(node);
  const c = typeColor(node.type, ui.types);
  const x = node.x, y = node.y;

  const isSel = selectedId === node.id;
  const inTrace = traceSet.has(node.id);
  const isNb = neighbours.has(node.id);
  const matched = matchesId(node.id);
  const isHovered = hoveredId === node.id;
  const degree = degreeById?.[node.id] ?? 0;

  // dim rule mirrors the SVG: a focus/search context fades everything not in it
  const dim = on && ((focusId && !isSel && !isNb && !inTrace) || (ui.hasSearch && !matched && !inTrace));
  const alpha = !on ? 0.06 : dim ? 0.2 : 1;
  ctx.globalAlpha = alpha;

  // soft colour glow (twinkles for the very prominent in the SVG; on canvas we keep it steady but a touch brighter when active)
  ctx.beginPath();
  ctx.arc(x, y, r * 2.3, 0, 2 * Math.PI);
  ctx.fillStyle = c;
  ctx.globalAlpha = alpha * (isSel || inTrace ? 0.3 : node.importance >= 8 ? 0.16 : 0.12);
  ctx.fill();
  ctx.globalAlpha = alpha;

  // scrutiny halo — dashed vermillion ring (entity "merits a look")
  if (node.scrutiny >= 0.7) {
    ctx.beginPath();
    ctx.arc(x, y, r + 9, 0, 2 * Math.PI);
    ctx.strokeStyle = VERM;
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = alpha;
  }

  // faint brass ring — this entity is a member of a finding (DESIGN_SPEC_V2 "Step 5":
  // the constellation should read as visibly organised around what merits attention).
  if (node.isFindingMember && !node.conflict) {
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, 2 * Math.PI);
    ctx.strokeStyle = GOLD;
    ctx.globalAlpha = alpha * 0.45;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // conflict ring — solid vermillion, width + opacity scaled by strength
  if (node.conflict) {
    const co = node.conflictStrength === 'low' ? 0.4 : node.conflictStrength === 'strong' ? 1 : 0.8;
    const cw = node.conflictStrength === 'strong' ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 12, 0, 2 * Math.PI);
    ctx.strokeStyle = VERM;
    ctx.globalAlpha = alpha * co;
    ctx.lineWidth = cw;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // selected / trace ring (gold for trace, type colour for plain selection)
  if (isSel || inTrace) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6, 0, 2 * Math.PI);
    ctx.strokeStyle = inTrace ? GOLD : c;
    ctx.globalAlpha = alpha * 0.9;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // body
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = c;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = isSel ? 2 : 1;
  ctx.stroke();

  // specular highlight (top-left), the same "sphere" cue as the SVG
  ctx.beginPath();
  ctx.arc(x - r * 0.22, y - r * 0.22, r * 0.42, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = alpha * 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;

  // label — DESIGN_SPEC_V2 "Step 5": only draw when zoomed in (k > 1.4), the node is
  // well-connected (degree >= 8) or it's a finding member; otherwise hover-only.
  // Selection / trace / search-match always earn a label regardless of zoom.
  const zoomedEnough = globalScale > 1.4;
  const showLabel = on && (isSel || inTrace || matched || isHovered || zoomedEnough || degree >= 8 || node.isFindingMember);
  if (showLabel && !dim) {
    const fontSize = (node.importance >= 8 ? 14 : 12) / globalScale;
    ctx.font = `${node.importance >= 7 ? 700 : 500} ${fontSize}px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ly = y + r + 4 / globalScale;
    // readability stroke behind the text (paintOrder: stroke in the SVG)
    ctx.lineWidth = 3.5 / globalScale;
    ctx.strokeStyle = HALO_BG;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha;
    ctx.strokeText(node.name, x, ly);
    ctx.fillStyle = TEXT;
    ctx.fillText(node.name, x, ly);
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 1;
}

/** Bigger hit area than the visible dot (matches the SVG's transparent 22px target). */
function paintNodePointer(node, color, ctx) {
  const r = Math.max(radius(node), 10);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
  ctx.fill();
}

/** sessionStorage helpers for the per-node-set layout cache (DESIGN_SPEC_V2 "Step 5":
 *  cache the computed layout keyed by a hash of the sorted included ids, and restore
 *  it so returning to a view is instant and never re-simulates). */
function loadCachedLayout(key) {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveCachedLayout(key, nodes) {
  if (!key || typeof window === 'undefined') return;
  try {
    const positions = {};
    for (const n of nodes) if (n.x != null && n.y != null) positions[n.id] = [n.x, n.y];
    window.sessionStorage.setItem(key, JSON.stringify(positions));
  } catch { /* storage full / unavailable — layout just re-simulates, harmless */ }
}

const OrreryCanvas = forwardRef(function OrreryCanvas(
  { graphData, types, ui, onNodeClick, onBackgroundClick, onEngineStop, layoutKey },
  ref,
) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoveredId, setHoveredId] = useState(null);
  const frozenRef = useRef(false);

  // node degree within the current (already-capped) graph data — drives the label
  // gate (degree >= 8 earns an always-on label) independent of zoom.
  const degreeById = useMemo(() => {
    const d = {};
    for (const l of graphData.links || []) {
      const a = idOf(l.source), b = idOf(l.target);
      d[a] = (d[a] ?? 0) + 1;
      d[b] = (d[b] ?? 0) + 1;
    }
    return d;
  }, [graphData]);

  // restore a cached layout (if we've laid out this exact node-set before) BEFORE the
  // library mounts, so it starts from settled positions instead of the centre.
  const seededGraphData = useMemo(() => {
    const cached = loadCachedLayout(layoutKey);
    if (!cached) return graphData;
    let hit = 0;
    const nodes = graphData.nodes.map((n) => {
      const pos = cached[n.id];
      if (!pos) return n;
      hit++;
      return { ...n, x: pos[0], y: pos[1] };
    });
    // only trust the cache if it covers (almost) every node in this set
    if (hit < nodes.length * 0.9) return graphData;
    return { nodes, links: graphData.links };
  }, [graphData, layoutKey]);
  const hadCachedLayout = seededGraphData !== graphData;

  // keep the latest UI state in a ref so the canvas paint closures always read live
  // values without forcing the library to rebind accessors every render.
  const uiRef = useRef(ui);
  uiRef.current = { ...ui, hoveredId, degreeById };

  // size the canvas to its container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // a new node-set (constellation <-> focus, or a widened focus) needs a fresh warmup.
  // Crucially, the underlying force-graph engine's animation frame loop does NOT
  // restart itself just because `graphData` changed (pauseAnimation cancels the
  // rAF loop outright, and there is no "resume on new data" wiring in the library) —
  // so a hard freeze on the PREVIOUS node-set would otherwise permanently stall every
  // node-set after it. Explicitly resume + reheat on every node-set change, then let
  // the (possibly instant, if cached) settle re-freeze it via handleEngineStop.
  useEffect(() => {
    frozenRef.current = false;
    const fg = fgRef.current;
    if (!fg) return;
    fg.resumeAnimation();
    fg.d3ReheatSimulation();
  }, [layoutKey]);

  // expose the imperative handles OrreryGraph drives (focus an entity, recenter)
  useImperativeHandle(ref, () => ({
    centerOnNode(node, k = 1.6, ms = 700) {
      const fg = fgRef.current;
      if (!fg || !node || node.x == null) return;
      fg.centerAt(node.x, node.y, ms);
      fg.zoom(k, ms);
    },
    fit(ms = 600, pad = 48) {
      const fg = fgRef.current;
      if (!fg) return;
      fg.zoomToFit(ms, pad);
    },
    reheat() {
      frozenRef.current = false;
      fgRef.current?.d3ReheatSimulation();
    },
    raw() {
      return fgRef.current;
    },
  }), []);

  // tune the force layout once the graph instance exists — spread the constellation
  // out a little more than the library default so it doesn't clump.
  const onReady = (fg) => {
    const firstMount = !fgRef.current;
    fgRef.current = fg;
    if (!fg) return;
    try {
      fg.d3Force('charge')?.strength(-140).distanceMax(700);
      const lf = fg.d3Force('link');
      if (lf) {
        lf.distance((l) => 36 + (1 - (l.strength || 0.5)) * 60).strength((l) => 0.12 + (l.strength || 0.5) * 0.25);
      }
      // a cached, already-settled layout needs no further simulation at all — this
      // only applies on first mount; later node-set swaps are handled by the
      // layoutKey effect above (resumeAnimation) and handleEngineStop below.
      if (firstMount && hadCachedLayout) {
        fg.pauseAnimation();
        frozenRef.current = true;
      }
    } catch { /* force may not be ready on first paint; harmless */ }
  };

  const handleEngineStop = () => {
    // HARD freeze: stop the simulation for good once it settles, and cache the
    // resulting positions for this node-set so a return visit is instant.
    if (frozenRef.current) return; // already frozen (e.g. a cached layout) — nothing to do
    frozenRef.current = true;
    fgRef.current?.pauseAnimation();
    saveCachedLayout(layoutKey, graphData.nodes);
    onEngineStop?.();
  };

  // ---- accessor callbacks. They read uiRef.current so they stay cheap + always current.
  const linkVisibility = useMemo(() => (l) => {
    const u = uiRef.current;
    const a = idOf(l.source), b = idOf(l.target);
    const sN = u.nodeById[a], tN = u.nodeById[b];
    if (!sN || !tN) return false;
    if (l.confidence * 100 < u.threshold) return false;
    if (!u.isOn(sN.type) || !u.isOn(tN.type)) return false;
    return true;
  }, []);

  // We draw links ourselves (linkCanvasObject) to reproduce the SVG precisely:
  // base steel-blue, opacity/width from confidence+strength, dotted when weak,
  // gold + thicker when in the trace path or touching the focused node, dimmed otherwise.
  const linkCanvasObject = useMemo(() => (l, ctx, globalScale) => {
    const u = uiRef.current;
    const a = idOf(l.source), b = idOf(l.target);
    const sN = l.source, tN = l.target; // force-graph replaces ids with node refs once laid out
    if (typeof sN !== 'object' || typeof tN !== 'object') return;

    const key = u.pairKey(a, b);
    const inTrace = u.tracePairs.has(key);
    const inFocus = u.focusId && (a === u.focusId || b === u.focusId);
    const matched = !u.hasSearch || u.matchesId(a) || u.matchesId(b) || inTrace;
    const dim = (u.focusId && !inFocus && !inTrace) || (u.hasSearch && !matched);
    const weak = l.confidence < 0.55;

    let stroke = 'rgba(150,170,210,1)';
    let op = 0.16 + l.confidence * 0.42;
    let w = 1 + l.strength * 3.4;
    if (inTrace) { stroke = GOLD; op = 0.95; w += 1.4; }
    else if (inFocus) { stroke = GOLD; op = 0.7; w += 0.6; }
    if (dim) op *= 0.16;

    ctx.beginPath();
    ctx.moveTo(sN.x, sN.y);
    ctx.lineTo(tN.x, tN.y);
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = op;
    ctx.lineWidth = w / globalScale;
    ctx.lineCap = 'round';
    if (!inTrace && weak) ctx.setLineDash([2 / globalScale, 6 / globalScale]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, []);

  const nodeCanvasObject = useMemo(() => (node, ctx, globalScale) => {
    paintNode(node, ctx, globalScale, uiRef.current);
  }, []);
  const nodePointerAreaPaint = useMemo(() => (node, color, ctx) => {
    // don't make filtered-off nodes clickable
    if (!uiRef.current.isOn(node.type)) return;
    paintNodePointer(node, color, ctx);
  }, []);

  if (!size.w) {
    // measure first; ForceGraph needs explicit width/height to avoid a 0-size canvas
    return <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }} />;
  }

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={seededGraphData}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        /* nodes — we paint them ourselves to mirror the SVG */
        nodeRelSize={1}
        nodeVal={(n) => radius(n)}
        nodeLabel={() => ''}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        onNodeHover={(n) => setHoveredId(n ? n.id : null)}
        /* links — custom paint for the dotted-weak / gold-trace treatment */
        linkVisibility={linkVisibility}
        linkCanvasObject={linkCanvasObject}
        /* interaction */
        onNodeClick={(n) => onNodeClick?.(n)}
        onBackgroundClick={() => onBackgroundClick?.()}
        enableNodeDrag
        /* bounded warmup + a FINITE cooldown, then a hard stop (handleEngineStop) —
           never a perpetual simulation, even on a fresh (uncached) node-set. */
        warmupTicks={hadCachedLayout ? 0 : 60}
        cooldownTicks={hadCachedLayout ? 0 : 90}
        cooldownTime={4000}
        d3VelocityDecay={0.32}
        autoPauseRedraw
        minZoom={0.18}
        maxZoom={8}
        onEngineStop={handleEngineStop}
      />
      <ForceReady fgRef={fgRef} onReady={onReady} />
    </div>
  );
});

/* tiny helper: react-force-graph exposes its instance via the forwarded ref; we run
   force tuning once it's mounted. Kept separate so the effect isn't tied to size. */
function ForceReady({ fgRef, onReady }) {
  useEffect(() => {
    let raf;
    const t = () => {
      if (fgRef.current) onReady(fgRef.current);
      else raf = requestAnimationFrame(t);
    };
    raf = requestAnimationFrame(t);
    return () => cancelAnimationFrame(raf);
  }, [fgRef, onReady]);
  return null;
}

export default OrreryCanvas;
