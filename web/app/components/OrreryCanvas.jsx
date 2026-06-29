'use client';

/**
 * The Explore full-network canvas — react-force-graph-2d (canvas/WebGL-ish 2d),
 * the M5 swap for the hand-rolled SVG. The library owns the d3-force simulation,
 * pan and zoom; we only describe how to *paint* each node and edge so the look is
 * pixel-for-pixel the same tool as Home / Dossier / Connect (same tokens, conflict
 * ring, scrutiny halo, dotted-weak edges, gold trace path).
 *
 * react-force-graph touches `window`, so OrreryGraph imports this via next/dynamic
 * with { ssr: false }. Everything stateful (selection, threshold, filters, trace)
 * lives up in OrreryGraph and arrives here as props; this component is the renderer.
 *
 * Performance: at ~2,000 nodes a per-tick React re-render of ~5k SVG elements pinned
 * the CPU (the "fan"). Here the simulation runs on the canvas with a bounded cooldown
 * and then idles (autoPauseRedraw) — no React work per frame.
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
  const { selectedId, traceSet, neighbours, focusId, isOn, matchesId } = ui;
  const on = isOn(node.type);
  const r = radius(node);
  const c = typeColor(node.type, ui.types);
  const x = node.x, y = node.y;

  const isSel = selectedId === node.id;
  const inTrace = traceSet.has(node.id);
  const isNb = neighbours.has(node.id);
  const matched = matchesId(node.id);

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

  // label — only when it would be legible (zoomed in enough) OR the node is
  // important / selected / traced / a search hit. Keeps the field readable at full extent.
  const zoomedEnough = globalScale >= 1.6;
  const showLabel = on && (isSel || inTrace || matched || (node.importance >= 6 && zoomedEnough) || (node.importance >= 8));
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

const OrreryCanvas = forwardRef(function OrreryCanvas(
  { graphData, types, ui, onNodeClick, onBackgroundClick, onEngineStop },
  ref,
) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // keep the latest UI state in a ref so the canvas paint closures always read live
  // values without forcing the library to rebind accessors every render.
  const uiRef = useRef(ui);
  uiRef.current = ui;

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
      fgRef.current?.d3ReheatSimulation();
    },
    raw() {
      return fgRef.current;
    },
  }), []);

  // tune the force layout once the graph instance exists — spread the hairball out
  // a little more than the library default so ~2k nodes don't clump.
  const onReady = (fg) => {
    fgRef.current = fg;
    if (!fg) return;
    try {
      fg.d3Force('charge')?.strength(-140).distanceMax(700);
      const lf = fg.d3Force('link');
      if (lf) {
        lf.distance((l) => 36 + (1 - (l.strength || 0.5)) * 60).strength((l) => 0.12 + (l.strength || 0.5) * 0.25);
      }
    } catch { /* force may not be ready on first paint; harmless */ }
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
        graphData={graphData}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        /* nodes — we paint them ourselves to mirror the SVG */
        nodeRelSize={1}
        nodeVal={(n) => radius(n)}
        nodeLabel={() => ''}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        /* links — custom paint for the dotted-weak / gold-trace treatment */
        linkVisibility={linkVisibility}
        linkCanvasObject={linkCanvasObject}
        /* interaction */
        onNodeClick={(n) => onNodeClick?.(n)}
        onBackgroundClick={() => onBackgroundClick?.()}
        enableNodeDrag
        warmupTicks={20}
        cooldownTicks={120}
        cooldownTime={6000}
        d3VelocityDecay={0.32}
        autoPauseRedraw
        minZoom={0.18}
        maxZoom={8}
        onEngineStop={() => onEngineStop?.()}
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
