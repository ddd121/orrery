# ORRERY — Build Handoff & PRD
### Carry this into a fresh Claude Code session

## How to use this

Open Claude Code in an empty project folder and drop in three files:

1. **This document** (the brief, the PRD, the build prompt).
2. **`resolution-confidence-engine-spec.md`** (the technical engine, your actual IP).
3. **`orrery.jsx`** (the working UI prototype, your front-end starting point).

Then paste the build prompt in Section 4 to kick off. The rest of this doc is context for you and for Claude Code.

---

## 1. What you're building

A tool that surfaces sourced connections between powerful people and the money and companies around them, with an honest confidence score on every link, so users can see the patterns and judge for themselves. It states facts and flags structural overlaps. It never alleges wrongdoing.

The moat is not the data (public) or the API list (copyable). It is three things that compound: a calibrated cross-jurisdiction entity-resolution model, an honest confidence-propagation layer, and a human-verified graph that gets better every time it is used. Full detail in the engine spec.

---

## 2. Accounts and keys: what you set up vs what Claude Code does

Honest framing first. Claude Code will write essentially all of the code, generate the database schema, run the migrations, wire the pipeline, and stand up the Next.js app. What it cannot do is create accounts in your name or enter your card details. So your job is to create a small number of accounts and drop their keys into a `.env` file. Then it cracks on.

**Tier 1: get these before you start (this is the whole MVP)**

| Thing | What it's for | Cost | What Claude Code needs |
|---|---|---|---|
| **Supabase** | Postgres + pgvector, auth, storage; the shared database | Free tier fine | Project URL, anon key, service role key in `.env` |
| **Anthropic API key** (console) | In-pipeline extraction + ambiguous-match adjudication + summaries. This is metered API usage, separate from your Max/Code subscription | Small metered spend | `ANTHROPIC_API_KEY` in `.env` |
| **Companies House API key** | The company graph spine: officers, PSCs, filings, streaming | Free | Key in `.env` (rate limit 600 req / 5 min) |
| **Electoral Commission** | Donations and loans | Free, no account | Nothing; you just download the CSVs |
| **UK Parliament APIs** | Members, financial interests, divisions, Hansard | Free, no key (Open Parliament Licence) | Nothing |

That is the full MVP set: two five-minute signups (Supabase, Anthropic), one free key (Companies House), two open downloads. Everything else is later.

**Tier 2: add when the MVP works**

- **TheyWorkForYou API key** (free tier, paid from roughly £20/mth) if you want pre-parsed parliamentary data instead of parsing it yourself.
- **OpenSanctions** (bulk free for non-commercial; API key plus a licence if you monetise) for global PEPs and sanctions.
- **OpenCorporates** (apply for a free Permitted User account as a researcher; the full API is paid, check current pricing) for non-UK company data.
- **ICIJ Offshore Leaks** (download) and **OCCRP Aleph** (request an API key) for the offshore and leaked-records layer.
- **Neo4j AuraDB** (free managed tier) when Postgres traversal starts to hurt, or run Neo4j locally in Docker.

**Tier 3: productionise and monetise, much later**

- **Stripe** for the subscription tier.
- **Vercel** to host the Next.js app, plus a small worker host (Render, Fly, or a VPS) for the scheduled ingestion jobs and the long-running Companies House streaming connection.

So yes, you need a few accounts, but only five things for the MVP, and Claude Code does all the building once the keys are in `.env`.

---

## 3. PRD

### Problem
Connections between powerful people, their donors, and the companies they touch are public but fragmented across dozens of registers, and the links are hidden because names rarely match cleanly across them. No accessible tool joins them up and shows the picture.

### Goal
Surface sourced connections with honest confidence so users can read the patterns and judge for themselves. State facts, flag structural overlaps, never allege wrongdoing.

### Users
- **Primary (v1):** investigative journalists, researchers, watchdogs, opposition researchers. They want depth, sources, export, pattern-hunting.
- **Secondary:** the public (a simple "explore your MP" experience).
- **Later, commercial:** compliance and due-diligence teams, who pay for monitoring and clean data.

