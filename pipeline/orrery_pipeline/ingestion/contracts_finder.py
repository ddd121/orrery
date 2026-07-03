"""UK public contracts ingestion (Contracts Finder / Find a Tender, OCDS) — the 5th register.

This is the source that *closes the loop*: it connects government contract AWARDS to
companies already in the graph (donor companies + Companies House companies), tying
money/power to public spending.

  buyer mention        the contracting authority / public-sector buyer (government_body)
  supplier mention     the awarded company — carries the supplier's Companies House number
                       so resolution (resolve_v3, by normalised company_number) MERGES it
                       with the existing donor / CH company. That merge is what closes the loop.
  CONTRACTED_WITH      supplier company -> buyer ('Holds contract from'), carrying the award
                       value (value_gbp in raw_attributes, like donations) + dates.

Bounded slice — NOT a bulk ingest. We first read the companies already in the graph (their
canonical names + verified company_numbers), then for each we ask Contracts Finder for AWARDED
notices and keep only the awards whose *awarded supplier name* actually matches that company.
The known company_number is then stamped onto the supplier mention from our own verified seed
(never guessed), so the deterministic company-number merge attaches the contract to the exact
existing entity. Contracts to companies NOT already in the graph are ignored on purpose.

Why match on supplier name + stamp our CRN: the Contracts Finder API has no supplier filter,
and its OCDS output carries the supplier's Companies House number only when the buyer provided
it (often absent). So we (a) constrain to suppliers we already hold and (b) attach by the
company_number we already trust — deterministic, precision-first, no fuzzy public merge.

Source: contractsfinder.service.gov.uk — keyless (Open Government Licence). Stdlib only;
writes via SUPABASE_DB_URL (pg8000), reusing the Companies House loader's SQL-safe quoting +
applier.

Usage:
    python -m orrery_pipeline.ingestion.contracts_finder [max_per_company] [statuses]
        max_per_company  notices to scan per company (default 50)
        statuses         comma-sep CF statuses (default "Awarded")
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

from .companies_house import s, j, apply_sql

# Keyless V2 REST search (full-text) + the per-notice detail that carries the awards array.
CF_BASE = "https://www.contractsfinder.service.gov.uk"
SEARCH_URL = f"{CF_BASE}/api/rest/2/search_notices/json"
NOTICE_URL = f"{CF_BASE}/Published/Notice"  # /{id} -> { notice, awards[...] }
PAUSE = 0.2  # polite pacing between calls


# ──────────────────────────── name normalisation / matching ────────────────────────────

# Strip legal suffixes + punctuation but KEEP distinguishing words (e.g. "group"), so
# "Ecotricity Group Limited" (03521776) and "Ecotricity Limited" (03043412) stay distinct.
_SUFFIXES = re.compile(
    r"\b(limited|ltd|plc|public limited company|llp|l\.?l\.?p\.?|"
    r"company|co|incorporated|inc|the)\b",
    re.IGNORECASE,
)


def norm_name(name: str) -> str:
    n = html.unescape(name or "").lower()
    n = n.replace("&", " and ")
    n = re.sub(r"[^a-z0-9 ]+", " ", n)
    n = _SUFFIXES.sub(" ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


# Generic trailing words that make a full-text query too loose (the CF search is AND-ish over
# loose terms, so "Ecotricity Group Limited" matches any notice with group/limited). For the
# SEARCH QUERY ONLY we keep the distinctive leading words and drop these; the strict per-award
# supplier match still uses the FULL normalised name, so precision is unaffected.
_GENERIC_TAIL = {
    "group", "holdings", "holding", "uk", "gb", "international", "global", "services",
    "service", "solutions", "capital", "partners", "partnership", "ventures", "trading",
    "investments", "management", "enterprises", "industries", "europe", "european",
    "finance", "financial",
}


def search_key(norm: str) -> str:
    """Distinctive leading phrase of a normalised name, for the full-text query. Strips generic
    trailing words but always keeps at least the first token (e.g. 'ecotricity group' ->
    'ecotricity'; 'phoenix partnership leeds' -> 'phoenix'; 'quadrature capital' -> 'quadrature')."""
    toks = norm.split()
    if not toks:
        return norm
    kept = [toks[0]]
    for t in toks[1:]:
        if t in _GENERIC_TAIL:
            break
        kept.append(t)
    return " ".join(kept)


# ──────────────────────────── API client ────────────────────────────

def _post(url: str, body: dict) -> dict | None:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "orrery-pipeline/0.1 (research)",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.load(r)
        time.sleep(PAUSE)
        return out
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(5)
            return _post(url, body)
        if e.code == 404:
            return None
        raise


def _get(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "orrery-pipeline/0.1 (research)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.load(r)
        time.sleep(PAUSE)
        return out
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(5)
            return _get(url)
        if e.code == 404:
            return None
        raise


def search_awarded(keyword: str, statuses: list[str], size: int) -> list[dict]:
    """Full-text search for notices mentioning `keyword` in the given statuses.
    NB the keyword is full-text (matches title/description too), so callers MUST re-check
    the actual awarded supplier name — see fetch_company_awards."""
    body = {"searchCriteria": {"keyword": keyword, "statuses": statuses}, "size": size}
    res = _post(SEARCH_URL, body) or {}
    return [n.get("item", n) for n in (res.get("noticeList") or [])]


def notice_awards(notice_id: str) -> tuple[str | None, list[dict]]:
    """Return (buyer_name, awards[]) for a notice. awards[] each carry supplierName,
    supplierAddress, value, supplierAwardedValue, awardedDate, startDate, endDate, awardGuid."""
    res = _get(f"{NOTICE_URL}/{notice_id}") or {}
    notice = res.get("notice") or {}
    buyer = notice.get("organisationName")
    return buyer, (res.get("awards") or [])


# ──────────────────────────── slice: awards to known companies ────────────────────────────

def to_gbp(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def fetch_company_awards(companies: list[dict], max_per_company: int, statuses: list[str]) -> list[dict]:
    """For each known company (name + company_number), find AWARDED notices where it is the
    actual awarded supplier. Dedupe per (notice, company) so a multi-lot framework to the same
    supplier yields one tie (representative max value), not one per lot.

    `companies`: [{name, company_number, norm}]. Returns award dicts ready for build_sql.
    """
    by_norm: dict[str, dict] = {c["norm"]: c for c in companies if c["norm"]}
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()  # (notice_id, company_number)

    for c in companies:
        if not c["norm"]:
            continue
        # search by the distinctive leading phrase (full legal name is too loose for CF's
        # full-text search); the per-award supplier match below still uses the full norm.
        notices = search_awarded(c.get("search_key") or c["norm"], statuses, max_per_company)
        for it in notices:
            nid = it.get("id")
            supplier_field = it.get("awardedSupplier") or ""
            # cheap pre-filter: does this company's name appear among the awarded suppliers?
            cand_norms = {norm_name(x) for x in supplier_field.split(",")}
            if c["norm"] not in cand_norms:
                continue
            buyer, awards = notice_awards(nid)
            if not buyer:
                continue
            # find this company's award row(s) on the notice; keep the representative one
            matched = [a for a in awards if norm_name(a.get("supplierName") or "") == c["norm"]]
            if not matched:
                continue
            key = (nid, c["company_number"])
            if key in seen:
                continue
            seen.add(key)
            # representative value = max award value across this supplier's lots on the notice
            vals = [to_gbp(a.get("supplierAwardedValue")) or to_gbp(a.get("value")) for a in matched]
            vals = [v for v in vals if v is not None]
            value_gbp = max(vals) if vals else None
            rep = matched[0]
            out.append({
                "notice_id": nid,
                "notice_ref": it.get("noticeIdentifier"),
                "title": it.get("title"),
                "buyer": buyer,
                "company": c,
                "supplier_name_raw": rep.get("supplierName"),
                "supplier_address": rep.get("supplierAddress"),
                "value_gbp": value_gbp,
                "awarded_date": (rep.get("awardedDate") or it.get("awardedDate") or "")[:10] or None,
                "start_date": (rep.get("startDate") or it.get("start") or "")[:10] or None,
                "end_date": (rep.get("endDate") or it.get("end") or "")[:10] or None,
                "lots": len(matched),
            })
    return out


# ──────────────────────────── SQL emit ────────────────────────────

def build_sql(awards: list[dict], source_url: str):
    rows = {"source_documents": [], "mentions": [], "relationship_assertions": []}
    doc_id = str(uuid.uuid4())
    rows["source_documents"].append(
        f"({s(doc_id)}, 'contracts_finder', {s('awarded-notices')}, {s(source_url)}, "
        f"{s('UK Contracts Finder — awarded public contracts (OCDS)')}, null, null)"
    )

    for a in awards:
        c = a["company"]
        # supplier mention carries OUR verified company_number -> resolve_v3 merges it with the
        # existing donor / CH company (deterministic). raw_name keeps the buyer-declared name.
        supplier_attrs = {
            "company_number": c["company_number"],  # deterministic key to the existing entity
            "supplier_address": a["supplier_address"],
            "matched_existing": c["name"],
        }
        supplier_mid = str(uuid.uuid4())
        rows["mentions"].append(
            f"({s(supplier_mid)}, {s(doc_id)}, 'company', {s(a['supplier_name_raw'])}, "
            f"{j(supplier_attrs)}, null)"
        )

        buyer_attrs = {"notice_ref": a["notice_ref"], "buyer_role": "contracting_authority"}
        buyer_mid = str(uuid.uuid4())
        rows["mentions"].append(
            f"({s(buyer_mid)}, {s(doc_id)}, 'government_body', {s(a['buyer'])}, "
            f"{j(buyer_attrs)}, null)"
        )

        # CONTRACTED_WITH: supplier 'Holds contract from' buyer (matches the seeded direction).
        assert_attrs = {
            "value_gbp": a["value_gbp"],
            "title": a["title"],
            "notice_ref": a["notice_ref"],
            "notice_id": a["notice_id"],
            "awarded_date": a["awarded_date"],
            "lots": a["lots"],
            "url": f"{CF_BASE}/notice/{a['notice_id']}",
        }
        # stable external-ref-ish identity for the assertion lives in attributes (notice_id +
        # company_number); the row id is a uuid like the other loaders.
        rows["relationship_assertions"].append(
            f"({s(str(uuid.uuid4()))}, {s(doc_id)}, 'CONTRACTED_WITH', {s(supplier_mid)}, "
            f"{s(buyer_mid)}, {s(a['awarded_date'] or a['start_date'])}, {s(a['end_date'])}, "
            f"{j(assert_attrs)})"
        )

    cols = {
        "source_documents": "id, source_code, external_ref, url, title, content_hash, raw",
        "mentions": "id, source_document_id, entity_type_hint, raw_name, raw_attributes, dob_year",
        "relationship_assertions":
            "id, source_document_id, statement_type, from_mention_id, to_mention_id, valid_from, valid_to, raw_attributes",
    }
    # Idempotent re-ingest: drop any prior contracts load first (FK cascade removes its mentions
    # + assertions + resolutions) so re-running over a larger company set never duplicates rows or
    # collides on the fixed (source_code, external_ref) unique key.
    parts = ["delete from public.source_documents where source_code = 'contracts_finder';"]
    for table in ("source_documents", "mentions", "relationship_assertions"):
        if rows[table]:
            parts.append(
                f"insert into public.{table} ({cols[table]}) values\n" + ",\n".join(rows[table]) + ";"
            )
    return "\n\n".join(parts), {k: len(v) for k, v in rows.items()}


# ──────────────────────────── read existing companies ────────────────────────────

def load_existing_companies(db_url: str) -> list[dict]:
    """Read companies already in the resolved graph (canonical_entities) with a company_number."""
    from urllib.parse import unquote, urlparse
    import ssl
    import pg8000.native  # pure-Python

    u = urlparse(db_url)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    con = pg8000.native.Connection(
        user=unquote(u.username or "postgres"), password=unquote(u.password or ""),
        host=u.hostname, port=u.port or 5432,
        database=(u.path or "/postgres").lstrip("/") or "postgres", ssl_context=ctx,
    )
    try:
        recs = con.run(
            "select display_name, attributes->>'company_number' "
            "from public.canonical_entities "
            "where entity_type = 'company' "
            "  and coalesce(attributes->>'company_number','') <> '' "
            "order by display_name"
        )
    finally:
        con.close()
    out = []
    for name, cono in recs:
        nm = norm_name(name)
        out.append({"name": name, "company_number": cono, "norm": nm, "search_key": search_key(nm)})
    return out


# ──────────────────────────── entry point ────────────────────────────

def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows console
    except Exception:
        pass
    max_per_company = int(argv[1]) if len(argv) > 1 else 50
    statuses = (argv[2].split(",") if len(argv) > 2 else ["Awarded"])

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("SUPABASE_DB_URL not set — needed to read the existing companies to target.")
        return 1

    companies = load_existing_companies(db_url)
    print(f"targeting {len(companies)} existing companies (donor + CH) with company numbers")

    awards = fetch_company_awards(companies, max_per_company, statuses)
    print(f"matched {len(awards)} contract awards to existing companies:")
    for a in sorted(awards, key=lambda x: -(x["value_gbp"] or 0)):
        v = f"£{a['value_gbp']:,.0f}" if a["value_gbp"] else "£n/a"
        print(f"  {a['company']['name']} ({a['company']['company_number']}) "
              f"— {a['buyer']} — {v} — {a['title'][:60] if a['title'] else ''}")

    if not awards:
        print("no awards matched existing companies; nothing to load.")
        return 0

    sql, summary = build_sql(awards, SEARCH_URL)
    print(f"records: {summary}")

    apply_sql(db_url, sql)
    print("applied via SUPABASE_DB_URL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
