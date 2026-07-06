import { loadGraph, loadFindings } from "@/lib/graph";
import OrreryApp from "./OrreryApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ nodes, links, types }, { findings, pairs }] = await Promise.all([
    loadGraph(),
    loadFindings(),
  ]);
  return <OrreryApp nodes={nodes} links={links} types={types} findings={findings} pairs={pairs} />;
}
