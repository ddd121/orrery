-- ORRERY — cross-source resolution v3 (deterministic, recomputable). Adds the
-- Parliament layer to v2. Still only stable keys + safe normalisation (no fuzzy
-- person matching across registers — that calibrated step is deliberately separate):
--   companies   -> normalised company_number (CH + EC donors)
--   parties     -> normalised party name (EC "Labour Party" == Parliament "Labour")
--   CH officers -> Companies House officer id
--   MPs         -> Parliament member id
--   committees / depts / orgs -> exact normalised name (shared committee => one node)
--   EC donors   -> DonorId ; EC recipients -> RegulatedEntityId
--   everything else -> singleton

-- findings/suggested_pairs (DESIGN_SPEC_V2 Step 1), entity_insights (Value Everywhere Wave 1) and
-- overseas_leads/offshore_leads/coverage (The Front Page, Wave A/B) are rebuilt from
-- canonical_entities/statements later in the same recompute build run (or by a standalone
-- best-effort script, in the case of offshore_leads/coverage); truncate them here too so the FKs
-- referencing canonical_entities do not block this truncate (a plain TRUNCATE does not cascade to
-- referencing tables unless they are listed or CASCADE is given).
truncate table public.statement_assertions, public.statements,
               public.mention_resolutions, public.canonical_entities,
               public.suggested_pairs, public.findings,
               public.entity_insights,
               public.overseas_leads, public.offshore_leads, public.coverage;

