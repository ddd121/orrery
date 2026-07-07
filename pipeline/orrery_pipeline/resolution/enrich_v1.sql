-- ORRERY -- jurisdiction/nationality enrichment v1 (The Front Page, Wave A.1). Runs after
-- dedupe_v1.sql and before edges_v2.sql in recompute build, over the canonical_entities set
-- resolve_v3 + dedupe_v1 just rebuilt. Pure deterministic rollup of mention raw_attributes
-- companies_house.py already captures (officers ~176-186, PSCs ~201-209): no new ingest, no new
-- person merging, no invented values.
--
-- jurisdiction (persons): the modal non-null country_of_residence across a persons ACTIVE
--   Companies House officer mentions. A person with no CH officer mention gets no jurisdiction at
--   all (stays null) -- an EC-only donor such as Christopher Harborne is NOT overseas-tagged this
--   way unless dedupe_v1 already merged their EC mention with a CH officer mention of the SAME
--   canonical entity (THE LINE: no new merging happens here, ever).
-- nationality (persons): the modal non-null nationality across the same ACTIVE CH officer
--   mentions.
-- jurisdiction (companies): GB when the canonical entity already carries a company_number
--   (resolve_v3 step 1 keys every CH-sourced company that way), otherwise the modal non-null
--   address->>country across its mentions (covers corporate PSC entities known only by a
--   registered address, e.g. an overseas holding company).
--
-- Light normalisation only: trim, then fold known UK synonyms (including the free-text "Uk"
-- casing CH data actually contains) onto the ISO code GB. No other value is ever rewritten or
-- invented.
--
-- Pure SQL, no dollar-quoted bodies, so recompute.py's statement splitter runs this faithfully.
-- Comments avoid semicolons and apostrophes so the naive split-on-';' never breaks mid-comment.

create temporary table tmp_gb_alias on commit drop as
select * from (values
  ('united kingdom'), ('england'), ('scotland'), ('wales'),
  ('northern ireland'), ('great britain'), ('uk')
) as t(alias);

-- ------------------------------------------------------------------------------------------------
-- Persons: country_of_residence and nationality, both counted over the same ACTIVE CH officer
-- mention set, one row per (entity, normalised value) with a count, then the top count per entity
-- wins (ties broken alphabetically for determinism).
-- ------------------------------------------------------------------------------------------------
create temporary table tmp_person_ctry_counts on commit drop as
select mr.canonical_entity_id as entity_id,
       case when lower(btrim(m.raw_attributes->>'country_of_residence')) in (select alias from tmp_gb_alias)
            then 'GB' else btrim(m.raw_attributes->>'country_of_residence') end as country,
       count(*) as n
from public.mentions m
join public.mention_resolutions mr on mr.mention_id = m.id and mr.is_active
join public.source_documents sd on sd.id = m.source_document_id and sd.source_code = 'companies_house'
where nullif(btrim(m.raw_attributes->>'country_of_residence'), '') is not null
group by mr.canonical_entity_id, 2;
create index on tmp_person_ctry_counts (entity_id);

create temporary table tmp_person_jurisdiction on commit drop as
select distinct on (entity_id) entity_id, country as jurisdiction
from tmp_person_ctry_counts
order by entity_id, n desc, country asc;

create temporary table tmp_person_nat_counts on commit drop as
select mr.canonical_entity_id as entity_id,
       btrim(m.raw_attributes->>'nationality') as nationality,
       count(*) as n
from public.mentions m
join public.mention_resolutions mr on mr.mention_id = m.id and mr.is_active
join public.source_documents sd on sd.id = m.source_document_id and sd.source_code = 'companies_house'
where nullif(btrim(m.raw_attributes->>'nationality'), '') is not null
group by mr.canonical_entity_id, 2;

create temporary table tmp_person_nationality on commit drop as
select distinct on (entity_id) entity_id, nationality
from tmp_person_nat_counts
order by entity_id, n desc, nationality asc;

update public.canonical_entities ce
set attributes = ce.attributes || jsonb_strip_nulls(jsonb_build_object(
      'jurisdiction', tpj.jurisdiction, 'nationality', tpn.nationality)),
    updated_at = now()
from public.canonical_entities base
left join tmp_person_jurisdiction tpj on tpj.entity_id = base.id
left join tmp_person_nationality tpn on tpn.entity_id = base.id
where base.id = ce.id
  and base.entity_type = 'person'
  and (tpj.jurisdiction is not null or tpn.nationality is not null);

-- ------------------------------------------------------------------------------------------------
-- Companies: GB when a CH company_number is already on the entity, else the modal non-null
-- address->>country across ANY of its mentions (e.g. a corporate PSC known only by address).
-- ------------------------------------------------------------------------------------------------
create temporary table tmp_company_addr_counts on commit drop as
select mr.canonical_entity_id as entity_id,
       case when lower(btrim(m.raw_attributes->'address'->>'country')) in (select alias from tmp_gb_alias)
            then 'GB' else btrim(m.raw_attributes->'address'->>'country') end as country,
       count(*) as n
from public.mentions m
join public.mention_resolutions mr on mr.mention_id = m.id and mr.is_active
where m.entity_type_hint = 'company'
  and nullif(btrim(m.raw_attributes->'address'->>'country'), '') is not null
group by mr.canonical_entity_id, 2;

create temporary table tmp_company_addr_country on commit drop as
select distinct on (entity_id) entity_id, country
from tmp_company_addr_counts
order by entity_id, n desc, country asc;

create temporary table tmp_company_jurisdiction on commit drop as
select ce.id as entity_id,
       case when ce.attributes ? 'company_number' then 'GB' else tac.country end as jurisdiction
from public.canonical_entities ce
left join tmp_company_addr_country tac on tac.entity_id = ce.id
where ce.entity_type = 'company'
  and (ce.attributes ? 'company_number' or tac.country is not null);

update public.canonical_entities ce
set attributes = ce.attributes || jsonb_build_object('jurisdiction', tcj.jurisdiction),
    updated_at = now()
from tmp_company_jurisdiction tcj
where tcj.entity_id = ce.id
  and tcj.jurisdiction is not null;
