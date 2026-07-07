-- ORRERY -- The Front Page, Wave A leads tables: dotted, disclaimed, never merged, never a
-- finding or a statement (CLAUDE.md THE LINE). Idempotent: a prior attempt at this task may have
-- partially applied this DDL, so every statement here is safe to re-run.
--
-- overseas_leads -- the Harborne-shaped case: an EC donor (person, >= GBP 250,000 total declared)
-- whose exact name-key matches a DIFFERENT Companies House officer registered as resident
-- overseas. Same name is not identification. Rebuilt wholesale by graph/findings_v1.sql
-- (recompute build).
--
-- offshore_leads -- ICIJ Offshore Leaks bulk-data name matches, companies only, exact normalised
-- name match. Rebuilt (delete + insert) by the standalone, best-effort
-- ingestion/icij_leads.py -- not part of recompute build.
--
-- Both reference canonical_entities, so both must be included in resolve_v3.sql's initial
-- truncate list (a plain TRUNCATE errors if another table still references the table being
-- truncated, regardless of the ON DELETE action) -- the same pattern entity_insights already
-- uses, and resolve_v3.sql has been updated accordingly.
--
-- RLS: locked down, then a public SELECT-only policy, mirroring 20260707120000_insights_tables.sql
-- exactly. Only the pipeline (service role) ever writes.

create table if not exists public.overseas_leads (
  id              text primary key,                     -- stable hash of donor + officer entity ids
  donor_entity_id uuid not null references public.canonical_entities(id) on delete cascade,
  donor_name      text not null,
  officer_name    text not null,
  country         text not null,                          -- the officer's Companies House residence
  amount_gbp      numeric,                                 -- the donor's largest single donation, context only
  recipient       text,                                    -- that donation's recipient, context only
  computed_at     timestamptz not null default now()
);
comment on table public.overseas_leads is
  'Dotted, disclaimed lead: an EC donor whose exact name-key matches a DIFFERENT Companies House officer registered overseas. Names can coincide -- never a merge, never a finding, never a statement. Recomputed wholesale by graph/findings_v1.sql.';
create index if not exists overseas_leads_donor_idx on public.overseas_leads (donor_entity_id);

create table if not exists public.offshore_leads (
  id                text primary key,                      -- stable hash of entity id + ICIJ node id
  entity_id         uuid not null references public.canonical_entities(id) on delete cascade,
  icij_name         text not null,
  icij_jurisdiction text,
  source_leak       text,                                   -- e.g. Panama Papers, Pandora Papers
  icij_node_id      text,
  icij_url          text,
  matched_at        timestamptz not null default now()
);
comment on table public.offshore_leads is
  'Dotted, disclaimed lead: an ICIJ Offshore Leaks entity whose exact normalised name matches one of OUR canonical companies. Companies only -- names can coincide -- never a merge, never a finding. Recomputed (delete + insert) by the standalone ingestion/icij_leads.py.';
create index if not exists offshore_leads_entity_idx on public.offshore_leads (entity_id);

alter table public.overseas_leads enable row level security;
alter table public.offshore_leads enable row level security;

drop policy if exists "public read" on public.overseas_leads;
drop policy if exists "public read" on public.offshore_leads;

create policy "public read" on public.overseas_leads for select to anon, authenticated using (true);
create policy "public read" on public.offshore_leads for select to anon, authenticated using (true);
