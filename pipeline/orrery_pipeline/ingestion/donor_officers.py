"""Donor -> Companies House officer bridge (The Front Page, Wave D.2) -- the acceptance-test
unlock.

The international layer (enrich_v1.sql + findings_v1.sql's OVERSEAS_MONEY / overseas_leads,
Wave A) is a pure rollup of Companies House officer `country_of_residence` already captured by
companies_house.py. It yields nothing today because our CH slice (~47 companies, reached via a
handful of anchor seeds + the interest-register bridge) happens to contain no officer record for
any big political donor -- Christopher Harborne (Reform UK's GBP 9,000,000 donor) has a real CH
officer record (registered residence Thailand) but none of HIS companies are in our graph yet.

This loader closes that gap deterministically, for the top individual donors by total declared
value:

  1. Group raw Electoral Commission donor mentions (entity_type_hint='person') by the SAME
     sorted-token, title-stripped name key dedupe_v1.sql's person namekey uses (so "Mr Christopher
     Harborne" and "Christopher Harborne" collapse into one donor group, while "Christopher
     Charles Sherriff Harborne" -- a distinct declared name with its own donations -- stays its
     own group). Sum declared value per group; take the top 40 groups >= GBP 500,000.
  2. CH `GET /search/officers?q={name}` (name = the group's longest/most descriptive raw_name, for
     search relevance). Accept ONLY results whose title, normalised with the SAME name key, EXACTLY
     equals the donor group's key -- never a "closest match", never fuzzy. Multiple exact-name
     officer records are all accepted (they may be different real people who share a name; THE
     LINE -- ingesting their public CH records is fine, nothing is merged here).
  3. For each accepted officer, fetch its appointments and take up to 3 ACTIVE appointed company
     numbers. Ingest each new company via companies_house.crawl(number, max_companies=1) (the
     company + its own officers/PSCs, not a deep BFS) -- the same reuse pattern
     companies_from_interests.py uses. Already-CH-sourced numbers are skipped. Total new companies
     ingested this run is capped at ~60.

This is PUBLIC Companies House data landing as its own mentions/assertions under the existing
'companies_house' source -- no new source row, no merging, no identity decision. Resolution
(resolve_v3 + dedupe_v1) decides, later and separately, whether a donor mention and a CH officer
mention are the same canonical entity (shared neighbour / DOB match only) -- a bare name match
here is deliberately NOT sufficient for that (overseas_leads exists precisely for the
same-name-not-merged case).

Stdlib + pg8000 only. Reuses companies_house's API client, SQL-safe quoting, crawl, build_sql,
apply_sql.

Usage:
    python -m orrery_pipeline.ingestion.donor_officers [max_new_companies] [top_n_donors]
        (defaults: max_new_companies=60, top_n_donors=40)
"""

from __future__ import annotations

import os
import re
import sys
import time
from urllib.parse import quote

from . import companies_house as ch
from .companies_house import apply_sql, build_sql, crawl, get as ch_get

SEARCH_PACE = 0.35  # on top of ch.get's own 0.25s RATE_PAUSE -> ~0.6s/request per the plan
MIN_TOTAL_GBP = 500_000
DEFAULT_TOP_N = 40
DEFAULT_MAX_NEW_COMPANIES = 60
MAX_APPOINTMENTS_PER_OFFICER = 3

# The SAME title/honorific word set dedupe_v1.sql's person namekey regex strips (mirrored here
# token-wise rather than via the SQL anchored-regex, which is equivalent for our purpose and more
# robust to adjacent title words).
_TITLE_WORDS = {
    "mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "lord", "lady", "rt", "hon",
    "honourable", "the", "rev", "reverend", "prof", "professor", "baroness", "baron",
    "earl", "viscount", "councillor", "cllr", "qc", "kc", "mp",
}


def person_namekey(name: str) -> str:
    """Lowercase, strip punctuation, drop title/honorific tokens, sort remaining tokens --
    the same key dedupe_v1.sql's tmp_pkey computes for persons, so a match here is always a
    match there."""
    text = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower())
    tokens = [t for t in text.split() if t and t not in _TITLE_WORDS]
    return " ".join(sorted(tokens))


# ──────────────────────────── DB helpers ────────────────────────────

DONOR_ROWS_SQL = """
select m.raw_name, (ra.raw_attributes->>'value_gbp')::numeric as value_gbp
from public.mentions m
join public.relationship_assertions ra
  on ra.from_mention_id = m.id and ra.statement_type = 'DONATED_TO'
join public.source_documents sd
  on sd.id = m.source_document_id and sd.source_code = 'electoral_commission'
where m.entity_type_hint = 'person'
  and ra.raw_attributes ? 'value_gbp'
"""

ALREADY_CH_SQL = """
select distinct split_part(external_ref, ':', 1)
from public.source_documents
where source_code = 'companies_house'
"""


def connect(db_url: str):
    import pg8000.native
    import ssl
    from urllib.parse import unquote, urlparse

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


