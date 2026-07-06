-- ORRERY v2 — the findings pool (docs/DESIGN_SPEC_V2.md "Step 1: the findings pool").
--
-- A "finding" is a materialised, sourced structural pattern over the resolved graph — a fact,
-- never a verdict — scored by "surprise" so the app can deal a different true thing to every
-- visitor. `suggested_pairs` is the companion table for the Connect "surprising pairs" feature.
-- Both are recomputable (rebuilt wholesale by pipeline/orrery_pipeline/graph/findings_v1.sql,
-- run after edges/scrutiny/motifs in `recompute build`), so this migration only creates the
-- shape and read policy — it never seeds rows itself.
--
-- RLS: locked down by default (per CLAUDE.md, every table gets RLS + no permissive policy until
-- a read path needs one), then a public SELECT-only policy is added, mirroring exactly the
-- pattern in 20260623181000_public_read_policies.sql for the other tables the app reads directly
-- via the anon key. Only the pipeline (service role) ever writes these tables.

create table public.findings (
  id                 text primary key,               -- stable hash of shape_code + sorted member entity ids
  shape_code         text not null,                   -- LOOP_CLOSED, SHARED_BENCH, FAMILY_DESK, …
  member_entity_ids  uuid[] not null,                  -- canonical_entities.id — the bodies in the mini orrery
  member_statement_ids uuid[] not null,                -- statements.id — the sourced evidence (Tie Rows)
  slots              jsonb not null default '{}'::jsonb, -- template values: names, £, counts, years
  rarity             numeric(6,4),                     -- geometric mean of member idf, excl. hubs
  corroboration      numeric(6,4),                      -- 1 + 0.5*(distinct registers - 1)
  money              numeric(6,4),                      -- min(1, log10(1+total £)/6)
  shape_weight       numeric(4,3),                      -- per-shape constant, engine-spec table
  surprise           numeric(8,4) not null,             -- the sampler's sort key
  min_confidence     numeric(5,4) not null,             -- min member-edge confidence — the libel gate
  is_lead            boolean not null default false,    -- true = 0.50-0.79 band, Leads shelf only, never a stated fact
  computed_at        timestamptz not null default now()
);
comment on table public.findings is
  'Materialised, sourced structural pattern over statements/canonical_entities (DESIGN_SPEC_V2 Step 1). Recomputable by findings_v1.sql; never hand-edited. min_confidence >= 0.80 for any row with is_lead = false — the confidence gate that keeps a finding a fact, not a verdict.';
create index findings_shape_idx on public.findings (shape_code);
create index findings_surprise_idx on public.findings (surprise desc);
create index findings_is_lead_idx on public.findings (is_lead);
create index findings_member_entity_ids_gin on public.findings using gin (member_entity_ids);

create table public.suggested_pairs (
  id             text primary key,                    -- stable hash of the sorted endpoint pair (+ path)
  from_entity_id uuid not null references public.canonical_entities(id) on delete cascade,
  to_entity_id   uuid not null references public.canonical_entities(id) on delete cascade,
  why            text not null,                        -- one-line, fact-only reason this pair is offered
  surprise       numeric(8,4) not null,
  computed_at    timestamptz not null default now()
);
comment on table public.suggested_pairs is
  'Endpoint pairs across registers worth tracing in Connect (DESIGN_SPEC_V2 Step 1 "suggested-pairs"). Recomputable by findings_v1.sql.';
create index suggested_pairs_from_idx on public.suggested_pairs (from_entity_id);
create index suggested_pairs_to_idx   on public.suggested_pairs (to_entity_id);

alter table public.findings        enable row level security;
alter table public.suggested_pairs enable row level security;

create policy "public read" on public.findings        for select to anon, authenticated using (true);
create policy "public read" on public.suggested_pairs for select to anon, authenticated using (true);
