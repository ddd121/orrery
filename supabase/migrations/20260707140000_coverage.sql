-- ORRERY -- The Front Page, Wave B: news corroboration. "In the news" panels read recent coverage
-- mentioning an entity's name (GDELT DOC 2.0, quoted exact-name search, keyless). Framing is
-- name-mention only -- a headline appearing here is never asserted as being about our entity; it
-- is a link the reader (or journalist) checks for themselves. Idempotent: safe to re-run.
--
-- References canonical_entities, so it is included in resolve_v3.sql's initial truncate list (see
-- 20260707130000_overseas_offshore_leads.sql for why that is necessary).
--
-- RLS: locked down, then a public SELECT-only policy, mirroring 20260707120000_insights_tables.sql
-- exactly. Only the pipeline (service role) ever writes.

create table if not exists public.coverage (
  id          text primary key,                          -- stable hash of entity id + article url
  entity_id   uuid not null references public.canonical_entities(id) on delete cascade,
  title       text not null,
  domain      text,
  url         text not null,
  seendate    text,
  fetched_at  timestamptz not null default now()
);
comment on table public.coverage is
  'Recent news coverage mentioning an entity name (GDELT DOC 2.0, quoted exact-name search, keyless, ~3-month window). Name-mention only, never asserted as about our entity. Recomputed wholesale (truncate + insert) by the standalone, best-effort ingestion/news_coverage.py, run at the end of recompute build.';
create index if not exists coverage_entity_idx on public.coverage (entity_id);

alter table public.coverage enable row level security;
drop policy if exists "public read" on public.coverage;
create policy "public read" on public.coverage for select to anon, authenticated using (true);
