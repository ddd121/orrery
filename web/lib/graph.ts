import { supabase } from "@/lib/supabase/client";

/** Shapes the prototype graph component consumes. */
export type GraphNode = {
  id: string;
  name: string;
  type: string;
  role: string;
  importance: number;
  news: never[];
  scrutiny: number;
  scrutinyMoney?: string;
  conflict?: boolean;
  conflictReason?: string;
  conflictStrength?: string;
  conflictOverlap?: string;
  jurisdiction?: string;
  nationality?: string;
};
export type GraphLink = {
  id?: string;
  source: string;
  target: string;
  rel: string;
  strength: number;
  confidence: number;
  method: string;
  amount?: string;
};
export type TypeConfig = Record<string, { label: string; color: string; icon: string }>;

/** Human label for each register, keyed by source_documents.source_code. */
const SOURCE_LABEL: Record<string, string> = {
  companies_house: "Companies House",
  electoral_commission: "Electoral Commission",
  parliament: "Parliament (Members API)",
  parliament_interests: "Register of Members' Interests",
  lords_interests: "Register of Lords' Interests",
  contracts_finder: "Contracts Finder",
};

/**
 * Register a statement most likely came from, keyed by statement_type. Only a *fallback*:
 * the pipeline stamps `attributes.sources` on every edge (edges_v2.sql), so this rarely
 * fires — but when it does it must be honest. Never default a non-company edge to
 * "Companies House"; misattributing provenance is a credibility failure.
 */
const TYPE_REGISTER: Record<string, string> = {
  DONATED_TO: "Electoral Commission",
  CONTRACTED_WITH: "Contracts Finder",
  DIRECTOR_OF: "Companies House",
  PSC_OF: "Companies House",
  OWNS: "Companies House",
  CO_DIRECTOR: "Companies House",
  ADVISER_TO: "Register of Members' Interests",
  MEMBER_OF: "Parliament",
  CHAIR_OF: "Parliament",
  MINISTERIAL_ROLE: "Parliament",
};

/**
 * Reads the resolved graph (canonical entities + scored statements) from Supabase
 * and maps it into the {nodes, links, types} the force-graph UI expects. Read-only,
 * via the anon key + RLS. The pipeline produced this graph; the app only renders it.
 */
export async function loadGraph(): Promise<{
  nodes: GraphNode[];
  links: GraphLink[];
  types: TypeConfig;
}> {
  // Supabase/PostgREST caps a single response at 1,000 rows — page through the entity + statement
  // tables (both exceed that at full-Commons scale) so the graph is never silently truncated.
  const fetchAll = async (table: string, columns: string): Promise<any[]> => {
    const out: any[] = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < size) break;
    }
    return out;
  };
  const [entsRows, stmtsRows, stypes, etypes] = await Promise.all([
    fetchAll("canonical_entities", "id, entity_type, canonical_name, display_name, category, attributes"),
    fetchAll("statements", "id, subject_entity_id, object_entity_id, statement_type, confidence, strength, attributes"),
    supabase.from("statement_types").select("code, label"),
    supabase.from("entity_types").select("code, label, ui_color, ui_icon"),
  ]);

  const stLabel: Record<string, string> = {};
  for (const s of stypes.data ?? []) stLabel[s.code] = s.label;

  const gbp = (n: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(Number(n));
  const links: GraphLink[] = stmtsRows.map((s: any) => ({
    id: s.id,
    source: s.subject_entity_id,
    target: s.object_entity_id,
    rel: stLabel[s.statement_type] ?? s.statement_type,
    strength: Number(s.strength ?? 0),
    confidence: Number(s.confidence ?? 0),
    method:
      Array.isArray(s.attributes?.sources) && s.attributes.sources.length
        ? s.attributes.sources.map((c: string) => SOURCE_LABEL[c] ?? c).join(" + ")
        : TYPE_REGISTER[s.statement_type] ?? "official register",
    amount: s.attributes?.amount_gbp != null ? gbp(s.attributes.amount_gbp) : undefined,
  }));

  const degree: Record<string, number> = {};
  for (const l of links) {
    degree[l.source] = (degree[l.source] ?? 0) + 1;
    degree[l.target] = (degree[l.target] ?? 0) + 1;
  }

  const allTypes: TypeConfig = {};
  for (const t of etypes.data ?? [])
    allTypes[t.code] = {
      label: t.label,
      color: t.ui_color ?? "#8A93AD",
      icon: t.ui_icon ?? "User",
    };

  const nodes: GraphNode[] = entsRows.map((e: any) => {
    const attrs = e.attributes ?? {};
    let role: string = e.category ?? allTypes[e.entity_type]?.label ?? e.entity_type;
    if (e.entity_type === "company" && attrs.company_number)
      role = `Company · ${attrs.company_number}`;
    const deg = degree[e.id] ?? 0;
    return {
      id: e.id,
      name: e.display_name ?? e.canonical_name,
      type: e.entity_type,
      role,
      importance: Math.max(4, Math.min(10, 4 + deg)),
      news: [],
      scrutiny: Number(attrs.scrutiny ?? 0),
      scrutinyMoney: attrs.scrutiny_money_gbp != null ? gbp(attrs.scrutiny_money_gbp) : undefined,
      conflict: attrs.conflict_flag === true,
      conflictReason: attrs.conflict_reason ?? undefined,
      conflictStrength: attrs.conflict_strength ?? undefined,
      conflictOverlap: attrs.conflict_overlap ?? undefined,
      jurisdiction: attrs.jurisdiction ?? undefined,
      nationality: attrs.nationality ?? undefined,
    };
  });

  // only surface entity types that actually appear, so the filter list isn't padded
  const present = new Set(nodes.map((n) => n.type));
  const types: TypeConfig = Object.fromEntries(
    Object.entries(allTypes).filter(([k]) => present.has(k)),
  );

  return { nodes, links, types };
}

