"""Register of All-Party Parliamentary Groups (The Front Page, Wave D.4).

APPGs are informal cross-party groups run by MPs/Lords on a subject or country, often with a
paid secretariat and financial backing from outside organisations -- a scrutiny surface the
platform doesn't cover yet (companies, donors and MPs, but no APPG layer).

Source: publications.parliament.uk's legacy "Register Of All-Party Parliamentary Groups"
(maintained by the Parliamentary Commissioner for Standards, republished roughly every 6 weeks,
no key/account). A stable, plain HTML/table format:

  .../pa/cm/cmallparty/{edition}/contents.htm    index: one <a href="{slug}.htm">Group name</a>
                                                  per group, under two headed <ul> lists
  .../pa/cm/cmallparty/{edition}/{slug}.htm      one group per page, always the same
                                                  <table class="basicTable"> sequence:
                                                    [0] Title / Purpose / Category (2-cell rows)
                                                    Officers (1-cell header 'Officers', then a
                                                      ['Role','Name','Party'] header, then 3-cell
                                                      rows)
                                                    Contact Details / IGMs (not extracted)
                                                    Registrable benefits received by the group,
                                                      with a 'Financial Benefits' subsection:
                                                      ['Source','Value £s','Received','Registered']
                                                      header then 4-cell rows -- external funding.

Extraction:
  Officers  -> person CHAIR_OF/MEMBER_OF appg   ('chair' in the declared role -> CHAIR_OF,
                                                  everything else -- Treasurer, Secretary,
                                                  Officer -- -> MEMBER_OF)
  Financial Benefits (>= GBP 1,500) -> funder FUNDS appg (funder entity type via the same
                                                  legal-suffix heuristic parliament_interests.py
                                                  uses for declared organisations)

Precision-first, mirroring lords_interests.py: a row that doesn't parse into the expected shape
(wrong cell count, no name, unparseable value) is skipped, never guessed. Idempotent: deletes any
prior 'appg' source load before landing a fresh one.

Stdlib only; writes via SUPABASE_DB_URL (pg8000), reusing the Companies House loader's SQL-safe
quoting + applier, and parliament_interests' etype_for/to_gbp.

Usage:
    python -m orrery_pipeline.ingestion.appg [max_groups]
        (default: all groups in the register, ~500-600)
"""

from __future__ import annotations

import html as html_lib
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta

from .companies_house import s, j, apply_sql
from .parliament_interests import etype_for, to_gbp

PUB_BASE = "https://publications.parliament.uk/pa/cm/cmallparty"
UA = {"User-Agent": "orrery-pipeline/0.1 (research)"}
PAUSE = 0.2  # seconds between group-page fetches -- a courteous, unrate-limited pace
MIN_FUNDING_GBP = 1500

SOURCE_SEED_SQL_TMPL = (
    "insert into public.sources (code, name, jurisdiction, url, licence, reliability_prior, notes)\n"
    "values ('appg', 'UK Parliament — Register of All-Party Parliamentary Groups', 'GB',\n"
    "        {url},\n"
    "        'Open Parliament Licence', 0.950,\n"
    "        'Declared APPG officers (Chair/Vice-Chair/Treasurer/Secretary) and registrable "
    "financial benefits (>= GBP 1,500) received from external sources. Maintained by the "
    "Parliamentary Commissioner for Standards, republished roughly every 6 weeks. Extraction is "
    "precision-first: rows that do not parse cleanly are skipped rather than guessed.')\n"
    "on conflict (code) do nothing;"
)


# ──────────────────────────── fetch + edition resolution ────────────────────────────

def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def resolve_edition() -> tuple[str, str] | None:
    """-> (edition_id, contents_url) for the most recent register edition we can reach, or None
    if nothing works (caller skips gracefully). Tries a handful of recent 6-weekly dates working
    backward from today, then falls back to editions confirmed to exist at the time this loader
    was written."""
    candidates: list[str] = []
    today = date.today()
    for weeks_back in (0, 6, 12, 18, 24):
        d = today - timedelta(weeks=weeks_back)
        candidates.append(d.strftime("%y%m%d"))
    for known_good in ("260518", "260413", "260223", "260112"):
        if known_good not in candidates:
            candidates.append(known_good)

    for edition in candidates:
        url = f"{PUB_BASE}/{edition}/contents.htm"
        try:
            body = fetch(url)
        except Exception:
            continue
        if "All-Party Parliamentary Groups" in body:
            return edition, url
    return None


