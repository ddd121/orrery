-- UK public contracts (Contracts Finder / Find a Tender, OCDS) — the 5th register.
-- Closes the loop: connects government contract AWARDS to companies already in the graph
-- (donor companies, Companies House companies), linking money/power to public spending.
--
-- Source: contractsfinder.service.gov.uk — awarded notices, OCDS JSON, NO API key.
-- The CONTRACTED_WITH statement_type already exists (seed_lookups); this only adds the
-- source row + its reliability prior so ingestion/contracts_finder.py can land awards under
-- source_code = 'contracts_finder'. A contract award is a sourced public-record fact.

insert into public.sources (code, name, jurisdiction, url, licence, reliability_prior, notes)
values ('contracts_finder', 'UK Contracts Finder', 'GB',
        'https://www.contractsfinder.service.gov.uk/',
        'Open Government Licence v3.0', 0.960,
        'Awarded public contracts (OCDS). Buyer department + awarded supplier + value + dates. '
        'Supplier names are buyer-declared; Companies House numbers are carried only when the '
        'buyer provided them, so suppliers are attached to existing graph companies by our own '
        'verified company_number on a normalised-name match (deterministic, no fuzzy public merge).')
on conflict (code) do nothing;
