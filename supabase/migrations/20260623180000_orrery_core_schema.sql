-- ════════════════════════════════════════════════════════════════════════
-- ORRERY — core statement-based schema  (Milestone 1)
-- Authoritative model: docs/resolution-confidence-engine-spec.md §1–§2
--
-- Provenance-first and RECOMPUTABLE. Three node layers, kept distinct:
--   mention            — a raw reference exactly as it appears in ONE source
--   canonical_entity   — the resolved real-world thing (clustered mentions)
--   statement          — a typed edge between canonical entities
-- The mention→canonical mapping is its own probabilistic table, so resolution
-- can be re-run as new data arrives WITHOUT losing provenance, and every merge
-- is auditable. Raw landing (mentions, relationship_assertions) is immutable;
-- resolution (mention_resolutions) and edge-scoring (statements) are layers
-- computed on top.
--
-- Two numbers per link, NEVER conflated:
--   confidence — how sure we are the link is real and correctly identified
--   strength   — assuming it's real, how meaningful the tie is
-- Both are computed in Milestone 4; their columns are nullable until then.
-- ════════════════════════════════════════════════════════════════════════

-- pgvector for embedding-based blocking (columns added in M3 when blocking
-- is built; the extension is part of the Tier-1 stack so we enable it now).
create extension if not exists vector with schema extensions;

-- Shared trigger to maintain updated_at. search_path pinned empty to satisfy
-- the Supabase "function_search_path_mutable" security advisor.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────────── lookups (tunable) ─────────────────────────
-- Weights/priors live in-DB so they are tunable without code changes.

create table public.sources (
  code              text primary key,                       -- e.g. 'companies_house'
  name              text not null,
  jurisdiction      text not null default 'GB',
  url               text,
  licence           text,
  -- r_s ∈ (0,1] — official register ≈ .97, leak ≈ .9, press ≈ .7, social ≈ .4
  reliability_prior numeric(4,3) not null check (reliability_prior > 0 and reliability_prior <= 1),
  notes             text,
  created_at        timestamptz not null default now()
);
comment on table public.sources is 'Datasets/registers. reliability_prior r_s is the per-source confidence prior (engine-spec §2).';

create table public.entity_types (
  code             text primary key,                        -- 'person','company','party',…
  label            text not null,
  -- the resolution-relevant distinction; everything non-person is an organisation
  fundamental_kind text not null check (fundamental_kind in ('person','organisation')),
  ui_color         text,                                    -- palette hint for the prototype UI
  ui_icon          text,
  description      text
);
comment on table public.entity_types is 'Controlled vocabulary of canonical-entity kinds; ui_* feed the M5 prototype.';

create table public.statement_types (
  code        text primary key,                             -- 'DIRECTOR_OF','DONATED_TO',…
  label       text not null,
  category    text,                                         -- UI grouping: 'Appointment','Donation','Contract',…
  -- §3 strength base weight (FAMILY .95, CO_DIRECTOR .7, HOSPITALITY .3, CO_MENTION .1, …)
  type_weight numeric(4,3) not null default 0.500 check (type_weight >= 0 and type_weight <= 1),
  -- §5.1 how strongly influence transmits along this edge in a chain (ownership high, co-attendance ≈ 0)
  conductance numeric(4,3) not null default 0.500 check (conductance >= 0 and conductance <= 1),
  directed    boolean not null default true,                -- false ⇒ symmetric (e.g. SHARES_ADDRESS_WITH)
  description text
);
comment on table public.statement_types is 'Edge vocabulary with tunable type_weight (strength §3) and conductance (propagation §5.1).';

-- ───────────────────────── provenance + raw landing ──────────────────────

create table public.source_documents (
  id           uuid primary key default gen_random_uuid(),
  source_code  text not null references public.sources(code),
  external_ref text,                                        -- filing id / CSV row / API resource id
  url          text,                                        -- link back to the primary source (non-negotiable)
  title        text,
  retrieved_at timestamptz not null default now(),
  content_hash text,
  raw          jsonb,                                       -- payload exactly as fetched
  created_at   timestamptz not null default now()
);
comment on table public.source_documents is 'A specific fetched artefact from a source — the provenance anchor every node/edge traces back to.';
create index source_documents_source_idx on public.source_documents (source_code);
create unique index source_documents_source_ref_uq
  on public.source_documents (source_code, external_ref) where external_ref is not null;

create table public.mentions (
  id                 uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  entity_type_hint   text references public.entity_types(code),     -- best guess at raw time
  raw_name           text not null,                                 -- exactly as it appears in the source
  normalised_name    text,                                          -- filled by the pipeline
  raw_attributes     jsonb not null default '{}'::jsonb,            -- dob, address, nationality, company_number, role…
  -- starter blocking keys; M3 extends these when blocking is built
  surname_metaphone  text,
  dob_year           int check (dob_year is null or dob_year between 1700 and 2200),
  created_at         timestamptz not null default now()
);
comment on table public.mentions is 'Raw, immutable entity reference from one source document. Never destructively merged.';
create index mentions_source_doc_idx on public.mentions (source_document_id);
create index mentions_normalised_name_idx on public.mentions (normalised_name);
create index mentions_block_idx on public.mentions (surname_metaphone, dob_year);