### Scope
- **v1 (MVP):** UK only. Three sources (Companies House, Electoral Commission, Parliament interests). Entity resolution across them with a calibrated confidence. A graph store. The force-directed UI from the prototype, with the confidence slider, node inspector, coverage panel, and path tracing. Two hero queries: network-around-X, and how-are-X-and-Y-connected.
- **Later:** streaming alerts and monitoring; cross-border sources via the footprint routes; the pro subscription tier; contextualisation features (news-to-graph linking, horizon scanning, computed base rates from your own data).
- **Never:** outcome predictions with AI-asserted confidence scores.

### Functional requirements
1. **Ingestion:** bulk snapshot loaders, plus incremental and streaming, plus scrapers for the messy CSV and PDF sources. Lands raw with provenance attached.
2. **Entity resolution:** per the engine spec. Blocking (including pgvector ANN), Fellegi-Sunter scoring with rarity weighting, a graph-aware second pass, LLM adjudication of the ambiguous band, calibration against a gold set.
3. **Graph and edges:** typed statements with confidence and strength, time-stamped, sourced.
4. **Confidence propagation:** serial multiply (decay) plus parallel noisy-OR (corroboration), via bounded weighted path enumeration. Established links render solid, inferred links render dotted.
5. **Inference and flags:** transitive control, common-control relatedness, the conflict-of-interest motif. Flags carry confidence and sources, never verdicts.
6. **UI:** the prototype graph (full-screen, pinch and pan, bottom-sheet inspector, confidence slider, filters, trace, recenter). Search. Sourced plain-English summaries on demand.
7. **Provenance:** every node and edge links back to a primary source. Non-negotiable.

### Non-functional
- **Precision-first:** high precision over recall; thresholds tuned to a target precision. A false link is a critical failure.
- **Auditability:** statement-based model; recomputable resolution; logged LLM rationales.
- **Cost control:** the LLM runs only on extraction and the ambiguous-match minority, never over millions of rows; batch where possible.
- **Legal and ethical spine:** facts not verdicts; sourced; public-interest; data-protection journalism framing.
- **Performance:** Postgres handles tens of millions of rows; graph traversal moves to Neo4j when it needs to.

### Tech stack (matches how you work)
- **App:** Next.js, React, TypeScript (Vercel later). UI seeded from `orrery.jsx`, swapping the hand-rolled SVG for a real graph lib (react-force-graph, Sigma.js, or Cytoscape.js) for scale.
- **Database:** Supabase Postgres plus pgvector, shared by app and pipeline. Service role key in `.env`.
- **Graph traversal:** Postgres recursive CTEs, or the Apache AGE extension, for v1; Neo4j AuraDB later for deep traversal at scale.
- **Resolution and ingestion pipeline:** a Python service (Splink for probabilistic record linkage, the loaders and scrapers, the propagation logic), run as scheduled jobs plus a long-running worker for Companies House streaming.
- **LLM in the loop:** Anthropic API for extraction from messy sources, ambiguous-match adjudication, and on-demand summaries.
- **Payments later:** Stripe.

This is polyglot on purpose: a Python pipeline and a TypeScript app sharing one Postgres. Keep the boundary clean. The pipeline writes the resolved graph; the app reads it.

### Architecture sketch
```
[sources] -> [Python ingestion: bulk / stream / scrape]
          -> [raw landing in Postgres, with provenance]
          -> [resolution: Splink + graph-aware pass + LLM adjudication + calibration]
          -> [canonical entities + scored edges in Postgres / graph]
          -> [Next.js app: API + force-graph UI + trace + summaries]
```

### The engine
See `resolution-confidence-engine-spec.md`. That is the authoritative spec for resolution, scoring, propagation, calibration, and the flywheel. Build it in the order given in its Section 11. Do not skip calibration.

### Out of scope (state these so Claude Code does not drift)
- No outcome predictions or AI-asserted probability of future events.
- No accusations or wrongdoing labels in the product's voice.
- No attempt to ingest every global source on day one. UK first, prove the engine, then expand.

### Definition of done for v1
- The three UK sources ingest and refresh on a schedule.
- Resolution runs with a calibrated confidence and a small gold set; precision is measured.
- The graph renders in the prototype UI; the confidence slider filters by threshold; you can trace a path between two entities and see per-hop confidence; clicking a node shows sourced connections and coverage.
- Every edge links to a source.

---

## 4. The Claude Code build prompt (paste this)

