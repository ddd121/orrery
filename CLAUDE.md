# CLAUDE.md — ORRERY

Working conventions and guardrails for every session. Read this first. The authoritative engine spec is [`docs/resolution-confidence-engine-spec.md`](docs/resolution-confidence-engine-spec.md); the product brief is [`docs/orrery-build-handoff-prd.md`](docs/orrery-build-handoff-prd.md).

## What this is

A power-mapping tool that surfaces **sourced** connections between UK public figures and the money and companies around them, with an honest **confidence** score on every link. It states facts and flags structural overlaps so users can judge for themselves.

## The line we hold (non-negotiable)

- **Facts, not verdicts.** Surface connections and structural overlaps *with sources*. Never allege wrongdoing; never label anyone corrupt or guilty. No outcome predictions and no AI-asserted probability of future events — ever.
- **Precision over recall.** A false link is a critical failure (libel + credibility collapse). Tune thresholds to a target precision; render anything below the bar as a dotted *lead*, never a stated fact.
- **Provenance is non-negotiable.** Every node and every edge links back to a primary source.
- **British English** in all user-facing copy.

## Data model (statement-based, provenance-first)

- **Store claims, not "truth."** Three distinct layers: **mention** (a raw reference exactly as it appears in one source) → **canonical entity** (the resolved real-world thing, formed by clustering mentions) → **statement** (a typed edge with source(s), validity interval, confidence, strength).
- The mention→canonical mapping is **probabilistic** (each carries a match confidence) and lives in its own table. **Resolution is a recomputable layer, never a destructive merge** — we can re-run it as new data arrives without losing provenance, and every merge is auditable.
- **Two numbers per link, never conflated:** *confidence* (how sure we are the link is real and correctly identified) vs *strength* (assuming it's real, how meaningful the tie is).

## The engine (the moat)

- **Resolution:** blocking (deterministic keys + phonetic/DOB-year + **pgvector ANN**) → Fellegi–Sunter probabilistic linkage with rarity (`m/u`) weights (Splink) → a **graph-aware second pass** (shared-neighbour Jaccard, iterate to fixpoint) → **LLM adjudication of the ambiguous band only** → **calibration** against a hand-labelled gold set to a target precision. Get resolution right before anything else; **do not skip calibration**.
- **Edge confidence** = combine(source-reliability prior, endpoint match confidence, corroboration). Corroboration across independent sources combines via **noisy-OR** `1 − Π(1 − rᵢ)`.
- **Edge strength** = type_weight × magnitude (log/saturating) × recency × duration × **rarity** (IDF/PMI — the anti-hairball term).
- **Propagation:** serial chains **multiply** (decay; if links share a shaky source, discount correlation — use `min`, don't multiply as if independent); parallel independent routes **noisy-OR** (compound). Bounded weighted path enumeration. Established links render **solid**, inferred links **dotted**.

## Where the LLM (Anthropic API) fits — and where it does NOT

- **Only:** extraction from messy unstructured sources; adjudicating the *ambiguous resolution band* (combined with the statistical score, then calibrated — anchoring on the statistical model is the hallucination guard); on-demand neutral plain-English summaries.
- **Never:** the source of truth; unanchored probabilities; processing millions of rows. **Log every LLM rationale** for auditability. Batch where possible; the LLM touches only the ambiguous minority.

## Stack & boundary

- **App** (`web/`): Next.js + React + TypeScript. Reads the resolved graph. UI seeded from `docs/prototype/orrery.jsx`; swap the hand-rolled SVG for a real graph lib (react-force-graph / Sigma.js / Cytoscape.js) at M5.
- **DB:** Supabase Postgres + pgvector, shared by `web/` and `pipeline/`. Schema lives in `supabase/migrations/`.
- **Pipeline** (`pipeline/`): Python — Splink for record linkage, the loaders/scrapers, the propagation logic. Scheduled jobs + a long-running worker for Companies House streaming (later).
- **Graph traversal:** Postgres recursive CTEs (or Apache AGE) for v1; Neo4j AuraDB later for deep traversal at scale.
- **Clean boundary:** the **pipeline writes** the resolved graph; the **app reads** it. Keep that boundary clean — the app does not run resolution; the pipeline does not render UI.

## Supabase / security conventions

- **Service role key: server + pipeline ONLY**, via `.env`. It must **never** reach the browser. Use the **publishable/anon key** for any client read (gated by RLS).
- **RLS enabled on every table** in `public`, locked down (no permissive `anon`/`authenticated` policies) until a specific read path needs one.
- All schema changes go through **migrations** in `supabase/migrations/`. Never hand-edit the deployed schema — add a migration. Run `get_advisors` (security + performance) after DDL changes.

## Build order — one milestone at a time, stop for review at each boundary

1. **Scaffold + statement-based schema** ← current.
2. Companies House ingestion for a small seed set (named companies + officers + PSCs) → raw landing with provenance.
3. Entity resolution v1: Splink + rarity-weighted Fellegi–Sunter + a tiny hand-labelled gold set + calibration; report precision on the gold set.
4. Edges with confidence + strength; bounded path propagation (serial multiply + parallel noisy-OR).
5. Wire the prototype UI to real data: graph, confidence slider filtering by threshold, node inspector with sourced connections, path tracing with per-hop confidence.
6. Add Electoral Commission + Parliament interests; re-resolve across all three sources.

**Do not add data sources or features beyond the current milestone.** Ask before installing anything that needs an account or a paid key, and when you need a credential, name exactly which one and where it goes.

## Environment (Windows)

- Run the **Python pipeline under WSL2** (Splink and the data tooling are smoother there). The host has Python 3.14, which is ahead of what Splink/deps support — pin a **3.11 or 3.12 venv** for the pipeline. Keep the Next.js app on the host or WSL2, your choice.
- Secrets live in `.env` / `.env.local` (gitignored). `.env.example` is the template.

## Out of scope (never)

- Outcome predictions or AI-asserted probability of future events.
- Accusations or wrongdoing labels in the product's voice.
- Ingesting every global source on day one. UK first; prove the engine; then expand.
