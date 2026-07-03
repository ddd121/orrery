/**
 * Shared, framework-agnostic helpers + design tokens for ORRERY's UI.
 *
 * Single source of truth for: the dark/gold/vermillion palette, the per-type
 * colours/icons, and the read-only graph derivations (path-finding, the findings
 * board, and an entity's grouped ties). The pipeline writes the resolved graph;
 * everything here only *reads* the {nodes, links} shape from `loadGraph`.
 *
 * The line we hold: these helpers surface sourced connections and structural
 * overlaps. They never assert wrongdoing — a conflict is framed "merits a look".
 */
import type { GraphNode, GraphLink, TypeConfig } from "@/lib/graph";
import {
  Landmark,
  User,
  Building2,
  Flag,
  Users,
  Briefcase,
} from "lucide-react";

/* ---------- design tokens: "The Register" ---------- */
/* Surfaces: flat near-black ground, borders not shadows. */
export const INK_0 = "#0A0E16"; // page background
export const INK_1 = "#101624"; // surface: cards, panels
export const INK_2 = "#161D2E"; // surface-raised: popovers, dropdowns, modals
export const HAIRLINE = "rgba(154,167,199,0.16)"; // default border
export const HAIRLINE_STRONG = "rgba(154,167,199,0.30)"; // hover / emphasis border
/* Text: three tiers, TEXT_3 is the AA floor and nothing goes below it. */
export const TEXT_1 = "#EDF1FA";
export const TEXT_2 = "#A9B2C8";
export const TEXT_3 = "#7C86A2";
/* One accent (brass) means "interactive / selected". Vermillion + green are semantic-only. */
export const BRASS = "#D9A648";
export const BRASS_SOFT = "rgba(217,166,72,0.12)";
export const SIGNAL = "#E06A50"; // conflicts, leads, confidence < 50
export const SIGNAL_SOFT = "rgba(224,106,80,0.10)";
export const POSITIVE = "#63B98B"; // Established confidence >= 80
export const SHADOW_OVERLAY = "0 16px 48px rgba(3,6,12,0.55)"; // floating layers only
export const PAGE_BG = "linear-gradient(180deg,#0C1120 0%, #0A0E16 320px)";

/* Font role stacks (faces loaded in layout.tsx via next/font, exposed as CSS vars). */
export const FONT_DISPLAY = 'var(--font-display), Georgia, "Times New Roman", serif';
export const FONT_SANS = 'var(--font-sans), "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO = 'var(--font-mono), ui-monospace, Consolas, monospace';

/* Legacy aliases (kept so existing components re-skin without edits; prefer the names above). */
export const GOLD = BRASS;
export const VERM = SIGNAL;
export const TEXT = TEXT_1;
export const MUTE = TEXT_2;
export const HAIR = HAIRLINE;
export const PANEL = INK_2;
export const MONO = FONT_MONO;
export const SANS = FONT_SANS;
export const BG = PAGE_BG;

/* Spacing + radius scales (the whole app uses only these). */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48 };
export const RADIUS = { xs: 4, sm: 8, md: 12, full: 999 }; // stamp 4, control 8, card 12, dot full

