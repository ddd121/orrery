import { loadGraph } from "@/lib/graph";
import OrreryApp from "./OrreryApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { nodes, links, types } = await loadGraph();
  return <OrreryApp nodes={nodes} links={links} types={types} />;
}
