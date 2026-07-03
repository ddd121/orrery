-- House of Lords Register of Interests — the 6th register.
-- Peers are appointed, not elected, and carry heavy business ties (chairmanships,
-- directorships, shareholdings) — a major scrutiny surface with no electoral check.
--
-- Source: members-api.parliament.uk — Members/{id}/RegisteredInterests, NO API key.
-- Adds the source row + reliability prior so ingestion/lords_interests.py can land
-- declared interests under source_code = 'lords_interests'. Statement types
-- (DIRECTOR_OF / ADVISER_TO / OWNS) already exist in seed_lookups.

insert into public.sources (code, name, jurisdiction, url, licence, reliability_prior, notes)
values ('lords_interests', 'UK Parliament — Register of Lords'' Interests', 'GB',
        'https://members-api.parliament.uk/',
        'Open Parliament Licence', 0.960,
        'Declared employment, directorships and shareholdings of members of the House of '
        'Lords (Categories 1 and 2 only; land/property, sponsorship, overseas visits, gifts '
        'and misc. financial interests are excluded — free text too messy to extract '
        'precisely). Extraction is precision-first: ambiguous or unparseable entries are '
        'skipped rather than guessed.')
on conflict (code) do nothing;
