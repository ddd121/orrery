# ORRERY Design System: "The Register"

> Direction (Fable, 2026-07-03): ORRERY should feel like a well-typeset public record with an
> editorial spine. A reference work you could cite, not a startup, not a dashboard. Credibility is
> the product, so the interface should look like it was typeset by people who verify things:
> broadsheet serif used sparingly, civic body type, monospaced audited figures, squared stamps
> instead of pills, rules instead of boxes, colour only where the data earns it.

**Design read:** citable evidence instrument for investigative journalists + researchers, public-record
language, editorial-archival. Dials: VARIANCE 2/5, MOTION 1/5 (150-200ms opacity fades only; reduced
motion removes them), DENSITY 4/5.

**Architecture:** KEEP inline-style tokens (no Tailwind migration). Restructure `web/lib/graph-utils.ts`
tokens, add ~40 lines to `globals.css`, add `web/app/components/Text.jsx` (six text components) and
`web/app/components/TieRow.jsx` (the confidence/strength row).

**Hard rules:** zero em-dashes (`—`) or en-dash separators (`–`) in UI copy (use `.`, `,`, `:`, `()`,
`-`, or `·`); Phosphor icons only (`@phosphor-icons/react`, weight `regular`), lucide removed; one accent
(BRASS); one radius scale; WCAG AA; dark-theme-locked; responsive to 375px.

## Tokens (paste into graph-utils.ts; keep legacy aliases GOLD/VERM/TEXT/MUTE/HAIR/PANEL/BG/MONO/SANS)

```
INK_0 #0A0E16 (page bg, flat)  INK_1 #101624 (surface)  INK_2 #161D2E (raised)
HAIRLINE rgba(154,167,199,0.16)  HAIRLINE_STRONG rgba(154,167,199,0.30)
TEXT_1 #EDF1FA  TEXT_2 #A9B2C8  TEXT_3 #7C86A2 (AA floor, never below)
BRASS #D9A648 (the only "interactive/selected" colour)  BRASS_SOFT rgba(217,166,72,0.12)
SIGNAL #E06A50 (semantic: conflict / lead / confidence <50)  SIGNAL_SOFT rgba(224,106,80,0.10)
POSITIVE #63B98B (semantic: Established confidence >=80)
SHADOW_OVERLAY 0 16px 48px rgba(3,6,12,0.55) (overlays only)  PAGE_BG linear-gradient(180deg,#0C1120 0%,#0A0E16 320px)
TYPE_COLORS: mp/minister/peer #E2C07C · person/donor #D492B6 · company #6FBFB2 · party #9D97E0
  · department #7FA9DE · appg #A9C47F · lobbyist #C9855E
SPACE {xs4 sm8 md12 lg16 xl24 xxl32 section48}   RADIUS {xs4 sm8 md12 full999}
```
Radius map: stamps/badges 4 (squared), buttons/inputs/chips 8, cards/panels/modals 12, dots full.
Elevation = borders not shadows (flat INK_1 + 1px HAIRLINE); shadow only on floating layers.

## Typography (next/font/google in layout.tsx -> CSS vars)
- Display: **Newsreader** (weights 500-600 only, italic ok). Used ONLY in `display` + `title1`
  (hero headline, dossier entity name, Connect page title). `var(--font-display)`.
- Body/UI: **Public Sans** (400/500/600/700). Everything interactive/structural. `var(--font-sans)`.
- Data: **Spline Sans Mono** (400/500/600). Every figure, %, company number, register name, stamp. `var(--font-mono)`.

TYPO scale (fontFamily, px, weight, lineHeight, letterSpacing):
```
display  DISPLAY clamp(28,4.5vw,38) 600 1.15 -0.01em
title1   DISPLAY clamp(22,3.5vw,27) 600 1.2  -0.005em
title2   SANS 17 700 1.3
title3   SANS 14.5 600 1.35
body     SANS 14 400 1.6
bodySm   SANS 13 400 1.55
caption  SANS 12 400 1.5 (TEXT_2)
eyebrow  MONO 11 500 1 .14em UPPER (TEXT_2)   [budget: max 1 per view region]
dataLabel MONO 10.5 500 1 .08em UPPER (TEXT_3)
dataValue MONO 13 500 1.2 tabular-nums
```

