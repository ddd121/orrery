"""Companies House ingestion (Milestone 2).

Crawls a small, connected seed from the Companies House Public Data API and lands
it *raw, with provenance* into the statement-based schema:

  source_documents      one per API resource fetched (profile / officers / PSCs),
                        carrying the raw JSON, the source URL, and a content hash
  mentions              one per company and one per officer/PSC *appearance*
                        (raw, per-source — never deduplicated; resolution clusters
                        them later in M3)
  relationship_assertions  DIRECTOR_OF (officer -> company) and PSC_OF / OWNS
                        (PSC -> company), with validity intervals

The crawl is a bounded breadth-first walk: start at an anchor company, then follow
its officers' *other appointments* to neighbouring companies. That deliberately
produces people who appear in more than one company — the signal entity resolution
exists to exploit.

Dependency-free (stdlib only) so it runs on the host Python without a venv. It does
NOT resolve or score anything — that's the pipeline's later stages. By default it
emits SQL to a file (applied via the Supabase MCP for the M2 seed); if SUPABASE_DB_URL
is set it can write directly with psycopg instead.

Usage:
    python -m orrery_pipeline.ingestion.companies_house <anchor_company_number> [max_companies]
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import deque

API_BASE = "https://api.company-information.service.gov.uk"
RATE_PAUSE = 0.25  # seconds between calls; well within 600 req / 5 min
# Storing the full raw API payload in source_documents.raw is ideal provenance but
# bloats a seed applied over the MCP. Off by default: provenance is preserved via the
# source url + retrieved_at + content_hash (the payload is re-fetchable). The proper
# psycopg pipeline run can set CH_STORE_RAW=1 to persist full payloads.
STORE_RAW = bool(os.environ.get("CH_STORE_RAW"))


# ──────────────────────────── API client ────────────────────────────

def _auth_header() -> str:
    key = os.environ.get("COMPANIES_HOUSE_API_KEY")
    if not key:
        raise SystemExit("COMPANIES_HOUSE_API_KEY not set (put it in .env / the environment).")
    return "Basic " + base64.b64encode((key + ":").encode()).decode()


def get(path: str) -> dict | None:
    """GET a CH API resource. Returns parsed JSON, or None on 404 (e.g. no PSCs)."""
    req = urllib.request.Request(API_BASE + path)
    req.add_header("Authorization", _auth_header())
    req.add_header("User-Agent", "orrery-pipeline/0.1 (research)")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        time.sleep(RATE_PAUSE)
        return data
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        if e.code == 429:
            time.sleep(5)
            return get(path)
        raise


# ──────────────────────────── crawl ────────────────────────────

def crawl(anchor: str, max_companies: int = 8) -> dict:
    """Bounded BFS from an anchor company, following officers' appointments."""
    seen: set[str] = set()
    queue: deque[str] = deque([anchor])
    companies: dict[str, dict] = {}

    while queue and len(companies) < max_companies:
        num = queue.popleft().strip().upper()
        if num in seen:
            continue
        seen.add(num)
        profile = get(f"/company/{num}")
        if not profile:
            continue
        officers = get(f"/company/{num}/officers") or {"items": []}
        pscs = get(f"/company/{num}/persons-with-significant-control") or {"items": []}
        companies[num] = {"profile": profile, "officers": officers, "pscs": pscs}

        # enqueue neighbouring companies via each officer's other appointments
        for off in officers.get("items", []):
            if len(companies) + len(queue) >= max_companies:
                break
            appts_path = (off.get("links", {}).get("officer", {}) or {}).get("appointments")
            if not appts_path:
                continue
            appts = get(appts_path)
            for a in (appts or {}).get("items", []):
                cn = (a.get("appointed_to", {}) or {}).get("company_number")
                if cn and cn not in seen:
                    queue.append(cn)
    return companies


# ──────────────────────────── SQL emit (safe quoting) ────────────────────────────

def s(v) -> str:
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def j(obj) -> str:
    text = json.dumps(obj, ensure_ascii=False)
    tag = "$orj$"
    while tag in text:
        tag = "$orj" + uuid.uuid4().hex[:6] + "$"
    return f"{tag}{text}{tag}::jsonb"


def _doc(rows, source_ref, url, title, raw) -> str:
    doc_id = str(uuid.uuid4())
    h = hashlib.md5(json.dumps(raw, sort_keys=True).encode()).hexdigest()
    raw_sql = j(raw) if STORE_RAW else "null"
    rows["source_documents"].append(
        f"({s(doc_id)}, 'companies_house', {s(source_ref)}, {s(url)}, {s(title)}, {s(h)}, {raw_sql})"
    )
    return doc_id


def _mention(rows, doc_id, type_hint, raw_name, attrs, dob_year=None) -> str:
    mid = str(uuid.uuid4())
    rows["mentions"].append(
        f"({s(mid)}, {s(doc_id)}, {s(type_hint)}, {s(raw_name)}, {j(attrs)}, "
        f"{('null' if dob_year is None else int(dob_year))})"
    )
    return mid


def _assertion(rows, doc_id, stype, frm, to, valid_from, valid_to, attrs) -> None:
    rows["relationship_assertions"].append(
        f"({s(str(uuid.uuid4()))}, {s(doc_id)}, {s(stype)}, {s(frm)}, {s(to)}, "
        f"{s(valid_from)}, {s(valid_to)}, {j(attrs)})"
    )


