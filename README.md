# ORRERY

> Influence, mapped. ORRERY surfaces **sourced** connections between UK public figures and the money and companies around them, with an honest **confidence** score on every link — so users can read the patterns and judge for themselves. It states facts and flags structural overlaps. **It never alleges wrongdoing.**

The moat is not the data (public) or the API list (copyable). It is three things that compound: a **calibrated cross-jurisdiction entity-resolution model**, an **honest confidence-propagation layer**, and a **human-verified resolution graph** that improves with use. See [`docs/resolution-confidence-engine-spec.md`](docs/resolution-confidence-engine-spec.md).

## Status

**Milestone 1 — scaffold + statement-based schema.** UK only. The build proceeds one milestone at a time (see the build order in [`CLAUDE.md`](CLAUDE.md)); do not add sources or features beyond the current milestone.

## Layout

```
docs/        The PRD, the engine spec, and the UI prototype (docs/prototype/orrery.jsx)
supabase/    Postgres schema as migrations (the statement-based data model)
web/         Next.js + TypeScript app — reads the resolved graph (UI wired in M5)
pipeline/    Python ingestion + resolution + propagation — writes the resolved graph
```

The boundary is deliberate and clean: **the Python pipeline writes the resolved graph; the TypeScript app reads it.** They share one Supabase Postgres.

## Setup (MVP / Tier 1)

1. Create a Supabase project (Postgres + pgvector). Copy `.env.example` → `.env.local` (web) / `.env` (pipeline) and fill in the keys.
2. Apply the database migrations in `supabase/migrations/` (via the Supabase CLI `db push`, or the Supabase MCP). Service role key stays server-side only.
3. (Later milestones) `web/`: `npm install && npm run dev`. `pipeline/`: a Python 3.12 venv under WSL2 — see [`pipeline/README.md`](pipeline/README.md).

Tier-1 accounts needed: Supabase, an Anthropic API key, a (free) Companies House API key. Electoral Commission and UK Parliament need no key.

## The line we hold

Facts, not verdicts. Every node and edge links back to a primary source. High precision over recall — a false link is a critical failure. No predictions of future outcomes, ever.