/** A materialised, sourced structural pattern (DESIGN_SPEC_V2 "Step 1: the findings pool"). */
export type Finding = {
  id: string;
  shape_code: string;
  member_entity_ids: string[];
  member_statement_ids: string[];
  slots: Record<string, any>;
  surprise: number;
  min_confidence: number;
};

/** A cross-register endpoint pair worth tracing in Connect (`public.suggested_pairs`). */
export type SuggestedPair = {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  why: string;
};

/**
 * Reads `public.findings` (excluding QUIET_PORTFOLIO, unsafe framing for now) ordered by
 * surprise desc, and `public.suggested_pairs`, both via the anon key + RLS. Paginated
 * defensively like `loadGraph`, though at ~494 rows a single fetch would already suffice.
 */
export async function loadFindings(): Promise<{ findings: Finding[]; pairs: SuggestedPair[] }> {
  const fetchAll = async (table: string, columns: string, order?: string): Promise<any[]> => {
    const out: any[] = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      let q = supabase.from(table).select(columns).range(from, from + size - 1);
      if (order) q = q.order(order, { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < size) break;
    }
    return out;
  };

  const [findingRows, pairRows] = await Promise.all([
    fetchAll(
      "findings",
      "id, shape_code, member_entity_ids, member_statement_ids, slots, surprise, min_confidence",
      "surprise",
    ),
    fetchAll("suggested_pairs", "id, from_entity_id, to_entity_id, why"),
  ]);

  const findings: Finding[] = findingRows
    .filter((f: any) => f.shape_code !== "QUIET_PORTFOLIO")
    .map((f: any) => ({
      id: f.id,
      shape_code: f.shape_code,
      member_entity_ids: f.member_entity_ids ?? [],
      member_statement_ids: f.member_statement_ids ?? [],
      slots: f.slots ?? {},
      surprise: Number(f.surprise ?? 0),
      min_confidence: Number(f.min_confidence ?? 0),
    }))
    .sort((a, b) => b.surprise - a.surprise);

  const pairs: SuggestedPair[] = pairRows.map((p: any) => ({
    id: p.id,
    from_entity_id: p.from_entity_id,
    to_entity_id: p.to_entity_id,
    why: p.why,
  }));

  return { findings, pairs };
}

/** One computed takeaway for a single entity (DESIGN_SPEC_V2 "Value Everywhere", Wave 1). */
export type Insight = {
  id: string;
  entity_id: string;
  kind: string;
  priority: number;
  rank: number | null;
  cohort_size: number | null;
  slots: Record<string, any>;
  computed_at: string;
};

/** A single global landing-page number (public.register_stats). */
export type RegisterStat = {
  value: number | null;
  slots: Record<string, any>;
};

/**
 * Reads `public.entity_insights` (grouped by entity, sorted by priority desc) and
 * `public.register_stats` (keyed by stat), both via the anon key + RLS. Paginated
 * defensively like `loadGraph`/`loadFindings`; entity_insights alone is ~6k rows,
 * comfortably past PostgREST's 1,000-row page cap.
 */
