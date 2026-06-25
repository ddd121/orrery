# ORRERY — Build Log & Resume Guide

> Living handoff doc. If a session resumes cold, read this + `CLAUDE.md` + the engine spec.
> Last updated: 2026-06-25.

## Status

Milestones **1–6 done**. A three-register UK power-map (Companies House + Electoral
Commission + Parliament) is **live** at `localhost:3000`, pushed to
`github.com/ddd121/orrery` (`main`). The cross-source fuzzy person matcher is **built but
report-only** — nothing inferred is on the public graph yet.

## Non-negotiable line (carry this)

- **The public graph is DETERMINISTIC only** — links matched on official identifiers
  (company numbers, CH officer ids, Parliament member ids, EC DonorId/RegulatedEntityId,
  normalised party names). The fuzzy matcher (`fuzzy_match.py`) is **report-only**:
  nothing uncertain about a *named person* is merged or shown as a fact.
- **Facts, not verdicts.** Every edge cites a source. Scrutiny = "merits a look", never
  "is dodgy". British English. Precision over recall.

## Supabase / secrets (gotchas)

- **Our project: `vtibsxiurrzjjbpsacrg`.** The connected MCP also exposes the user's
  unrelated **`daojvtfwazckfuizecup` (Pupil Pathways prod)** — **NEVER write there.**
  Before any DDL/write, call `get_project_url` and confirm it returns `vtibsxiurrzjjbpsacrg`.
- Secrets in **`.env`** (gitignored): `COMPANIES_HOUSE_API_KEY`, `SUPABASE_DB_URL`
  (session pooler, IPv4), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  `web/.env.local` has the two `NEXT_PUBLIC_*`. `.mcp.json` (project-scoped supabase MCP)
  is gitignored.
- Python: **`pipeline/.venv`** (host Python 3.14 + `pg8000`, pure-Python driver). Splink
  and the full statistical resolution want a **3.11/3.12 WSL2 venv** — not set up yet.

## Recompute pipeline (run in this order)

```bash
set -a; . ./.env; set +a          # load secrets

# 1. INGEST (writes raw mentions + relationship_assertions, idempotent-ish; re-running
#    duplicates source_documents — delete by source_code first if re-ingesting)
PYTHONPATH=pipeline pipeline/.venv/Scripts/python -m orrery_pipeline.ingestion.companies_house <anchor> <max>
PYTHONPATH=pipeline pipeline/.venv/Scripts/python -m orrery_pipeline.ingestion.electoral_commission <from> <to> <limit>
PYTHONPATH=pipeline pipeline/.venv/Scripts/python -m orrery_pipeline.ingestion.parliament <take>

# 2. RESOLVE + SCORE (run the SQL via the Supabase MCP execute_sql, or psql/pg8000).
#    resolve_v3 TRUNCATES the resolution + edge layers and rebuilds from raw (recomputable;
#    raw layer is never touched). Order matters.
#    a) pipeline/orrery_pipeline/resolution/resolve_v3.sql   (cross-source deterministic)
#    b) pipeline/orrery_pipeline/graph/edges_v2.sql          (confidence + strength + £)
#    c) pipeline/orrery_pipeline/graph/scrutiny_v1.sql       (§8 scrutiny score)

# 3. FUZZY (report-only — prints candidate cross-source person matches; does not merge)
PYTHONPATH=pipeline pipeline/.venv/Scripts/python -m orrery_pipeline.resolution.fuzzy_match

# 4. APP
npm install --prefix web && npm run dev --prefix web      # -> localhost:3000
npx --yes cloudflared tunnel --url http://localhost:3000  # temporary public link
```

## Data state (last run)

- 3 sources; ~259 canonical entities, ~290 statements.
- Seed: Halma (`00040932`) + Aggreko group; donor companies **Ecotricity `03043412`,
  Quadrature `09516131`, Phoenix Partnership `04077829`, Access Industries `05035508`**;
  EC top-40 donations of 2024; 20 current MPs (+ biographies).
