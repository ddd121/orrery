"""Companies House BRIDGE (Milestone 6/7 follow-on).

Peers and MPs *declare* companies in the interest registers (lords_interests,
register_of_interests) as bare names — name-only islands with no Companies House
record, so a declared directorship doesn't connect to the company's other
officers/PSCs or to any donations/contracts already in the graph.

This loader closes that gap DETERMINISTICALLY. The Companies Act forbids two
*active* companies from sharing a name, so an EXACT normalised-name match to a
single ACTIVE company returned by the CH search endpoint is essentially unique —
safe for the public graph without fuzzy matching or an LLM in the loop.

For each declared company name (ranked by how many distinct parliamentarians
declare it):
  1. CH `GET /search/companies?q={name}`.
  2. Normalise every candidate's `title` the same way as the declared name
     (lowercase, strip punctuation, collapse whitespace, drop "the", fold
     ltd/limited/plc/llp/... to a single legal-suffix marker) and keep only
     candidates whose normalised title EXACTLY equals the declared key AND whose
     `company_status == 'active'`.
  3. Exactly one such candidate -> verified match. Zero, or more than one -> SKIP
     (never take a "closest" or top-ranked non-exact hit).
  4. For each verified company_number, ingest it via companies_house.crawl(number,
     max_companies=1) — the company + its own officers/PSCs, NOT a deep BFS — and
     apply the resulting SQL. Resolution (dedupe_v1.sql) then merges the declared
     name-only company with this CH-sourced record by normalised name-key, so the
     interest tie attaches to the full company.

Numbers already CH-sourced are skipped (cheap idempotence; re-ingesting is
harmless but wasteful — resolution would just dedupe the duplicate source_document).

Stdlib only; reuses companies_house's API client, SQL-safe quoting, apply_sql.

Usage:  python -m orrery_pipeline.ingestion.companies_from_interests [max_companies]
        (default max_companies: 60)
"""

from __future__ import annotations

import os
import re
import sys
import time

from . import companies_house as ch
from .companies_house import apply_sql, build_sql, crawl, get as ch_get, s

SEARCH_PACE = 0.3  # seconds between CH search calls, on top of ch.get's own RATE_PAUSE

# Legal-form suffixes grouped into CLASSES. A match requires the same class (or one side
# carrying no recognised suffix) — crucially a foreign "Inc"/"LLC" must NEVER fold into a UK
# "Ltd"/"plc", and "plc" must not fold into "Limited": those are different legal entities, and
# folding them created false matches ("Blackstone Inc" -> a coincidental "BLACKSTONE LTD";
# "GlaxoSmithKline plc" -> a different "GLAXOSMITHKLINE LIMITED" subsidiary).
_SUFFIX_CLASSES = [
    (re.compile(r"\b(ltd|limited|cyf|cyfyngedig)\b"), "ltd"),   # ltd == limited (incl. Welsh)
    (re.compile(r"\bplc\b"), "plc"),
    (re.compile(r"\bllp\b"), "llp"),
    (re.compile(r"\blp\b"), "lp"),
    (re.compile(r"\b(llc|inc|incorporated|corp|corporation)\b"), "foreign"),
]
# Weak markers stripped from the base but NOT treated as a class (often part of the name).
_WEAK_MARKER = re.compile(r"\b(the|company|co)\b")


# ──────────────── name key: (base, suffix_class) — base half matches dedupe_v1.sql ────────────────

def name_key(name: str) -> tuple[str, str]:
    """-> (base, suffix_class). `base` is lowercased, punctuation-stripped, "the"/"company"/"co"-
    dropped, sorted tokens — the SAME sorted-token, legal-suffix-stripped key dedupe_v1.sql's org
    name-key uses, so an equal base here merges there. `suffix_class` is one of ltd/plc/llp/lp/
    foreign/none, and must be compatible (see `compatible`) for a bridge match — this half is
    STRICTER than dedupe (which ignores the suffix), so a bridge match is always a dedupe match."""
    text = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower())
    cls = "none"
    for pat, c in _SUFFIX_CLASSES:
        if pat.search(text):
            cls = c
            text = pat.sub(" ", text)
    text = _WEAK_MARKER.sub(" ", text)
    base = " ".join(sorted(t for t in text.split() if t))
    return base, cls


def compatible(c1: str, c2: str) -> bool:
    """Suffix classes match if equal, or if one side carries no recognised suffix. A foreign
    marker (Inc/LLC) is never compatible with a UK form, nor plc with ltd."""
    return c1 == c2 or "none" in (c1, c2)


# ──────────────────────────── candidate query ────────────────────────────

CANDIDATES_SQL = """
select ra.raw_name as declared_name, count(distinct ra.person_mid) as n_declarers
from (
  select m.id as company_mid, m.raw_name,
         coalesce(rel_from.from_mention_id, rel_to.to_mention_id) as person_mid
  from public.mentions m
  left join public.relationship_assertions rel_to on rel_to.to_mention_id = m.id
  left join public.relationship_assertions rel_from on rel_from.from_mention_id = m.id
  where m.entity_type_hint = 'company'
    and (m.raw_attributes->>'via' like 'lords_interests%%'
         or m.raw_attributes->>'via' like 'register_of_interests%%')
) ra
where ra.person_mid is not null
group by ra.raw_name
order by n_declarers desc, ra.raw_name asc
"""

