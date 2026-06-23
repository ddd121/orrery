-- ORRERY — entity resolution v1 (Companies House, deterministic, recomputable).
--
-- Clears the resolution + edge layers and rebuilds them from the immutable raw layer
-- (mentions / relationship_assertions are never touched). Uses high-precision official
-- identifiers, so match_confidence is 1.0 by construction:
--   companies -> company_number
--   officers  -> the Companies House officer id (from the appointments link)
-- Corporate officers (corporate-director/secretary, or carrying an identification block)
-- resolve to an organisation. Anything left (PSCs, link-less officers) becomes its own
-- conservative singleton — never merged without evidence (precision over recall).
--
-- Fuzzy / probabilistic resolution (Splink, rarity-weighted Fellegi-Sunter) + calibration
-- against a gold set is introduced for CROSS-source matching (M6): e.g. tying a CH officer
-- to an Electoral Commission donor by name. That is where it earns its keep; within a
-- single register the official ids already give near-deterministic, high-precision links.

truncate table public.statement_assertions, public.statements,
               public.mention_resolutions, public.canonical_entities;

-- 1) Companies — key: company_number
with src as (
  select m.id as mention_id, m.raw_name, m.raw_attributes->>'company_number' as cono
  from public.mentions m
  where m.entity_type_hint = 'company' and (m.raw_attributes ? 'company_number')
),
grp as (
  insert into public.canonical_entities
    (entity_type, canonical_name, display_name, attributes, category, resolution_version)
  select 'company', min(raw_name), min(raw_name),
         jsonb_build_object('company_number', cono), 'company', 1
  from src group by cono
  returning id, attributes->>'company_number' as cono
)
insert into public.mention_resolutions
    (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'ch_v1'
from src s join grp g on g.cono = s.cono;

-- 2) Officers — key: CH officer id; corporate officers -> organisation
with src as (
  select m.id as mention_id, m.raw_name,
         m.raw_attributes->>'ch_appointments_link' as off_link,
         coalesce(m.raw_attributes->>'officer_role','') as role,
         (m.raw_attributes ? 'identification') as has_ident
  from public.mentions m
  where m.entity_type_hint = 'person' and (m.raw_attributes ? 'ch_appointments_link')
),
keyed as (select *, (role like 'corporate%' or has_ident) as is_corp from src),
grp as (
  insert into public.canonical_entities
    (entity_type, canonical_name, display_name, attributes, category, resolution_version)
  select case when bool_or(is_corp) then 'organisation' else 'person' end,
         min(raw_name), min(raw_name),
         jsonb_build_object('ch_officer_link', off_link), null, 1
  from keyed group by off_link
  returning id, attributes->>'ch_officer_link' as off_link
)
insert into public.mention_resolutions
    (mention_id, canonical_entity_id, match_confidence, method, model_version)
select k.mention_id, g.id, 1.0, 'deterministic', 'ch_v1'
from keyed k join grp g on g.off_link = k.off_link;

-- 3) Remaining unresolved mentions -> one canonical each (conservative singletons)
with unresolved as materialized (
  select m.id as mention_id, gen_random_uuid() as cid, m.raw_name,
         coalesce(m.entity_type_hint, 'person') as etype, m.raw_attributes as attrs
  from public.mentions m
  left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null
),
ins as (
  insert into public.canonical_entities
    (id, entity_type, canonical_name, display_name, attributes, resolution_version)
  select cid, etype, raw_name, raw_name, attrs, 1 from unresolved
  returning id
)
insert into public.mention_resolutions
    (mention_id, canonical_entity_id, match_confidence, method, model_version)
select mention_id, cid, 1.0, 'deterministic', 'ch_v1' from unresolved;
