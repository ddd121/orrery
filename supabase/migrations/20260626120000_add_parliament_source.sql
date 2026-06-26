-- The Parliament *members* feed (party, constituency, committee seats, ministerial roles)
-- is a distinct official register from the Register of Members' Financial Interests, with its
-- own reliability prior. It was previously mislabelled under `parliament_interests`; give it
-- its own source row so `ingestion/parliament.py` can land it under `source_code = 'parliament'`.

insert into public.sources (code, name, jurisdiction, url, licence, reliability_prior, notes)
values ('parliament', 'UK Parliament — Members', 'GB', 'https://members-api.parliament.uk/',
        'Open Parliament Licence', 0.970,
        'Current MPs: party, constituency, committee seats, ministerial roles. Official Members API.')
on conflict (code) do nothing;