# ──────────────────────────── HTML table parsing ────────────────────────────

def strip_tags(cell_html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", cell_html)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_tables(page_html: str) -> list[list[list[str]]]:
    """-> list of tables, each a list of rows, each row a list of cell texts."""
    tables = re.findall(r"<table[^>]*>(.*?)</table>", page_html, re.S)
    out = []
    for t in tables:
        table_rows = []
        for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)
            table_rows.append([strip_tags(c) for c in cells])
        out.append(table_rows)
    return out


def iso_date(value: str | None):
    """Register dates are DD/MM/YYYY -> ISO."""
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", (value or "").strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def parse_group_page(page_html: str) -> dict:
    tables = parse_tables(page_html)
    info: dict[str, str] = {}
    if tables:
        for row in tables[0]:
            if len(row) == 2:
                info[row[0]] = row[1]

    officers: list[tuple[str, str, str]] = []
    funders: list[tuple[str, str, str, str]] = []

    for table in tables:
        if table and table[0] == ["Officers"]:
            for row in table[2:]:  # [0]='Officers' header, [1]=['Role','Name','Party'] header
                if len(row) == 3 and row[1]:
                    officers.append((row[0], row[1], row[2]))

        in_financial = False
        for row in table:
            if row == ["Financial Benefits"]:
                in_financial = True
                continue
            if not in_financial:
                continue
            if row == ["Source", "Value £s", "Received", "Registered"]:
                continue
            if len(row) == 4:
                funders.append((row[0], row[1], row[2], row[3]))
            else:
                in_financial = False  # a differently-shaped row ends the subsection

    return {
        "title": info.get("Title"),
        "category": info.get("Category"),
        "purpose": info.get("Purpose"),
        "officers": officers,
        "funders": funders,
    }


# ──────────────────────────── index page ────────────────────────────

def parse_index(contents_html: str) -> list[tuple[str, str]]:
    """-> [(slug, group_name), ...] from the contents page, excluding introduction.htm."""
    out = []
    for m in re.finditer(r'href="([a-z0-9-]+\.htm)">([^<]+)</a>', contents_html):
        slug, name = m.group(1), html_lib.unescape(m.group(2)).strip()
        if slug == "introduction.htm":
            continue
        out.append((slug[:-4], name))
    return out


# ──────────────────────────── SQL build ────────────────────────────

def build_sql(groups: list[dict], edition_url: str):
    rows = {"mentions": [], "relationship_assertions": []}
    stats = {
        "groups_fetched": len(groups), "groups_with_officers": 0, "groups_with_funders": 0,
        "officer_ties": 0, "funder_ties": 0, "skipped_rows": 0, "examples": [],
    }

    def mention(doc_id, et, name, attrs):
        mid = str(uuid.uuid4())
        rows["mentions"].append(f"({s(mid)}, {s(doc_id)}, {s(et)}, {s(name)}, {j(attrs)}, null)")
        return mid

    def assertion(doc_id, st, frm, to, vfrom, attrs):
        rows["relationship_assertions"].append(
            f"({s(str(uuid.uuid4()))}, {s(doc_id)}, {s(st)}, {s(frm)}, {s(to)}, "
            f"{s(vfrom)}, null, {j(attrs)})"
        )

    source_doc_rows = []

    for g in groups:
        title = g.get("title")
        if not title:
            stats["skipped_rows"] += 1
            continue

        doc_id = str(uuid.uuid4())
        url = f"{edition_url.rsplit('/', 1)[0]}/{g['slug']}.htm"
        source_doc_rows.append(
            f"({s(doc_id)}, 'appg', {s(g['slug'])}, {s(url)}, {s(title)}, null, null)"
        )

        appg_mid = mention(doc_id, "appg", title, {
            "category": g.get("category"), "purpose": g.get("purpose"),
        })

        officers = g.get("officers", [])
        officer_ties_here = 0
        for role, name, party in officers:
            if not name or not role:
                stats["skipped_rows"] += 1
                continue
            st = "CHAIR_OF" if "chair" in role.lower() else "MEMBER_OF"
            person_mid = mention(doc_id, "person", name,
                                  {"via": "appg_register", "party": party or None})
            assertion(doc_id, st, person_mid, appg_mid, None,
                      {"role_raw": role, "group": title})
            officer_ties_here += 1
            stats["officer_ties"] += 1
            if len(stats["examples"]) < 10:
                stats["examples"].append((name, st, title, role))
        if officer_ties_here:
            stats["groups_with_officers"] += 1

        funder_ties_here = 0
        for source_name, value_raw, received, registered in g.get("funders", []):
            value_gbp = to_gbp(value_raw)
            if not source_name or value_gbp is None or value_gbp < MIN_FUNDING_GBP:
                stats["skipped_rows"] += 1
                continue
            et = etype_for(source_name, "organisation")
            funder_mid = mention(doc_id, et, source_name, {"via": "appg_register:financial_benefit"})
            assertion(doc_id, "FUNDS", funder_mid, appg_mid, iso_date(received), {
                "value_gbp": value_gbp, "value_raw": value_raw,
                "received": received, "registered": registered,
            })
            funder_ties_here += 1
            stats["funder_ties"] += 1
        if funder_ties_here:
            stats["groups_with_funders"] += 1

    cols = {
        "source_documents": "id, source_code, external_ref, url, title, content_hash, raw",
        "mentions": "id, source_document_id, entity_type_hint, raw_name, raw_attributes, dob_year",
        "relationship_assertions":
            "id, source_document_id, statement_type, from_mention_id, to_mention_id, valid_from, valid_to, raw_attributes",
    }
    parts = [
        SOURCE_SEED_SQL_TMPL.format(url=s(edition_url)),
        # Idempotent re-ingest: drop any prior APPG load first (FK cascade removes its mentions +
        # assertions + resolutions), so re-running never duplicates rows or collides on the
        # (source_code, external_ref) unique key. The raw layer is the only home; recompute
        # rebuilds the resolution layer from it.
        "delete from public.source_documents where source_code = 'appg';",
    ]
    if source_doc_rows:
        parts.append(
            f"insert into public.source_documents ({cols['source_documents']}) values\n"
            + ",\n".join(source_doc_rows) + ";"
        )
    for t in ("mentions", "relationship_assertions"):
        if rows[t]:
            parts.append(f"insert into public.{t} ({cols[t]}) values\n" + ",\n".join(rows[t]) + ";")
    return "\n\n".join(parts), stats


