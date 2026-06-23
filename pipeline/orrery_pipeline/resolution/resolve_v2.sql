-- ORRERY — cross-source resolution v2 (deterministic, recomputable). Supersedes
-- companies_house_v1.sql once more than one source is present.
--
-- Still deterministic / high-precision — it uses only stable official keys, so no
-- false cross-source links (fuzzy individual matching across registers is a separate,
-- calibrated step, deliberately not done here):
--   companies  -> normalised company_number, merged ACROSS sources (CH company == EC
--                 company donor with the same number; EC drops the leading zero, so we
--                 zero-pad all-numeric numbers to 8)
--   CH officers-> Companies House officer id
--   EC donors  -> EC DonorId   (individuals / unincorporated donors)
--   recipients -> EC RegulatedEntityId  (parties / MPs)
--   everything else -> its own conservative singleton

truncate table public.statement_assertions, public.statements,
               public.mention_resolutions, public.canonical_entities;

-- 1) Companies by normalised company_number (cross-source merge: EC donor == CH company)
with src as (
  select m.id as mention_id, m.raw_name,
         case when (m.raw_attributes->>'company_number') ~ '^[0-9]+$'
              then lpad(m.raw_attributes->>'company_number', 8, '0')
              else m.raw_attributes->>'company_number' end as cono
  from public.mentions m
  where m.entity_type_hint = 'company'
    and coalesce(m.raw_attributes->>'company_number', '') <> ''
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
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v2'
from src s join grp g on g.cono = s.cono;

-- 2) Companies House officers by officer id (only mentions not already resolved)
with src as (
  select m.id as mention_id, m.raw_name,
         m.raw_attributes->>'ch_appointments_link' as off_link,
         coalesce(m.raw_attributes->>'officer_role','') as role,
         (m.raw_attributes ? 'identification') as has_ident
  from public.mentions m
  left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and (m.raw_attributes ? 'ch_appointments_link')
),
keyed as (select *, (role like 'corporate%' or has_ident) as is_corp from src),
grp as (
  insert into public.canonical_entities
    (entity_type, canonical_name, display_name, attributes, resolution_version)
  select case when bool_or(is_corp) then 'organisation' else 'person' end,
         min(raw_name), min(raw_name),
         jsonb_build_object('ch_officer_link', off_link), 1
  from keyed group by off_link
  returning id, attributes->>'ch_officer_link' as off_link
)
insert into public.mention_resolutions
    (mention_id, canonical_entity_id, match_confidence, method, model_version)
select k.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v2'
from keyed k join grp g on g.off_link = k.off_link;

-- 3) Electoral Commission donors by DonorId (individuals / unincorporated, not already merged by company number)
with src as (
  select m.id as mention_id, m.raw_name, m.entity_type_hint as etype,
         m.raw_attributes->>'donor_id' as did
  from public.mentions m
  left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and coalesce(m.raw_attributes->>'donor_id','') <> ''
),
grp as (
  insert into public.canonical_entities
    (entity_type, canonical_name, display_name, attributes, resolution_version)
  select max(etype), min(raw_name), min(raw_name),
         jsonb_build_object('ec_donor_id', did), 1
  from src group by did
  returning id, attributes->>'ec_donor_id' as did
)
insert into public.mention_resolutions
    (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v2'
from src s join grp g on g.did = s.did;

-- 4) Electoral Commission recipients by RegulatedEntityId (parties / MPs)
with src as (
  select m.id as mention_id, m.raw_name, m.entity_type_hint as etype,
         m.raw_attributes->>'regulated_entity_id' as rid
  from public.mentions m
  left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and coalesce(m.raw_attributes->>'regulated_entity_id','') <> ''
),
grp as (
  insert into public.canonical_entities
    (entity_type, canonical_name, display_name, attributes, resolution_version)
  select max(etype), min(raw_name), min(raw_name),
         jsonb_build_object('ec_regulated_entity_id', rid), 1
  from src group by rid
  returning id, attributes->>'ec_regulated_entity_id' as rid
)
insert into public.mention_resolutions
    (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v2'
from src s join grp g on g.rid = s.rid;

-- 5) Anything still unresolved -> conservative singletons
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
select mention_id, cid, 1.0, 'deterministic', 'xsrc_v2' from unresolved;