## Icons (Phosphor, regular weight; size 16 default, 14 dense, 20 header)
Types: MP/Minister/Peer=IdentificationBadge · Person/Donor=User · Company=Buildings · Party=FlagBanner
· Department=Bank · APPG=UsersThree · Lobbyist=Megaphone.
Actions: Search=MagnifyingGlass · Connect=Path · Explore=Graph · Back=ArrowLeft · crumb sep=CaretRight
· conflict/merits-a-look=WarningDiamond · established=SealCheck · source/provenance=ArchiveBox
· external link=ArrowSquareOut · donation=CurrencyGbp · contract=FileText · copy/copied=LinkSimple/Check
· help=BookOpenText · filter=FunnelSimple · threshold=SlidersHorizontal · reset=ArrowCounterClockwise
· close/info=X/Info · most connected=ListNumbers.

## The Tie Row (the key fix: confidence vs strength, two grammars, both labelled)
Confidence = epistemic -> named TIER + exact % in a squared stamp. Strength = material -> discrete
4-segment gauge + word (never a %, never a smooth/filled bar).
- Confidence tiers: ESTABLISHED >=80% (POSITIVE, solid rail), PROBABLE 50-79% (BRASS, solid rail),
  LEAD <50% (SIGNAL, DASHED rail). Row has a 2px left rail, solid vs dashed by tier (mirrors graph edges).
- Strength segments: 1 Weak(<.25) 2 Moderate(.25-.49) 3 Strong(.50-.74) 4 Core(>=.75). 12x5px rects,
  radius 1, 1px HAIRLINE border, filled = TEXT_2 (neutral data-ink, NOT accent).
Row anatomy:
  L1: type glyph (type colour) + name (title3, truncate) + right: confidence stamp "ESTABLISHED · 97%".
  L2: fact in bodySm TEXT_2: relationship + amount (dataValue BRASS if present) + counterpart role. `·` seps.
  L3 metrics line (dataLabel labels in TEXT_3): `CONFIDENCE 97%` (dataValue tier colour) ·
     `STRENGTH ▰▰▰▱ Strong` (gauge + word bodySm TEXT_2) · `VIA {register}` (dataValue TEXT_2 + ArrowSquareOut if url).
  <420px: stamp drops tier word (shows % only, colour still encodes), metrics wrap to 2 rows, labels never drop.
Section legend once above first group (caption): "Confidence is how sure we are a link is real and
correctly identified. Strength is how much the tie matters once it is real. The two are independent:
a certain link can be trivial, and a strong tie can be uncertain."
Same grammar in Dossier rows, Connect hops, Explore inspector, ConfidenceLegend.

## Navigation & IA
- Header (sticky, keep blur): brand + wordmark; primary nav = three TEXT tabs "Findings / Connect /
  Explore" (glyph + label, active = TEXT_1 + 2px BRASS underline, inactive TEXT_2; labels never hide,
  search collapses to icon <560px); right: search (320px) + Help (BookOpenText). Drop header tagline.
- Explore no longer renders bare: header persists on every view (canvas = calc(100vh-56px)); delete the
  floating "Findings" escape button (the header is the way back).
- Breadcrumb row under header on non-Home views (caption, `›` sep, ancestors clickable):
  Dossier "Findings › Dossier › {Name}"; Connect "Findings › Connection[ › {A} to {B}]"; Explore
  "Findings › Full network". Set document.title per view ("{Name} · ORRERY").
- Text.jsx: PageTitle(title1, one/view) · SectionHeader(title2 + optional mono count) · Eyebrow(max 1
  per region) · Body · Caption · DataLabel. Headings sit on a bottom hairline rule (structure via rules,
  not boxes). Prose >2 lines -> label + short text pairs, not stacked bold-lead paragraphs.

## First-run (Home masthead)
Delete the animated ForceGraph backdrop + scrim. Left-aligned masthead on flat INK_0, max-width 1080:
- one eyebrow "A public-record map of UK political influence"; headline (display) "Who funds whom in
  British politics, with receipts."; subhead (body TEXT_2); search input.
- START WITH chips (name-resolved against loaded nodes, hide if absent): Ecotricity Group Limited, IPGL
  Limited, GB News, Lord Spencer/Michael Spencer, Dale Vince, largest resolved donor (Phoenix £5M Cons).
  Chip = radius 8, HAIRLINE border, type glyph + name, hover border BRASS. Last chip = worked Connect
  example "How is Dale Vince connected to the Labour Party?" (opens Connect prefilled).
