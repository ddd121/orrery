export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "12vh 24px" }}>
      <h1 style={{ letterSpacing: "0.15em", fontWeight: 800, margin: 0 }}>
        ORRERY
      </h1>
      <p
        style={{
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.2em",
          fontSize: 12,
          marginTop: 6,
        }}
      >
        influence, mapped
      </p>
      <p style={{ lineHeight: 1.6, marginTop: 28 }}>
        Scaffold in place (Milestone&nbsp;1). The force-directed graph from the
        prototype is wired to live data in Milestone&nbsp;5 — until then this
        page is a placeholder so the app boots.
      </p>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 20 }}>
        Facts, not verdicts. Every connection links back to a primary source.
      </p>
    </main>
  );
}
