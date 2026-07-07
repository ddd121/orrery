-- ORRERY v2 — the findings pool (DESIGN_SPEC_V2 "Step 1: the findings pool"). Recomputable:
-- TRUNCATE + rebuild wholesale from public.statements + public.canonical_entities, run after
-- edges_v2 / scrutiny_v1 / motifs_v2 in recompute build. Never hand-edited.
--
-- A finding is a materialised, SOURCED structural pattern, never a verdict. Every row traces back
-- to member_statement_ids (the Tie Row evidence) and member_entity_ids (the mini orrery bodies).
-- The libel gate is non-negotiable: a finding is only ever dealt as a stated fact when the MINIMUM
-- confidence across its member statements is >= 0.80 (min_confidence, is_lead = false). Anything in
-- the 0.50-0.79 band is stored with is_lead = true for a separate dashed Leads shelf, never as a
-- stated fact. Nothing below 0.50 is ever considered here.
--
-- Hub guard: party and government_body entities are excluded as "the interesting member" of a
-- finding (same rule dedupe_v1/motifs_v2 use) -- "both tied to the Labour Party" is not a
-- surprising structural pattern, it is the least surprising thing in this dataset.
--
-- Surprise score (engine-spec, transparent, each component printable as a "why" line):
--   idf(entity)          = 1 / log2(2 + degree), degree over non-hub-typed edges only
--   rarity               = geometric mean of idf over the finding's non-hub members
--   corroboration_lift   = 1 + 0.5 * (distinct source registers among member statements - 1)
--   money                = min(1, log10(1 + total £ on member statements) / 6)
--   shape_weight         = per-shape constant (table below)
--   surprise             = shape_weight * (0.4 + 0.6*rarity) * corroboration_lift * (0.5 + 0.5*money)
--
-- Pure SQL, no dollar-quoted bodies, so recompute.py's statement splitter runs this faithfully.
-- Comments avoid semicolons and apostrophes so the naive split-on-';' never breaks mid-comment.

truncate table public.findings;
truncate table public.suggested_pairs;
truncate table public.overseas_leads;

-- ------------------------------------------------------------------------------------------------
-- 0) Shared scaffolding: degree (non-hub-typed neighbour count) and idf per entity, and a
--    statement-to-source-register lookup, reused by every shape below.
-- ------------------------------------------------------------------------------------------------

create temporary table tmp_hub_types on commit drop as
select unnest(array['party', 'government_body']) as entity_type;

create temporary table tmp_degree on commit drop as
select id, count(*)::numeric as degree
from (
  select s.subject_entity_id as id
  from public.statements s
  join public.canonical_entities o on o.id = s.object_entity_id
  where o.entity_type not in (select entity_type from tmp_hub_types)
  union all
  select s.object_entity_id as id
  from public.statements s
  join public.canonical_entities sub on sub.id = s.subject_entity_id
  where sub.entity_type not in (select entity_type from tmp_hub_types)
) d
group by 1;
create index on tmp_degree (id);

-- idf = 1 / log2(2 + degree); an entity with no non-hub edges gets degree 0 -> idf = 1 (rarest)
create temporary table tmp_idf on commit drop as
select ce.id, 1.0 / log(2.0, 2.0 + coalesce(td.degree, 0)) as idf
from public.canonical_entities ce
left join tmp_degree td on td.id = ce.id;
create index on tmp_idf (id);

-- statement id -> distinct source registers it cites (from attributes->'sources')
create temporary table tmp_stmt_sources on commit drop as
select s.id as statement_id, jsonb_array_elements_text(coalesce(s.attributes->'sources', '[]'::jsonb)) as src
from public.statements s;
create index on tmp_stmt_sources (statement_id);