export async function loadInsights(): Promise<{
  insightsByEntity: Record<string, Insight[]>;
  stats: Record<string, RegisterStat>;
}> {
  const fetchAll = async (table: string, columns: string): Promise<any[]> => {
    const out: any[] = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < size) break;
    }
    return out;
  };

  const [insightRows, statRows] = await Promise.all([
    fetchAll("entity_insights", "id, entity_id, kind, priority, rank, cohort_size, slots, computed_at"),
    fetchAll("register_stats", "stat, value_numeric, slots"),
  ]);

  const insightsByEntity: Record<string, Insight[]> = {};
  for (const r of insightRows) {
    const insight: Insight = {
      id: r.id,
      entity_id: r.entity_id,
      kind: r.kind,
      priority: Number(r.priority ?? 0),
      rank: r.rank ?? null,
      cohort_size: r.cohort_size ?? null,
      slots: r.slots ?? {},
      computed_at: r.computed_at,
    };
    (insightsByEntity[r.entity_id] ??= []).push(insight);
  }
  for (const list of Object.values(insightsByEntity)) {
    list.sort((a, b) => b.priority - a.priority);
  }

  const stats: Record<string, RegisterStat> = {};
  for (const r of statRows) {
    stats[r.stat] = {
      value: r.value_numeric != null ? Number(r.value_numeric) : null,
      slots: r.slots ?? {},
    };
  }

  return { insightsByEntity, stats };
}

/** A news mention of an entity's name, from `public.coverage` (keyless GDELT ingest). */
export type CoverageRow = {
  id: string;
  entity_id: string;
  title: string;
  domain: string;
  url: string;
  seendate: string;
  fetched_at: string;
};

/** An ICIJ Offshore Leaks company-name lead, from `public.offshore_leads`. LEADS ONLY:
 *  never merged into the graph, always shown with its "names can coincide" disclaimer. */
export type OffshoreLead = {
  id: string;
  entity_id: string;
  icij_name: string;
  icij_jurisdiction: string;
  source_leak: string;
  icij_node_id: string;
  icij_url: string;
  matched_at: string;
};

/** A same-name overseas-resident-officer lead against a large donor, from
 *  `public.overseas_leads`. LEADS ONLY, never merged, always disclaimed. */
export type OverseasLead = {
  id: string;
  donor_entity_id: string;
  donor_name: string;
  officer_name: string;
  country: string;
  amount_gbp: number | null;
  recipient: string;
  computed_at: string;
};

/**
 * Reads the international-layer tables (`coverage`, `offshore_leads`, `overseas_leads`),
 * each independently guarded: these tables are built by a parallel pipeline effort and
 * may not exist yet while this UI ships, so every fetch is wrapped in its own try/catch
 * returning [] rather than throwing — the app must render correctly (panels simply hidden)
 * before, during and after that data lands. Anon key + RLS, same boundary as every other read.
 */
export async function loadExtras(): Promise<{
  coverageByEntity: Record<string, CoverageRow[]>;
  offshoreByEntity: Record<string, OffshoreLead[]>;
  overseasByDonor: Record<string, OverseasLead[]>;
}> {
  const fetchAllSafe = async (table: string, columns: string): Promise<any[]> => {
    try {
      const out: any[] = [];
      const size = 1000;
      for (let from = 0; ; from += size) {
        const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < size) break;
      }
      return out;
    } catch {
      // table not migrated yet, RLS not yet opened, or a transient error: degrade to
      // empty rather than fail the whole page load.
      return [];
    }
  };

  const [coverageRows, offshoreRows, overseasRows] = await Promise.all([
    fetchAllSafe("coverage", "id, entity_id, title, domain, url, seendate, fetched_at"),
    fetchAllSafe(
      "offshore_leads",
      "id, entity_id, icij_name, icij_jurisdiction, source_leak, icij_node_id, icij_url, matched_at",
    ),
    fetchAllSafe(
      "overseas_leads",
      "id, donor_entity_id, donor_name, officer_name, country, amount_gbp, recipient, computed_at",
    ),
  ]);

  const coverageByEntity: Record<string, CoverageRow[]> = {};
  for (const r of coverageRows) (coverageByEntity[r.entity_id] ??= []).push(r);
  for (const list of Object.values(coverageByEntity)) {
    list.sort((a, b) => String(b.seendate).localeCompare(String(a.seendate)));
  }

  const offshoreByEntity: Record<string, OffshoreLead[]> = {};
  for (const r of offshoreRows) (offshoreByEntity[r.entity_id] ??= []).push(r);

  const overseasByDonor: Record<string, OverseasLead[]> = {};
  for (const r of overseasRows) (overseasByDonor[r.donor_entity_id] ??= []).push(r);

  return { coverageByEntity, offshoreByEntity, overseasByDonor };
}
