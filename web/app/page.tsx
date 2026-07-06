import { loadGraph, loadFindings, loadInsights } from "@/lib/graph";
import OrreryApp from "./OrreryApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ nodes, links, types }, { findings, pairs }, { insightsByEntity, stats }] = await Promise.all([
    loadGraph(),
    loadFindings(),
    loadInsights(),
  ]);
  return (
    <OrreryApp
      nodes={nodes}
      links={links}
      types={types}
      findings={findings}
      pairs={pairs}
      insightsByEntity={insightsByEntity}
      stats={stats}
    />
  );
}
