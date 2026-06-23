-- ORRERY — scrutiny score v1 (engine-spec §8). Recomputable; run after edges.
--
-- "Merits a look", not "is dodgy". An entity scores on the ROLE it plays in political
-- money or public office — not merely for being attached to something that does (that
-- floods the graph with bills, committees and whip posts). The money an entity is
-- credited with:
--   gave a donation          (donor)                                 -> the £ given
--   received a donation      (party / regulated donee)               -> the £ received
--   directs/owns a donor co  (the person behind the money)           -> that company's £
--   sits in a funded party   (MP/minister of a party that took money) -> the party's £
-- scrutiny = saturating(that £) + 0.2 bridge bonus for an office-holder also near money.
-- A neutral corporate group (no political money) scores 0 — the engine does not cry wolf.

with don_out as (
  select subject_entity_id id, max((attributes->>'amount_gbp')::numeric) amt
  from public.statements where statement_type = 'DONATED_TO' and (attributes ? 'amount_gbp') group by 1
),
don_in as (
  select object_entity_id id, max((attributes->>'amount_gbp')::numeric) amt
  from public.statements where statement_type = 'DONATED_TO' and (attributes ? 'amount_gbp') group by 1
),
ctrl as (  -- person/org that directs, controls or owns a donor company
  select s.subject_entity_id id, max(dox.amt) amt
  from public.statements s
  join don_out dox on dox.id = s.object_entity_id
  where s.statement_type in ('DIRECTOR_OF','PSC_OF','OWNS','CO_DIRECTOR')
  group by 1
),
viaparty as (  -- MP / member of a party that received donations
  select s.subject_entity_id id, max(di.amt) amt
  from public.statements s
  join don_in di on di.id = s.object_entity_id
  where s.statement_type = 'MEMBER_OF'
  group by 1
),
office as (select id from public.canonical_entities where category = 'mp'),
money as (
  select id, max(amt) amt
  from (select * from don_out union all select * from don_in union all select * from ctrl union all select * from viaparty) z
  group by 1
),
score as (
  select ce.id, m.amt as money, (o.id is not null) as office,
    round(least(1.0,
      coalesce(ln(1 + m.amt) / ln(1 + 5000000.0), 0)
      + case when m.amt is not null and o.id is not null then 0.2 else 0 end
    )::numeric, 3) as scrutiny
  from public.canonical_entities ce
  left join money m on m.id = ce.id
  left join office o on o.id = ce.id
)
update public.canonical_entities ce
set attributes = (ce.attributes - 'scrutiny' - 'scrutiny_money_gbp')
  || jsonb_build_object('scrutiny', coalesce(s.scrutiny, 0))
  || case when s.money is not null then jsonb_build_object('scrutiny_money_gbp', s.money) else '{}'::jsonb end
from score s
where s.id = ce.id;
