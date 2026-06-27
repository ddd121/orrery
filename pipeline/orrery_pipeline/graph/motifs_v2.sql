-- ORRERY — §7 conflict-of-interest motif v2 (recomputable; run after scrutiny).
-- v1 flagged an MP who holds a directorship/shareholding while sitting on a committee. v2 adds
-- a SALIENCE: does the remit of a committee/bill they sit on overlap the SECTOR of that interest?
-- Sector is inferred transparently from a keyword lexicon over committee + company names; party-
-- political vehicles, dormant shells and eponymous personal companies are demoted — so a genuine
-- remit↔sector overlap (e.g. a property company + the Planning Bill) outranks the noise.
-- Still a "merits a look" flag with the receipts attached, never a verdict.

with lex(theme, kw) as (values
  ('housing','home'),('housing','housing'),('housing','propert'),('housing','estate'),('housing','renter'),
  ('housing','planning'),('housing','infrastructure'),('housing','construction'),('housing','tenant'),('housing','land'),
  ('finance','capital'),('finance','invest'),('finance','financ'),('finance','bank'),('finance','asset'),
  ('finance','fund'),('finance','trading'),('finance','advisory'),('finance','account'),('finance','equity'),('finance','wealth'),
  ('health','health'),('health','care'),('health','medical'),('health','nhs'),('health','pharma'),('health','clinic'),('health','hospital'),
  ('defence','defence'),('defence','military'),('defence','armed forces'),('defence','aerospace'),
  ('data_tech','data'),('data_tech','digital'),('data_tech','software'),('data_tech','online'),
  ('data_tech','telecom'),('data_tech','cyber'),('data_tech','learning'),('data_tech','technolog'),
  ('media','media'),('media','broadcast'),('media','film'),('media','music'),('media','event'),
  ('media','festival'),('media','culture'),('media','sport'),('media','entertain'),
  ('transport','transport'),('transport','rail'),('transport','aviation'),('transport','logistic'),('transport','freight'),
  ('energy','energy'),('energy','power'),('energy','renewable'),('energy','solar'),('energy','petroleum'),
  ('education','education'),('education','school'),('education','academ'),('education','universit'),('education','training'),
  ('legal','litigation'),('legal','solicitor'),('legal','barrister'),('legal','chambers'),
  ('procurement','procurement'),('procurement','supply chain')
),
mp as (
  select id, regexp_replace(lower(canonical_name), '^.* ', '') as surname
  from public.canonical_entities where category = 'mp'
),
comm as (  -- committees / bills / ministerial bodies the MP sits on
  select m.id as mp_id, lower(o.canonical_name) as txt
  from mp m
  join public.statements s on s.subject_entity_id = m.id and s.statement_type in ('MEMBER_OF', 'CHAIR_OF', 'MINISTERIAL_ROLE')
  join public.canonical_entities o on o.id = s.object_entity_id
  where o.entity_type in ('organisation', 'government_body')
),
intr as (  -- directorships / shareholdings (active business interests)
  select m.id as mp_id, m.surname, o.canonical_name as iname, lower(o.canonical_name) as itxt
  from mp m
  join public.statements s on s.subject_entity_id = m.id and s.statement_type in ('OWNS', 'DIRECTOR_OF')
  join public.canonical_entities o on o.id = s.object_entity_id
),
comm_theme as (select distinct c.mp_id, l.theme from comm c join lex l on c.txt like '%' || l.kw || '%'),
intr_theme as (select distinct i.mp_id, l.theme from intr i join lex l on i.itxt like '%' || l.kw || '%'),
ov as (  -- remit ↔ sector overlap: a theme present on BOTH a committee and an interest
  select ct.mp_id, string_agg(distinct ct.theme, ', ' order by ct.theme) as themes
  from comm_theme ct join intr_theme it on it.mp_id = ct.mp_id and it.theme = ct.theme
  group by ct.mp_id
),
agg as (
  select i.mp_id,
    string_agg(distinct i.iname, '; ' order by i.iname) as interests,
    -- a "real" commercial interest = not a party-political vehicle, not dormant, not the MP's own-name company
    bool_or(
      i.itxt !~ '(labour|conservative|liberal democrat|reform uk| party|campaign|to win)'
      and i.itxt not like '%dormant%'
      and i.itxt not like '%' || i.surname || '%'
    ) as has_commercial
  from intr i group by i.mp_id
),
comms as (
  select c.mp_id, string_agg(distinct initcap(c.txt), '; ' order by initcap(c.txt)) as committees
  from comm c group by c.mp_id
)
update public.canonical_entities ce
set attributes = (ce.attributes - 'conflict_flag' - 'conflict_reason' - 'conflict_strength' - 'conflict_overlap')
  || case
       when a.interests is null or cm.committees is null then jsonb_build_object('conflict_flag', false)
       else jsonb_build_object(
         'conflict_flag', true,
         'conflict_strength', case when ov.themes is not null then 'strong'
                                   when a.has_commercial then 'medium'
                                   else 'low' end,
         'conflict_overlap', ov.themes,
         'conflict_reason',
           'Holds a directorship/shareholding — ' || a.interests || ' — while sitting on: ' || cm.committees || '. '
           || case when ov.themes is not null
                   then 'The committee remit and the interest overlap on: ' || ov.themes || ' — merits a look.'
                   when a.has_commercial
                   then 'No remit↔sector overlap detected from the names — merits a look at what the business does.'
                   else 'Interests read as party-political / dormant / personal rather than commercial — lower priority.' end
       ) end
from agg a
  left join ov on ov.mp_id = a.mp_id
  left join comms cm on cm.mp_id = a.mp_id
where a.mp_id = ce.id;
