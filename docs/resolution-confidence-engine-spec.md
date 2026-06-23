# The Resolution & Confidence Engine
### The core IP for a cross-jurisdiction power-mapping tool — "the moat"

> The data is public. The API list is copyable. Neither is defensible. The defensible asset is this engine: a **calibrated cross-jurisdiction entity-resolution model**, an **honest confidence-propagation layer**, and a **human-verified resolution graph that compounds with use**. This document specifies all three.

---

## 0. Design principles

1. **Store claims, not "truth."** Every fact is a *statement* with a source and a timestamp. Merging entities is a *recomputable layer on top*, never a destructive overwrite. (This is the Follow-the-Money / OpenSanctions model. Adopt it.)
2. **Two numbers per link, never conflated.** *Confidence* = how sure we are the link is real and correctly identified. *Strength* = assuming it's real, how meaningful a tie it is.
3. **High precision over recall.** A false link is existential (libel + credibility collapse). Tune thresholds to a target precision (e.g. 95%), accept lower recall, and render anything below the bar as a dotted *lead*, never a stated fact.
4. **Flags, never verdicts.** The engine surfaces structural patterns with sources and lets the user judge. It never asserts wrongdoing.

---

## 1. Data model

Three node layers — keep them distinct:

- **Mention** — a raw reference exactly as it appears in one source: `"J. Smith, director, Companies House filing #X, 2021"`.
- **Canonical entity** — the resolved real-world thing, formed by clustering mentions. The mention→canonical mapping is itself **probabilistic** (each carries a match confidence).
- **Statement (edge)** — a typed relationship (`DIRECTOR_OF`, `DONATED_TO`, `OWNS`, `SHARES_ADDRESS_WITH`, `CONTRACTED_WITH`, `FAMILY_OF`…), each with: source(s), validity interval, raw attributes, computed `confidence`, computed `strength`.

Why the mention/canonical split matters: it lets you **re-run resolution** as new data arrives without losing provenance, and it makes every merge auditable. This single decision is what separates a credible tool from a black box.

---

## 2. Edge confidence (is this link real?)

```
edge_confidence = combine(
    source_reliability,          # prior per source
    endpoint_match_confidence,   # only as sure as its entities are resolved
    corroboration                # independent sources asserting the same edge
)
```

- **Source reliability prior** `r_s ∈ (0,1]`: official register ≈ 0.97, leaked dataset ≈ 0.9 (high but caveated), reputable press ≈ 0.7, social/inferred ≈ 0.4. Tunable per source.
- **Endpoint match confidence**: a cross-border edge is only as confident as the resolution of the entities it connects. `ShellCo —owns→ Asset` inferred via a shared director inherits the director-match confidence. This is why §3 is the whole game.
- **Corroboration** (independent sources, same edge): combine via **noisy-OR** — `1 − Π(1 − r_i)`. Two independent mediocre sources beat one good one.

---

## 3. Edge strength (how meaningful, if real?)

```
edge_strength = type_weight × magnitude × recency × duration × rarity
```

- **type_weight** (lookup, tunable): `FAMILY 0.95`, `CO_DIRECTOR 0.7`, `OWNERSHIP scaled by %`, `DONATION/CONTRACT scaled by £`, `SHARED_ADDRESS` per rarity, `HOSPITALITY 0.3`, `CO_MENTION 0.1`.
- **magnitude**: saturating (log) scale of £ or % — £45k and £50k are near-equal; £500 vs £500k is not.
- **recency**: `exp(−λ·age)` — current ties outweigh ancient ones.
- **duration**: a 10-year directorship > a 6-month one.
- **rarity (the anti-noise term)**: a shared attribute is informative in **inverse proportion to how common it is**. A registered office used by 4,000 shells ≈ 0 signal; one used by 2 companies ≈ strong. This is **IDF / PMI** applied to relationships, and it's what stops the graph collapsing into a hairball.

---

## 4. Entity resolution — the core (the actual moat)

Same data everyone has; the magic is matching `"Marcus Helmsworth, financier (UK)"` to `"M. Helmsworth, director (BVI)"` to `"Markus Helmsworth (Cyprus filing)"` *correctly*, across scripts, with a calibrated number.

### 4.1 Blocking (you can't compare N² pairs)
Generate candidate pairs cheaply, then score only within blocks:
- deterministic keys: shared company number, LEI, passport/tax ID, phone, email, domain;
- phonetic + DOB-year keys: `metaphone(surname) + dob_year`;
- **embedding blocking (uses your pgvector stack)**: embed an entity's description, ANN-search nearest neighbours as candidates. Catches transliteration/spelling that exact keys miss.

