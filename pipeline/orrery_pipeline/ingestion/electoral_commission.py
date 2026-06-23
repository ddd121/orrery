"""Electoral Commission ingestion (Milestone 6) — political donations.

Lands donations raw, with provenance, into the statement-based schema:
  donor mention      person / company / organisation. COMPANY donors carry their
                     Companies House registration number, which lets resolution link
                     them to a CH company *deterministically* (same company number) —
                     the money -> company -> directors chain, high precision.
  recipient mention  the regulated entity (political party, or an MP / regulated donee)
  DONATED_TO         donor -> recipient, with value (GBP) and accepted date

Source: the EC CSV API (no key). Stdlib only; writes via SUPABASE_DB_URL (pg8000),
reusing the Companies House loader's SQL-safe quoting + applier.

Usage:
    python -m orrery_pipeline.ingestion.electoral_commission [from_date] [to_date] [limit]
"""

from __future__ import annotations

import csv
import io
import os
import re
import sys
import urllib.parse
import urllib.request
import uuid

from .companies_house import s, j, apply_sql

EC_CSV = "https://search.electoralcommission.org.uk/api/csv/Donations"

_DONOR_TYPE = {
    "Individual": "person",
    "Company": "company",
    "Limited Liability Partnership": "company",
    "Registered Political Party": "party",
}
_RECIPIENT_TYPE = {"Political Party": "party"}


def donor_type(status: str) -> str:
    return _DONOR_TYPE.get((status or "").strip(), "organisation")


def recipient_type(entity_type: str) -> str:
    # regulated donees are overwhelmingly MPs / members of regulated parties -> person
    return _RECIPIENT_TYPE.get((entity_type or "").strip(), "person")


def fetch(from_date: str, to_date: str, query: str = "", rows: int = 2000) -> str:
    params = [
        ("start", "0"), ("rows", str(rows)), ("query", query),
        ("sort", "Value"), ("order", "desc"),
        ("et", "pp"), ("et", "ppm"), ("et", "tp"), ("et", "perpar"), ("et", "rd"),
        ("date", "Accepted"), ("from", from_date), ("to", to_date),
        ("register", "gb"),
        ("donorStatus", "individual"), ("donorStatus", "company"),
        ("donorStatus", "unincorporatedassociation"),
        ("isIrishSourceYes", "true"), ("isIrishSourceNo", "true"),
        ("includeOutsideSection75", "true"), ("getDescriptions", "true"),
    ]
    url = f"{EC_CSV}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "orrery-pipeline/0.1 (research)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8-sig"), url


def to_gbp(value: str):
    try:
        return float((value or "").replace("£", "").replace(",", "").strip() or 0)
    except ValueError:
        return None


def iso_date(value: str):
    """EC dates are DD/MM/YYYY -> ISO for the date columns."""
    v = (value or "").strip()
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", v)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return v[:10] or None


def build_sql(csv_text: str, source_url: str, limit: int):
    rows = {"source_documents": [], "mentions": [], "relationship_assertions": []}
    doc_id = str(uuid.uuid4())
    rows["source_documents"].append(
        f"({s(doc_id)}, 'electoral_commission', {s('donations-export')}, {s(source_url)}, "
        f"{s('Electoral Commission — donations export')}, null, null)"
    )

    reader = csv.DictReader(io.StringIO(csv_text))
    kept = 0
    for row in reader:
        if kept >= limit:
            break
        donor_name = (row.get("DonorName") or "").strip()
        recipient = (row.get("RegulatedEntityName") or "").strip()
        if not donor_name or not recipient:
            continue
        kept += 1

        d_status = row.get("DonorStatus")
        d_type = donor_type(d_status)
        crn = (row.get("CompanyRegistrationNumber") or "").strip() or None
        donor_attrs = {
            "donor_status": d_status,
            "company_number": crn,        # deterministic key to Companies House
            "postcode": row.get("Postcode") or None,
            "donor_id": row.get("DonorId") or None,
        }
        donor_mid = str(uuid.uuid4())
        rows["mentions"].append(
            f"({s(donor_mid)}, {s(doc_id)}, {s(d_type)}, {s(donor_name)}, {j(donor_attrs)}, null)"
        )

        r_type = recipient_type(row.get("RegulatedEntityType"))
        recip_attrs = {
            "regulated_entity_type": row.get("RegulatedEntityType"),
            "regulated_donee_type": row.get("RegulatedDoneeType") or None,
            "regulated_entity_id": row.get("RegulatedEntityId") or None,
        }
        recip_mid = str(uuid.uuid4())
        rows["mentions"].append(
            f"({s(recip_mid)}, {s(doc_id)}, {s(r_type)}, {s(recipient)}, {j(recip_attrs)}, null)"
        )

        accepted = iso_date(row.get("AcceptedDate"))
        assert_attrs = {
            "value_gbp": to_gbp(row.get("Value")),
            "value_raw": row.get("Value"),
            "ec_ref": row.get("ECRef"),
            "donation_type": row.get("DonationType"),
            "nature_of_donation": row.get("NatureOfDonation") or None,
            "reported_date": iso_date(row.get("ReportedDate")),
        }
        rows["relationship_assertions"].append(
            f"({s(str(uuid.uuid4()))}, {s(doc_id)}, 'DONATED_TO', {s(donor_mid)}, {s(recip_mid)}, "
            f"{s(accepted)}, null, {j(assert_attrs)})"
        )

    cols = {
        "source_documents": "id, source_code, external_ref, url, title, content_hash, raw",
        "mentions": "id, source_document_id, entity_type_hint, raw_name, raw_attributes, dob_year",
        "relationship_assertions":
            "id, source_document_id, statement_type, from_mention_id, to_mention_id, valid_from, valid_to, raw_attributes",
    }
    parts = []
    for table in ("source_documents", "mentions", "relationship_assertions"):
        if rows[table]:
            parts.append(
                f"insert into public.{table} ({cols[table]}) values\n" + ",\n".join(rows[table]) + ";"
            )
    return "\n\n".join(parts), {k: len(v) for k, v in rows.items()}, kept


def main(argv: list[str]) -> int:
    from_date = argv[1] if len(argv) > 1 else "2024-01-01"
    to_date = argv[2] if len(argv) > 2 else "2024-12-31"
    limit = int(argv[3]) if len(argv) > 3 else 40

    csv_text, url = fetch(from_date, to_date)
    sql, summary, kept = build_sql(csv_text, url, limit)
    print(f"kept {kept} donations ({from_date}..{to_date}); records: {summary}")

    db_url = os.environ.get("SUPABASE_DB_URL")
    if db_url and sql:
        apply_sql(db_url, sql)
        print("applied via SUPABASE_DB_URL")
    else:
        print("SUPABASE_DB_URL not set (or nothing to load)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