-- ------------------------------------------------------------------------------------------------
-- Helper macro (repeated per shape): given a set of candidate findings as
--   (shape_code, member_entity_ids uuid[], member_statement_ids uuid[], slots jsonb)
-- compute rarity / corroboration / money / min_confidence / surprise and insert into public.findings.
-- SQL has no macros, so each shape below repeats the same tail computation over its own candidate
-- CTE (kept identical on purpose for auditability).
-- ------------------------------------------------------------------------------------------------

-- ==================================================================================================
-- LOOP_CLOSED — a company with a DONATED_TO -> party AND CONTRACTED_WITH from public bodies.
-- shape_weight 1.0. Real instance: Ecotricity (>£1m to Labour, 21 public contracts).
-- ==================================================================================================
with donations as (
  select s.id as stmt_id, s.subject_entity_id as company_id, s.object_entity_id as party_id,
         (s.attributes->>'amount_gbp')::numeric as amount, s.confidence
  from public.statements s
  join public.canonical_entities party on party.id = s.object_entity_id and party.entity_type = 'party'
  where s.statement_type = 'DONATED_TO'
),
contracts as (
  select s.id as stmt_id, s.subject_entity_id as company_id,
         (s.attributes->>'amount_gbp')::numeric as amount, s.confidence
  from public.statements s
  where s.statement_type = 'CONTRACTED_WITH'
),
loop_co as (
  select d.company_id,
         array_agg(distinct d.stmt_id) filter (where d.stmt_id is not null) as donation_stmt_ids,
         array_agg(distinct c.stmt_id) filter (where c.stmt_id is not null) as contract_stmt_ids,
         max(d.amount) as top_donation_gbp,
         sum(distinct d.amount) as donation_total_gbp,
         count(distinct c.stmt_id) as contract_count,
         sum(c.amount) as contract_total_gbp,
         (select party.canonical_name from public.canonical_entities party
            where party.id = (array_agg(d.party_id))[1]) as party_name,
         least(min(d.confidence), min(c.confidence)) as min_conf
  from donations d
  join contracts c on c.company_id = d.company_id
  group by d.company_id
),
cand as (
  select
    'LOOP_CLOSED' as shape_code,
    array[lc.company_id] as member_entity_ids,
    lc.donation_stmt_ids || lc.contract_stmt_ids as member_statement_ids,
    jsonb_build_object(
      'company', ce.canonical_name,
      'party', lc.party_name,
      'donation_gbp', lc.top_donation_gbp,
      'donation_total_gbp', lc.donation_total_gbp,
      'contract_count', lc.contract_count,
      'contract_total_gbp', lc.contract_total_gbp
    ) as slots,
    coalesce(lc.donation_total_gbp, 0) + coalesce(lc.contract_total_gbp, 0) as total_gbp,
    lc.min_conf as min_confidence
  from loop_co lc
  join public.canonical_entities ce on ce.id = lc.company_id
),
scored as (
  select c.*,
    (select geometric_mean_idf.g from (
       select exp(avg(ln(nullif(ti.idf, 0)))) as g
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me
     ) geometric_mean_idf) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code,
  s.member_entity_ids,
  s.member_statement_ids,
  s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  round(least(1.0, log(10.0, 1 + s.total_gbp) / 6.0)::numeric, 4),
  1.0,
  round((
    1.0 * (0.4 + 0.6 * coalesce(s.rarity, 0))
    * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
    * (0.5 + 0.5 * least(1.0, log(10.0, 1 + s.total_gbp) / 6.0))
  )::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- SHARED_BENCH — a company/org tied to N>=3 distinct parliamentarians via a specific advisory or
-- board role (ADVISER_TO, DIRECTOR_OF, CHAIR_OF, SECRETARIAT_OF -- shareholdings via OWNS excluded,
-- they dilute this into every FTSE constituent and stop meaning anything). shape_weight 0.8.
-- Real instance: GB News (5 parliamentarians). A crude noise filter drops generic place/institution
-- names the current extraction mis-types as organisations (no upstream fix in scope this step).
-- ==================================================================================================
with noise as (
  select id from public.canonical_entities
  where entity_type in ('company', 'organisation')
    and (
      canonical_name ~* '^(london|oxford|cambridge|edinburgh|cardiff|manchester|birmingham|glasgow|belfast|usa|uk|online|virtual|geneva|brussels)$'
      or canonical_name ~ '^[0-9]'
      or canonical_name ~* '(university of|^the [a-z]+$)'
      or length(canonical_name) < 4
    )
),
ties as (
  select s.id as stmt_id, s.object_entity_id as org_id, s.subject_entity_id as person_id, s.confidence
  from public.statements s
  join public.canonical_entities org on org.id = s.object_entity_id
    and org.entity_type in ('company', 'organisation') and org.id not in (select id from noise)
  join public.canonical_entities p on p.id = s.subject_entity_id
    and p.entity_type = 'person' and p.category = 'mp'
  where s.statement_type in ('ADVISER_TO', 'DIRECTOR_OF', 'CHAIR_OF', 'SECRETARIAT_OF')
),
bench as (
  select org_id, array_agg(distinct person_id) as people, array_agg(distinct stmt_id) as stmt_ids,
         count(distinct person_id) as n_people, min(confidence) as min_conf
  from ties
  group by org_id
  having count(distinct person_id) >= 3
),
cand as (
  select
    'SHARED_BENCH' as shape_code,
    array[b.org_id] || b.people as member_entity_ids,
    b.stmt_ids as member_statement_ids,
    jsonb_build_object('org', ce.canonical_name, 'n_people', b.n_people,
                        'people', (select array_agg(p.canonical_name order by p.canonical_name)
                                     from unnest(b.people) pid join public.canonical_entities p on p.id = pid)) as slots,
    0::numeric as total_gbp,
    b.min_conf as min_confidence
  from bench b
  join public.canonical_entities ce on ce.id = b.org_id
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  0.0,
  0.8,
  round((0.8 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * 0.5)::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- FAMILY_DESK — two parliamentarians (or MP + officer) tied to the SAME company via DIRECTOR_OF /
-- OWNS / PSC_OF, sharing a surname. shape_weight 0.9. Real instance: IPGL / the Spencers. A
-- given-name-subset guard drops pairs that are really one unresolved person under two name-forms
-- (e.g. "Lord Fink" vs "FINK, Stanley, Lord") -- a real family pair has genuinely different given
-- names, a resolution-gap duplicate has one name nested inside the other.
-- ==================================================================================================
with links as (
  select s.id as stmt_id, s.object_entity_id as company_id, s.subject_entity_id as person_id, s.confidence,
    p.canonical_name,
    lower(case when p.canonical_name ~ ',' then trim(split_part(p.canonical_name, ',', 1))
               else regexp_replace(p.canonical_name, '^.* ', '') end) as surname,
    (select array_agg(distinct t) from unnest(string_to_array(
        regexp_replace(lower(
          case when p.canonical_name ~ ','
               then regexp_replace(split_part(p.canonical_name, ',', 2), '^ ', '')
               else regexp_replace(p.canonical_name, ' [^ ]*$', '') end
        ), '[^a-z ]', '', 'g'), ' ')) t
      where t not in ('mr','mrs','ms','dr','sir','dame','lord','lady','the','rt','hon','honourable','baroness','baron','earl','of','right')
    ) as given_tokens
  from public.statements s
  join public.canonical_entities p on p.id = s.subject_entity_id and p.entity_type = 'person'
  where s.statement_type in ('DIRECTOR_OF', 'OWNS', 'PSC_OF')
),
-- group by the (company, person_a, person_b) triple: a person can hold more than one statement
-- type against the same company (e.g. DIRECTOR_OF and PSC_OF), which would otherwise duplicate
-- the pair via distinct stmt_a/stmt_b combinations and break the findings primary key.
pairs as (
  select
    l1.company_id,
    least(l1.person_id, l2.person_id) as person_a,
    greatest(l1.person_id, l2.person_id) as person_b,
    l1.surname,
    array_agg(distinct l1.stmt_id) || array_agg(distinct l2.stmt_id) as pair_stmt_ids,
    least(min(l1.confidence), min(l2.confidence)) as min_conf
  from links l1
  join links l2 on l2.company_id = l1.company_id and l2.person_id > l1.person_id and l2.surname = l1.surname
  where length(l1.surname) > 2
    and not (l1.given_tokens <@ l2.given_tokens or l2.given_tokens <@ l1.given_tokens)
  group by l1.company_id, least(l1.person_id, l2.person_id), greatest(l1.person_id, l2.person_id), l1.surname
),
cand as (
  select
    'FAMILY_DESK' as shape_code,
    array[p.company_id, p.person_a, p.person_b] as member_entity_ids,
    p.pair_stmt_ids as member_statement_ids,
    jsonb_build_object('company', ce.canonical_name, 'surname', initcap(p.surname),
                        'person_a', pa.canonical_name, 'person_b', pb.canonical_name) as slots,
    0::numeric as total_gbp,
    p.min_conf as min_confidence
  from pairs p
  join public.canonical_entities ce on ce.id = p.company_id
  join public.canonical_entities pa on pa.id = p.person_a
  join public.canonical_entities pb on pb.id = p.person_b
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  0.0,
  0.9,
  round((0.9 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * 0.5)::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- BIG_MONEY — a DONATED_TO statement in the top decile by amount_gbp. shape_weight 0.6.
-- Real instance: Phoenix Partnership (Leeds) Ltd, £5m to the Conservative Party.
-- ==================================================================================================
with amounts as (
  select percentile_cont(0.9) within group (order by (attributes->>'amount_gbp')::numeric) as p90
  from public.statements
  where statement_type = 'DONATED_TO' and attributes ? 'amount_gbp'
),
big as (
  select s.id as stmt_id, s.subject_entity_id as donor_id, s.object_entity_id as recipient_id,
         (s.attributes->>'amount_gbp')::numeric as amount, s.confidence
  from public.statements s, amounts a
  where s.statement_type = 'DONATED_TO'
    and s.attributes ? 'amount_gbp'
    and (s.attributes->>'amount_gbp')::numeric >= a.p90
),
cand as (
  select
    'BIG_MONEY' as shape_code,
    array[b.donor_id, b.recipient_id] as member_entity_ids,
    array[b.stmt_id] as member_statement_ids,
    jsonb_build_object('donor', donor.canonical_name, 'recipient', recip.canonical_name,
                        'amount_gbp', b.amount)
      || case when donor.attributes ? 'jurisdiction'
              then jsonb_build_object('donor_jurisdiction', donor.attributes->>'jurisdiction')
              else '{}'::jsonb end as slots,
    b.amount as total_gbp,
    b.confidence as min_confidence
  from big b
  join public.canonical_entities donor on donor.id = b.donor_id
  join public.canonical_entities recip on recip.id = b.recipient_id
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  round(least(1.0, log(10.0, 1 + s.total_gbp) / 6.0)::numeric, 4),
  0.6,
  round((0.6 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * (0.5 + 0.5 * least(1.0, log(10.0, 1 + s.total_gbp) / 6.0)))::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- OVERSEAS_MONEY -- a DONATED_TO statement whose donor rolled-up jurisdiction (enrich_v1.sql,
-- Companies House residence/registration only, never invented) is present and not GB. Purely
-- deterministic: "overseas-linked" here is a factual descriptor of a registered residence or
-- registration, never an insinuation (CLAUDE.md THE LINE). shape_weight 0.95 -- these lead the
-- ranking. An EC donor and a same-named CH officer are NOT the same entity unless dedupe_v1
-- already merged them on a shared neighbour or DOB match, a same-name-only coincidence never
-- reaches this shape, it is a dotted lead in overseas_leads instead (below).
-- ==================================================================================================
with od as (
  select s.id as stmt_id, s.subject_entity_id as donor_id, s.object_entity_id as recipient_id,
         (s.attributes->>'amount_gbp')::numeric as amount, s.confidence,
         donor.attributes->>'jurisdiction' as jurisdiction
  from public.statements s
  join public.canonical_entities donor on donor.id = s.subject_entity_id
  where s.statement_type = 'DONATED_TO'
    and s.attributes ? 'amount_gbp'
    and donor.attributes ? 'jurisdiction'
    and donor.attributes->>'jurisdiction' <> 'GB'
),
cand as (
  select
    'OVERSEAS_MONEY' as shape_code,
    array[od.donor_id, od.recipient_id] as member_entity_ids,
    array[od.stmt_id] as member_statement_ids,
    jsonb_build_object(
      'donor', donor.canonical_name, 'recipient', recip.canonical_name,
      'amount_gbp', od.amount, 'jurisdiction', od.jurisdiction,
      'basis', 'Companies House registered residence'
    ) as slots,
    od.amount as total_gbp,
    od.confidence as min_confidence
  from od
  join public.canonical_entities donor on donor.id = od.donor_id
  join public.canonical_entities recip on recip.id = od.recipient_id
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  round(least(1.0, log(10.0, 1 + s.total_gbp) / 6.0)::numeric, 4),
  0.95,
  round((0.95 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * (0.5 + 0.5 * least(1.0, log(10.0, 1 + s.total_gbp) / 6.0)))::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- SECTOR_OVERLAP — reuses motifs_v2's conflict_flag: a parliamentarian whose declared interest
-- sector overlaps the remit of a committee/bill they sit on (conflict_strength = strong or medium).
-- shape_weight 0.85. Real instance: an MP flagged strong on a housing/finance/data_tech overlap.
-- Member statements are the same MEMBER_OF (committee) and DIRECTOR_OF/OWNS (interest) rows
-- motifs_v2 read to raise the flag, so the finding stays sourced to concrete statements, not just
-- the derived attribute.
-- ==================================================================================================
with flagged as (
  select ce.id as mp_id, ce.canonical_name, ce.attributes->>'conflict_strength' as strength,
         ce.attributes->>'conflict_overlap' as overlap
  from public.canonical_entities ce
  where ce.attributes->>'conflict_flag' = 'true'
    and ce.attributes->>'conflict_strength' in ('strong', 'medium')
),
committee_stmts as (
  select s.id as stmt_id, s.subject_entity_id as mp_id, s.object_entity_id as org_id, s.confidence
  from public.statements s
  where s.statement_type in ('MEMBER_OF', 'CHAIR_OF', 'MINISTERIAL_ROLE')
),
interest_stmts as (
  select s.id as stmt_id, s.subject_entity_id as mp_id, s.object_entity_id as org_id, s.confidence
  from public.statements s
  where s.statement_type in ('OWNS', 'DIRECTOR_OF')
),
agg as (
  select f.mp_id, f.canonical_name, f.strength, f.overlap,
    array_agg(distinct cs.stmt_id) filter (where cs.stmt_id is not null) as committee_stmt_ids,
    array_agg(distinct ints.stmt_id) filter (where ints.stmt_id is not null) as interest_stmt_ids,
    array_agg(distinct cs.org_id) filter (where cs.org_id is not null) as committee_org_ids,
    array_agg(distinct ints.org_id) filter (where ints.org_id is not null) as interest_org_ids,
    least(min(cs.confidence), min(ints.confidence)) as min_conf
  from flagged f
  join committee_stmts cs on cs.mp_id = f.mp_id
  join interest_stmts ints on ints.mp_id = f.mp_id
  group by f.mp_id, f.canonical_name, f.strength, f.overlap
),
cand as (
  select
    'SECTOR_OVERLAP' as shape_code,
    array[a.mp_id] || coalesce(a.interest_org_ids, array[]::uuid[]) as member_entity_ids,
    a.committee_stmt_ids || a.interest_stmt_ids as member_statement_ids,
    jsonb_build_object('mp', a.canonical_name, 'strength', a.strength, 'overlap', a.overlap) as slots,
    0::numeric as total_gbp,
    a.min_conf as min_confidence
  from agg a
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  0.0,
  0.85,
  round((0.85 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * 0.5)::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- QUIET_PORTFOLIO — a person with >= 3 DIRECTOR_OF/OWNS statements, ranked (via the rarity term)
-- by how few OTHER registers mention them -- a heavy declared portfolio that is otherwise quiet.
-- shape_weight 0.75. Real instance: heavy Lords directorships.
-- ==================================================================================================
with roles as (
  select s.id as stmt_id, s.subject_entity_id as person_id, s.object_entity_id as company_id, s.confidence
  from public.statements s
  join public.canonical_entities p on p.id = s.subject_entity_id and p.entity_type = 'person'
  where s.statement_type in ('DIRECTOR_OF', 'OWNS')
),
portfolio as (
  select person_id, array_agg(distinct stmt_id) as stmt_ids, array_agg(distinct company_id) as company_ids,
         count(distinct company_id) as n_companies, min(confidence) as min_conf
  from roles
  group by person_id
  having count(distinct company_id) >= 3
),
cand as (
  select
    'QUIET_PORTFOLIO' as shape_code,
    array[p.person_id] as member_entity_ids,
    p.stmt_ids as member_statement_ids,
    jsonb_build_object('person', ce.canonical_name, 'n_companies', p.n_companies,
                        'companies', (select array_agg(co.canonical_name order by co.canonical_name)
                                        from unnest(p.company_ids) cid join public.canonical_entities co on co.id = cid)) as slots,
    0::numeric as total_gbp,
    p.min_conf as min_confidence
  from portfolio p
  join public.canonical_entities ce on ce.id = p.person_id
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  0.0,
  0.75,
  round((0.75 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * 0.5)::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- CROSSING — an entity whose member statements span 3+ distinct registers (source_codes).
-- shape_weight 0.7. Real instance: Ecotricity / Ecotricity Group Limited (companies_house,
-- contracts_finder, electoral_commission, parliament_interests).
-- ==================================================================================================
with per_entity_src as (
  select eid, jsonb_array_elements_text(coalesce(attrs, '[]'::jsonb)) as src, stmt_id, confidence
  from (
    select s.subject_entity_id as eid, s.attributes->'sources' as attrs, s.id as stmt_id, s.confidence
    from public.statements s
    union all
    select s.object_entity_id as eid, s.attributes->'sources' as attrs, s.id as stmt_id, s.confidence
    from public.statements s
  ) x
),
crossing as (
  select eid, array_agg(distinct stmt_id) as stmt_ids, count(distinct src) as n_registers, min(confidence) as min_conf
  from per_entity_src
  group by eid
  having count(distinct src) >= 3
),
cand as (
  select
    'CROSSING' as shape_code,
    array[c.eid] as member_entity_ids,
    c.stmt_ids as member_statement_ids,
    jsonb_build_object('entity', ce.canonical_name, 'n_registers', c.n_registers) as slots,
    0::numeric as total_gbp,
    c.min_conf as min_confidence
  from crossing c
  join public.canonical_entities ce on ce.id = c.eid
  where ce.entity_type not in (select entity_type from tmp_hub_types)
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  0.0,
  0.7,
  round((0.7 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * 0.5)::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- NEW_ON_REGISTER — a single statement with valid_from within the last 30 days. shape_weight 0.5.
-- Rolling: this shape is time-sensitive by design and will change on every recompute.
-- ==================================================================================================
with recent as (
  select s.id as stmt_id, s.subject_entity_id as subj, s.object_entity_id as obj,
         s.statement_type, s.valid_from, s.confidence
  from public.statements s
  where s.valid_from >= current_date - interval '30 days'
),
cand as (
  select
    'NEW_ON_REGISTER' as shape_code,
    array[r.subj, r.obj] as member_entity_ids,
    array[r.stmt_id] as member_statement_ids,
    jsonb_build_object('subject', subj.canonical_name, 'statement_type', r.statement_type,
                        'object', obj.canonical_name, 'valid_from', r.valid_from) as slots,
    0::numeric as total_gbp,
    r.confidence as min_confidence
  from recent r
  join public.canonical_entities subj on subj.id = r.subj
  join public.canonical_entities obj on obj.id = r.obj
),
scored as (
  select c.*,
    (select exp(avg(ln(nullif(ti.idf, 0))))
       from unnest(c.member_entity_ids) me
       join public.canonical_entities ent on ent.id = me and ent.entity_type not in (select entity_type from tmp_hub_types)
       join tmp_idf ti on ti.id = me) as rarity,
    (select count(distinct ss.src) from unnest(c.member_statement_ids) msid
       join tmp_stmt_sources ss on ss.statement_id = msid) as n_registers
  from cand c
)
insert into public.findings
  (id, shape_code, member_entity_ids, member_statement_ids, slots,
   rarity, corroboration, money, shape_weight, surprise, min_confidence, is_lead, computed_at)
select
  md5(s.shape_code || '|' || (select string_agg(x::text, ',' order by x) from unnest(s.member_entity_ids) x)),
  s.shape_code, s.member_entity_ids, s.member_statement_ids, s.slots,
  round(coalesce(s.rarity, 0)::numeric, 4),
  round((1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))::numeric, 4),
  0.0,
  0.5,
  round((0.5 * (0.4 + 0.6 * coalesce(s.rarity, 0))
         * (1 + 0.5 * greatest(0, coalesce(s.n_registers, 1) - 1))
         * 0.5)::numeric, 4),
  round(s.min_confidence::numeric, 4),
  s.min_confidence < 0.80,
  now()
from scored s
where s.min_confidence >= 0.50;

-- ==================================================================================================
-- suggested_pairs — endpoint pairs worth tracing in Connect. A full bounded path search is heavy
-- in plain SQL, so this uses the approximation the spec allows: the two ends of a known
-- LOOP_CLOSED / FAMILY_DESK finding (already cross-register, already money-and-confidence gated),
-- picking the lowest-degree pair of members per finding so the suggestion favours a specific,
-- rare route over a hub-heavy one. Deduplicated by endpoint pair, kept small.
-- ==================================================================================================
with finding_members as (
  select f.id as finding_id, f.shape_code, f.slots, m as member_id
  from public.findings f, unnest(f.member_entity_ids) m
  where f.shape_code in ('LOOP_CLOSED', 'FAMILY_DESK') and f.is_lead = false
),
pairs_per_finding as (
  select a.finding_id, a.shape_code, a.slots,
         least(a.member_id, b.member_id) as ea, greatest(a.member_id, b.member_id) as eb,
         td_a.degree + td_b.degree as total_degree
  from finding_members a
  join finding_members b on b.finding_id = a.finding_id and b.member_id > a.member_id
  left join tmp_degree td_a on td_a.id = a.member_id
  left join tmp_degree td_b on td_b.id = b.member_id
),
best_per_finding as (
  select distinct on (finding_id) finding_id, shape_code, slots, ea, eb, total_degree
  from pairs_per_finding
  order by finding_id, total_degree asc nulls first
),
cand as (
  select
    ea, eb, shape_code,
    case when shape_code = 'LOOP_CLOSED'
         then 'Both trace through ' || coalesce(slots->>'company', 'the same company') ||
              ' -- a donor to ' || coalesce(slots->>'party', 'a party') ||
              ' that also holds public contracts.'
         else 'Linked through ' || coalesce(slots->>'company', 'the same company') ||
              ', sharing the surname ' || coalesce(slots->>'surname', '') || '.'
    end as why,
    total_degree
  from best_per_finding
  where ea is not null and eb is not null
),
ranked as (
  select distinct on (ea, eb) ea, eb, why, total_degree
  from cand
  order by ea, eb, total_degree asc nulls last
)
insert into public.suggested_pairs (id, from_entity_id, to_entity_id, why, surprise, computed_at)
select
  md5('PAIR|' || least(r.ea, r.eb)::text || '|' || greatest(r.ea, r.eb)::text),
  r.ea, r.eb, r.why,
  round((1.0 / (1.0 + coalesce(r.total_degree, 0)))::numeric, 4),
  now()
from ranked r
order by total_degree asc nulls last
limit 40;

-- ==================================================================================================
-- overseas_leads -- the disclaimed, dotted Harborne-shaped lead (Wave A.3). An EC donor (person)
-- with total declared donations >= GBP 250,000 whose exact name-key -- the SAME sorted-token,
-- title-stripped key dedupe_v1.sql already computed into tmp_pkey -- matches a DIFFERENT person
-- canonical entity carrying a non-GB attributes->>jurisdiction (enrich_v1.sql, Companies House
-- residence only). tmp_pkey is still in scope here: recompute.py runs the whole BUILD list in one
-- transaction and tmp_pkey is "on commit drop", not dropped per statement or per file (the same
-- reuse insights_v1.sql documents for tmp_hub_types/tmp_degree/tmp_stmt_sources, both created in
-- THIS file). NEVER a merge, NEVER a finding, NEVER a statement: a shared name alone is not an
-- identification (THE LINE, CLAUDE.md) -- this table is exactly the sanctioned dotted-lead
-- mechanism, rendered disclaimed ("names can coincide") on the donor dossier and the related
-- BIG_MONEY finding page.
-- ==================================================================================================
with donor_totals as (
  select s.subject_entity_id as donor_id,
         sum((s.attributes->>'amount_gbp')::numeric) as total_gbp
  from public.statements s
  join public.canonical_entities donor on donor.id = s.subject_entity_id and donor.entity_type = 'person'
  where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp'
  group by s.subject_entity_id
  having sum((s.attributes->>'amount_gbp')::numeric) >= 250000
),
top_recipient as (
  select distinct on (s.subject_entity_id) s.subject_entity_id as donor_id,
         recip.canonical_name as recipient_name,
         (s.attributes->>'amount_gbp')::numeric as amount_gbp
  from public.statements s
  join public.canonical_entities recip on recip.id = s.object_entity_id
  where s.statement_type = 'DONATED_TO' and s.attributes ? 'amount_gbp'
  order by s.subject_entity_id, (s.attributes->>'amount_gbp')::numeric desc
),
matches as (
  select dt.donor_id, donor.canonical_name as donor_name,
         tr.recipient_name, tr.amount_gbp,
         officer.id as officer_entity_id, officer.canonical_name as officer_name,
         officer.attributes->>'jurisdiction' as country
  from donor_totals dt
  join public.canonical_entities donor on donor.id = dt.donor_id
  join tmp_pkey dpk on dpk.id = dt.donor_id and dpk.namekey <> ''
  join tmp_pkey opk on opk.namekey = dpk.namekey and opk.id <> dpk.id
  join public.canonical_entities officer on officer.id = opk.id
    and officer.entity_type = 'person'
    and officer.attributes ? 'jurisdiction'
    and officer.attributes->>'jurisdiction' <> 'GB'
  left join top_recipient tr on tr.donor_id = dt.donor_id
)
insert into public.overseas_leads
  (id, donor_entity_id, donor_name, officer_name, country, amount_gbp, recipient, computed_at)
select
  md5('OVERSEAS_LEAD|' || m.donor_id::text || '|' || m.officer_entity_id::text),
  m.donor_id, m.donor_name, m.officer_name, m.country, m.amount_gbp, m.recipient_name, now()
from matches m;