### 4.2 Probabilistic record linkage (Fellegi–Sunter; Splink implements this)
For each candidate pair, compare on fields (name, DOB, address, nationality, IDs…). For each field's agreement level define:
- **m** = P(this agreement | same entity)
- **u** = P(this agreement | different entities) — *agreement by chance*

Match weight per field `= ln(m/u)`. Sum to a log-likelihood ratio:

```
LLR = Σ_f ln(m_f / u_f)
posterior_odds = prior_odds × exp(LLR)
P_match = posterior_odds / (1 + posterior_odds)
```

**Why this is principled, not vibes:** `u` encodes rarity automatically. `u(surname=Smith) ≈ 0.01` so matching "Smith" barely moves the needle; `u(surname=Helmsworth) ≈ 5e-6` so matching it contributes enormous positive weight. Rarity falls out of the maths instead of being hand-waved.

### 4.3 Cross-jurisdiction features (where the sophistication lives)
- **Names**: multi-script normalisation, transliteration (Cyrillic/Arabic→Latin), name-order handling, nicknames, phonetic (Double Metaphone) + edit distance (Jaro-Winkler).
- **DOB**: exact / year-only / month-year (UK PSC gives month+year) as graded agreement levels.
- **Identifiers**: company number, LEI, tax/passport — near-deterministic when present (huge `m/u`).
- **Address**: normalise + geocode, then rarity-weight.

### 4.4 Collective (graph-aware) resolution — the second pass
Attributes alone aren't enough. Two "John Smith" nodes are far more likely the same if they **share neighbours** (same co-directors, same companies, same addresses). Add a relational feature — Jaccard overlap of resolved neighbourhoods — with its own `m/u`, then **iterate to a fixpoint**: resolving some entities creates graph context that improves resolution of others. This is what the best investigative systems do, and most amateurs never reach it.

### 4.5 Decision bands + LLM adjudication
- `P_match > τ_high` → auto-merge.
- `P_match < τ_low` → distinct.
- **`τ_low ≤ P_match ≤ τ_high` → Claude adjudicates.** Hand it both records + their neighbourhood + the conflicting evidence; it reasons like an analyst and returns `{judgement, calibrated_confidence, rationale}`. You spend LLM calls *only* on the ambiguous minority (cost control) and log the rationale (auditability).

**Critical:** the LLM is a weigher of evidence, not the oracle. Combine, don't replace:
```
final_logit = statistical_logit + β · llm_logit   →   then calibrate (§6)
```
Anchoring on the statistical model is your hallucination guard.

---

## 5. Confidence propagation along chains (your headline question)

Two regimes. Telling them apart is the engine's reason to exist.

### 5.1 Serial (chained inference) → multiply → **decays**
`A→B` conf `p1`, `B→C` conf `p2`, **independent sources** ⇒ chain conf ≈ `p1 · p2`. Over `k` hops the product → 0. Long inferred chains are weak *by construction*.
- **Independence caveat (sophistication):** if both links rest on the *same* shaky source, the errors are correlated — don't multiply as if independent; use `min` or a correlation-discounted combine. Track source independence per edge.
- Path **strength** attenuates too: model each edge's `conductance ∈ (0,1]` by type (ownership transmits control strongly; co-attendance ≈ 0), and `path_strength = Π conductance_e`. Influence flows but dilutes.

### 5.2 Parallel (independent corroboration) → noisy-OR → **compounds**
Two independent routes between A and B, confidences `p1, p2`:
```
combined_confidence = 1 − (1 − p1)(1 − p2)
```
Multiple independent corroborating paths push confidence *above* any single route. This is the rigorous version of "more connections = stronger" — it's corroboration, not line-count.

### 5.3 Aggregate connection score
Between any A and B: enumerate paths up to length `k`, keep top-N by score, then
```
path_score   = (Π edge_confidence) · (Π conductance) · α^(len−1)   # α = per-hop damping
overall_conf = noisy_OR over independent paths
overall_strength = 1 − Π(1 − path_strength)   # saturating
```

