# ORRERY

> Influence, mapped. ORRERY surfaces **sourced** connections between UK public figures and the money and companies around them, with an honest **confidence** score on every link — so users can read the patterns and judge for themselves. It states facts and flags structural overlaps. **It never alleges wrongdoing.**

The moat is not the data (public) or the API list (copyable). It is three things that compound: a **calibrated cross-jurisdiction entity-resolution model**, an **honest confidence-propagation layer**, and a **human-verified resolution graph** that improves with use. See [`docs/resolution-confidence-engine-spec.md`](docs/resolution-confidence-engine-spec.md).

## Status

**The engine and a findings-first product are live (UK).** Four public registers — Companies House, the Electoral Commission, UK Parliament (members), and the Register of Members' Financial Interests — ingest, resolve, and connect through one pipeline (resolve → confidence/strength → §7 conflict-of-interest salience → scrutiny). Current slice: **~840 entities, ~1,400 sourced statements, 21 ranked conflict-of-interest leads** — e.g. an MP shaping housing law who owns a property company ("merits a look", never a verdict).

The full roadmap, data state, and resume guide live in **[`docs/BUILD_LOG.md`](docs/BUILD_LOG.md)**; the milestone order and guardrails in **[`CLAUDE.md`](CLAUDE.md)**. UK-first by design — international expansion is planned behind the same jurisdiction-agnostic schema (see the *Expansion roadmap* in the build log).

## Using it

ORRERY is **findings-first**, not a graph to decode. Three things a visitor does:

- **Surface** — land on a board of *what merits a look*: conflict-of-interest leads and the money behind the parties, sourced and ranked.
- **Look up** — search any figure or company → a dossier of its ties grouped in plain English, every line citing its source and confidence, with a small focused network picture.
- **Connect** — trace the sourced path between two names, hop by hop.

The full 800+-node network is an opt-in **Explore** view; the default views stay small and legible.

## Layout

```
docs/        PRD, engine spec, BUILD_LOG (roadmap + resume), UI prototype
supabase/    Postgres schema as migrations (the statement-based data model)
web/         Next.js + TypeScript app — reads the resolved graph
               app/OrreryApp.jsx · app/views/* (Home, Entity) · app/components/ForceGraph.jsx
               app/OrreryGraph.jsx (the opt-in full-network Explore view)
               lib/graph.ts (loader) · lib/graph-utils.ts (findPath, leads, ties)
pipeline/    Python — ingestion loaders · resolution/edges/scrutiny/§7 SQL · recompute.py
```

The boundary is deliberate and clean: **the Python pipeline writes the resolved graph; the TypeScript app reads it.** They share one Supabase Postgres.

## Run

- **App:** `npm install --prefix web && npm run dev --prefix web` → http://localhost:3000
- **Rebuild the resolved graph** (after new data lands): `python -m orrery_pipeline.recompute build`
  (`recompute reset` + the loaders re-ingest from scratch — see the build log for the clean sequence).
- Secrets live in `.env` / `web/.env.local` (gitignored); template in `.env.example`. The service-role key is server/pipeline only — **never the browser**.

Accounts/keys: Supabase, an Anthropic API key (for later LLM adjudication/summaries), a free Companies House key. The Electoral Commission and UK Parliament APIs need no key.

## The line we hold

Facts, not verdicts. Every node and edge links back to a primary source. High precision over recall — a false link is a critical failure. No predictions of future outcomes, ever. British English throughout.