- MOST CONNECTED panel: top 10 by degree (already in loadGraph), rank (dataValue) + name + mono count,
  each row -> dossier. Stacks below chips on mobile.
- Only decoration: static (no motion) orrery-ring SVG at 6% opacity behind the right column.
- caption link under chips: "How to read the confidence and strength figures" -> HelpSheet.

## Per-view
- Home board: keep 3 computed-lead columns (Conflicts of interest [WarningDiamond] / Where interests
  converge [Buildings] / The money behind the parties [CurrencyGbp]). Card = INK_1 + HAIRLINE + radius 12
  + 2px left rail in semantic colour (SIGNAL / teal / BRASS). KILL tinted card backgrounds. Stamps for
  MERITS A LOOK / STRONG SIGNAL / DONOR + PUBLIC CONTRACTS. People chips use type glyph not dots.
- Dossier: name = PageTitle (Newsreader); type stamp + role + company No. (dataValue, CH link). Conflict
  banner = INK_1 + 2px SIGNAL rail + WarningDiamond + stamps. Connections: SectionHeader + mono count +
  the legend + groups (rule-line group headers "Director of ——— 14"); rows = Tie Row; groups >8 collapse
  behind "Show all 14". Sort toggle (dataLabel) STRENGTH/CONFIDENCE/AMOUNT. Keep ego-graph + 3 actions
  restyled ("Open the full map" / "Trace a path from here" / "Copy link to this dossier").
- Connect: keep pickers + threshold (relabel MINIMUM CONFIDENCE). Chain = VERTICAL evidence list (all
  breakpoints): node pill (glyph+name title3) then connector card (condensed Tie Row grammar) with
  solid/dashed rail by tier. Summary "3 steps · weakest link 72% · via ...". Keep route mini-graph + no-path recovery.
- Explore (focus-first, never render all 6k): default = union(top 150 by degree, all conflict nodes,
  endpoints of top 25 donations), cap 300, edges conf>=50. Search/click -> neighbourhood mode: focus + 2
  hops, cap 150 by strength, others REMOVED (not dimmed). Honesty chip bottom-left "SHOWING 300 OF 6,012
  ENTITIES · FOCUS A NAME TO GO DEEPER" / "SHOWING {N} WITHIN 2 STEPS OF {NAME}" + Widen (1->2->3). Labels
  only when zoom k>1.4 or degree>=8. Keep threshold/type filters/trace/inspector (rows adopt Tie Row grammar).

## Copy (British English, zero em/en dashes; `·` ok)
- Hero: "Who funds whom in British politics, with receipts." Subhead: "Every connection between public
  figures, companies and political money is drawn from a public register, and carries its source and an
  honest confidence score."
- Credibility strip: "{n} entities · 6 public registers · {n} findings · every link cites its source" (real counts).
- Merits-a-look caption: "A structural overlap drawn from public records. It is a prompt to look, not an allegation."
- Confidence def: "Confidence is how sure we are a link is real and correctly identified. A shared
  Companies House number is near-certain; a name-only match is weaker, and is shown as such."
- Strength def: "Strength is how much a tie matters once it is real: the kind of tie, its size, how recent it is, and how unusual."
- Tiers: "Established, 80% and above · Probable, 50 to 79% · Lead, below 50%".
- No path (threshold): "No route found at 40% confidence. A path may exist through weaker links." Button
  "Search again including weaker links". No path (zero): "There is no route between {A} and {B} in any
  register we hold. That can change as sources are added."
- Explore loading: "LOADING THE REGISTER GRAPH". Buttons: "Open the full map" / "Trace a path from here" / "Copy link to this dossier".
- HelpSheet source list: replace every em-dash with a colon ("Companies House: directors, shareholders and persons with significant control.").

## Implementation order (each ships value)
1. Tokens + fonts + globals (re-skins whole app via legacy aliases).
2. Phosphor swap (remap ICONS/TYPE in graph-utils; replace lucide across the 6 files; remove lucide).
3. TieRow.jsx + legend (EntityView, Explore inspector, ConfidenceLegend).
4. Navigation (header tabs, persistent-over-Explore, breadcrumb row, document.title, Text.jsx, eyebrow cull).
5. First-run Home (delete backdrop, masthead, START WITH chips, MOST CONNECTED, card restyle no washes).
6. Connect vertical chain + Explore triage.
7. Copy audit (table above + dash grep; 375px pass every view).
