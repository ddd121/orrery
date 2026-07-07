"""News corroboration via GDELT DOC 2.0 (The Front Page, Wave B.1) -- keyless, no account.

For a bounded set of distinctive names (finding members + top-10-ranked insight entities +
overseas_leads donors, filtered to >= 2 tokens and >= 8 characters so a bare surname or a party
name never fires a query), quote-exact-searches GDELT's article index and keeps the top 3 results
by seendate into `public.coverage`.

Framing is name-mention only: a headline appearing here is never asserted as being about our
entity, it is "recent coverage mentioning this name" -- the reader (or journalist) checks the
article themselves. Recomputable: truncate + insert, safe to re-run.

Wired into `recompute.py` as a best-effort step run AFTER the BUILD transaction commits (its own
DB connection, its own try/except) -- a GDELT outage never fails the resolved-graph rebuild.
`SKIP_NEWS=1` bypasses it entirely. Every per-name failure (timeout, rate limit, malformed
response) is swallowed and counted, never raised.

GDELT's own rate-limit message (observed live) asks for one request every 5 seconds, tighter than
the roughly-1s pace floated in planning -- GDELT_PACE below honours the real, observed limit
rather than the earlier guess.

Stdlib + pg8000 only.

Usage:
    python -m orrery_pipeline.ingestion.news_coverage [max_names]
"""

from __future__ import annotations

import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.parse import unquote, urlparse

from .companies_house import apply_sql, s

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_PACE = 5.2  # seconds between calls -- GDELT asks for one every 5 seconds, observed live
MAX_NAMES_DEFAULT = 150
ARTICLES_PER_NAME = 3

NAME_SET_SQL = """
with member_ids as (
  select distinct m as entity_id, 3 as pr
  from public.findings f, unnest(f.member_entity_ids) m
),
top_insights as (
  select distinct entity_id, 2 as pr
  from public.entity_insights
  where rank is not null and rank <= 10
),
lead_donors as (
  select distinct donor_entity_id as entity_id, 1 as pr
  from public.overseas_leads
),
candidates as (
  select entity_id, min(pr) as pr
  from (
    select * from member_ids
    union all select * from top_insights
    union all select * from lead_donors
  ) u
  group by entity_id
)
select ce.id, ce.canonical_name
from candidates c
join public.canonical_entities ce on ce.id = c.entity_id
where array_length(regexp_split_to_array(btrim(ce.canonical_name), '\\s+'), 1) >= 2
  and length(ce.canonical_name) >= 8
order by c.pr asc, ce.canonical_name asc
"""


def connect(db_url: str):
    import pg8000.native

    u = urlparse(db_url)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pg8000.native.Connection(
        user=unquote(u.username or "postgres"),
        password=unquote(u.password or ""),
        host=u.hostname,
        port=u.port or 5432,
        database=(u.path or "/postgres").lstrip("/") or "postgres",
        ssl_context=ctx,
    )


def fetch_names(con, max_names: int) -> list[tuple[str, str]]:
    rows = con.run(NAME_SET_SQL)
    return [(str(eid), name) for eid, name in rows][:max_names]


def gdelt_articles(name: str) -> list[dict]:
    query = f'"{name}" sourcelang:eng'
    url = (
        f"{GDELT_URL}?query={urllib.parse.quote(query)}"
        f"&mode=artlist&maxrecords=5&format=json"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "orrery-pipeline/0.1 (research)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    return (data or {}).get("articles", [])[:ARTICLES_PER_NAME]


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    max_names = int(argv[1]) if len(argv) > 1 else MAX_NAMES_DEFAULT

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("SUPABASE_DB_URL not set (put it in .env / the environment); skipping.")
        return 0

    con = connect(db_url)
    try:
        names = fetch_names(con, max_names)
    finally:
        con.close()
    print(f"news coverage: querying GDELT for {len(names)} distinctive name(s) "
          f"(pace {GDELT_PACE}s)")

    rows = []
    n_ok, n_skipped = 0, 0
    for i, (entity_id, name) in enumerate(names):
        if i > 0:
            time.sleep(GDELT_PACE)
        try:
            articles = gdelt_articles(name)
        except Exception as e:  # network/timeout/rate-limit/bad-json -- tolerate silently
            n_skipped += 1
            continue
        if not articles:
            n_ok += 1
            continue
        n_ok += 1
        for art in articles:
            url = (art.get("url") or "").strip()
            title = (art.get("title") or "").strip()
            if not url or not title:
                continue
            cov_id = hashlib.md5(f"COVERAGE|{entity_id}|{url}".encode()).hexdigest()
            domain = art.get("domain")
            seendate = art.get("seendate")
            rows.append(
                f"({s(cov_id)}, {s(entity_id)}, {s(title)}, {s(domain)}, {s(url)}, "
                f"{s(seendate)}, now())"
            )

    print(f"names queried ok: {n_ok}  skipped (per-name failure): {n_skipped}  "
          f"articles collected: {len(rows)}")

    parts = ["truncate table public.coverage;"]
    if rows:
        parts.append(
            "insert into public.coverage (id, entity_id, title, domain, url, seendate, fetched_at) "
            "values\n" + ",\n".join(rows) + ";"
        )
    apply_sql(db_url, "\n\n".join(parts))
    print(f"coverage rebuilt: {len(rows)} row(s) written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