create table public.relationship_assertions (
  id                 uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  statement_type     text not null references public.statement_types(code),
  from_mention_id    uuid not null references public.mentions(id) on delete cascade,
  to_mention_id      uuid not null references public.mentions(id) on delete cascade,
  valid_from         date,
  valid_to           date,                                          -- null ⇒ ongoing / unknown
  raw_attributes     jsonb not null default '{}'::jsonb,            -- amount_gbp, percentage, position…
  asserted_at        timestamptz not null default now(),
  constraint relationship_assertions_distinct_ck check (from_mention_id <> to_mention_id),
  constraint relationship_assertions_interval_ck check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
comment on table public.relationship_assertions is 'Raw, immutable relationship asserted by one source between two mentions. Resolved into statements in M4.';
create index relationship_assertions_from_idx on public.relationship_assertions (from_mention_id);
create index relationship_assertions_to_idx on public.relationship_assertions (to_mention_id);
create index relationship_assertions_type_idx on public.relationship_assertions (statement_type);
create index relationship_assertions_doc_idx on public.relationship_assertions (source_document_id);

-- ─────────────────────── resolution layer (recomputable) ──────────────────

create table public.canonical_entities (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        text not null references public.entity_types(code),
  canonical_name     text not null,
  display_name       text,
  attributes         jsonb not null default '{}'::jsonb,            -- representative/merged attributes
  category           text,                                          -- finer UI hint (e.g. 'minister','donor'), derived
  resolution_version int not null default 1,                        -- which resolution run produced this
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.canonical_entities is 'Resolved real-world entity formed by clustering mentions. A recomputable view of the raw layer.';
create index canonical_entities_type_idx on public.canonical_entities (entity_type);
create index canonical_entities_name_idx on public.canonical_entities (canonical_name);
create trigger trg_canonical_entities_updated_at
  before update on public.canonical_entities
  for each row execute function public.set_updated_at();

create table public.mention_resolutions (
  id                  uuid primary key default gen_random_uuid(),
  mention_id          uuid not null references public.mentions(id) on delete cascade,
  canonical_entity_id uuid not null references public.canonical_entities(id) on delete cascade,
  -- calibrated probability that this mention IS this entity (engine-spec §4/§6)
  match_confidence    numeric(5,4) not null check (match_confidence >= 0 and match_confidence <= 1),
  method              text not null check (method in ('deterministic','splink','graph','llm','human')),
  model_version       text,
  rationale           text,                                         -- LLM/human reasoning — audit trail
  is_active           boolean not null default true,                -- current resolution; history retained
  decided_at          timestamptz not null default now()
);
comment on table public.mention_resolutions is 'Probabilistic, recomputable mention→canonical mapping. The auditable heart of resolution (engine-spec §4).';
-- a mention has at most one ACTIVE resolution; older runs are kept for audit
create unique index mention_resolutions_active_uq on public.mention_resolutions (mention_id) where is_active;
create index mention_resolutions_entity_idx on public.mention_resolutions (canonical_entity_id) where is_active;

-- ─────────────────── resolved edges + scoring layer (M4) ──────────────────

create table public.statements (
  id                 uuid primary key default gen_random_uuid(),
  subject_entity_id  uuid not null references public.canonical_entities(id) on delete cascade,
  statement_type     text not null references public.statement_types(code),
  object_entity_id   uuid not null references public.canonical_entities(id) on delete cascade,
  valid_from         date,
  valid_to           date,
  attributes         jsonb not null default '{}'::jsonb,
  -- computed in M4; nullable until then
  confidence         numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  strength           numeric(5,4) check (strength   is null or (strength   >= 0 and strength   <= 1)),
  resolution_version int not null default 1,
  computed_at        timestamptz,
  created_at         timestamptz not null default now(),
  constraint statements_distinct_ck check (subject_entity_id <> object_entity_id),
  constraint statements_interval_ck check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
comment on table public.statements is 'Resolved typed edge between canonical entities. The layer the app reads. confidence vs strength never conflated.';
create index statements_subject_idx on public.statements (subject_entity_id);
create index statements_object_idx on public.statements (object_entity_id);
create index statements_type_idx on public.statements (statement_type);
-- one logical edge per (subject, type, object, validity window) per resolution run
create unique index statements_logical_edge_uq on public.statements (
  subject_entity_id, statement_type, object_entity_id,
  (coalesce(valid_from, '-infinity'::date)),
  (coalesce(valid_to,   'infinity'::date)),
  resolution_version
);

create table public.statement_assertions (
  statement_id              uuid not null references public.statements(id) on delete cascade,
  relationship_assertion_id uuid not null references public.relationship_assertions(id) on delete cascade,
  primary key (statement_id, relationship_assertion_id)
);
comment on table public.statement_assertions is 'Links a resolved statement to the raw assertion(s) backing it — the corroboration substrate for noisy-OR (§2) and full provenance.';
create index statement_assertions_assertion_idx on public.statement_assertions (relationship_assertion_id);

-- ───────────────────────────── row-level security ────────────────────────
-- Locked down: RLS on every table, no permissive policies. The pipeline writes
-- and the app's server side read via the service role (which bypasses RLS).
-- Browser-direct read policies can be added in M5 if the UI reads Supabase
-- directly rather than through Next.js API routes.

alter table public.sources                 enable row level security;
alter table public.entity_types            enable row level security;
alter table public.statement_types         enable row level security;
alter table public.source_documents        enable row level security;
alter table public.mentions                enable row level security;
alter table public.relationship_assertions enable row level security;
alter table public.canonical_entities      enable row level security;
alter table public.mention_resolutions     enable row level security;
alter table public.statements              enable row level security;
alter table public.statement_assertions    enable row level security;
