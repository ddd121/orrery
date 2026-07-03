# ORRERY — Build Log & Resume Guide

> Living handoff doc. If a session resumes cold, read this + `CLAUDE.md` + the engine spec.
> Last updated: 2026-07-03.

## Status

Milestones **1–7 done + a findings-first UX rebuild**; now on a **launch-readiness push**
(calibration → depth → polish → international; hosting/auth excluded per Roy — "v last").
A **6-register** UK power-map (Companies House · Electoral Commission · Parliament members ·
Register of Members' Interests · **Contracts Finder** · **Register of Lords' Interests**) is
**live** at `localhost:3000`, pushed to `github.com/ddd121/orrery` (`main`). **5,903 entities /
9,796 statements** (Lords added 3,346 declared ties from 791 peers; the CH bridge attached 37
interest-declared companies to their real Companies House records). The app is findings-first
(Home board · Dossier · A→B Connect · canvas Explore via react-force-graph). Resolution moat:
deterministic resolve + **§4.4 graph-aware dedup done**. Real cross-register loops now close —
**Ecotricity** (interest register → CH directors → Labour donation → 21 public contracts, one
canonical entity); **IPGL** (Lord Spencer's Lords declaration + his CH officer record + 33
co-directors + Patrick Spencer MP); **GB News** ties five parliamentarians. The **CH bridge**
(`ingestion/companies_from_interests.py`) is deterministic: exact normalised-name match to a single
ACTIVE company, with a **suffix-class guard** (a foreign "Inc" never folds into a UK "Ltd"; "plc"
never into "Limited") — this is what keeps a US-parent declaration off a coincidental UK namesake.

**Calibration moat — validated & correctly report-only (2026-07-03).** The cross-source person
matcher stays **report-only with 0 auto-merges — the right state, proven, not a shortfall.** The
bootstrap gold set is *circular* (labels "same person" by the shared-neighbour feature the score
keys on → the 0.984 threshold is a tautology, and any pair clearing it was already merged by the
deterministic dedup); on the one non-circular test the matcher has zero separating power. **No
scoring change fixes it on this data** — calibration is **data-limited**. Genuine completion path:
Phase 2 depth → a ~150-pair hand-labelled pilot (residual base-rate) → LLM adjudication **last**,
gated on confirming `ANTHROPIC_API_KEY` with Roy. The report's reliability curve was *inverted*;
root cause found + fixed — `gold_set` had mislabelled same-canonical cross-source pairs (e.g.
'Kirith Entwistle' vs 'Kirith Entwistle MP') as "different people"; the `same_canonical` fix (plus
keyless surname-freq + neighbour-IDF hygiene) makes it **monotonic** (0.95→0.65, 0.98→0.94,
0.99→1.00) with real thresholds (95% @ 0.962). **Still 0 proposed cross-source merges — nothing
inferred about a named person is on the public graph — the line holds.** See the Data state +
roadmap sections below.

## Non-negotiable line (carry this)

- **The public graph is DETERMINISTIC only** — links matched on official identifiers
  (company numbers, CH officer ids, Parliament member ids, EC DonorId/RegulatedEntityId,
  normalised party names). The fuzzy matcher (`fuzzy_match.py`) is **report-only**:
  nothing uncertain about a *named person* is merged or shown as a fact.
- **Facts, not verdicts.** Every edge cites a source. Scrutiny = "merits a look", never
  "is dodgy". British English. Precision over recall.

## Model routing (delegation convention — confirmed 2026-06-30)

