import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { headlineFor, whyLine } from "@/lib/deal";

/**
 * /f/[id]: the finding's crawlable unfurl route (DESIGN_SPEC_V2 "Step 6"; Wave C).
 *
 * Crawlers (Twitter/X, WhatsApp, LinkedIn, Slack, etc.) never execute client JS, so the
 * SPA's client-side `#finding=` routing gives them nothing to read. This route fetches
 * the finding row server-side, emits real <meta> tags via `generateMetadata`, and then
 * hands humans straight back into the app: a tiny client component replaces the URL to
 * `/#finding={id}` on mount, where the full interactive finding view lives.
 *
 * Anon key only (RLS-gated read), same boundary as every other client read in this app.
 */

export const dynamic = "force-dynamic";

type FindingRow = {
  id: string;
  shape_code: string;
  member_entity_ids: string[];
  member_statement_ids: string[];
  slots: Record<string, any>;
  surprise: number;
  min_confidence: number;
};

/* Module-scope anon client: no server helper exists for a plain anon read (server.ts is
   service-role and explicitly server-only; client.ts is browser-scoped), so this mirrors
   lib/supabase/client.ts's construction with the same public env vars. Read-only, RLS-gated. */
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function fetchFinding(id: string): Promise<FindingRow | null> {
  const { data, error } = await anon
    .from("findings")
    .select("id, shape_code, member_entity_ids, member_statement_ids, slots, surprise, min_confidence")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    shape_code: data.shape_code,
    member_entity_ids: data.member_entity_ids ?? [],
    member_statement_ids: data.member_statement_ids ?? [],
    slots: data.slots ?? {},
    surprise: Number(data.surprise ?? 0),
    min_confidence: Number(data.min_confidence ?? 0),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const finding = await fetchFinding(id);

  if (!finding) {
    return {
      title: "Finding not found · ORRERY",
      description: "That finding could not be found. It may have been recomputed.",
    };
  }

  const title = headlineFor(finding);
  const description = `${whyLine(finding)} Every link cites its public register.`;
  const ogImage = `/f/${id}/opengraph-image`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function FindingPermalinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const finding = await fetchFinding(id);

  return (
    <div style={{ background: "#0A0E16", color: "#EDF1FA", minHeight: "100vh" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "64px 20px", textAlign: "center" }}>
        <p style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13, letterSpacing: "0.18em", color: "#D9A648" }}>
          ORRERY
        </p>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 600, lineHeight: 1.3, margin: "20px 0" }}>
          {finding ? headlineFor(finding) : "That finding could not be found."}
        </h1>
        <p style={{ fontFamily: "Arial, sans-serif", fontSize: 14, color: "#A9B2C8" }}>Opening the full record...</p>
      </div>
      <RedirectToApp id={id} />
    </div>
  );
}

/* Humans get bounced straight into the SPA's client-side finding view; crawlers never
   run this script, so they only ever see the metadata + the fallback markup above. */
function RedirectToApp({ id }: { id: string }) {
  const target = `/#finding=${encodeURIComponent(id)}`;
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: `window.location.replace(${JSON.stringify(target)});`,
      }}
    />
  );
}