/* Type scale as reusable style tokens. Newsreader (display) is used only in display + title1. */
export const TYPO = {
  display: { fontFamily: FONT_DISPLAY, fontSize: "clamp(28px, 4.5vw, 38px)", fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.01em" },
  title1: { fontFamily: FONT_DISPLAY, fontSize: "clamp(22px, 3.5vw, 27px)", fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.005em" },
  title2: { fontFamily: FONT_SANS, fontSize: 17, fontWeight: 700, lineHeight: 1.3 },
  title3: { fontFamily: FONT_SANS, fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 },
  body: { fontFamily: FONT_SANS, fontSize: 14, fontWeight: 400, lineHeight: 1.6 },
  bodySm: { fontFamily: FONT_SANS, fontSize: 13, fontWeight: 400, lineHeight: 1.55 },
  caption: { fontFamily: FONT_SANS, fontSize: 12, fontWeight: 400, lineHeight: 1.5, color: TEXT_2 },
  eyebrow: { fontFamily: FONT_MONO, fontSize: 11, fontWeight: 500, lineHeight: 1, letterSpacing: ".14em", textTransform: "uppercase" as const, color: TEXT_2 },
  dataLabel: { fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: 500, lineHeight: 1, letterSpacing: ".08em", textTransform: "uppercase" as const, color: TEXT_3 },
  dataValue: { fontFamily: FONT_MONO, fontSize: 13, fontWeight: 500, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" as const },
};

/* Per-entity-type colours, one lightness band, none colliding with the semantic three. */
export const TYPE_COLORS: Record<string, string> = {
  mp: "#E2C07C", minister: "#E2C07C", peer: "#E2C07C",
  person: "#D492B6", donor: "#D492B6",
  company: "#6FBFB2",
  party: "#9D97E0",
  department: "#7FA9DE", government_body: "#7FA9DE",
  appg: "#A9C47F",
  lobbyist: "#C9855E",
};

/* per-entity-type colour + Lucide icon. The DB drives these via entity_types
   (loadGraph builds `types`), but we keep a static fallback map so styling is
   stable even for types the live `types` lookup misses. */
export const TYPE: Record<string, { label: string; color: string; icon: any }> = {
  minister: { label: "Minister", color: TYPE_COLORS.minister, icon: Landmark },
  mp: { label: "MP", color: TYPE_COLORS.mp, icon: Landmark },
  peer: { label: "Peer", color: TYPE_COLORS.peer, icon: Landmark },
  donor: { label: "Donor", color: TYPE_COLORS.donor, icon: User },
  company: { label: "Company", color: TYPE_COLORS.company, icon: Building2 },
  party: { label: "Party", color: TYPE_COLORS.party, icon: Flag },
  appg: { label: "APPG", color: TYPE_COLORS.appg, icon: Users },
  department: { label: "Department", color: TYPE_COLORS.department, icon: Landmark },
  government_body: { label: "Public body", color: TYPE_COLORS.government_body, icon: Landmark },
  lobbyist: { label: "Lobbying", color: TYPE_COLORS.lobbyist, icon: Briefcase },
  person: { label: "Person", color: TYPE_COLORS.person, icon: User },
};

/* entity-type icons resolved by name (entity_types.ui_icon from the database) */
export const ICONS: Record<string, any> = {
  Landmark,
  User,
  Building2,
  Flag,
  Users,
  Briefcase,
};

/* ------------------------------ small helpers ------------------------------ */
export const idOf = (e: any): string =>
  typeof e === "object" && e !== null ? e.id : e;

/** Node radius from its importance. Shared by every ForceGraph variant. */
export const radius = (d: { importance: number }): number =>
  8 + Math.sqrt(d.importance) * 5.5;

/* Confidence tiers (the epistemic axis): Established (green) 0.8+, Probable (brass) 0.5+, Lead (vermillion). */
export const confTier = (c: number): { label: string; color: string; solid: boolean } =>
  c >= 0.8
    ? { label: "Established", color: POSITIVE, solid: true }
    : c >= 0.5
      ? { label: "Probable", color: BRASS, solid: true }
      : { label: "Lead", color: SIGNAL, solid: false };
export const confColor = (c: number): string => confTier(c).color;

/* Strength gauge (the material axis): a discrete 1-4 band with a word, never a percentage. */
export const strengthBand = (s: number): { segments: number; label: string } =>
  s >= 0.75
    ? { segments: 4, label: "Core" }
    : s >= 0.5
      ? { segments: 3, label: "Strong" }
      : s >= 0.25
        ? { segments: 2, label: "Moderate" }
        : { segments: 1, label: "Weak" };

/** Resolve a type's display colour. The design palette (TYPE_COLORS) is authoritative, then DB, then floor. */
export function typeColor(type: string, types?: TypeConfig): string {
  return TYPE_COLORS[type] ?? types?.[type]?.color ?? TYPE[type]?.color ?? TEXT_2;
}

/** Resolve a type's icon component (by the DB's ui_icon name, then the static map). */
export function typeIcon(type: string, types?: TypeConfig): any {
  const iconName = types?.[type]?.icon;
  return (iconName && ICONS[iconName]) || TYPE[type]?.icon || User;
}

/** Resolve a type's human label. */
export function typeLabel(type: string, types?: TypeConfig): string {
  return types?.[type]?.label ?? TYPE[type]?.label ?? type;
}

/**
 * Parse a GBP figure out of a link. Amounts arrive as pre-formatted strings
 * ("£45,000", "£12.4m"); we also accept a raw numeric if one is ever present.
 * Returns 0 when there's no figure, so sorting is safe.
 */
export function amountValue(l: Partial<GraphLink> & { amount?: any }): number {
  const a = (l as any).amount;
  if (a == null) return 0;
  if (typeof a === "number") return a;
  const s = String(a).trim();
  // pull the leading number, honouring a trailing magnitude suffix (k / m / bn)
  const m = s.match(/£?\s*([\d,]+(?:\.\d+)?)\s*(k|m|bn|b)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return 0;
  const suf = (m[2] || "").toLowerCase();
  const mult = suf === "k" ? 1e3 : suf === "m" ? 1e6 : suf === "bn" || suf === "b" ? 1e9 : 1;
  return n * mult;
}

/* ------------------------------ path-finding ------------------------------ */
/**
 * BFS shortest path between two entities, filtered to links at/above `thresh`
 * (a 0–100 confidence percentage). Returns an ordered list of node ids, or null.
 * Moved verbatim from OrreryGraph so the A→B finder and path views share one impl.
 */
export function findPath(
  fromId: string,
  toId: string,
  links: GraphLink[],
  thresh: number,
): string[] | null {
  const adj: Record<string, string[]> = {};
  links.forEach((l) => {
    if (l.confidence * 100 < thresh) return;
    const a = idOf(l.source),
      b = idOf(l.target);
    if (!adj[a]) adj[a] = [];
    if (!adj[b]) adj[b] = [];
    adj[a].push(b);
    adj[b].push(a);
  });
  const q: string[][] = [[fromId]];
  const seen = new Set([fromId]);
  while (q.length) {
    const path = q.shift()!;
    const last = path[path.length - 1];
    if (last === toId) return path;
    (adj[last] || []).forEach((n) => {
      if (!seen.has(n)) {
        seen.add(n);
        q.push([...path, n]);
      }
    });
  }
  return null;
}

/* ------------------------------ entity ties ------------------------------ */
export type Tie = {
  other: GraphNode;
  rel: string;
  amount?: string;
  confidence: number;
  strength: number;
  method: string;
  direction: "out" | "in";
};
export type TieGroup = { rel: string; ties: Tie[] };

/**
 * Every connection touching `nodeId`, grouped by relationship label, each tie
 * carrying the other entity + amount + confidence + the source ("method").
 * Direction is recorded (out = nodeId is the subject) so the dossier can read
 * naturally ("Donated to" vs "Funded by"). Groups and rows are sorted by the
 * strongest, most-confident tie first.
 */
export function tiesOf(
  nodeId: string,
  links: GraphLink[],
  nodes: GraphNode[],
): TieGroup[] {
  const byId: Record<string, GraphNode> = {};
  for (const n of nodes) byId[n.id] = n;

  const ties: Tie[] = [];
  for (const l of links) {
    const a = idOf(l.source),
      b = idOf(l.target);
    if (a !== nodeId && b !== nodeId) continue;
    const otherId = a === nodeId ? b : a;
    const other = byId[otherId];
    if (!other) continue; // dangling endpoint — skip rather than render a blank row
    ties.push({
      other,
      rel: l.rel,
      amount: l.amount,
      confidence: l.confidence,
      strength: l.strength,
      method: l.method,
      direction: a === nodeId ? "out" : "in",
    });
  }

  const groups: Record<string, Tie[]> = {};
  for (const t of ties) (groups[t.rel] ||= []).push(t);

  const scoreOf = (t: Tie) => t.strength * 2 + t.confidence;
  return Object.entries(groups)
    .map(([rel, list]) => ({
      rel,
      ties: list.sort((x, y) => scoreOf(y) - scoreOf(x)),
    }))
    .sort((g1, g2) => scoreOf(g2.ties[0]) - scoreOf(g1.ties[0]));
}

/* ------------------------------ findings board ------------------------------ */
export type ConflictLead = {
  node: GraphNode;
  reason: string;
  overlap?: string;
  strength: string; // 'strong' | 'medium' | 'low'
};
export type MoneyLead = {
  donor: GraphNode;
  party: GraphNode;
  amountStr: string;
  amountValue: number;
  /** best-effort: people/companies that sit behind the donor (its directors / owners). */
  behind: { node: GraphNode; rel: string }[];
};
/** A company/organisation where several people converge, and/or that is both a
 *  political donor and a public-contract holder — the cross-register standouts. */
export type ConcentrationLead = {
  node: GraphNode;
  people: GraphNode[];
  isDonor: boolean;
  isContractor: boolean;
};
export type Leads = {
  conflicts: ConflictLead[];
  money: MoneyLead[];
  concentrations: ConcentrationLead[];
  registers: string[];
};

const STRENGTH_RANK: Record<string, number> = { strong: 0, medium: 1, low: 2 };

/* relationship labels we read as "X stands behind donor Y" (directorships / ownership).
   Matched case-insensitively as substrings so DB label wording ("Director of",
   "Owns", "Shareholder of", "Person with significant control") all qualify. */
const BEHIND_REL = ["director", "own", "shareholder", "significant control", "psc", "secretary"];
/* relationship labels that denote a political donation. */
const DONATION_REL = ["donat", "donor"];
/* relationship labels that denote a public-sector contract award. */
const CONTRACT_REL = ["contract"];

function relMatches(rel: string, needles: string[]): boolean {
  const r = rel.toLowerCase();
  return needles.some((n) => r.includes(n));
}

/**
 * The findings board, computed client-side from the resolved graph.
 *
 *  - `conflicts`: every conflict-flagged entity, strong→medium→low then scrutiny
 *    desc, each with its plain-English reason / overlap sector / strength.
 *  - `money`: the largest political donations (donor → £X → party), with a
 *    best-effort "people behind it" = the donor's own directors / owners.
 *
 * `moneyLimit` caps the money cards (default 8). Facts only — never a verdict.
 */
export function leads(
  nodes: GraphNode[],
  links: GraphLink[],
  moneyLimit = 8,
): Leads {
  const byId: Record<string, GraphNode> = {};
  for (const n of nodes) byId[n.id] = n;

  /* (a) conflicts of interest */
  const conflicts: ConflictLead[] = nodes
    .filter((n) => n.conflict)
    .map((n) => ({
      node: n,
      reason: n.conflictReason ?? "",
      overlap: n.conflictOverlap,
      strength: n.conflictStrength ?? "medium",
    }))
    .sort(
      (a, b) =>
        (STRENGTH_RANK[a.strength] ?? 1) - (STRENGTH_RANK[b.strength] ?? 1) ||
        (b.node.scrutiny || 0) - (a.node.scrutiny || 0) ||
        b.node.importance - a.node.importance ||
        a.node.name.localeCompare(b.node.name),
    );

  /* (b) the money behind the parties — top donations by amount */
  const donations = links
    .filter((l) => relMatches(l.rel, DONATION_REL))
    .map((l) => {
      const donor = byId[idOf(l.source)];
      const party = byId[idOf(l.target)];
      return { l, donor, party, value: amountValue(l) };
    })
    // only donations whose endpoints we can resolve and that target a party
    .filter((d) => d.donor && d.party && d.party.type === "party")
    .sort((a, b) => b.value - a.value);

  const money: MoneyLead[] = donations.slice(0, moneyLimit).map((d) => {
    // "people behind it": the donor company's directors / owners (incoming ties
    // where someone is a director/PSC OF the donor, or the donor owns something
    // that is itself held by a person). We surface the human/company on the other
    // end of any directorship/ownership tie touching the donor.
    const behindSeen = new Set<string>();
    const behind: { node: GraphNode; rel: string }[] = [];
    for (const lk of links) {
      const a = idOf(lk.source),
        b = idOf(lk.target);
      if (a !== d.donor.id && b !== d.donor.id) continue;
      if (!relMatches(lk.rel, BEHIND_REL)) continue;
      const otherId = a === d.donor.id ? b : a;
      const other = byId[otherId];
      if (!other || other.id === d.party.id || behindSeen.has(other.id)) continue;
      behindSeen.add(other.id);
      behind.push({ node: other, rel: lk.rel });
      if (behind.length >= 4) break;
    }
    return {
      donor: d.donor,
      party: d.party,
      amountStr: d.l.amount ?? "",
      amountValue: d.value,
      behind,
    };
  });

  /* (c) where interests converge — a company/org tied to several people, and/or
     that is BOTH a political donor and a public-contract holder (the Ecotricity
     shape). Computed from the graph, sourced, framed as "worth a look". */
  const orgIds = new Set(
    nodes.filter((n) => n.type === "company" || n.type === "organisation").map((n) => n.id),
  );
  type Agg = { people: Set<string>; isDonor: boolean; isContractor: boolean };
  const agg: Record<string, Agg> = {};
  const bump = (id: string): Agg => (agg[id] ||= { people: new Set(), isDonor: false, isContractor: false });
  for (const l of links) {
    const a = idOf(l.source), b = idOf(l.target);
    // a person converging on an org (either direction)
    if (orgIds.has(a) && byId[b]?.type === "person") bump(a).people.add(b);
    if (orgIds.has(b) && byId[a]?.type === "person") bump(b).people.add(a);
    // the org itself donates
    if (relMatches(l.rel, DONATION_REL) && orgIds.has(a)) bump(a).isDonor = true;
    // the org holds a public contract (either endpoint may be the supplier)
    if (relMatches(l.rel, CONTRACT_REL)) {
      if (orgIds.has(a)) bump(a).isContractor = true;
      if (orgIds.has(b)) bump(b).isContractor = true;
    }
  }
  const concentrations: ConcentrationLead[] = Object.entries(agg)
    .map(([id, v]) => ({
      node: byId[id],
      people: [...v.people].map((pid) => byId[pid]).filter(Boolean),
      isDonor: v.isDonor,
      isContractor: v.isContractor,
    }))
    .filter((c) => c.node && ((c.isDonor && c.isContractor) || c.people.length >= 3))
    // donor+contractor loops first, then by how many people converge
    .sort(
      (a, b) =>
        Number(b.isDonor && b.isContractor) - Number(a.isDonor && a.isContractor) ||
        b.people.length - a.people.length ||
        a.node.name.localeCompare(b.node.name),
    );

  /* distinct registers actually present in the graph (from each edge's source label) */
  const regSet = new Set<string>();
  for (const l of links) {
    if (l.method) for (const part of l.method.split(" + ")) regSet.add(part.trim());
  }
  const registers = [...regSet].filter(Boolean).sort();

  return { conflicts, money, concentrations, registers };
}