def build_sql(companies: dict) -> str:
    rows = {"source_documents": [], "mentions": [], "relationship_assertions": []}

    for num, data in companies.items():
        profile = data["profile"]
        name = profile.get("company_name")

        prof_doc = _doc(rows, f"{num}:profile", f"{API_BASE}/company/{num}",
                        f"{name} — profile", profile)
        company_mid = _mention(rows, prof_doc, "company", name, {
            "company_number": num,
            "company_status": profile.get("company_status"),
            "type": profile.get("type"),
            "date_of_creation": profile.get("date_of_creation"),
            "registered_office_address": profile.get("registered_office_address"),
            "sic_codes": profile.get("sic_codes"),
        })

        off_doc = _doc(rows, f"{num}:officers", f"{API_BASE}/company/{num}/officers",
                       f"{name} — officers", data["officers"])
        for off in data["officers"].get("items", []):
            dob = off.get("date_of_birth") or {}
            ch_off = (off.get("links", {}).get("officer", {}) or {}).get("appointments")
            off_mid = _mention(rows, off_doc, "person", off.get("name"), {
                "officer_role": off.get("officer_role"),
                "appointed_on": off.get("appointed_on"),
                "resigned_on": off.get("resigned_on"),
                "nationality": off.get("nationality"),
                "occupation": off.get("occupation"),
                "country_of_residence": off.get("country_of_residence"),
                "address": off.get("address"),
                "date_of_birth": dob or None,
                "ch_appointments_link": ch_off,
            }, dob_year=dob.get("year"))
            _assertion(rows, off_doc, "DIRECTOR_OF", off_mid, company_mid,
                       off.get("appointed_on"), off.get("resigned_on"),
                       {"officer_role": off.get("officer_role")})

        pscs = data["pscs"]
        if pscs.get("items"):
            psc_doc = _doc(rows, f"{num}:psc",
                           f"{API_BASE}/company/{num}/persons-with-significant-control",
                           f"{name} — PSCs", pscs)
            for psc in pscs.get("items", []):
                kind = psc.get("kind", "")
                corporate = "corporate" in kind or "legal-person" in kind
                dob = psc.get("date_of_birth") or {}
                psc_mid = _mention(rows, psc_doc, "company" if corporate else "person",
                                   psc.get("name"), {
                                       "kind": kind,
                                       "natures_of_control": psc.get("natures_of_control"),
                                       "notified_on": psc.get("notified_on"),
                                       "nationality": psc.get("nationality"),
                                       "address": psc.get("address"),
                                       "identification": psc.get("identification"),
                                       "date_of_birth": dob or None,
                                   }, dob_year=dob.get("year"))
                _assertion(rows, psc_doc, "OWNS" if corporate else "PSC_OF",
                           psc_mid, company_mid, psc.get("notified_on"),
                           psc.get("ceased_on"), {"natures_of_control": psc.get("natures_of_control")})

    parts = []
    cols = {
        "source_documents": "id, source_code, external_ref, url, title, content_hash, raw",
        "mentions": "id, source_document_id, entity_type_hint, raw_name, raw_attributes, dob_year",
        "relationship_assertions":
            "id, source_document_id, statement_type, from_mention_id, to_mention_id, valid_from, valid_to, raw_attributes",
    }
    for table in ("source_documents", "mentions", "relationship_assertions"):
        if rows[table]:
            parts.append(
                f"insert into public.{table} ({cols[table]}) values\n"
                + ",\n".join(rows[table]) + ";"
            )
    summary = {k: len(v) for k, v in rows.items()}
    return "\n\n".join(parts), summary


# ──────────────────────────── entry point ────────────────────────────

def main(argv: list[str]) -> int:
    anchor = argv[1] if len(argv) > 1 else os.environ.get("CH_ANCHOR")
    if not anchor:
        raise SystemExit("Usage: python -m orrery_pipeline.ingestion.companies_house <anchor> [max_companies]")
    max_companies = int(argv[2]) if len(argv) > 2 else 8

    companies = crawl(anchor, max_companies)
    sql, summary = build_sql(companies)
    print(f"crawled {len(companies)} companies: {sorted(companies)}")
    print(f"records: {summary}")

    out_dir = os.path.join(os.path.dirname(__file__), "..", "..", ".scratch")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.abspath(os.path.join(out_dir, "ch_seed.sql"))
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(sql + "\n")
    print(f"wrote SQL -> {out_path}")

    db_url = os.environ.get("SUPABASE_DB_URL")
    if db_url:
        apply_sql(db_url, sql)
        print("applied directly via SUPABASE_DB_URL")
    else:
        print("SUPABASE_DB_URL not set; SQL written to file only.")
    return 0


def apply_sql(db_url: str, sql: str) -> None:
    """Execute the generated SQL against Postgres. Uses pg8000 (pure-Python, so it
    installs on any Python incl. 3.14); falls back to psycopg if present."""
    from urllib.parse import urlparse, unquote
    u = urlparse(db_url)
    try:
        import pg8000.native  # type: ignore
        import ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # encrypted; skip cert verification for the dev pipeline
        con = pg8000.native.Connection(
            user=unquote(u.username or "postgres"),
            password=unquote(u.password or ""),
            host=u.hostname,
            port=u.port or 5432,
            database=(u.path or "/postgres").lstrip("/") or "postgres",
            ssl_context=ctx,
        )
        try:
            for stmt in sql.split("\n\n"):  # parts are joined by a blank line; JSON is single-line
                if stmt.strip():
                    con.run(stmt)
        finally:
            con.close()
    except ImportError:
        import psycopg  # type: ignore
        with psycopg.connect(db_url) as conn:
            for stmt in sql.split("\n\n"):
                if stmt.strip():
                    conn.execute(stmt)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
