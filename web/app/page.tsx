import { loadGraph, loadFindings, loadInsights, loadExtras } from "@/lib/graph";
import OrreryApp from "./OrreryApp";

export const dynamic = "force-dynamic";

/* Server-side memo of the full dataset. Every request used to re-fetch the entire graph
   (11k entities, 14k statements, insights, findings, extras) from Supabase, which made
   each page load take tens of seconds. The data only changes when the pipeline recomputes,
   so a short TTL in module scope serves everyone else instantly; the first request after
   the TTL (or a server restart) refreshes it. */
const TTL_MS = 5 * 60 * 1000;
type AllData = {
  graph: Awaited<ReturnType<typeof loadGraph>>;
  findings: Awaited<ReturnType<typeof loadFindings>>;
  insights: Awaited<ReturnType<typeof loadInsights>>;
  extras: Awaited<ReturnType<typeof loadExtras>>;
};
let cache: { at: number; data: AllData } | null = null;
let inflight: Promise<AllData> | null = null;

async function loadAll(): Promise<AllData> {
  const [graph, findings, insights, extras] = await Promise.all([
    loadGraph(),
    loadFindings(),
    loadInsights(),
    loadExtras(),
  ]);
  return { graph, findings, insights, extras };
}

async function loadAllCached(): Promise<AllData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!inflight) {
    inflight = loadAll()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export default async function Home() {
  const { graph, findings, insights, extras } = await loadAllCached();
  return (
    <OrreryApp
      nodes={graph.nodes}
      links={graph.links}
      types={graph.types}
      findings={findings.findings}
      pairs={findings.pairs}
      insightsByEntity={insights.insightsByEntity}
      stats={insights.stats}
      coverageByEntity={extras.coverageByEntity}
      offshoreByEntity={extras.offshoreByEntity}
      overseasByDonor={extras.overseasByDonor}
    />
  );
}
