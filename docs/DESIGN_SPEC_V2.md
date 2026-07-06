# ORRERY v2: The Discovery Engine

> Direction (Fable, round two): ORRERY stops being a reference work you consult and becomes "a
> register that deals." Materialise every unusual, fully-sourced structural pattern as a discrete
> **finding**, score by **surprise**, and deal a different hand to every visitor every visit. The
> serendipity is in the SAMPLING ORDER, never the facts. Every card is a template over sourced
> statements, confidence-stamped, register-linked. 1M users uncover 1M different true things.
> Builds on v1 ("The Register" tokens/fonts/icons in DESIGN_SPEC.md). Facts not verdicts, British
> English, ZERO em-dashes.

**Signature moment:** the landing deals one finding as a mini ORRERY (member entities as bodies on
concentric register-rings around a centre, type-coloured, BRASS centre) under a Newsreader headline.
"Deal another" deals a different true thing. "Find your MP" = personal entry. The name means
something on screen.

## Two grounded diagnoses
1. **Strength gauge is broken.** edges_v2 strength = type_weight x recency x duration x magnitude.
   Duration `1-exp(-years/5)` gives ~0.35 for typical tenures and DEFAULTS 0.5 when valid_from null.
   For point events (donations, contracts) valid_to is null so the term reads the event's AGE, not
   tenure: a recent £5m donation scores ~0 (band 1). Distribution: 57% land band 2/4. DEMOTE the
   per-row gauge entirely; show the concrete fact instead (see Strength decision).
2. **Missing rarity term.** The engine spec's strength includes RARITY (IDF/PMI, the anti-hairball
   term); edges_v2 never computes it. That absent term IS the surprise signal. Computing it is the
   discovery engine.

## Step 1: the findings pool (pipeline: `findings_v1.sql` + migration + recompute wiring)
Materialise a `findings` table (recomputable, RLS anon-read like other read tables) after
edges/scrutiny/motifs in `recompute build`. Row: stable id (hash of shape code + sorted member
entity ids), shape_code, member_entity_ids[], member_statement_ids[], template slot values
(names/£/counts/years as jsonb), surprise components (rarity, corroboration, money, shape_weight,
surprise), min_confidence, computed_at.

**Finding shapes** (SQL motifs over existing statements; all provable in current data):
| shape_code | definition | real instance |
|---|---|---|
| LOOP_CLOSED | company with DONATED_TO->party AND CONTRACTED_WITH from public bodies | Ecotricity |
| SHARED_BENCH | one company tied to N>=3 parliamentarians across registers | GB News (5) |
| FAMILY_DESK | two parliamentarians (or MP+officer) linked through one company, shared surname | IPGL: Spencers |
| BIG_MONEY | donation in top decile by £ | Phoenix £5m to Cons |
| SECTOR_OVERLAP | motifs_v2 conflict: committee remit overlaps declared interest sector | Amos (housing) |
| QUIET_PORTFOLIO | peer/MP with declared directorships >= K, ranked by how few other registers mention them | heavy Lords directorships |
| CROSSING | entity appearing in 3+ distinct registers | Ecotricity, Dale Vince |
| NEW_ON_REGISTER | statement with valid_from within 30 days | rolling |

**Surprise score** (per finding, transparent, each component printable as a "why" line):
- `idf(entity) = 1/log2(2+degree)`, exclude party/government_body hubs (as motifs_v2/dedupe_v1 do).
- `rarity = geometric mean of idf over non-hub members`.
- `corroboration_lift = 1 + 0.5*(distinct registers among member statements - 1)`.
- `money = min(1, log10(1+total£)/6)`.
- `shape_weight`: LOOP 1.0, FAMILY 0.9, SECTOR 0.85, SHARED_BENCH 0.8, QUIET 0.75, CROSSING 0.7, BIG_MONEY 0.6, NEW 0.5.
- `surprise = shape_weight * (0.4 + 0.6*rarity) * corroboration_lift * (0.5 + 0.5*money)`; recency tiebreak.
- **Confidence gate (non-negotiable):** min member-edge confidence >= 0.80 to be dealt as a fact.
  0.50-0.79 -> a separate "Leads" shelf (dashed, "a prompt to look" caption). <0.50 never surfaced.