- **Money ↔ power connects:** Labour = 15 corporate donors / £13.8M / 12 MP members.
  Ecotricity → £1M → Labour + its 14 directors (incl. Dale Vince). Phoenix → £5M → Conservatives.
- Scrutiny: 87 entities flagged (≥0.7), neutral corporate group at 0, no bill/committee noise.
- Fuzzy matcher: **0 cross-source person matches** in this slice (nothing inferred goes
  public); catches within-source dedup (two-id Kennerley; CH officer-vs-PSC name variants).

## File map

| Path | Role |
|---|---|
| `supabase/migrations/*_orrery_core_schema.sql` | statement-based schema (10 tables, RLS) |
| `..._orrery_seed_lookups.sql` | sources / entity_types / statement_types (tunable weights) |
| `..._public_read_policies.sql` | anon SELECT on the read tables (M5 read path) |
| `pipeline/orrery_pipeline/ingestion/companies_house.py` | CH loader (BFS crawl, officers + PSCs) |
| `.../ingestion/electoral_commission.py` | EC donations loader (CSV API) |
| `.../ingestion/parliament.py` | Parliament loader (members-api: MPs, party, roles, committees) |
| `.../resolution/resolve_v3.sql` | **current** cross-source deterministic resolution |
| `.../resolution/companies_house_v1.sql`, `resolve_v2.sql` | superseded (kept for history) |
| `.../resolution/fuzzy_match.py` | **report-only** F-S fuzzy cross-source person matcher |
| `.../graph/edges_v2.sql` | **current** edge scoring (confidence/strength/£) |
| `.../graph/scrutiny_v1.sql` | §8 scrutiny score (role-based money/power) |
| `web/lib/graph.ts` | fetch resolved graph → {nodes, links, types} |
| `web/app/OrreryGraph.jsx` | ported prototype, props-driven, scrutiny halo + pill |

## Key decisions

- Cross-source company merge: normalise `company_number` (zero-pad all-numeric to 8) so
  EC `3043412` == CH `03043412`.
- Party merge: normalise name (strip "the/party/and unionist") so EC "Labour Party" ==
  Parliament "Labour".
- `source_documents.raw` stored `null` by default (provenance via url + content_hash);
  set `CH_STORE_RAW=1` for full payloads.
- Fuzzy matcher: a **forename conflict is a hard blocker** — shared connections must never
  merge two different people (this caught a real false positive: Peter Wood ≠ Christopher Wood).

## Roadmap (remaining — do in order)

1. **Calibration (v1's last gap; NEXT).** Hand-labelled gold set of candidate person pairs
   → fit Platt/isotonic → reliability diagram → set the merge threshold to a target
   precision (~95%) → report precision. Turns `fuzzy_match.py` from report-only into a
   trusted merge step. Build: `resolution/calibration.py` + a versioned gold-set file.
   Then **LLM adjudication** (`claude-api`) of the ambiguous band, combined with the
   statistical score (anchor on stats = the hallucination guard).
2. **Register of Members' Financial Interests** (`interests-api.parliament.uk`) — the
   richest scrutiny signal (MPs' declared directorships/shareholdings/donations) and the
   data that creates real cross-register individuals + enables the §7 conflict-of-interest
   motif. Likely needs LLM extraction for the messy free-text categories.
3. **§7 inference + motifs:** transitive control, common control, the conflict-of-interest
   composite flag (with sources, never a verdict).
4. **Scheduled refresh** (the 3 sources) + later CH streaming → motif-closing alerts (§8 anomaly).
5. **Human-verified flywheel:** analyst confirm/reject on ambiguous merges → training data.
6. **On-demand LLM summaries** of a path/flag → sourced neutral plain English.
7. **Real graph lib** (react-force-graph / Sigma) when node counts exceed a few hundred
   (the hand-rolled SVG is the M5 deferral).
