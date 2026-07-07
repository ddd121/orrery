-- Register of All-Party Parliamentary Groups (The Front Page, Wave D.4) -- a scrutiny surface
-- not covered yet: APPGs are informal cross-party groups, often carrying paid secretariats and
-- financial backing from outside organisations.
--
-- Source: publications.parliament.uk's "Register Of All-Party Parliamentary Groups" (maintained
-- by the Parliamentary Commissioner for Standards, republished roughly every 6 weeks), NO API
-- key. Adds the source row + reliability prior so ingestion/appg.py can land declared officers
-- and registrable financial benefits under source_code = 'appg'. Statement types (CHAIR_OF /
-- MEMBER_OF / FUNDS) and the 'appg' entity type already exist in seed_lookups.
--
-- Idempotent (on conflict do nothing); appg.py's own build_sql also upserts this row, so this
-- migration is belt-and-braces for a fresh recompute that hasn't run the loader yet.

insert into public.sources (code, name, jurisdiction, url, licence, reliability_prior, notes)
values ('appg', 'UK Parliament — Register of All-Party Parliamentary Groups', 'GB',
        'https://publications.parliament.uk/pa/cm/cmallparty/',
        'Open Parliament Licence', 0.950,
        'Declared APPG officers (Chair/Vice-Chair/Treasurer/Secretary) and registrable '
        'financial benefits (>= GBP 1,500) received from external sources. Maintained by the '
        'Parliamentary Commissioner for Standards, republished roughly every 6 weeks. '
        'Extraction is precision-first: rows that do not parse cleanly are skipped rather than '
        'guessed.')
on conflict (code) do nothing;