> You are building the MVP of ORRERY, a power-mapping tool that surfaces sourced connections between UK public figures and the money and companies around them. Before doing anything, read the two companion files in this repo: `resolution-confidence-engine-spec.md` (the authoritative spec for entity resolution, confidence scoring, propagation, and calibration) and `orrery.jsx` (the working front-end prototype). Also read the PRD you were given.
>
> Principles to hold throughout:
> - Precision over recall. A false link is a critical failure. Tune to high precision.
> - Statement-based, provenance-first data model. Every fact has a source and a timestamp. Resolution is a recomputable layer, never a destructive merge.
> - Facts, not verdicts. The product surfaces connections and flags structural overlaps with sources. It never alleges wrongdoing, and it makes no predictions of future outcomes.
> - The LLM (Anthropic API) is used only for extraction from messy sources, adjudicating the ambiguous resolution band, and on-demand summaries. Never as the source of truth, and never over millions of rows.
>
> Stack: Next.js, React, TypeScript app; Supabase Postgres plus pgvector (service role key in `.env`); a Python pipeline using Splink for probabilistic record linkage; Postgres recursive CTEs (or Apache AGE) for graph traversal in v1; Anthropic API for the LLM steps. Keep the app and pipeline boundary clean: the pipeline writes the resolved graph, the app reads it.
>
> Build in this order, and stop for my review at the end of each milestone:
> 1. Repo scaffold, a project `CLAUDE.md`, and `.env.example`. Set up Supabase migrations. Implement the statement-based schema (mentions, canonical entities, typed statements with source, validity interval, confidence, strength) from spec Section 1.
> 2. Companies House ingestion for a small seed set (a few named companies and their officers and PSCs), landing raw with provenance.
> 3. Entity resolution v1: Splink with rarity-weighted Fellegi-Sunter, a tiny hand-labelled gold set, and calibration. Output canonical entities with a calibrated match confidence, and report precision on the gold set.
> 4. Edges with confidence and strength, and bounded path propagation (serial multiply plus parallel noisy-OR) per spec Section 5.
> 5. Wire the prototype UI to the real data: render the resolved graph, the confidence slider filtering by threshold, the node inspector with sourced connections, and path tracing showing per-hop confidence.
> 6. Add Electoral Commission and Parliament interests, and re-resolve across all three sources.
>
> At the start of each milestone, tell me the plan and any decisions that need my input (account keys, schema trade-offs, library choices). Do not add data sources or features beyond the current milestone. Ask before installing anything that needs an account or a paid key, and when you need a credential, tell me exactly which one and where to put it.
>
> Definition of done for this MVP: the three UK sources ingest and refresh; resolution produces a calibrated confidence with measured precision; and the prototype UI renders the graph, filters by confidence, and traces a sourced multi-hop path between two entities, with every edge linking to a primary source.

---

## 5. Skills, MCP, and tooling

- **Skills:** use your find-skills capability to pull in the **frontend-design** skill for the UI work (design tokens, component styling). Use **skill-creator** if you want to codify a repeatable source-loader pattern as your own skill. The docx, xlsx, and pdf skills are there for exports and reports later.
- **MCP:** add the **Supabase MCP server** so Claude Code can manage the database, run migrations, and inspect schema directly. Your globally configured MCPs carry over. An HTTP-fetch or Companies House MCP helps during ingestion development.
- **Subagents:** you have these installed globally. Use a dedicated subagent for the Python resolution pipeline and another for the front end, so context stays clean across the polyglot boundary.
- **CLAUDE.md:** put a project `CLAUDE.md` at the repo root capturing your conventions (Supabase service role via `.env`, British English in copy, precision-first, facts-not-verdicts, the stack, the build order). This keeps every session on-rails.
- **Windows:** you are on Windows. Run the Python pipeline side under WSL2 (Splink and the data tooling are smoother there) and keep the Next.js app wherever you prefer. For current setup specifics, see the Claude Code docs map: https://docs.anthropic.com/en/docs/claude-code/claude_code_docs_map.md

---

## 6. First session, literally

1. Create the empty repo folder, add the three carry-over files, and add a `.env` with your Supabase, Anthropic, and Companies House keys.
2. Paste the build prompt. Let it scaffold the repo, write the schema, and run migrations against Supabase.
3. Milestone one and two only. Get one true multi-hop link on screen, sourced, with a confidence, before adding any more sources. Do not let it sprawl.

The discipline that makes this work is the same one that makes the product credible: start narrow, get the resolution right, prove one real connection, then widen.
