-- ORRERY — edge scoring v1 (recomputable). Builds resolved `statements` from the raw
-- `relationship_assertions`, mapping each endpoint mention through its active resolution.
--
--   confidence = source_reliability x endpoint_match_confidence   (engine-spec §2)
--                Independent-source corroboration (noisy-OR) arrives with the 2nd source (M6);
--                within one register there is nothing to corroborate, so confidence = that.
--   strength   = type_weight x recency x duration                 (engine-spec §3)
--                recency  = exp(-0.15 * years_since_end)  (ongoing ties ~1)
--                duration = 1 - exp(-years_active / 5)     (saturating; a long tie > a brief one)
--
-- One statement per (subject, type, object); backing assertions are linked in
-- statement_assertions for full provenance and as the substrate for noisy-OR later.

-- 1) Resolved, scored edges
with mapped as (
  select ra.statement_type,
         sub.canonical_entity_id as subj,
         obj.canonical_entity_id as obj,
         ra.valid_from, ra.valid_to,
         src.reliability_prior * least(sub.match_confidence, obj.match_confidence) as asrt_conf
  from public.relationship_assertions ra
  join public.mention_resolutions sub on sub.mention_id = ra.from_mention_id and sub.is_active
  join public.mention_resolutions obj on obj.mention_id = ra.to_mention_id and obj.is_active
  join public.source_documents sd on sd.id = ra.source_document_id
  join public.sources src on src.code = sd.source_code
  where sub.canonical_entity_id <> obj.canonical_entity_id
),
edges as (
  select statement_type, subj, obj,
         min(valid_from) as vfrom,
         case when bool_or(valid_to is null) then null else max(valid_to) end as vto,
         max(asrt_conf) as confidence
  from mapped
  group by statement_type, subj, obj
)
insert into public.statements
  (subject_entity_id, statement_type, object_entity_id, valid_from, valid_to,
   confidence, strength, resolution_version, computed_at)
select e.subj, e.statement_type, e.obj, e.vfrom, e.vto,
       round(e.confidence::numeric, 4),
       round(greatest(0, least(1,
         st.type_weight
         * exp(-0.15 * greatest(0, (current_date - coalesce(e.vto, current_date))) / 365.0)
         * case when e.vfrom is null then 0.5
                else 1 - exp(- greatest(0, (coalesce(e.vto, current_date) - e.vfrom)) / 365.0 / 5.0)
           end
       ))::numeric, 4) as strength,
       1, now()
from edges e
join public.statement_types st on st.code = e.statement_type;

-- 2) Provenance: link every statement to the raw assertion(s) behind it
with mapped as (
  select ra.id as assertion_id, ra.statement_type,
         sub.canonical_entity_id as subj, obj.canonical_entity_id as obj
  from public.relationship_assertions ra
  join public.mention_resolutions sub on sub.mention_id = ra.from_mention_id and sub.is_active
  join public.mention_resolutions obj on obj.mention_id = ra.to_mention_id and obj.is_active
  where sub.canonical_entity_id <> obj.canonical_entity_id
)
insert into public.statement_assertions (statement_id, relationship_assertion_id)
select s.id, m.assertion_id
from mapped m
join public.statements s
  on s.subject_entity_id = m.subj
 and s.statement_type   = m.statement_type
 and s.object_entity_id = m.obj
 and s.resolution_version = 1;