ALREADY_CH_SQL = """
select distinct split_part(external_ref, ':', 1)
from public.source_documents
where source_code = 'companies_house'
"""


def fetch_candidates(con) -> list[tuple[str, int]]:
    rows = con.run(CANDIDATES_SQL)
    return [(r[0], r[1]) for r in rows if r[0]]


def fetch_already_ingested(con) -> set[str]:
    rows = con.run(ALREADY_CH_SQL)
    return {r[0].strip().upper() for r in rows if r[0]}


# ──────────────────────────── CH search + strict exact-active match ────────────────────────────

def search_exact_active(declared_name: str) -> tuple[dict, str] | tuple[None, str]:
    """Return (matched_item, reason) on a unique exact-active match, else (None, reason)."""
    base, cls = name_key(declared_name)
    if not base:
        return None, "empty-normalised-key"
    try:
        from urllib.parse import quote
        data = ch_get(f"/search/companies?q={quote(declared_name)}")
    except Exception as e:  # network/HTTP error — skip, never guess
        return None, f"search-error:{e}"
    time.sleep(SEARCH_PACE)
    items = (data or {}).get("items", [])
    exact_active = []
    for it in items:
        t_base, t_cls = name_key(it.get("title", ""))
        if t_base == base and compatible(cls, t_cls) and it.get("company_status") == "active":
            exact_active.append(it)
    if len(exact_active) == 1:
        return exact_active[0], "matched"
    if len(exact_active) == 0:
        return None, "no-exact-active-match"
    return None, f"ambiguous:{len(exact_active)}-exact-active-hits"


# ──────────────────────────── main ────────────────────────────

def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    max_companies = int(argv[1]) if len(argv) > 1 else 60

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        raise SystemExit("SUPABASE_DB_URL not set (put it in .env / the environment).")

    import ssl
    import pg8000.native
    from urllib.parse import unquote, urlparse

    u = urlparse(db_url)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    con = pg8000.native.Connection(
        user=unquote(u.username or "postgres"),
        password=unquote(u.password or ""),
        host=u.hostname,
        port=u.port or 5432,
        database=(u.path or "/postgres").lstrip("/") or "postgres",
        ssl_context=ctx,
    )

    try:
        candidates = fetch_candidates(con)
        already = fetch_already_ingested(con)
    finally:
        con.close()

    print(f"declared-company candidates considered: {len(candidates)} distinct names")
    print(f"already CH-sourced company numbers (will skip if re-matched): {len(already)}")

    matched: list[tuple[str, str, str, str]] = []  # declared, title, number, status
    skipped: dict[str, int] = {}
    skipped_examples: dict[str, list[str]] = {}

    processed = 0
    for declared_name, n_declarers in candidates:
        if processed >= max_companies:
            break
        processed += 1

        item, reason = search_exact_active(declared_name)
        if item is None:
            skipped[reason] = skipped.get(reason, 0) + 1
            skipped_examples.setdefault(reason, [])
            if len(skipped_examples[reason]) < 8:
                skipped_examples[reason].append(declared_name)
            continue

        number = (item.get("company_number") or "").strip().upper()
        title = item.get("title")
        status = item.get("company_status")

        if number in already:
            skipped["already-ch-sourced"] = skipped.get("already-ch-sourced", 0) + 1
            skipped_examples.setdefault("already-ch-sourced", [])
            if len(skipped_examples["already-ch-sourced"]) < 8:
                skipped_examples["already-ch-sourced"].append(f"{declared_name} -> {title} ({number})")
            continue

        # Ingest just this company (its own officers/PSCs, not a deep BFS).
        try:
            companies = crawl(number, max_companies=1)
        except Exception as e:
            skipped["crawl-error"] = skipped.get("crawl-error", 0) + 1
            skipped_examples.setdefault("crawl-error", [])
            if len(skipped_examples["crawl-error"]) < 8:
                skipped_examples["crawl-error"].append(f"{declared_name} -> {title} ({number}): {e}")
            continue

        if number not in companies:
            skipped["crawl-empty"] = skipped.get("crawl-empty", 0) + 1
            continue

        sql, summary = build_sql(companies)
        apply_sql(db_url, sql)
        already.add(number)  # don't re-ingest if the same number matches a later declared name

        matched.append((declared_name, title, number, status))
        print(f"  MATCHED  {declared_name!r} -> {title!r} ({number}, {status})  "
              f"[{summary}]")

    print()
    print(f"processed: {processed}  matched: {len(matched)}  skipped: {sum(skipped.values())}")
    print("skip reasons:")
    for reason, count in sorted(skipped.items(), key=lambda kv: -kv[1]):
        print(f"  {reason}: {count}")
        for ex in skipped_examples.get(reason, [])[:5]:
            print(f"    e.g. {ex!r}")

    print()
    print("full matched list (declared name -> CH title (number, status)):")
    for declared_name, title, number, status in matched:
        print(f"  {declared_name!r} -> {title!r} ({number}, {status})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