Route delegated work by task type (Roy's call). Full detail in memory `model-routing-convention.md`.
- **Fable 5** — hardest reasoning / architecture / strategy, as a *discrete strategy subagent*
  (e.g. the calibration moat), not the always-on main loop. $10/$50 per 1M.
- **Sonnet 5** — the coding bulk (near-Opus quality at ~⅓ price). $3/$15 (intro $2/$10 to 31 Aug 2026).
- **Haiku 4.5** — cheap mechanical passes (greps/renames/scans; no `effort` param). $1/$5, 200K ctx.
- **Opus 4.8** — orchestrator (main loop) + adversarial QA / review. $5/$25.

Mechanic: the main-loop model is user-selected (can't hot-swap mid-session — switching invalidates
the prompt cache); route **subagents** via the Agent tool's `model` param, or `Workflow
agent({model, effort})`. Per-subagent **effort** is Workflow-only (the Agent tool sets model, not
effort); Workflows need explicit opt-in. Announce the model + rough cost per delegation. Effort:
`xhigh` default for coding/agentic, `high` = efficient balance, `max` for QA/correctness.

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

- **2026-06-27 — broadened to the full Commons (650 MPs):** **2,074 entities, 5,800 statements, 5 sources**;
  **95 conflict-of-interest leads (24 strong / 61 medium / 10 low)**. Dedup residual: 58 redundant
  persons / 31 clusters (harder same-name cases, left for the calibrated matcher). **Scale fix:**
  `loadGraph` was truncating at Supabase's 1,000-row response cap → now pages through entities +
  statements (`web/lib/graph.ts`). The bullets below are the earlier 150-MP slice (kept for context).

- **5 sources** (Companies House · Electoral Commission · Parliament members · Register of Members'
  Interests · **Contracts Finder**); 839 entities + contract buyers, 1,435 statements + **21
  `CONTRACTED_WITH` edges** (150-MP broaden + contracts, 2026-06-27). **Closed loop:** Ecotricity
  donated £1m → Labour AND holds 13 public contracts — donor + government contractor in one entity.
  (Contracts Finder loader: keyless OCDS; matches suppliers by name then stamps our verified CRN so
  resolve_v3 attaches to the existing company; re-run = delete prior `contracts_finder` raw first.)
  At ~840 nodes the hand-rolled SVG is at its comfort limit — the react-force-graph/Sigma swap
  (roadmap item 7) is now genuinely warranted before going much wider; the browse panel is what
  keeps it navigable for now.
- Seed: Halma (`00040932`) + Aggreko group; donor companies **Ecotricity `03043412`,
  Quadrature `09516131`, Phoenix Partnership `04077829`, Access Industries `05035508`**;
  EC top-40 donations of 2024; **150 current MPs** (+ biographies) and their registered interests.
- **Money ↔ power connects:** Labour = 15 corporate donors / £13.8M / 12 MP members.
  Ecotricity → £1M → Labour + its 14 directors (incl. Dale Vince). Phoenix → £5M → Conservatives.
- **§7 conflict-of-interest (`motifs_v2.sql`, salience-ranked): 21 MPs — 6 strong / 11 medium / 4 low.**
  Sector is inferred from the company's declared **description + nature** (Register of Interests), not
  just its name, and **internal House-management committees** (Finance Committee (Commons), Members
  Estimate, …) are excluded so their names don't fake a sector overlap. STRONG: Amos (housing), Brash
  (housing), Alaba (media), Aquarone (data/tech), Collins (data/tech), Barclay (finance). Per-edge
  provenance (`attributes.sources`) labels every link by its real register. Rebuild: `recompute build`.
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

1. **Resolution moat — §4.4 graph-aware dedup DONE** (`resolution/dedupe_v1.sql`, runs in
   `recompute build` between resolve_v3 and edges_v2): deterministic, precision-safe merge of
   split canonical entities — same sorted-name key + a *shared specific neighbour* (party /
   government_body hubs excluded) or DOB-year. Collapsed 17/23 split persons (859→829 entities;
   "COWLING, Tom" → one entity, chain intact); 6 same-name clusters correctly LEFT unmerged
   (distinct donor ids, no shared link — handed to the calibrated matcher). This is the safe
   deterministic layer; the harder cross-source/ambiguous-band cases still need calibration:
   **Calibration MACHINERY DONE** (`resolution/calibration.py`: pure-Python isotonic
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
7. **Real graph lib — DONE (react-force-graph-2d, canvas)** (`web/app/components/OrreryCanvas.jsx`):
   Explore renders the full **2,074-node** graph smoothly on canvas; verified search-focus (camera
   flies + dims others), node-select → inspector, confidence slider, and the panel all preserved;
   the SVG's per-tick re-render (the CPU/fan sink) is gone (the library owns the sim/zoom/pan).
   `OrreryGraph.jsx` slimmed ~355 lines to wire the existing chrome into the canvas. Home/Dossier/
   Connect untouched (small graphs). Earlier context for why this was the priority:
   ~~Real graph lib (react-force-graph / Sigma) — was the priority at 839 nodes (the
   hairball + the SVG's limit). Interim wins shipped: (a) **perf** — the d3 sim is pre-warmed
   headlessly with no continuous 60fps timer (was re-rendering ~5k SVG els ~300× on load → the
   "fan"; now idles when still; drag ticks on-move) in `OrreryGraph.jsx`; (b) **onboarding** — a
   first-run welcome (auto-once via localStorage) answers what/where-to-start with a "Show me the
   leads →" CTA into the ranked list; the panel is the way in, the SVG is the backdrop. The
   canvas/WebGL lib is the real fix for rendering thousands of nodes smoothly + de-hairballing.

## UX redesign — findings-first (shipped 2026-06-27)

The app was graph-first (land on an 839-node hairball, click random nodes). Reframed to
**findings-first / search-led**, reusing the engine (no data/schema change). New IA in `web/`:
- `page.tsx` → `OrreryApp.jsx` (client shell; `view` = home | entity | explore; sticky header + global search).
- `views/HomeView.jsx` — **the landing**: hero search + a "what merits a look" board (conflict cards
  strong-first + "the money behind the parties") + a live credibility strip + a cheap CSS-drift
  backdrop (no force sim). No auto-welcome modal.
- `views/EntityView.jsx` — **dossier**: conflict banner + ties grouped in plain English (confidence +
  "via {source}" per row) + a small focused ego-graph.
- `components/ForceGraph.jsx` — reusable lightweight d3 (backdrop | focused; headless pre-warm; NO timer).
- `lib/graph-utils.ts` — shared tokens + `findPath`, `leads()`, `tiesOf()`.
- `OrreryGraph.jsx` kept as the opt-in **Explore** full-network view (+ `initialFocusId`).
- **Gotcha:** running `next build` while `next dev` is live corrupts `.next` ("outdated Webpack" /
  "a[d] is not a function"). Fix: kill :3000, `rm -rf web/.next`, restart `npm run dev`.

**M4 — DONE (2026-06-27, `web/app/views/ConnectView.jsx`):** the A→B **connection finder** — dual entity search → `findPath` → a left-to-right
sourced path chain ("A —donated £4m→ Co —director→ B") + a focused path graph. Currently a "soon" stub
live from the Home hero, the header "Connect", and each dossier's "Find a path from here";
no-path → lower-threshold fallback. Verified: Cowling → Ecotricity (Director, 97%, CH) → Labour
(Donated £1m, 97%, EC). **The findings-first redesign is complete: Home · Dossier · Connect · Explore.**

## Expansion roadmap (to be genuinely useful — beyond the UK demo)

The engine + UX work; the gap to "useful" is **coverage + scale + trust**:
- **More UK sources (depth):** Contracts Finder (public contracts — this *closes the loop*:
  donor → party → minister → contract); lobbying / APPG registers; Land Registry / property; court &
  insolvency. Each new source re-runs through the same resolve → edges → scrutiny → motifs pipeline.
- **Scale (breadth):** all 650 MPs + Lords + a far larger CH/EC slice → the **graph-lib swap** (item 7)
  and Postgres → Neo4j AuraDB for deep traversal become load-bearing, not optional.
- **International:** the model is jurisdiction-agnostic (mention → canonical → statement). Expand via
  per-jurisdiction loaders + a `jurisdiction` dimension (EU Transparency Register; OpenCorporates for
  cross-border company graphs; US FEC/lobbying; ICIJ/OCCRP leak datasets). UK-first proves the engine,
  then add jurisdictions one at a time behind the same schema. *Do not ingest every global source on
  day one* (PRD guardrail).
- **The moat (trust):** the calibrated gold set + LLM adjudication (item 1) turns cross-register
  *person* matching from report-only into trusted merges — **required before international**, where
  name collisions explode.
- **Live + flywheel:** scheduled refresh + CH streaming change-alerts (item 4); analyst confirm/reject
  flywheel (item 5); on-demand neutral LLM summaries (item 6).