# ──────────────────────────── main ────────────────────────────

def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    max_groups = int(argv[1]) if len(argv) > 1 else None

    edition = resolve_edition()
    if edition is None:
        print("could not reach any recent APPG register edition; skipping gracefully.")
        return 0
    edition_id, contents_url = edition
    print(f"using register edition {edition_id!r} ({contents_url})")

    try:
        contents_html = fetch(contents_url)
    except Exception as e:
        print(f"failed to fetch the contents index, skipping gracefully: {e}")
        return 0

    index = parse_index(contents_html)
    if not index:
        print("contents index parsed to zero groups; skipping gracefully (structure may have changed).")
        return 0
    if max_groups:
        index = index[:max_groups]
    print(f"groups in index: {len(index)}")

    groups: list[dict] = []
    fetch_errors = 0
    for i, (slug, name) in enumerate(index, start=1):
        url = f"{PUB_BASE}/{edition_id}/{slug}.htm"
        try:
            page_html = fetch(url)
        except Exception as e:
            fetch_errors += 1
            if fetch_errors <= 5:
                print(f"  fetch-error {slug}: {e}")
            time.sleep(PAUSE)
            continue
        time.sleep(PAUSE)
        parsed = parse_group_page(page_html)
        parsed["slug"] = slug
        if not parsed.get("title"):
            parsed["title"] = name  # fall back to the index link text
        groups.append(parsed)
        if i % 50 == 0:
            print(f"  fetched {i}/{len(index)} group pages…")

    print(f"group pages fetched: {len(groups)} (fetch errors: {fetch_errors})")

    sql, stats = build_sql(groups, contents_url)
    print(f"groups with officers: {stats['groups_with_officers']}  "
          f"groups with funders >= GBP {MIN_FUNDING_GBP:,}: {stats['groups_with_funders']}")
    print(f"officer ties: {stats['officer_ties']}  funder ties: {stats['funder_ties']}  "
          f"skipped rows: {stats['skipped_rows']}")
    if stats["examples"]:
        print("examples:")
        for name, st, group, role in stats["examples"][:6]:
            print(f"  {name} -> {st} -> {group}   [role: {role!r}]")

    db_url = os.environ.get("SUPABASE_DB_URL")
    if db_url:
        apply_sql(db_url, sql)
        print("applied via SUPABASE_DB_URL")
    else:
        print("SUPABASE_DB_URL not set; not applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
