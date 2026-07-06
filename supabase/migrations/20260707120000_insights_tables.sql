-- ORRERY v2 — the takeaway engine (Value Everywhere, Wave 1). Two comparative-context tables:
-- entity_insights (per-entity computed takeaways, the "so what" for any click) and register_stats
-- (global landing-page numbers). Both are recomputable — rebuilt wholesale by
-- pipeline/orrery_pipeline/graph/insights_v1.sql, run after findings_v1.sql in recompute build —
-- so this migration only creates the shape and read policy, it never seeds rows itself.
--
-- RLS: locked down by default, then a public SELECT-only policy is added, mirroring exactly the
-- pattern in 20260706120000_findings_tables.sql. Only the pipeline (service role) ever writes.

create table public.entity_insights (
  id            text primary key,                    -- stable hash of kind + entity_id (+ set discriminator)
  entity_id     uuid not null references public.canonical_entities(id) on delete cascade,
  kind          text not null,                        -- RANK_MONEY_GIVEN, RANK_MONEY_RECEIVED, RANK_PORTFOLIO,
                                                        -- ONLY_N, BRIDGE, NEAREST_NOTABLE, BASIC
  priority      numeric(8,4) not null,                 -- UI takes the top rows per entity by this
  rank          int,                                   -- rank within cohort, where applicable
  cohort_size   int,                                    -- size of the named comparison cohort
  slots         jsonb not null default '{}'::jsonb,     -- template values the UI renders directly
  computed_at   timestamptz not null default now()
);
comment on table public.entity_insights is
  'Per-entity comparative takeaway (DESIGN_SPEC_V2 Value Everywhere, Wave 1). Recomputable by insights_v1.sql; never hand-edited. Every canonical entity has at least one row (the NEAREST_NOTABLE/BASIC floor) so no click ever returns an empty takeaway.';
create index entity_insights_entity_idx on public.entity_insights (entity_id);
create index entity_insights_kind_idx on public.entity_insights (kind);
create index entity_insights_priority_idx on public.entity_insights (priority desc);

create table public.register_stats (
  stat          text primary key,                      -- total_political_money, largest_single_donation, …
  value_numeric numeric,                                -- the headline number, where the stat is a single scalar
  slots         jsonb not null default '{}'::jsonb,      -- formatted string + supporting detail for the UI
  computed_at   timestamptz not null default now()
);
comment on table public.register_stats is
  'Global landing-page numbers (DESIGN_SPEC_V2 Value Everywhere, Wave 1 "the state of the register" strip). Recomputable by insights_v1.sql.';

alter table public.entity_insights enable row level security;
alter table public.register_stats  enable row level security;

create policy "public read" on public.entity_insights for select to anon, authenticated using (true);
create policy "public read" on public.register_stats  for select to anon, authenticated using (true);
