-- ORRERY — graph-aware dedup v1 (engine-spec §4.4 "collective resolution", the SAFE
-- deterministic subset). Runs AFTER resolve_v3 and BEFORE edges_v2: it merges canonical
-- entities that resolve_v3 left split because they share no deterministic key (different CH
-- officer_id per appointment for the same director; register-of-interests names with no stable
-- id appearing N times; punctuation/format variants like "Mr." vs "Mr").
--
-- It works by reassigning the losers' active mention_resolutions to a survivor and deleting the
-- loser canonical_entities; edges_v2 then builds statements over the merged set. Provenance is
-- preserved (mentions + mention_resolutions are never destroyed, only repointed), so this is a
-- recomputable layer, not a destructive merge.
--
-- PRECISION OVER RECALL is the #1 rule — a wrong merge of two different people is a critical
-- (libel) failure. Hence:
--   * persons merge ONLY when two same-name nodes share a canonical neighbour (§4.4) or a
--     DOB-year — name alone NEVER merges a person (two different "James Moore" stay distinct;
--     the calibrated Splink/Fellegi-Sunter matcher handles the hard cases later).
--   * orgs/companies merge on a distinctive sorted-token name key (low collision). We exclude
--     government_body entirely: those parenthetical minister/committee role names are token-bag
--     collisions waiting to happen ("Minister of State (DTI) (also FCO)" vs the FCO-first
--     wording share every token) and resolve_v3 already merged the real committee duplicates.
--
-- Idempotent: re-running finds no remaining same-key duplicates and is a no-op. Pure SQL only
-- (no dollar-quoted bodies / DO blocks) so recompute.py's statement splitter runs it faithfully.

-- ----------------------------------------------------------------------------------------------
-- 0) Neighbour graph as it stands after resolve_v3 (the exact endpoints edges_v2 will use):
--    a canonical entity's neighbour = the canonical entity on the other end of any
--    relationship_assertion touching one of its active mentions. Undirected, self-loops dropped.
--
--    HUB GUARD (the libel safety): we exclude `party` and `government_body` neighbours as
--    connectors. Those are pure aggregation hubs — "both donated to Labour" or "both sat under
--    the same department" is NOT evidence two same-named people are the same person (Labour alone
--    has degree ~103 here; a single shared hub is near-zero Jaccard, §4.4). Sharing a *specific*
--    company or individual IS evidence (co-director of one named company; donor to one named
--    person). This is exactly what keeps two different "Martin Taylor"s — both linked only to
--    Labour — from being merged, while letting "HESTER, Francis…" == "…Francis… Hester" merge on
--    their shared Phoenix Partnership directorship.
-- ----------------------------------------------------------------------------------------------
create temporary table tmp_m2e on commit drop as
select mr.mention_id, mr.canonical_entity_id
from public.mention_resolutions mr
where mr.is_active;
create index on tmp_m2e (mention_id);

create temporary table tmp_hub on commit drop as
select id from public.canonical_entities where entity_type in ('party', 'government_body');

create temporary table tmp_nbr on commit drop as
select distinct ent, neighbour from (
  select e.canonical_entity_id as ent, o.canonical_entity_id as neighbour
  from public.relationship_assertions ra
  join tmp_m2e e on e.mention_id = ra.from_mention_id
  join tmp_m2e o on o.mention_id = ra.to_mention_id
  where e.canonical_entity_id <> o.canonical_entity_id
  union all
  select o.canonical_entity_id as ent, e.canonical_entity_id as neighbour
  from public.relationship_assertions ra
  join tmp_m2e e on e.mention_id = ra.from_mention_id
  join tmp_m2e o on o.mention_id = ra.to_mention_id
  where e.canonical_entity_id <> o.canonical_entity_id
) u
where u.neighbour not in (select id from tmp_hub);  -- drop hub connectors (party / gov body)
create index on tmp_nbr (ent);

