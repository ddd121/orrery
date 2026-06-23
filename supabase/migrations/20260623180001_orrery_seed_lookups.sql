-- ════════════════════════════════════════════════════════════════════════
-- ORRERY — seed the tunable lookups  (Milestone 1)
-- Priors/weights are starting points; they are CALIBRATED against the gold set
-- (engine-spec §6) and tuned per source. Edit freely — they live in-DB on
-- purpose. Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

-- ── sources: the three MVP registers, with reliability priors (§2) ────────
insert into public.sources (code, name, jurisdiction, url, licence, reliability_prior, notes) values
  ('companies_house',      'Companies House',                       'GB',
   'https://developer.company-information.service.gov.uk/',
   'Crown Copyright / Open Government Licence', 0.970,
   'Officers, PSCs, filings, registered offices. Official register.'),
  ('electoral_commission', 'Electoral Commission',                  'GB',
   'https://search.electoralcommission.org.uk/',
   'Open Government Licence', 0.970,
   'Political donations and loans. Official register; donor names are self-declared.'),
  ('parliament_interests', 'UK Parliament — Registers of Interests', 'GB',
   'https://www.parliament.uk/mps-lords-and-offices/standards-and-financial-interests/',
   'Open Parliament Licence', 0.950,
   'Members'' financial interests, APPG register, ministerial roles.')
on conflict (code) do nothing;

-- ── entity_types: fundamental kinds; ui_* are hints for the M5 prototype ──
insert into public.entity_types (code, label, fundamental_kind, ui_color, ui_icon, description) values
  ('person',          'Person',           'person',       '#D9C27A', 'User',      'A natural person (officer, PSC, member, donor, adviser…). Role lives in canonical_entities.category.'),
  ('company',         'Company',          'organisation', '#6FC3B8', 'Building2', 'A registered company (Companies House).'),
  ('organisation',    'Organisation',     'organisation', '#E5654B', 'Briefcase', 'A non-company organisation (e.g. lobbying / public-affairs firm).'),
  ('party',           'Political party',  'organisation', '#9C8BD8', 'Flag',      'A registered political party.'),
  ('government_body', 'Government body',  'organisation', '#6F9BD8', 'Landmark',  'A government department or public body.'),
  ('appg',            'APPG',             'organisation', '#7CC58E', 'Users',     'An All-Party Parliamentary Group.')
on conflict (code) do nothing;

-- ── statement_types: edge vocabulary with type_weight (§3) + conductance (§5.1)
--    directed = false ⇒ symmetric edge. Weights are pre-calibration defaults.
insert into public.statement_types (code, label, category, type_weight, conductance, directed, description) values
  -- Companies House (M2)
  ('DIRECTOR_OF',      'Director of',                'Appointment', 0.700, 0.600, true,  'Officer appointment (person → company).'),
  ('PSC_OF',           'Significant control of',     'Ownership',   0.850, 0.850, true,  'Person with significant control (person → company).'),
  ('OWNS',             'Owns',                       'Ownership',   0.800, 0.900, true,  'Ownership / shareholding; magnitude scaled by % at compute time. Transmits control strongly.'),
  ('SHARES_ADDRESS_WITH','Shares address with',      'Address',     0.400, 0.200, false, 'Shared registered office/address; informative only inversely to how common the address is (rarity §3).'),
  ('CO_DIRECTOR',      'Co-director with',           'Appointment', 0.700, 0.400, false, 'Two people who are co-directors of the same company.'),
  -- Electoral Commission (M6)
  ('DONATED_TO',       'Donated to',                 'Donation',    0.700, 0.500, true,  'Political donation/loan; magnitude scaled by £ at compute time.'),
  -- Parliament interests (M6)
  ('MEMBER_OF',        'Member of',                  'Membership',  0.600, 0.300, true,  'Party membership / affiliation.'),
  ('CHAIR_OF',         'Chairs',                     'Appointment', 0.750, 0.550, true,  'Chairs a group/committee (e.g. an APPG).'),
  ('SECRETARIAT_OF',   'Provides secretariat to',    'Appointment', 0.600, 0.450, true,  'Organisation runs the secretariat for a group.'),
  ('FUNDS',            'Funds',                      'Funding',     0.600, 0.450, true,  'Funds a group/APPG; magnitude scaled by £.'),
  ('HOSPITALITY_FROM', 'Received hospitality from',  'Hospitality', 0.300, 0.200, true,  'Declared hospitality/gift received (person ← provider).'),
  ('ADVISER_TO',       'Adviser to',                 'Appointment', 0.550, 0.450, true,  'Advisory relationship.'),
  ('MINISTERIAL_ROLE', 'Minister at',                'Appointment', 0.900, 0.700, true,  'Holds a ministerial role at a government body. Strong public-office tie.'),
  ('CONTRACTED_WITH',  'Holds contract from',        'Contract',    0.700, 0.500, true,  'Government contract award; magnitude scaled by £.'),
  -- General
  ('FAMILY_OF',        'Family of',                  'Family',      0.950, 0.600, false, 'Family relationship.'),
  ('CO_MENTION',       'Co-mentioned with',          'Mention',     0.100, 0.050, false, 'Co-occurrence in a source; weak by construction.')
on conflict (code) do nothing;