### 5.4 Worked example — the shell chain
```
UKPerson —[co-director; conf .70, cond .50]→ ShellCo(BVI)
ShellCo  —[owns (leak);  conf .60, cond .90]→ Asset
```
Single-path inference "UKPerson ↔ Asset": conf ≈ .70 × .60 = **.42** (a strong *lead*, not a fact).
Now a second, independent route appears (shared address + a press report), conf .50:
```
combined = 1 − (1 − .42)(1 − .50) = .71
```
Decay and corroboration, both visible, both honest. Render the .42 single chain **dotted**; the corroborated .71 **solid**. That *is* your confidence slider, extended to chained inference.

### 5.5 Going deeper (the end-state)
The whole graph is a probabilistic model. The principled frameworks for "logical rules under uncertainty" are **Probabilistic Soft Logic (PSL)** and **Markov Logic Networks (MLN)** — they let you encode rules like `owns(X,Y) ∧ owns(Y,Z) ⇒ controls(X,Z)` *with* confidences, and infer globally via belief propagation. Start with bounded weighted path-enumeration (explainable, tractable); graduate to PSL/MLN when you want global, rule-driven inference.

---

## 6. Calibration (what makes a number mean something)
A "70%" must be right ~70% of the time, or it's theatre.
- Build a **gold set**: a few thousand hand-labelled resolved/not-resolved pairs and true/false edges.
- Fit `m`/`u` from it; fit a **calibration curve** (Platt scaling or isotonic regression) mapping raw scores → calibrated probabilities; check with a reliability diagram.
- Set thresholds to hit a **target precision** on the gold set.
Calibration is rarely done by amateurs — it's a visible credibility differentiator.

---

## 7. Inference rules & motifs (the "read between the lines" engine)
Derive new, attenuated edges and flags via graph-pattern queries (Cypher) or PSL rules:
- **Transitive control**: `owns(A,B,≥thresh) ∧ owns(B,C) ⇒ controls(A,C)` (attenuated conf).
- **Common control**: `controls(X,A) ∧ controls(X,B) ⇒ related(A,B)`.
- **Conflict-of-interest motif** (a *flag*, with sources, never a verdict): official `P` on committee for sector `S`, donation `D→P`, `D` controls company `C`, `sector(C)=S`, `C` holds a contract from the department `S` oversees. Composite confidence = combination of the constituent edges.

---

## 8. Ranking & surfacing (usefulness, not noise)
The graph has millions of links; most are innocent. Surface by *interestingness*:
- **Centrality**: confidence-weighted PageRank / betweenness → brokers and fixers.
- **Anomaly / change**: a new edge (from the Companies House streaming feed) that *closes* a motif → alert.
- **Scrutiny score** = pattern_strength × confidence × public-interest weight (public office + public money). Framed as "merits a look," with the receipts attached.

---

## 9. The flywheel (why the moat compounds)
Every analyst confirm/reject on an ambiguous merge becomes new training data → resolution improves → the next merge is better. Over time you accumulate a **human-verified, confidence-scored resolution graph** that:
- nobody else has (the raw inputs are public; the *resolved* graph is yours),
- improves with every use (data network effect),
- is the thing competitors can't copy by hitting the same APIs.

**That triad — calibrated resolution, honest propagation, compounding verified graph — is the moat.**

---

## 10. Where Claude fits (precisely)
- **Extraction**: messy unstructured sources (PDF hospitality logs, prose declarations) → structured statements.
- **Blocking**: optional embedding of entity descriptions for candidate generation.
- **Adjudication**: the ambiguous resolution band only — structured judgement + rationale, *combined* with the statistical score, then calibrated.
- **Explanation**: turn a path or flag into sourced, neutral plain English on demand.
- **Not**: the source of truth; unanchored probabilities; processing millions of rows.

---

## 11. Build order
1. One jurisdiction graph (Companies House + Electoral Commission + Parliament interests), provenance-first schema.
2. Fellegi–Sunter resolution with rarity weighting + a gold set + calibration. **Get this right before anything else.**
3. Confidence/strength on edges; bounded path propagation (serial multiply + noisy-OR).
4. Streaming ingest → motif alerts.
5. Collective (graph-aware) resolution pass.
6. Cross-border sources (Offshore Leaks, Aleph, OpenCorporates, GLEIF) bridged via §4 + the "footprint" routes (open-system touchpoints, shared fingerprints).
7. PSL/MLN for global rule-driven inference.

---

### The moat, in one line
> Anyone can fetch the dots. Almost nobody can resolve who's who across borders, propagate confidence honestly down the chain, and prove every link — and the graph that does it gets better every day it runs.
