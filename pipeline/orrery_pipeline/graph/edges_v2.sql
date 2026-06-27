-- ORRERY — edge scoring v2 (recomputable). Adds monetary magnitude to v1:
--   confidence = source_reliability x endpoint_match_confidence
--   strength   = type_weight x recency x duration x magnitude
--                magnitude = log-saturating in £ for valued edges (donations/contracts):
--                ln(1+£)/ln(1+1,000,000), capped at 1; 1 for edges with no amount.
-- Donation £ amounts are also copied onto the statement (attributes.amount_gbp) so the
-- UI can show "via Companies House record · £1,000,000".

with mapped as (
  select ra.statement_type,
         sub.canonical_entity_id as subj,
         obj.canonical_entity_id as obj,
         ra.valid_from, ra.valid_to,
         src.reliability_prior * least(sub.match_confidence, obj.match_confidence) as asrt_conf,
         (ra.raw_attributes->>'value_gbp')::numeric as amount,
         sd.source_code as source_code
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
         max(asrt_conf) as confidence,
         max(amount) as amount_gbp,
         array_agg(distinct source_code) as sources
  from mapped
  group by statement_type, subj, obj
)
insert into public.statements
  (subject_entity_id, statement_type, object_entity_id, valid_from, valid_to,
   attributes, confidence, strength, resolution_version, computed_at)
select e.subj, e.statement_type, e.obj, e.vfrom, e.vto,
       jsonb_build_object('sources', to_jsonb(e.sources))
         || case when e.amount_gbp is not null
                 then jsonb_build_object('amount_gbp', e.amount_gbp) else '{}'::jsonb end,
       round(e.confidence::numeric, 4),
       round(greatest(0, least(1,
         st.type_weight
         * exp(-0.15 * greatest(0, (current_date - coalesce(e.vto, current_date))) / 365.0)
         * case when e.vfrom is null then 0.5
                else 1 - exp(- greatest(0, (coalesce(e.vto, current_date) - e.vfrom)) / 365.0 / 5.0)
           end
         * case when e.amount_gbp is not null
                then least(1.0, ln(1 + e.amount_gbp) / ln(1 + 1000000)) else 1.0 end
       ))::numeric, 4) as strength,
       1, now()
from edges e
join public.statement_types st on st.code = e.statement_type;

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