-- ----------------------------------------------------------------------------------------------
-- 1) Candidate pairs to merge (same entity, undirected a<b). Two sources:
--    (a) PERSONS — same sorted-token name key AND (share a neighbour OR share a DOB-year).
--    (b) ORG/COMPANY — same sorted-token org key (legal-form-stripped); name match is enough.
--    A name key strips punctuation, titles/legal forms, then sorts the remaining tokens, so
--    "COWLING, Tom" == "Tom Cowling" and "Mr. Alan Halsall" == "Mr Alan Halsall" and
--    "J.C. Bamford Excavators Ltd" == "J.C. Bamford Excavators Limited".
-- ----------------------------------------------------------------------------------------------

-- person name key
create temporary table tmp_pkey on commit drop as
select ce.id,
       coalesce((
         select string_agg(tok, ' ' order by tok)
         from unnest(string_to_array(
           regexp_replace(
             regexp_replace(lower(ce.canonical_name), '[^a-z0-9 ]', ' ', 'g'),
             '(^| )(mr|mrs|ms|miss|mx|dr|sir|dame|lord|lady|rt|hon|honourable|the|rev|reverend|prof|professor|baroness|baron|earl|viscount|councillor|cllr|qc|kc|mp)( |$)',
             ' ', 'g'),
           ' ')) tok
         where tok <> ''
       ), '') as namekey,
       (ce.attributes->>'date_of_birth') as dob,
       (ce.attributes->>'birth_year')    as birth_year
from public.canonical_entities ce
where ce.entity_type = 'person';
create index on tmp_pkey (namekey);

-- org/company name key (government_body deliberately excluded — see header)
create temporary table tmp_okey on commit drop as
select ce.id,
       coalesce((
         select string_agg(tok, ' ' order by tok)
         from unnest(string_to_array(
           regexp_replace(
             regexp_replace(lower(ce.canonical_name), '[^a-z0-9 ]', ' ', 'g'),
             '(^| )(the|ltd|limited|plc|llp|llc|lp|inc|incorporated|cyf|cyfyngedig)( |$)',
             ' ', 'g'),
           ' ')) tok
         where tok <> ''
       ), '') as namekey
from public.canonical_entities ce
where ce.entity_type in ('organisation', 'company');
create index on tmp_okey (namekey);

create temporary table tmp_pairs (a uuid, b uuid) on commit drop;

-- (a) person pairs: same key, share a neighbour OR a DOB-year, exclude empty keys
insert into tmp_pairs (a, b)
select distinct least(p1.id, p2.id), greatest(p1.id, p2.id)
from tmp_pkey p1
join tmp_pkey p2 on p2.namekey = p1.namekey and p2.id <> p1.id and p1.namekey <> ''
where exists (
        select 1 from tmp_nbr n1 join tmp_nbr n2 on n2.neighbour = n1.neighbour
        where n1.ent = p1.id and n2.ent = p2.id
      )
   or ( p1.dob is not null and p1.dob = p2.dob )
   or ( p1.birth_year is not null and p1.birth_year = p2.birth_year )
   or ( p1.dob is not null and p2.birth_year is not null and left(p1.dob,4) = p2.birth_year )
   or ( p2.dob is not null and p1.birth_year is not null and left(p2.dob,4) = p1.birth_year );

-- (b) org/company pairs: same distinctive key (name match suffices), exclude empty keys
insert into tmp_pairs (a, b)
select distinct least(o1.id, o2.id), greatest(o1.id, o2.id)
from tmp_okey o1
join tmp_okey o2 on o2.namekey = o1.namekey and o2.id <> o1.id and o1.namekey <> '';

