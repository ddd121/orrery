"""Register of Members' Financial Interests (Milestone 7) — the richest scrutiny signal.

interests-api.parliament.uk (no key). Extracts the structured `fields` of each interest
(no LLM needed) into declared MP -> entity ties:

  Shareholdings (OrganisationName) -> MP  OWNS        company
  Employment (PayerName)           -> MP  DIRECTOR_OF company  (if paid as a director)
                                       MP  ADVISER_TO  company  (other paid work)
  Donations (summary + Value)      -> donor DONATED_TO MP

These are declared, public-record facts (high reliability) and they create the cross-register
individuals the calibrated matcher needs. Stdlib only; writes via SUPABASE_DB_URL (pg8000).

Usage:  python -m orrery_pipeline.ingestion.parliament_interests [n_mps]
"""

from __future__ import annotations

import os
import re
import sys
import time
import urllib.request
import uuid
import json

from .companies_house import s, j, apply_sql

MAPI = "https://members-api.parliament.uk"
IAPI = "https://interests-api.parliament.uk"
PAUSE = 0.15
_CO = re.compile(r"\b(ltd|limited|plc|llp|inc|partnership|holdings|group|co)\b", re.I)


def get(u: str):
    r = urllib.request.Request(u, headers={"User-Agent": "orrery/0.1", "Accept": "application/json"})
    with urllib.request.urlopen(r, timeout=40) as resp:
        d = json.load(resp)
    time.sleep(PAUSE)
    return d


def etype_for(name: str, default: str) -> str:
    return "company" if _CO.search(name or "") else default


def to_gbp(v):
    try:
        return float(str(v).replace("£", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def build_sql(members: list, doc_id: str):
    rows = {"mentions": [], "relationship_assertions": []}

    def mention(et, name, attrs):
        mid = str(uuid.uuid4())
        rows["mentions"].append(f"({s(mid)}, {s(doc_id)}, {s(et)}, {s(name)}, {j(attrs)}, null)")
        return mid

    def assertion(st, frm, to, vfrom, attrs):
        rows["relationship_assertions"].append(
            f"({s(str(uuid.uuid4()))}, {s(doc_id)}, {s(st)}, {s(frm)}, {s(to)}, {s(vfrom)}, null, {j(attrs)})")

    n_int = 0
    for m in members:
        v = m.get("value", m)
        pid, name = v.get("id"), v.get("nameDisplayAs")
        if not (pid and name):
            continue
        try:
            interests = get(f"{IAPI}/api/v1/Interests?MemberId={pid}&Take=50").get("items", [])
        except Exception:
            continue
        if not interests:
            continue
        mp_mid = mention("person", name, {"parliament_member_id": pid})
        for it in interests:
            iv = it.get("value", it)
            fd = {f.get("name"): f.get("value") for f in (iv.get("fields") or [])}
            summary = iv.get("summary") or ""
            vfrom = (iv.get("registrationDate") or "")[:10] or None
            if fd.get("OrganisationName"):                      # shareholding
                co = fd["OrganisationName"].strip()
                cid = mention("company", co, {"description": fd.get("OrganisationDescription"),
                                              "via": "register_of_interests:shareholding"})
                assertion("OWNS", mp_mid, cid, vfrom, {"threshold": fd.get("ShareholdingThreshold")})
                n_int += 1
            elif fd.get("PayerName"):                           # employment / earnings
                payer = fd["PayerName"].strip()
                priv = fd.get("PayerIsPrivateIndividual")
                et = "person" if priv else etype_for(payer, "organisation")
                cid = mention(et, payer, {"nature": fd.get("PayerNatureOfBusiness"),
                                          "via": "register_of_interests:employment"})
                st = "DIRECTOR_OF" if fd.get("IsPaidAsDirectorOfPayer") else "ADVISER_TO"
                assertion(st, mp_mid, cid, vfrom, {"job_title": fd.get("JobTitle"),
                                                   "value_gbp": to_gbp(fd.get("Value"))})
                n_int += 1
            elif fd.get("DonationSource") is not None:          # donation to the MP
                donor = re.split(r"\s+[-–]\s+£?", summary, 1)[0].strip() or "Unknown donor"
                et = etype_for(donor, "person")
                did = mention(et, donor, {"via": "register_of_interests:donation"})
                assertion("DONATED_TO", did, mp_mid, vfrom,
                          {"value_gbp": to_gbp(fd.get("Value")), "payment_type": fd.get("PaymentType")})
                n_int += 1

    cols = {
        "mentions": "id, source_document_id, entity_type_hint, raw_name, raw_attributes, dob_year",
        "relationship_assertions":
            "id, source_document_id, statement_type, from_mention_id, to_mention_id, valid_from, valid_to, raw_attributes",
    }
    parts = [f"insert into public.source_documents (id, source_code, external_ref, url, title, content_hash, raw) "
             f"values ({s(doc_id)}, 'parliament_interests', 'register-of-interests', {s(IAPI)}, "
             f"{s('Register of Members Financial Interests')}, null, null);"]
    for t in ("mentions", "relationship_assertions"):
        if rows[t]:
            parts.append(f"insert into public.{t} ({cols[t]}) values\n" + ",\n".join(rows[t]) + ";")
    return "\n\n".join(parts), n_int


def main(argv):
    take = int(argv[1]) if len(argv) > 1 else 30
    doc_id = str(uuid.uuid4())
    members = get(f"{MAPI}/api/Members/Search?IsCurrentMember=true&House=1&skip=0&take={take}").get("items", [])
    print(f"fetched {len(members)} MPs; pulling their registered interests…")
    sql, n_int = build_sql(members, doc_id)
    print(f"extracted {n_int} declared interests")
    db = os.environ.get("SUPABASE_DB_URL")
    if db and n_int:
        apply_sql(db, sql)
        print("applied via SUPABASE_DB_URL")
    else:
        print("nothing to apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