- Each card prints its justification: `WHY THIS SURFACED · crosses 3 registers · £1.0m · one of 2 companies on both the donor and contract lists`.

Also materialise a **suggested-pairs** table for Connect: endpoint pairs from different registers,
path length 2-4, min confidence >=80, at least one money edge, low endpoint degree, dedup by path overlap.

## Step 2: Home = the Deal
Masthead keeps The Register spine (left, flat INK_0, Newsreader headline "Who funds whom in British
politics, with receipts."). Right column = the dealt hand: a hero finding card rendered as a mini
orrery SVG + Newsreader headline + shape stamp + confidence stamp + register stamps; `Deal another`
button (200ms slide+settle). Below: 3 smaller text-only finding cards (headline + stamps). Under the
search: `Find your MP` first-class typeahead (constituency/MP names, client-side). `START WITH`
chips (real entities, name-resolved, hide if absent) + a worked Connect chip. Credibility strip:
"{n} entities · 6 public registers · {n} findings · every link cites its source". Below: "From the
ledger" top-6 teaser -> "See all findings". Board of 3 columns MOVES to the Findings page.

## The Deal sampler (client, deterministic-safe)
localStorage visitorId UUID; `seed = hash(visitorId + ISO date + drawCount)`. Order findings by
surprise desc. Slot 1 = uniform from top 10 (guaranteed wow). Slots 2-4 = weighted sample without
replacement, weight `exp(-rank/25)`. Diversity: no two cards share shape or member entity. No
repeats within session. "Deal another" increments drawCount, reseeds. Same finding can LEAD with a
different member entity by seed. All rendered from `findings` rows via fixed per-shape templates.

## Step 3: Tie Row v2 (strength gauge OUT, fact lines IN)
Remove the 4-segment gauge from every row (Tie Row, Connect hops, Explore inspector). Show the
concrete fact per tie type: Donation -> "£5,000,000 · March 2024"; Directorship/PSC -> "Director
since 2013 · current" / "Resigned 2019"; Contract -> "£{x} · {buyer} · 2024"; Interest -> declared
category + date; Membership/role -> role + since-year. Plus a **rarity note** (caption) ONLY when
the edge is top-decile rarity for its type ("the only donor in this list that also holds public
contracts"). Confidence stamp/tier UNCHANGED (that axis works). Dossier connections default sort =
Rarity (unusual first), with Confidence / Amount alternatives; ego-graph ranks neighbours by rarity.

## Step 4: Connect = the hero act (fix the drag-feel; the Reveal)
Connect is a PAGE, never a bottom sheet, nothing anchored to viewport bottom. Pickers top, side by
side; beneath, 3 suggested surprising pairs (from the suggested-pairs table, seeded sample). The
chain is the vertical evidence list that DRAWS: node pill appears, rail draws down 240ms, register
stamp settles 120ms, next pill; weakest link pulses once + takes a "WEAKEST LINK 72%" tag; summary
counts steps (<1.5s for 4 hops). reduced-motion -> instant complete chain. Route mini-graph to the
side (desktop) / below (mobile), static. No-path keeps honest copy + "Search again including weaker links".

## Step 5: Explore = constellation (de-hairball, performant, coherent nav)
Never render 5,903 nodes. Persistent header on Explore (canvas = calc(100vh-56px)), breadcrumb
"Findings > Full network", no floating escape button, no bottom sheet.
- Default (Constellation): union(all finding-member entities, endpoints of top 25 donations, top 50
  by degree), cap 300; edges = finding-member edges + conf>=50 among included, cap 900; finding
  members get a faint BRASS ring.
- Focus (search/click): focus + 2 hops ranked by rarity x strength-percentile, cap 150; others
  REMOVED not dimmed. Widen 1->2->3. Honesty chip "SHOWING 300 OF 5,903 ... FOCUS A NAME TO GO DEEPER".
- Lens (from Collections): precomputed node-set queries (e.g. "Labour's donor network").
- Performance: <=300 nodes / <=900 edges always; ~60 warmup ticks headless, <=90 cooldown then HARD
  FREEZE (no endless sim); cache layout per node-set hash in sessionStorage. Labels at k>1.4 or
  degree>=8 or finding-member. Inspector = docked right panel (desktop) / full-screen push (mobile),
  Tie Row grammar, "Open full dossier".

## Step 6: Findings ledger + Finding page + the Cutting + Collections
- Findings page = single ranked ledger (by surprise) with filter rail (shape/party/register/sort),
  each row = rank + shape stamp + one-line headline + confidence stamp + register count, expands to
  mini orrery + member chips + why line, click -> finding page.
- NEW Finding page (`#finding={id}`): full-size orrery + headline + THE EVIDENCE (member statements
  as Tie Rows with register links) + WHY THIS SURFACED + actions.
- THE CUTTING: "Copy as cutting" renders the card (orrery + headline + stamps + "orrery · drawn from
  the register on {date}") to a canvas image for sharing, in The Register typography. Pure client-side.
- Collections: curated shape-filters with editorial titles ("The Contract Loop", "The Media Bench",
  "Family Business", "The GBP 5m Club", "The Quiet Peers"), open the ledger pre-filtered + a themed
  Explore lens. Leads shelf: sub-80% material, dashed, segregated.

## Step 7: New on the register + first-run trail
- "New on the register": strip on Home + Ledger filter, statements with valid_from in last 30 days.
- First-run trail (localStorage flag, skippable, never modal-trapped): one-line invite under hero
  "See how one company closed the loop: follow the Ecotricity trail" -> Ecotricity finding page ->
  Connect prefilled Ecotricity->Cabinet Office, 2 caption coach-marks. 90s, teaches the grammar.

## Strength decision (summary)
Demote the per-tie gauge entirely. Show type-specific facts + rarity notes (above). Recalibrate
UNDER THE HOOD later (`edges_v3.sql`): split formula by category (events: magnitude x recency
`exp(-age/3yr)`, NO duration term; tenures: type_weight x duration x currency), add the rarity
multiplier (endpoint IDF + type-pair PMI), percentile-normalise within statement_type (store the
percentile). Percentile used for ranking/sort/focus/surprise; DISPLAYED only in the sort control,
never a per-row gauge. Confidence stamp/tier unchanged.

## Navigation model
One sticky header on EVERY view incl Explore (wordmark->Home; tabs Findings/Connect/Explore, active
= 2px BRASS underline; search; Help). Breadcrumb row under header on non-Home views (ancestors
clickable). Everything is a URL (#finding=, #entity=, #connect=a,b,thresh, #explore=focus:id,hops:2,
#lens=). document.title per view. Cross-link lattice: finding -> member dossiers -> Connect prefilled
-> hop pills -> dossiers -> "See it on the map" (Explore focused) -> inspector -> full dossier. No dead ends.

## Wow moments (motion 2/5, only on the DRAWING OF EVIDENCE, reduced-motion = instant final state)
1. The Deal: hero card 200ms slide+settle, shape stamp lands 80ms after (a hand stamp).
2. The Reveal (Connect): receipt-printing chain; rails draw 240ms/hop; weakest link pulses once + tag.
3. The Loop closes (LOOP finding pages + first-run): orrery draws the donation arc + contract arc,
   the ring completes at the company with a 400ms BRASS glow. The geometry IS the finding.
4. Constellation assembles (Explore entry): nodes fade in by priority over 600ms, then freeze.
5. Counters tick up once on first paint (500ms), never again.
6. The Cutting: border flashes BRASS 150ms as the image lands on the clipboard.

## Implementation priority
1. findings_v1.sql + table + read policy + suggested-pairs (pipeline). Foundation.
2. Home: the Deal (mini-orrery SVG, seeded sampler, Deal another, Find your MP, ledger teaser).
3. Tie Row v2 (gauge out, fact lines in).
4. Connect hero + Reveal + suggested pairs.
5. Explore triage (constellation, focus, docked inspector, persistent header + breadcrumbs).
6. Findings ledger + finding page + Cutting + Collections.
7. First-run Ecotricity trail + New on the register.
8. edges_v3.sql (category-split strength, rarity term, percentile normalisation).