-- 1) Companies by normalised company_number (cross-source)
with src as (
  select m.id mention_id, m.raw_name,
         case when (m.raw_attributes->>'company_number') ~ '^[0-9]+$'
              then lpad(m.raw_attributes->>'company_number', 8, '0')
              else m.raw_attributes->>'company_number' end as cono
  from public.mentions m
  where m.entity_type_hint = 'company' and coalesce(m.raw_attributes->>'company_number','') <> ''
),
grp as (
  insert into public.canonical_entities (entity_type, canonical_name, display_name, attributes, category, resolution_version)
  select 'company', min(raw_name), min(raw_name), jsonb_build_object('company_number', cono), 'company', 1
  from src group by cono returning id, attributes->>'company_number' as cono
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v3' from src s join grp g on g.cono = s.cono;

-- 2) Parties by normalised name (merges EC + Parliament). Strips a trailing bracketed
--    abbreviation first ("Scottish National Party (SNP)" -> "Scottish National Party"), then the
--    same legal/qualifier tokens as before, plus a trailing plural s so "Liberal Democrats"
--    folds onto "Liberal Democrat" (both are actually present, unmerged, in the current register,
--    verified against distinct party mention names in the DB). Reform UK carries no variant
--    spelling in the data today (single canonical entity already, confirmed in DB) but needs no
--    special casing here regardless: reform uk matches none of these strip tokens either way, so
--    it passes through unchanged and stays merged as Wave D broadens EC/Parliament coverage.
with src as (
  select m.id mention_id, m.raw_name,
         btrim(regexp_replace(
           regexp_replace(lower(m.raw_name), '\s*\([^)]*\)\s*$', '', 'g'),
           '( and unionist| party|s$|^the )', '', 'g')) as pkey
  from public.mentions m
  left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and m.entity_type_hint = 'party'
),
grp as (
  insert into public.canonical_entities (entity_type, canonical_name, display_name, attributes, category, resolution_version)
  select 'party', min(raw_name), min(raw_name), jsonb_build_object('party_key', pkey), 'party', 1
  from src group by pkey returning id, attributes->>'party_key' as pkey
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v3' from src s join grp g on g.pkey = s.pkey;

-- 3) Companies House officers by officer id
with src as (
  select m.id mention_id, m.raw_name, m.raw_attributes->>'ch_appointments_link' off_link,
         coalesce(m.raw_attributes->>'officer_role','') role, (m.raw_attributes ? 'identification') has_ident
  from public.mentions m left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and (m.raw_attributes ? 'ch_appointments_link')
),
keyed as (select *, (role like 'corporate%' or has_ident) is_corp from src),
grp as (
  insert into public.canonical_entities (entity_type, canonical_name, display_name, attributes, resolution_version)
  select case when bool_or(is_corp) then 'organisation' else 'person' end, min(raw_name), min(raw_name),
         jsonb_build_object('ch_officer_link', off_link), 1
  from keyed group by off_link returning id, attributes->>'ch_officer_link' as off_link
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select k.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v3' from keyed k join grp g on g.off_link = k.off_link;

-- 4) MPs by Parliament member id
with src as (
  select m.id mention_id, m.raw_name, m.raw_attributes->>'parliament_member_id' pid
  from public.mentions m left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and coalesce(m.raw_attributes->>'parliament_member_id','') <> ''
),
grp as (
  insert into public.canonical_entities (entity_type, canonical_name, display_name, attributes, category, resolution_version)
  select 'person', min(raw_name), min(raw_name), jsonb_build_object('parliament_member_id', pid), 'mp', 1
  from src group by pid returning id, attributes->>'parliament_member_id' as pid
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v3' from src s join grp g on g.pid = s.pid;

-- 5) Committees / departments / orgs by exact normalised name (shared committee => one node)
with src as (
  select m.id mention_id, m.raw_name, m.entity_type_hint etype, lower(btrim(m.raw_name)) nkey
  from public.mentions m left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and m.entity_type_hint in ('organisation','government_body','appg')
),
grp as (
  insert into public.canonical_entities (entity_type, canonical_name, display_name, attributes, resolution_version)
  select max(etype), min(raw_name), min(raw_name), jsonb_build_object('name_key', nkey), 1
  from src group by nkey returning id, attributes->>'name_key' as nkey
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v3' from src s join grp g on g.nkey = s.nkey;

-- 6) EC donors by DonorId
with src as (
  select m.id mention_id, m.raw_name, m.entity_type_hint etype, m.raw_attributes->>'donor_id' did
  from public.mentions m left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and coalesce(m.raw_attributes->>'donor_id','') <> ''
),
grp as (
  insert into public.canonical_entities (entity_type, canonical_name, display_name, attributes, resolution_version)
  select max(etype), min(raw_name), min(raw_name), jsonb_build_object('ec_donor_id', did), 1
  from src group by did returning id, attributes->>'ec_donor_id' as did
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v3' from src s join grp g on g.did = s.did;

-- 7) EC recipients by RegulatedEntityId (regulated donees not already a party)
with src as (
  select m.id mention_id, m.raw_name, m.entity_type_hint etype, m.raw_attributes->>'regulated_entity_id' rid
  from public.mentions m left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null and coalesce(m.raw_attributes->>'regulated_entity_id','') <> ''
),
grp as (
  insert into public.canonical_entities (entity_type, canonical_name, display_name, attributes, resolution_version)
  select max(etype), min(raw_name), min(raw_name), jsonb_build_object('ec_regulated_entity_id', rid), 1
  from src group by rid returning id, attributes->>'ec_regulated_entity_id' as rid
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select s.mention_id, g.id, 1.0, 'deterministic', 'xsrc_v3' from src s join grp g on g.rid = s.rid;

-- 8) Singletons
with unresolved as materialized (
  select m.id mention_id, gen_random_uuid() cid, m.raw_name,
         coalesce(m.entity_type_hint,'person') etype, m.raw_attributes attrs
  from public.mentions m left join public.mention_resolutions mr on mr.mention_id = m.id
  where mr.id is null
),
ins as (
  insert into public.canonical_entities (id, entity_type, canonical_name, display_name, attributes, resolution_version)
  select cid, etype, raw_name, raw_name, attrs, 1 from unresolved returning id
)
insert into public.mention_resolutions (mention_id, canonical_entity_id, match_confidence, method, model_version)
select mention_id, cid, 1.0, 'deterministic', 'xsrc_v3' from unresolved;
