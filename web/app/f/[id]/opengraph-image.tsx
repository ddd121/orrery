import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { headlineFor, shapeLabel } from "@/lib/deal";

/**
 * The finding's unfurl card (DESIGN_SPEC_V2 "Step 6"; Wave C). next/og renders this at
 * request time from plain divs (no SVG support inside ImageResponse), reproducing the
 * register's dark ground + brass rule + stamps + a simplified orrery glyph, so a shared
 * link looks like ORRERY before anyone even clicks through. Same facts as the page it
 * represents: no new claims are made here.
 */

export const runtime = "nodejs";
export const alt = "ORRERY finding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK_0 = "#0A0E16";
const HAIRLINE = "rgba(154,167,199,0.16)";
const TEXT_1 = "#EDF1FA";
const TEXT_2 = "#A9B2C8";
const TEXT_3 = "#7C86A2";
const BRASS = "#D9A648";
const SIGNAL = "#E06A50";
const POSITIVE = "#63B98B";

const TYPE_COLORS: Record<string, string> = {
  mp: "#E2C07C", minister: "#E2C07C", peer: "#E2C07C",
  person: "#D492B6", donor: "#D492B6",
  company: "#6FBFB2",
  party: "#9D97E0",
  department: "#7FA9DE", government_body: "#7FA9DE",
  appg: "#A9C47F",
  lobbyist: "#C9855E",
};

function confTier(c: number) {
  if (c >= 0.8) return { label: "Established", color: POSITIVE };
  if (c >= 0.5) return { label: "Probable", color: BRASS };
  return { label: "Lead", color: SIGNAL };
}

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function fetchFinding(id: string) {
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

/* A handful of member types in a fixed ring, purely decorative (no live layout data is
   available inside this isolated route), so the geometry reads as "an orrery" without
   claiming to be the actual finding graph. */
const ORBIT_TYPES = ["mp", "company", "donor", "party", "person", "appg"];

export default async function Image({ params }: { params: { id: string } }) {
  const finding = await fetchFinding(params.id);

  const headline = finding ? headlineFor(finding) : "That finding could not be found";
  const shape = finding ? shapeLabel(finding.shape_code) : null;
  const tier = finding ? confTier(finding.min_confidence) : null;
  const pct = finding ? Math.round(finding.min_confidence * 100) : null;
  const registers = typeof finding?.slots?.n_registers === "number" ? finding.slots.n_registers : null;

  const orbitR = 118;
  const cx = 150;
  const cy = 315;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: INK_0,
          padding: "56px 60px",
          fontFamily: "Georgia, serif",
        }}
      >
        {/* header rule */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 16, borderBottom: `1px solid ${HAIRLINE}` }}>
          <div style={{ display: "flex", fontFamily: "monospace", fontSize: 15, letterSpacing: 3, color: BRASS }}>ORRERY</div>
          <div style={{ display: "flex", fontFamily: "monospace", fontSize: 12, letterSpacing: 1, color: TEXT_3 }}>
            DRAWN FROM THE PUBLIC REGISTERS
          </div>
        </div>

        {/* body: orrery glyph + headline/stamps */}
        <div style={{ display: "flex", flex: 1, alignItems: "center" }}>
          {/* simplified orrery: 3 concentric circle outlines + brass centre + orbit dots */}
          <div style={{ position: "relative", width: 300, height: 300, display: "flex" }}>
            <Ring size={236} cx={cx} cy={cy} />
            <Ring size={166} cx={cx} cy={cy} />
            <Ring size={96} cx={cx} cy={cy} />
            <div
              style={{
                position: "absolute",
                left: cx - 15,
                top: cy - 15,
                width: 30,
                height: 30,
                borderRadius: 999,
                background: BRASS,
                display: "flex",
              }}
            />
            {ORBIT_TYPES.map((t, i) => {
              const angle = -Math.PI / 2 + (i / ORBIT_TYPES.length) * 2 * Math.PI;
              const x = cx + Math.cos(angle) * orbitR;
              const y = cy + Math.sin(angle) * orbitR;
              return (
                <div
                  key={t}
                  style={{
                    position: "absolute",
                    left: x - 9,
                    top: y - 9,
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: TYPE_COLORS[t] ?? TEXT_2,
                    display: "flex",
                  }}
                />
              );
            })}
          </div>

          {/* headline + stamps */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingLeft: 20 }}>
            <div
              style={{
                display: "flex",
                fontSize: 44,
                fontWeight: 600,
                lineHeight: 1.2,
                color: TEXT_1,
                maxWidth: 660,
              }}
            >
              {headline}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 32, flexWrap: "wrap" }}>
              {shape && <Stamp text={shape} color={BRASS} />}
              {tier && pct != null && <Stamp text={`${tier.label.toUpperCase()} · ${pct}%`} color={tier.color} />}
              {registers != null && (
                <Stamp text={`${registers} ${registers === 1 ? "REGISTER" : "REGISTERS"}`} color={TEXT_2} />
              )}
            </div>
          </div>
        </div>

        {/* footer rule */}
        <div style={{ display: "flex", paddingTop: 16, borderTop: `1px solid ${HAIRLINE}`, fontFamily: "monospace", fontSize: 15, color: TEXT_3 }}>
          ORRERY &middot; drawn from the public registers
        </div>
      </div>
    ),
    { ...size },
  );
}

function Ring({ size: s, cx, cy }: { size: number; cx: number; cy: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: cx - s / 2,
        top: cy - s / 2,
        width: s,
        height: s,
        borderRadius: 999,
        border: `1px solid ${HAIRLINE}`,
        display: "flex",
      }}
    />
  );
}

function Stamp({ text, color }: { text: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 12px",
        borderRadius: 4,
        background: `${color}1A`,
        border: `1px solid ${color}55`,
        color,
        fontFamily: "monospace",
        fontSize: 15,
        letterSpacing: 1,
      }}
    >
      {text}
    </div>
  );
}
