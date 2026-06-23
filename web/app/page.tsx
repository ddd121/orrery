import { loadGraph } from "@/lib/graph";
import OrreryGraph from "./OrreryGraph";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { nodes, links, types } = await loadGraph();
  return <OrreryGraph nodes={nodes} links={links} types={types} />;
}
