-- ORRERY — §7 conflict-of-interest motif (recomputable; run after scrutiny). A FLAG with
-- the receipts attached, never a verdict: an MP who holds a directorship or shareholding in
-- a company (an active business interest, stronger than a paid advisory role) WHILE sitting
-- on a parliamentary committee. The product surfaces the structural overlap and lets the
-- user judge whether the committee's remit touches the interest — it never alleges anything.

with iface as (
  select mp.id,
    (select string_agg(distinct o.canonical_name, '; ' order by o.canonical_name)
       from public.statements s join public.canonical_entities o on o.id = s.object_entity_id
      where s.subject_entity_id = mp.id and s.statement_type = 'MEMBER_OF' and o.entity_type = 'organisation') as committees,
    (select string_agg(distinct o.canonical_name, '; ' order by o.canonical_name)
       from public.statements s join public.canonical_entities o on o.id = s.object_entity_id
      where s.subject_entity_id = mp.id and s.statement_type in ('OWNS', 'DIRECTOR_OF')) as interests
  from public.canonical_entities mp
  where mp.category = 'mp'
)
update public.canonical_entities ce
set attributes = (ce.attributes - 'conflict_flag' - 'conflict_reason')
  || case when i.committees is not null and i.interests is not null
       then jsonb_build_object(
              'conflict_flag', true,
              'conflict_reason',
              'Holds a directorship/shareholding — ' || i.interests ||
              ' — while sitting on: ' || i.committees || '. Merits a look: does the committee''s remit touch the interest?')
       else jsonb_build_object('conflict_flag', false) end
from iface i
where i.id = ce.id;