-- ----------------------------------------------------------------------------------------------
-- 2) Connected components over the candidate pairs (so transitively-mergeable groups collapse in
--    one shot — §4.4 "iterate to a fixpoint"). Union-find by iterative label propagation: each
--    node's component label starts as its own id, then repeatedly becomes the smallest label
--    across its candidate edges until nothing changes. Labels are uuids; Postgres has no
--    min(uuid) aggregate, so we aggregate on the canonical text form (same lexicographic order as
--    uuid) and cast back — order-preserving and deterministic. 8 relaxation passes settle any
--    realistic component here (largest candidate group = 4). Idempotent: with no pairs, tmp_edge
--    and tmp_lbl are empty and every pass is a no-op.
-- ----------------------------------------------------------------------------------------------
create temporary table tmp_edge on commit drop as
  select a, b from tmp_pairs union select b as a, a as b from tmp_pairs;  -- symmetric closure

create temporary table tmp_lbl on commit drop as
  select id as node, id as label from (
    select a as id from tmp_edge union select b as id from tmp_edge
  ) s;
create index on tmp_lbl (node);

update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;
update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;
update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;
update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;
update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;
update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;
update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;
update tmp_lbl l set label = m.ml
from (select e.a as node, min(x.label::text)::uuid ml from tmp_edge e join tmp_lbl x on x.node = e.b group by e.a) m
where m.node = l.node and m.ml < l.label;

-- ----------------------------------------------------------------------------------------------
-- 3) Pick a survivor per component: most active mention_resolutions, then lowest id (stable).
-- ----------------------------------------------------------------------------------------------
create temporary table tmp_cnt on commit drop as
  select l.node, l.label,
         (select count(*) from public.mention_resolutions mr
          where mr.canonical_entity_id = l.node and mr.is_active) as n_active
  from tmp_lbl l;

create temporary table tmp_survivor on commit drop as
  select distinct on (label) label, node as survivor
  from tmp_cnt
  order by label, n_active desc, node asc;
create index on tmp_survivor (label);

-- loser -> survivor map (exclude the survivor itself)
create temporary table tmp_merge on commit drop as
  select c.node as loser, s.survivor
  from tmp_cnt c join tmp_survivor s on s.label = c.label
  where c.node <> s.survivor;
create index on tmp_merge (loser);

-- ----------------------------------------------------------------------------------------------
-- 4) Apply the merge. Order matters for FK safety: repoint mention_resolutions, fold attributes
--    onto the survivor (survivor's own values win; fill nulls from losers), THEN delete losers.
-- ----------------------------------------------------------------------------------------------

-- 4a) Reassign every loser's mention_resolutions (active or not — keep full provenance) to its
--     survivor. After this the loser canonical has no referencing mention_resolutions.
update public.mention_resolutions mr
set canonical_entity_id = m.survivor
from tmp_merge m
where mr.canonical_entity_id = m.loser;

-- 4b) Merge attributes, survivor-priority. For each survivor, build the union of its losers'
--     non-null attribute keys, then overlay the survivor's OWN attributes on top (`loser_union
--     || survivor_attrs`) so the survivor always wins and we only ever ADD keys it was missing.
--     Computed in one statement; jsonb `||` is right-biased so survivor keys take precedence.
update public.canonical_entities ce
set attributes = coalesce(folded.loser_union, '{}'::jsonb) || ce.attributes,
    updated_at = now()
from (
  select m.survivor,
         (select jsonb_object_agg(k, v) from (
            select distinct on (kv.key) kv.key as k, kv.value as v
            from tmp_merge mm
            join public.canonical_entities l on l.id = mm.loser
            cross join lateral jsonb_each(l.attributes) kv
            where mm.survivor = m.survivor
              and kv.value is not null and kv.value <> 'null'::jsonb
            order by kv.key, l.id asc          -- lowest-id loser wins a contested key
          ) loser_attrs) as loser_union
  from (select distinct survivor from tmp_merge) m
) folded
where ce.id = folded.survivor;

-- 4c) Delete the loser canonical_entities (now unreferenced).
delete from public.canonical_entities ce
using tmp_merge m
where ce.id = m.loser;
