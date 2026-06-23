-- ORRERY — public read path (Milestone 5).
--
-- Until now every table had RLS enabled with NO policies (locked to service-role only).
-- The app needs to read the resolved graph in the browser via the publishable/anon key,
-- so we add SELECT-only policies on exactly the tables the UI renders. This is the
-- "specific read path" CLAUDE.md reserves anon policies for. Everything is public-record,
-- public-interest data meant to be shown — but it's still read-only and scoped to the
-- presentation tables; the raw mention/resolution layers stay closed.

create policy "public read" on public.canonical_entities for select to anon, authenticated using (true);
create policy "public read" on public.statements          for select to anon, authenticated using (true);
create policy "public read" on public.statement_types     for select to anon, authenticated using (true);
create policy "public read" on public.entity_types        for select to anon, authenticated using (true);
create policy "public read" on public.sources             for select to anon, authenticated using (true);
create policy "public read" on public.source_documents    for select to anon, authenticated using (true);
