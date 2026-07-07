import { loadGraph, loadFindings, loadInsights, loadExtras } from "@/lib/graph";
import OrreryApp from "./OrreryApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ nodes, links, types }, { findings, pairs }, { insightsByEntity, stats }, extras] = await Promise.all([
    loadGraph(),
    loadFindings(),
    loadInsights(),
    loadExtras(),
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
      coverageByEntity={extras.coverageByEntity}
      offshoreByEntity={extras.offshoreByEntity}
      overseasByDonor={extras.overseasByDonor}
    />
  );
}