def fetch_top_donor_groups(con, top_n: int) -> list[tuple[str, str, float]]:
    """-> [(namekey, representative_raw_name, total_gbp), ...] sorted by total desc, filtered to
    total >= MIN_TOTAL_GBP, top_n groups. Representative name = the longest raw_name seen for that
    key (most tokens -> best CH search relevance)."""
    rows = con.run(DONOR_ROWS_SQL)
    totals: dict[str, float] = {}
    best_name: dict[str, str] = {}
    for raw_name, value_gbp in rows:
        if not raw_name:
            continue
        key = person_namekey(raw_name)
        if not key:
            continue
        totals[key] = totals.get(key, 0.0) + float(value_gbp or 0)
        if key not in best_name or len(raw_name) > len(best_name[key]):
            best_name[key] = raw_name

    groups = [
        (key, best_name[key], total)
        for key, total in totals.items()
        if total >= MIN_TOTAL_GBP
    ]
    groups.sort(key=lambda t: -t[2])
    return groups[:top_n]


def fetch_already_ingested(con) -> set[str]:
    rows = con.run(ALREADY_CH_SQL)
    return {r[0].strip().upper() for r in rows if r[0]}


# ──────────────────────────── CH search: exact-namekey officers ────────────────────────────

def search_exact_officers(donor_key: str, query_name: str) -> tuple[list[dict], str]:
    """Return (accepted_items, reason). accepted_items are every /search/officers result whose
    normalised title EXACTLY equals donor_key -- zero, one, or more (homonyms are all accepted;
    nothing here merges an officer with the donor)."""
    try:
        data = ch_get(f"/search/officers?q={quote(query_name)}")
    except Exception as e:  # network/HTTP error -- skip, never guess
        return [], f"search-error:{e}"
    time.sleep(SEARCH_PACE)
    items = (data or {}).get("items", [])
    accepted = [it for it in items if person_namekey(it.get("title", "")) == donor_key]
    if not accepted:
        return [], "no-exact-match"
    return accepted, "matched"


def active_appointment_companies(officer_item: dict) -> tuple[list[str], str]:
    """Fetch the officer's appointments and return up to MAX_APPOINTMENTS_PER_OFFICER ACTIVE
    appointed company numbers."""
    appts_path = (officer_item.get("links") or {}).get("self")
    if not appts_path:
        return [], "no-appointments-link"
    try:
        data = ch_get(appts_path)
    except Exception as e:
        return [], f"appointments-error:{e}"
    time.sleep(SEARCH_PACE)
    numbers = []
    for a in (data or {}).get("items", []):
        appointed = a.get("appointed_to") or {}
        if appointed.get("company_status") != "active":
            continue
        num = (appointed.get("company_number") or "").strip().upper()
        if num and num not in numbers:
            numbers.append(num)
        if len(numbers) >= MAX_APPOINTMENTS_PER_OFFICER:
            break
    return numbers, "ok"


# ──────────────────────────── main ────────────────────────────

def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    max_new_companies = int(argv[1]) if len(argv) > 1 else DEFAULT_MAX_NEW_COMPANIES
    top_n = int(argv[2]) if len(argv) > 2 else DEFAULT_TOP_N

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        raise SystemExit("SUPABASE_DB_URL not set (put it in .env / the environment).")

    con = connect(db_url)
    try:
        groups = fetch_top_donor_groups(con, top_n)
        already = fetch_already_ingested(con)
    finally:
        con.close()

    print(f"donor groups considered (namekey, total >= GBP {MIN_TOTAL_GBP:,}): {len(groups)}")
    print(f"already CH-sourced company numbers (will skip if re-matched): {len(already)}")
    print()

    new_companies_ingested = 0
    hit_cap = False

    for donor_key, donor_name, total_gbp in groups:
        if hit_cap:
            break

        accepted, reason = search_exact_officers(donor_key, donor_name)
        if not accepted:
            print(f"  {donor_name!r} (GBP {total_gbp:,.0f}): no exact-name CH officer match ({reason})")
            continue

        companies_this_donor = 0
        for officer in accepted:
            if hit_cap:
                break
            numbers, areason = active_appointment_companies(officer)
            if not numbers:
                continue
            for number in numbers:
                if new_companies_ingested >= max_new_companies:
                    hit_cap = True
                    break
                if number in already:
                    continue
                try:
                    companies = crawl(number, max_companies=1)
                except Exception as e:
                    print(f"    crawl-error {number}: {e}")
                    continue
                if number not in companies:
                    continue
                sql, summary = build_sql(companies)
                apply_sql(db_url, sql)
                already.add(number)
                new_companies_ingested += 1
                companies_this_donor += 1
                title = companies[number]["profile"].get("company_name")
                print(f"    INGESTED {number} ({title!r}) via officer {officer.get('title')!r}  [{summary}]")

        print(f"  {donor_name!r} (GBP {total_gbp:,.0f}): "
              f"{len(accepted)} matched officer(s), {companies_this_donor} new companies ingested")

    print()
    print(f"total new companies ingested: {new_companies_ingested}"
          + (" (cap reached)" if hit_cap else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
