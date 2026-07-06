-- ORRERY v2 -- the takeaway engine (Value Everywhere, Wave 1). Recomputable: TRUNCATE + rebuild
-- wholesale from public.statements + public.canonical_entities + public.findings, run after
-- findings_v1.sql in recompute build. Never hand-edited.
--
-- Every entity_insights row is a comparative, sourced sentence-in-waiting: a rank, a percentile, a
-- small-set membership, a bridge, or (the floor) a hop count to the nearest finding. The floor
-- guarantee is non-negotiable: every canonical entity gets at least one row, so no click in the
-- product ever returns an empty takeaway. Facts, never verdicts. Money is EC-declared amount_gbp
-- only; contract figures are COUNTS, never summed as money (framework ceilings, not receipts).
--
-- Pure SQL, no dollar-quoted bodies, so recompute.py's statement splitter runs this faithfully.
-- Comments avoid semicolons and apostrophes so the naive split-on-';' never breaks mid-comment.

truncate table public.entity_insights;
truncate table public.register_stats;

-- ------------------------------------------------------------------------------------------------
-- 0) Shared scaffolding, reused from findings_v1.sql conventions: hub exclusion, degree/idf,
--    statement-to-source-register lookup. recompute.py runs the whole BUILD list in ONE
--    transaction, and findings_v1.sql (which runs immediately before this file) already creates
--    tmp_hub_types / tmp_degree / tmp_stmt_sources as "on commit drop" temp tables -- they are
--    still in scope here (dropped only at the final commit), so this file reuses them rather than
--    recreating them (a second CREATE TEMP TABLE with the same name in the same session errors).
-- ------------------------------------------------------------------------------------------------

-- per-entity distinct source registers across every statement touching it (subject or object)
create temporary table tmp_entity_registers on commit drop as
select eid, array_agg(distinct src order by src) as registers, count(distinct src) as n_registers
from (
  select s.subject_entity_id as eid, ss.src
  from public.statements s join tmp_stmt_sources ss on ss.statement_id = s.id
  union all
  select s.object_entity_id as eid, ss.src
  from public.statements s join tmp_stmt_sources ss on ss.statement_id = s.id
) x
group by eid;
create index on tmp_entity_registers (eid);

-- undirected edge list (both directions) over statements, for hop-based nearest-notable search
create temporary table tmp_edges on commit drop as
select subject_entity_id as a, object_entity_id as b from public.statements
union
select object_entity_id as a, subject_entity_id as b from public.statements;
create index on tmp_edges (a);

