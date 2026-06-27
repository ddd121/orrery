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

- **4 sources; 839 canonical entities, 1,435 statements** (after the 150-MP broaden, 2026-06-27).
  At ~840 nodes the hand-rolled SVG is at its comfort limit — the react-force-graph/Sigma swap
  (roadmap item 7) is now genuinely warranted before going much wider; the browse panel is what
  keeps it navigable for now.
- Seed: Halma (`00040932`) + Aggreko group; donor companies **Ecotricity `03043412`,
  Quadrature `09516131`, Phoenix Partnership `04077829`, Access Industries `05035508`**;
  EC top-40 donations of 2024; **150 current MPs** (+ biographies) and their registered interests.
- **Money ↔ power connects:** Labour = 15 corporate donors / £13.8M / 12 MP members.
  Ecotricity → £1M → Labour + its 14 directors (incl. Dale Vince). Phoenix → £5M → Conservatives.
- **§7 conflict-of-interest (`motifs_v2.sql`, salience-ranked): 21 MPs flagged — 5 strong / 12 medium / 4 low.**
  STRONG remit↔sector overlap: Amos (housing), Brash (housing), Alaba (media), Aquarone (data/tech),
  Barclay (finance). The 12 medium are commercial interests whose sector isn't in the company name —
  the SIC-code / interest-description sector step would promote the genuine ones. Per-edge provenance
  (`attributes.sources`) labels every link by its real register. Rebuild: `recompute build`.
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

1. **Calibration — MACHINERY DONE** (`resolution/calibration.py`: pure-Python isotonic
   (PAVA) + reliability diagram + threshold-to-target-precision; self-tested — e.g. ≥95%
   precision at score ≥ 0.90 on the synthetic set). **Remaining: fit it to a REAL gold set**,
   which needs broader data (item 2) — the current slice has too few cross-source candidate
   pairs to fit one honestly. Key the gold set by **stable mention-id pairs** (entity ids are
   regenerated each run). Then **LLM adjudication** (`claude-api`) of the ambiguous band,
   combined with the statistical score (anchor on stats = hallucination guard). **Until
   fitted, `fuzzy_match.py` stays report-only — nothing inferred reaches the public graph.**
2. **Register of Members' Interests — DONE** (`ingestion/parliament_interests.py`):
   extracts the structured `fields` (no LLM needed) → MP `OWNS`/`DIRECTOR_OF`/`ADVISER_TO`
   company (shareholdings + employment) + donor `DONATED_TO` MP. 22 interests for 20 MPs
   landed; visible in each MP's inspector (e.g. Allin-Khan→ITV plc, Adam→director of Sask
   Optics Ltd). Run via the recompute pipeline (resolve_v3 → edges_v2 → scrutiny_v1).
3. **§7 conflict-of-interest flag — DONE v2** (`graph/motifs_v2.sql`, salience-ranked): flags an
   MP holding a directorship/shareholding while on a committee, then scores it by whether the
   committee remit overlaps the interest's SECTOR (transparent keyword lexicon) — `strong` overlap /
   `medium` commercial-but-no-detectable-overlap / `low` (party-political, dormant, eponymous —
   demoted). Surfaced with a strength-scaled red ring + a strength-aware inspector box that names
   the overlapping sector; the browse list sorts strong-first. `recompute build` runs v2 (v1 kept
   for history). Next precision step: use CH SIC codes / interest descriptions for sector instead
   of name keywords (Bhatti is `medium` only because his company names don't reveal their sector).
   **Remaining:** transitive/common-control motifs; **company-name fuzzy matching** (link
   interest-companies ↔ donor cos ↔ CH — none carry a CRN); committee-remit↔interest-sector
   overlap for precision; **provenance-label fix** (interest edges mislabel as "Companies
   House" in graph.ts `method` — needs per-statement source). Broadening the seed will surface
   many more conflicts + give the calibration its cross-register gold set.

   **To broaden the seed (loaders are NOT idempotent — do this cleanly):** `source_documents`
   has a unique `(source_code, external_ref)`, so re-running a loader raises `23505` and writes
   nothing (atomic — safe, the graph is untouched). (`parliament.py` is now FIXED: it pages past
   the Members API's 20-row cap, and writes `source_code='parliament'` not `parliament_interests`;
   the `parliament` source row + its migration `20260626120000_add_parliament_source.sql` are in.)
   The clean re-ingest, in order — note (a)+(b) briefly empty the graph, so run it in one go:
   (a) `truncate statement_assertions, statements, mention_resolutions, canonical_entities cascade;`
   (b) delete prior raw: `delete from relationship_assertions / mentions / source_documents
   where source_code in ('parliament','parliament_interests')` (children first — check FK cascade);
   (c) re-run `parliament` + `parliament_interests` loaders with a larger take;
   (d) recompute via **MCP** `execute_sql` (NOT `apply_sql` — it splits on blank lines and chokes
   on the commented multi-statement files): resolve_v3 → edges_v2 → scrutiny_v1 → motifs_v1.
   Best done with fresh context — it's ~8 steps and the truncate makes the graph briefly empty.
4. **Scheduled refresh** (the 3 sources) + later CH streaming → motif-closing alerts (§8 anomaly).
5. **Human-verified flywheel:** analyst confirm/reject on ambiguous merges → training data.
6. **On-demand LLM summaries** of a path/flag → sourced neutral plain English.
7. **Real graph lib** (react-force-graph / Sigma) when node counts exceed a few hundred
   (the hand-rolled SVG is the M5 deferral).
