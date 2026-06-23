import { supabase } from "@/lib/supabase/client";

/** Shapes the prototype graph component consumes. */
export type GraphNode = {
  id: string;
  name: string;
  type: string;
  role: string;
  importance: number;
  news: never[];
};
export type GraphLink = {
  source: string;
  target: string;
  rel: string;
  strength: number;
  confidence: number;
  method: string;
  amount?: string;
};
export type TypeConfig = Record<string, { label: string; color: string; icon: string }>;

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
  const [ents, stmts, stypes, etypes] = await Promise.all([
    supabase
      .from("canonical_entities")
      .select("id, entity_type, canonical_name, display_name, category, attributes"),
    supabase
      .from("statements")
      .select("subject_entity_id, object_entity_id, statement_type, confidence, strength, attributes"),
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
  const links: GraphLink[] = (stmts.data ?? []).map((s: any) => ({
    source: s.subject_entity_id,
    target: s.object_entity_id,
    rel: stLabel[s.statement_type] ?? s.statement_type,
    strength: Number(s.strength ?? 0),
    confidence: Number(s.confidence ?? 0),
    method:
      s.statement_type === "DONATED_TO"
        ? "Electoral Commission record"
        : "Companies House record",
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

  const nodes: GraphNode[] = (ents.data ?? []).map((e: any) => {
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
    };
  });

  // only surface entity types that actually appear, so the filter list isn't padded
  const present = new Set(nodes.map((n) => n.type));
  const types: TypeConfig = Object.fromEntries(
    Object.entries(allTypes).filter(([k]) => present.has(k)),
  );

  return { nodes, links, types };
}