-- ==================================================================================================
-- RANK_MONEY_GIVEN -- outgoing DONATED_TO, summed, ranked within a cohort split by entity_type
-- (person donors / company donors, kept separate so a peer comparison is honest).
-- ==================================================================================================
with giving as (
  select s.subject_entity_id as donor_id,
         sum((s.attributes->>'amount_gbp')::numeric) as total_gbp,
         count(*) as n_donations
  from public.statements s
  where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp'
  group by s.subject_entity_id
),
recipients as (
  select s.subject_entity_id as donor_id, o.canonical_name as recipient_name,
         sum((s.attributes->>'amount_gbp')::numeric) as amt
  from public.statements s
  join public.canonical_entities o on o.id = s.object_entity_id
  where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp'
  group by s.subject_entity_id, o.canonical_name
),
top_recipients as (
  select donor_id, array_agg(recipient_name order by amt desc) as recipients
  from (
    select donor_id, recipient_name, amt,
           row_number() over (partition by donor_id order by amt desc) as rn
    from recipients
  ) r
  where rn <= 3
  group by donor_id
),
cohorted as (
  select g.donor_id, ce.canonical_name, ce.entity_type,
         case when ce.entity_type = 'person' then 'person' else 'company' end as cohort_key,
         g.total_gbp, g.n_donations
  from giving g
  join public.canonical_entities ce on ce.id = g.donor_id
),
ranked as (
  select c.*, tr.recipients,
    rank() over (partition by cohort_key order by total_gbp desc) as rnk,
    count(*) over (partition by cohort_key) as cohort_size
  from cohorted c
  left join top_recipients tr on tr.donor_id = c.donor_id
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('RANK_MONEY_GIVEN|' || r.donor_id::text),
  r.donor_id,
  'RANK_MONEY_GIVEN',
  round((0.9 * (1.0 - (r.rnk - 1)::numeric / greatest(1, r.cohort_size)))::numeric, 4),
  r.rnk,
  r.cohort_size,
  jsonb_build_object(
    'name', r.canonical_name,
    'total_gbp', r.total_gbp,
    'n_donations', r.n_donations,
    'recipients', coalesce(r.recipients, array[]::text[]),
    'rank', r.rnk,
    'cohort', case when r.cohort_key = 'person'
                   then 'the ' || r.cohort_size || ' individual donors in this register'
                   else 'the ' || r.cohort_size || ' company donors in this register' end,
    'percentile', round((100 * (1.0 - (r.rnk - 1)::numeric / greatest(1, r.cohort_size)))::numeric, 1)
  ),
  now()
from ranked r;

-- ==================================================================================================
-- RANK_MONEY_RECEIVED -- incoming DONATED_TO, summed, ranked within a cohort split by entity_type
-- (parties / persons as regulated donees, e.g. an MP receiving donations directly).
-- ==================================================================================================
with receiving as (
  select s.object_entity_id as recipient_id,
         sum((s.attributes->>'amount_gbp')::numeric) as total_gbp,
         count(*) as n_donations
  from public.statements s
  where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp'
  group by s.object_entity_id
),
donors as (
  select s.object_entity_id as recipient_id, sub.canonical_name as donor_name,
         sum((s.attributes->>'amount_gbp')::numeric) as amt
  from public.statements s
  join public.canonical_entities sub on sub.id = s.subject_entity_id
  where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp'
  group by s.object_entity_id, sub.canonical_name
),
top_donors as (
  select recipient_id, array_agg(donor_name order by amt desc) as donors
  from (
    select recipient_id, donor_name, amt,
           row_number() over (partition by recipient_id order by amt desc) as rn
    from donors
  ) d
  where rn <= 3
  group by recipient_id
),
cohorted as (
  select r.recipient_id, ce.canonical_name, ce.entity_type,
         case when ce.entity_type = 'party' then 'party' else 'person' end as cohort_key,
         r.total_gbp, r.n_donations
  from receiving r
  join public.canonical_entities ce on ce.id = r.recipient_id
),
ranked as (
  select c.*, td.donors,
    rank() over (partition by cohort_key order by total_gbp desc) as rnk,
    count(*) over (partition by cohort_key) as cohort_size
  from cohorted c
  left join top_donors td on td.recipient_id = c.recipient_id
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('RANK_MONEY_RECEIVED|' || r.recipient_id::text),
  r.recipient_id,
  'RANK_MONEY_RECEIVED',
  round((0.9 * (1.0 - (r.rnk - 1)::numeric / greatest(1, r.cohort_size)))::numeric, 4),
  r.rnk,
  r.cohort_size,
  jsonb_build_object(
    'name', r.canonical_name,
    'total_gbp', r.total_gbp,
    'n_donations', r.n_donations,
    'donors', coalesce(r.donors, array[]::text[]),
    'rank', r.rnk,
    'cohort', case when r.cohort_key = 'party'
                   then 'the ' || r.cohort_size || ' parties in this register'
                   else 'the ' || r.cohort_size || ' individual regulated donees in this register' end,
    'percentile', round((100 * (1.0 - (r.rnk - 1)::numeric / greatest(1, r.cohort_size)))::numeric, 1)
  ),
  now()
from ranked r;

-- ==================================================================================================
-- RANK_PORTFOLIO -- count of DIRECTOR_OF/OWNS/ADVISER_TO ties, for MPs and peers (category = 'mp'
-- covers both Houses: resolve_v3 keys all Parliament-member-id mentions, MP or peer, to category
-- 'mp' -- a House split is not reachable at this layer, so the cohort is named honestly as both).
-- ==================================================================================================
with roles as (
  select s.subject_entity_id as person_id, s.statement_type,
         s.object_entity_id as org_id
  from public.statements s
  join public.canonical_entities p on p.id = s.subject_entity_id and p.category = 'mp'
  where s.statement_type in ('DIRECTOR_OF', 'OWNS', 'ADVISER_TO')
),
by_type as (
  select person_id, statement_type, count(*) as cnt
  from roles
  group by person_id, statement_type
),
portfolio as (
  select person_id, sum(cnt) as n_ties, jsonb_object_agg(statement_type, cnt) as kinds_breakdown
  from by_type
  group by person_id
),
cohort as (
  select ce.id from public.canonical_entities ce where ce.category = 'mp'
),
filled as (
  select c.id as person_id, coalesce(p.n_ties, 0) as n_ties, coalesce(p.kinds_breakdown, '{}'::jsonb) as kinds_breakdown
  from cohort c
  left join portfolio p on p.person_id = c.id
),
ranked as (
  select f.*, ce.canonical_name,
    rank() over (order by n_ties desc) as rnk,
    count(*) over () as cohort_size
  from filled f
  join public.canonical_entities ce on ce.id = f.person_id
  where f.n_ties >= 1
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('RANK_PORTFOLIO|' || r.person_id::text),
  r.person_id,
  'RANK_PORTFOLIO',
  round((0.85 * (1.0 - (r.rnk - 1)::numeric / greatest(1, r.cohort_size)))::numeric, 4),
  r.rnk,
  r.cohort_size,
  jsonb_build_object(
    'name', r.canonical_name,
    'n_ties', r.n_ties,
    'kinds_breakdown', r.kinds_breakdown,
    'rank', r.rnk,
    'cohort', 'the ' || r.cohort_size || ' MPs and peers on the Parliament register with at least one declared directorship, shareholding or advisory role',
    'percentile', round((100 * (1.0 - (r.rnk - 1)::numeric / greatest(1, r.cohort_size)))::numeric, 1)
  ),
  now()
from ranked r;

-- ==================================================================================================
-- ONLY_N (a) -- companies that BOTH donate (subject of DONATED_TO) AND hold contracts (party to
-- CONTRACTED_WITH, either side). Same predicate family as findings LOOP_CLOSED, computed per entity.
-- ==================================================================================================
with donors as (
  select distinct s.subject_entity_id as company_id
  from public.statements s
  where s.statement_type = 'DONATED_TO'
),
contractors as (
  select distinct s.subject_entity_id as company_id
  from public.statements s
  where s.statement_type = 'CONTRACTED_WITH'
),
loop_set as (
  select d.company_id from donors d join contractors c on c.company_id = d.company_id
),
sized as (
  select company_id, count(*) over () as set_size from loop_set
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('ONLY_N|donor_contractor|' || s.company_id::text),
  s.company_id,
  'ONLY_N',
  round((1.0 / s.set_size)::numeric, 4),
  null,
  s.set_size,
  jsonb_build_object(
    'name', ce.canonical_name,
    'set_size', s.set_size,
    'set_description', 'one of ' || s.set_size || ' companies on this register that both donate to a party and hold public-sector contracts'
  ),
  now()
from sized s
join public.canonical_entities ce on ce.id = s.company_id;

-- ==================================================================================================
-- ONLY_N (b) -- entities whose statements span 3+ distinct registers (source_codes). Same predicate
-- as findings CROSSING, computed per entity (hub types excluded, per findings convention).
-- ==================================================================================================
with crossing as (
  select eid, n_registers from tmp_entity_registers where n_registers >= 3
),
sized as (
  select c.eid, c.n_registers, count(*) over () as set_size
  from crossing c
  join public.canonical_entities ce on ce.id = c.eid
  where ce.entity_type not in (select entity_type from tmp_hub_types)
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('ONLY_N|crossing|' || s.eid::text),
  s.eid,
  'ONLY_N',
  round((1.0 / s.set_size)::numeric, 4),
  null,
  s.set_size,
  jsonb_build_object(
    'name', ce.canonical_name,
    'set_size', s.set_size,
    'set_description', 'one of ' || s.set_size || ' entities on this register whose ties are recorded across 3 or more distinct public registers'
  ),
  now()
from sized s
join public.canonical_entities ce on ce.id = s.eid;

-- ==================================================================================================
-- BRIDGE -- entities whose ties span >= 3 distinct registers, ranked by register count (the same
-- base set as ONLY_N(b), but framed and ranked as a bridge rather than a small-set membership).
-- ==================================================================================================
with crossing as (
  select eid, registers, n_registers from tmp_entity_registers where n_registers >= 3
),
ranked as (
  select c.eid, c.registers, c.n_registers, ce.canonical_name,
    rank() over (order by c.n_registers desc) as rnk,
    count(*) over () as cohort_size
  from crossing c
  join public.canonical_entities ce on ce.id = c.eid
  where ce.entity_type not in (select entity_type from tmp_hub_types)
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('BRIDGE|' || r.eid::text),
  r.eid,
  'BRIDGE',
  round((0.6 * (1.0 - (r.rnk - 1)::numeric / greatest(1, r.cohort_size)))::numeric, 4),
  r.rnk,
  r.cohort_size,
  jsonb_build_object(
    'name', r.canonical_name,
    'n_registers', r.n_registers,
    'registers', to_jsonb(r.registers),
    'rank', r.rnk,
    'cohort', 'the ' || r.cohort_size || ' entities on this register whose ties cross 3 or more distinct public registers'
  ),
  now()
from ranked r;

-- ==================================================================================================
-- NEAREST_NOTABLE (the floor) -- for every entity not already covered above, the nearest
-- finding-member entity within 2 hops via statements edges (1 hop preferred, else 2). Set-based:
-- edges CTE (already tmp_edges) unioning both directions, join finding members at 1 hop, then at
-- 2 hops for the remainder. One row per entity, fewest hops wins.
-- ==================================================================================================
with covered as (
  select distinct entity_id from public.entity_insights
),
finding_members as (
  select distinct m as member_id, f.id as finding_id, f.shape_code, f.slots
  from public.findings f, unnest(f.member_entity_ids) m
  where f.is_lead = false
),
uncovered as (
  select ce.id as eid from public.canonical_entities ce
  where ce.id not in (select entity_id from covered)
),
hop1 as (
  select u.eid, fm.member_id as notable_id, fm.finding_id, fm.shape_code, fm.slots, 1 as hops
  from uncovered u
  join tmp_edges e on e.a = u.eid
  join finding_members fm on fm.member_id = e.b and fm.member_id <> u.eid
),
hop1_best as (
  select distinct on (eid) eid, notable_id, finding_id, shape_code, slots, hops
  from hop1
  order by eid, finding_id
),
remainder as (
  select eid from uncovered where eid not in (select eid from hop1_best)
),
hop2 as (
  select r.eid, fm.member_id as notable_id, fm.finding_id, fm.shape_code, fm.slots, 2 as hops
  from remainder r
  join tmp_edges e1 on e1.a = r.eid
  join tmp_edges e2 on e2.a = e1.b
  join finding_members fm on fm.member_id = e2.b and fm.member_id <> r.eid
),
hop2_best as (
  select distinct on (eid) eid, notable_id, finding_id, shape_code, slots, hops
  from hop2
  order by eid, finding_id
),
combined as (
  select * from hop1_best
  union all
  select * from hop2_best
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('NEAREST_NOTABLE|' || c.eid::text),
  c.eid,
  'NEAREST_NOTABLE',
  round((0.3 / c.hops)::numeric, 4),
  null,
  null,
  jsonb_build_object(
    'name', ce.canonical_name,
    'notable_name', notable.canonical_name,
    'notable_finding_headline_hint', c.shape_code || ':' || coalesce(
      c.slots->>'company', c.slots->>'org', c.slots->>'person', c.slots->>'mp',
      c.slots->>'entity', c.slots->>'donor', notable.canonical_name
    ),
    'hops', c.hops
  ),
  now()
from combined c
join public.canonical_entities ce on ce.id = c.eid
join public.canonical_entities notable on notable.id = c.notable_id;

-- ==================================================================================================
-- BASIC (final fallback) -- for any entity still uncovered after NEAREST_NOTABLE (isolated: no
-- statements within 2 hops of any finding member, or no statements at all), a static row so the
-- "every entity has an insight" guarantee holds unconditionally.
-- ==================================================================================================
with covered as (
  select distinct entity_id from public.entity_insights
),
uncovered as (
  select ce.id as eid, ce.canonical_name from public.canonical_entities ce
  where ce.id not in (select entity_id from covered)
),
degrees as (
  select u.eid, u.canonical_name, coalesce(td.degree, 0) as n_ties,
         coalesce((select n_registers from tmp_entity_registers r where r.eid = u.eid), 0) as n_registers
  from uncovered u
  left join tmp_degree td on td.id = u.eid
)
insert into public.entity_insights (id, entity_id, kind, priority, rank, cohort_size, slots, computed_at)
select
  md5('BASIC|' || d.eid::text),
  d.eid,
  'BASIC',
  0.05,
  null,
  null,
  jsonb_build_object(
    'name', d.canonical_name,
    'n_ties', d.n_ties,
    'n_registers', d.n_registers
  ),
  now()
from degrees d;

-- ==================================================================================================
-- register_stats -- the landing-page "state of the register" numbers.
-- ==================================================================================================

insert into public.register_stats (stat, value_numeric, slots, computed_at)
select
  'total_political_money',
  sum((s.attributes->>'amount_gbp')::numeric),
  jsonb_build_object(
    'formatted', to_char(sum((s.attributes->>'amount_gbp')::numeric), 'FM999,999,999,999'),
    'n_donations', count(*),
    'n_donors', count(distinct s.subject_entity_id)
  ),
  now()
from public.statements s
where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp';

with biggest as (
  select s.id, s.subject_entity_id, s.object_entity_id, (s.attributes->>'amount_gbp')::numeric as amount_gbp
  from public.statements s
  where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp'
  order by (s.attributes->>'amount_gbp')::numeric desc
  limit 1
)
insert into public.register_stats (stat, value_numeric, slots, computed_at)
select
  'largest_single_donation',
  b.amount_gbp,
  jsonb_build_object(
    'donor_name', donor.canonical_name,
    'recipient_name', recip.canonical_name,
    'amount_gbp', b.amount_gbp,
    'donor_entity_id', b.subject_entity_id,
    'recipient_entity_id', b.object_entity_id
  ),
  now()
from biggest b
join public.canonical_entities donor on donor.id = b.subject_entity_id
join public.canonical_entities recip on recip.id = b.object_entity_id;

with tied_parliamentarians as (
  select distinct s.subject_entity_id as person_id
  from public.statements s
  join public.canonical_entities p on p.id = s.subject_entity_id and p.category = 'mp'
  where s.statement_type in ('DIRECTOR_OF', 'OWNS', 'ADVISER_TO')
)
insert into public.register_stats (stat, value_numeric, slots, computed_at)
select
  'parliamentarians_with_paid_ties',
  count(*),
  jsonb_build_object(
    'count', count(*),
    'cohort', 'MPs and peers on the Parliament register with at least one declared directorship, shareholding or advisory role'
  ),
  now()
from tied_parliamentarians;

with donors as (
  select distinct s.subject_entity_id as company_id from public.statements s where s.statement_type = 'DONATED_TO'
),
contractors as (
  select distinct s.subject_entity_id as company_id from public.statements s where s.statement_type = 'CONTRACTED_WITH'
),
both_sets as (
  select d.company_id from donors d join contractors c on c.company_id = d.company_id
)
insert into public.register_stats (stat, value_numeric, slots, computed_at)
select
  'donor_and_contractor_companies',
  count(*),
  jsonb_build_object('count', count(*)),
  now()
from both_sets;

insert into public.register_stats (stat, value_numeric, slots, computed_at)
select 'entities_total', count(*), jsonb_build_object('count', count(*)), now()
from public.canonical_entities;

insert into public.register_stats (stat, value_numeric, slots, computed_at)
select 'statements_total', count(*), jsonb_build_object('count', count(*)), now()
from public.statements;

insert into public.register_stats (stat, value_numeric, slots, computed_at)
select 'registers_total', count(distinct src), jsonb_build_object('count', count(distinct src)), now()
from tmp_stmt_sources;

with newest as (
  select s.statement_type, s.valid_from
  from public.statements s
  where s.valid_from is not null
  order by s.valid_from desc
  limit 1
)
insert into public.register_stats (stat, value_numeric, slots, computed_at)
select
  'newest_disclosure',
  null,
  jsonb_build_object('date', n.valid_from, 'statement_type', n.statement_type),
  now()
from newest n;
