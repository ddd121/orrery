"""UK Parliament ingestion (Milestone 6) — the 'power' axis.

Lands a bounded slice of current MPs from the Members API (no key), with:
  MP mention (person)
  MEMBER_OF        MP -> party            (links MPs to the donation-receiving parties)
  MINISTERIAL_ROLE MP -> government body  (from governmentPosts — power over public money)
  CHAIR_OF / MEMBER_OF  MP -> committee   (committee seats — sector oversight)

Bounded on purpose: the hand-rolled prototype SVG is comfortable with a few hundred
nodes; the real graph library (react-force-graph / Sigma) for full scale is the M5
deferral noted in the PRD. Stdlib only; writes via SUPABASE_DB_URL (pg8000).

Usage:
    python -m orrery_pipeline.ingestion.parliament [take]
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import uuid

from .companies_house import s, j, apply_sql

API = "https://members-api.parliament.uk"
PAUSE = 0.15


def get(path: str):
    req = urllib.request.Request(API + path, headers={"User-Agent": "orrery/0.1", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        data = json.load(r)
    time.sleep(PAUSE)
    return data


def build_sql(members: list, doc_id: str):
    rows = {"mentions": [], "relationship_assertions": []}

    def mention(etype, name, attrs):
        mid = str(uuid.uuid4())
        rows["mentions"].append(
            f"({s(mid)}, {s(doc_id)}, {s(etype)}, {s(name)}, {j(attrs)}, null)"
        )
        return mid

    def assertion(stype, frm, to, vfrom, attrs):
        rows["relationship_assertions"].append(
            f"({s(str(uuid.uuid4()))}, {s(doc_id)}, {s(stype)}, {s(frm)}, {s(to)}, {s(vfrom)}, null, {j(attrs)})"
        )

    for m in members:
        v = m.get("value", m)
        pid = v.get("id")
        name = v.get("nameDisplayAs")
        if not name:
            continue
        party = (v.get("latestParty") or {}).get("name")
        member_url = f"{API}/api/Members/{pid}"
        mp_mid = mention("person", name, {
            "parliament_member_id": pid,
            "party": party,
            "constituency": (v.get("latestHouseMembership") or {}).get("membershipFrom"),
            "source_url": member_url,
        })
        if party:
            party_mid = mention("party", party, {})
            assertion("MEMBER_OF", mp_mid, party_mid, None, {})

        try:
            bio = get(f"/api/Members/{pid}/Biography").get("value", {})
        except Exception:
            bio = {}
        for p in (bio.get("governmentPosts") or []):
            body = p.get("name")
            if not body:
                continue
            body_mid = mention("government_body", body, {"post": body})
            assertion("MINISTERIAL_ROLE", mp_mid, body_mid,
                      (p.get("startDate") or "")[:10] or None, {"post": body})
        for c in (bio.get("committeeMemberships") or []):
            cname = c.get("name")
            if not cname:
                continue
            c_mid = mention("organisation", cname, {"kind": "parliamentary_committee"})
            role = (c.get("role") or "").lower()
            stype = "CHAIR_OF" if "chair" in role else "MEMBER_OF"
            assertion(stype, mp_mid, c_mid, (c.get("startDate") or "")[:10] or None, {"role": c.get("role")})

    cols = {
        "mentions": "id, source_document_id, entity_type_hint, raw_name, raw_attributes, dob_year",
        "relationship_assertions":
            "id, source_document_id, statement_type, from_mention_id, to_mention_id, valid_from, valid_to, raw_attributes",
    }
    parts = [f"insert into public.source_documents (id, source_code, external_ref, url, title, content_hash, raw) values "
             f"({s(doc_id)}, 'parliament', 'members-current', {s(API + '/api/Members/Search')}, "
             f"{s('UK Parliament — current members')}, null, null);"]
    for table in ("mentions", "relationship_assertions"):
        if rows[table]:
            parts.append(f"insert into public.{table} ({cols[table]}) values\n" + ",\n".join(rows[table]) + ";")
    return "\n\n".join(parts), {k: len(v) for k, v in rows.items()}


def main(argv: list[str]) -> int:
    take = int(argv[1]) if len(argv) > 1 else 40
    doc_id = str(uuid.uuid4())
    members: list = []
    skip = 0
    while len(members) < take:  # the Members Search API caps page size at 20 — page through it
        batch = get(f"/api/Members/Search?IsCurrentMember=true&House=1&skip={skip}&take=20").get("items", [])
        if not batch:
            break
        members.extend(batch)
        skip += 20
    members = members[:take]
    print(f"fetched {len(members)} current MPs; pulling biographies…")
    sql, summary = build_sql(members, doc_id)
    print(f"records: {summary}")
    db_url = os.environ.get("SUPABASE_DB_URL")
    if db_url and sql:
        apply_sql(db_url, sql)
        print("applied via SUPABASE_DB_URL")
    else:
        print("SUPABASE_DB_URL not set")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
