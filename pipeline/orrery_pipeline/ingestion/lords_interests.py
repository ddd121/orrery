"""Register of Lords' Interests (Milestone 6) — the 6th register.

Peers are appointed, not elected, and carry heavy business ties (chairmanships,
directorships, shareholdings) with no electoral check — a major scrutiny surface.

members-api.parliament.uk (no key). Two calls per peer:

  Members/Search?House=2&IsCurrentMember=true   paged roster of current Lords
  Members/{id}/RegisteredInterests               categorised free-text interests

Only Category 1 (Remunerated employment etc.) and Category 2 (Shareholdings etc.) are
extracted — both have a fairly regular "{role}, {org}" / "{org} ({description})" shape.
Categories 3-7 (land, sponsorship, overseas visits, gifts, misc financial) are free text
with no clean, reliable company tie and are skipped entirely for v1.

This is a PRECISION-FIRST extraction: mis-attributing a company to a named peer is a
critical failure (libel + credibility collapse). When a line doesn't cleanly parse, or
the extracted org name has no legal-entity marker (Category 2) or no letters at all, it
is SKIPPED — never guessed. A healthy skip rate is expected and is a feature, not a bug.

  Category 1 -> DIRECTOR_OF or ADVISER_TO (peer -> org), role kept in raw_attributes
  Category 2 -> OWNS (peer -> company), company-suffix gated (Ltd/Limited/plc/LLP/LP/Inc/Company)

Stdlib only; writes via SUPABASE_DB_URL (pg8000), reusing the Companies House loader's
SQL-safe quoting + applier + the Commons interests loader's get()/etype_for() shape.

Usage:  python -m orrery_pipeline.ingestion.lords_interests [n_lords]
        (default: ALL current Lords — depth is the goal for this register)
"""

from __future__ import annotations

import os
import re
import sys
import uuid

from .companies_house import s, j, apply_sql
from .parliament_interests import get, etype_for, to_gbp  # noqa: F401 (to_gbp kept for parity/future use)

MAPI = "https://members-api.parliament.uk"

# House=2 is the Lords in the Members API's House enum (1 = Commons).
HOUSE_LORDS = 2

# Category 2 acceptance gate: only accept an extracted name if it carries a recognisable
# legal-entity suffix. Deliberately stricter / more explicit than companies_house._CO
# (which is tuned for Companies House profile names, not free-text register entries) —
# this is the exact list called for by this register's extraction spec.
_LEGAL_SUFFIX = re.compile(
    r"\b(ltd|limited|plc|llp|lp|inc|company)\b", re.I
)

# Category 1 role -> statement_type. Anything not matching one of these falls back to
# ADVISER_TO (a paid, non-controlling tie is the conservative default).
_DIRECTOR_ROLE = re.compile(
    r"\b(director|chairman|chair|chief executive|ceo|managing|partner|proprietor|owner)\b",
    re.I,
)

SOURCE_SEED_SQL = (
    "insert into public.sources (code, name, jurisdiction, url, licence, reliability_prior, notes)\n"
    "values ('lords_interests', 'UK Parliament — Register of Lords'' Interests', 'GB',\n"
    "        'https://members-api.parliament.uk/',\n"
    "        'Open Parliament Licence', 0.960,\n"
    "        'Declared employment, directorships and shareholdings of members of the House of '\n"
    "        'Lords (Categories 1 and 2 only; land/property, sponsorship, overseas visits, gifts '\n"
    "        'and misc. financial interests are excluded — free text too messy to extract '\n"
    "        'precisely). Extraction is precision-first: ambiguous or unparseable entries are '\n"
    "        'skipped rather than guessed.')\n"
    "on conflict (code) do nothing;"
)


# ──────────────────────────── text helpers ────────────────────────────

def _clean(text: str) -> str:
    """Normalise whitespace (register text carries stray \\r\\n and doubled spaces)."""
    return re.sub(r"\s+", " ", (text or "")).strip()


def _match_trailing_paren(text: str) -> tuple[int, str] | None:
    """If `text` ends with a parenthetical, return (start_index, inner_text), respecting
    nested parens (e.g. "...; see category 2(a))" is ONE trailing group, not two)."""
    if not text.endswith(")"):
        return None
    depth = 0
    for i in range(len(text) - 1, -1, -1):
        ch = text[i]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                return i, text[i + 1: -1]
    return None  # unbalanced — treat as no trailing paren


def _strip_trailing_desc(text: str) -> str:
    """Strip TRAILING parenthetical(s) whose content starts lowercase (a business-nature
    description, e.g. "(computing and software)"), repeatedly — some entries chain more
    than one, e.g. "Ltd (desc a) (desc b)", and some descriptions themselves contain
    nested parens (e.g. "(...; see category 2(a))"). Stops at the first trailing paren
    that is capitalised or empty (e.g. "(UK)", "(formerly IOCOM UK Ltd)"), which is kept."""
    text = text.strip()
    while True:
        m = _match_trailing_paren(text)
        if not m:
            return text
        start, inner = m
        inner = inner.strip()
        if inner and inner[0].islower():
            text = text[:start].strip()
            continue
        return text


def _has_letters(text: str) -> bool:
    return bool(re.search(r"[A-Za-z]", text or ""))


def parse_category1(raw: str) -> tuple[str, str] | None:
    """"{role clauses}, {org}" -> (role, org_name). The trailing lowercase description is
    stripped FIRST — it is prose and may itself contain commas — then the org is the LAST
    comma-separated segment. So a multi-title role like "Co-chair, Founder and Director,
    Visionable Limited (…)" yields org "Visionable Limited", NOT "Founder and Director,
    Visionable Limited"; and a description comma ("Acme Ltd (a big, well-known firm)") can't
    leak into the org. Returns None if there's no role/org comma or the org has no letters."""
    text = _strip_trailing_desc(_clean(raw))
    if "," not in text:
        return None
    role, org = text.rsplit(",", 1)
    role, org = role.strip(), org.strip()
    if not role or not org or not _has_letters(org):
        return None
    return role, org


def statement_type_for_role(role: str) -> str:
    return "DIRECTOR_OF" if _DIRECTOR_ROLE.search(role or "") else "ADVISER_TO"


def parse_category2(raw: str) -> str | None:
    """Extract a company name from a Category 2 shareholding line, gated on a legal
    suffix. Handles the "100 per cent ownership with partner of X (desc)" phrasing by
    taking the segment after the LAST " of " when present."""
    text = _clean(raw)
    if " of " in text:
        text = text.rsplit(" of ", 1)[1]
    name = _strip_trailing_desc(text)
    if not name or not _has_letters(name):
        return None
    if not _LEGAL_SUFFIX.search(name):
        return None
    return name


# ──────────────────────────── SQL build ────────────────────────────

def build_sql(peers: list, doc_id: str):
    rows = {"mentions": [], "relationship_assertions": []}
    stats = {"lords_fetched": len(peers), "interests_seen": 0,
             "extracted": 0, "skipped": 0, "examples": []}

    def mention(et, name, attrs):
        mid = str(uuid.uuid4())
        rows["mentions"].append(f"({s(mid)}, {s(doc_id)}, {s(et)}, {s(name)}, {j(attrs)}, null)")
        return mid

    def assertion(st, frm, to, vfrom, attrs):
        rows["relationship_assertions"].append(
            f"({s(str(uuid.uuid4()))}, {s(doc_id)}, {s(st)}, {s(frm)}, {s(to)}, {s(vfrom)}, null, {j(attrs)})")

    for m in peers:
        v = m.get("value", m)
        pid, name = v.get("id"), v.get("nameDisplayAs")
        if not (pid and name):
            continue
        try:
            cats = get(f"{MAPI}/api/Members/{pid}/RegisteredInterests").get("value", [])
        except Exception:
            continue
        if not cats:
            continue

        peer_mid = None  # lazily created — only if this peer yields >=1 extracted tie

        def ensure_peer_mid():
            nonlocal peer_mid
            if peer_mid is None:
                peer_mid = mention("person", name, {"parliament_member_id": pid, "house": "Lords"})
            return peer_mid

        def walk(cat_name, items):
            for it in items:
                stats["interests_seen"] += 1
                if it.get("deletedWhen"):
                    stats["skipped"] += 1
                    continue
                raw_text = it.get("interest") or ""

                if cat_name.startswith("Category 1"):
                    parsed = parse_category1(raw_text)
                    if not parsed:
                        stats["skipped"] += 1
                    else:
                        role, org = parsed
                        st = statement_type_for_role(role)
                        et = etype_for(org, "organisation")
                        pmid = ensure_peer_mid()
                        oid = mention(et, org, {"via": "lords_interests:category1_employment",
                                                 "category": cat_name})
                        assertion(st, pmid, oid, None, {"role_raw": role, "value_gbp": None,
                                                         "source_text": raw_text})
                        stats["extracted"] += 1
                        if len(stats["examples"]) < 12:
                            stats["examples"].append((name, st, org, raw_text))

                elif cat_name.startswith("Category 2"):
                    org = parse_category2(raw_text)
                    if not org:
                        stats["skipped"] += 1
                    else:
                        pmid = ensure_peer_mid()
                        oid = mention("company", org, {"via": "lords_interests:category2_shareholding",
                                                        "category": cat_name})
                        assertion("OWNS", pmid, oid, None, {"value_gbp": None, "source_text": raw_text})
                        stats["extracted"] += 1
                        if len(stats["examples"]) < 12:
                            stats["examples"].append((name, "OWNS", org, raw_text))
                else:
                    stats["skipped"] += 1

                # Recurse into childInterests (spec: recurse too, even though none were
                # observed populated in a live sample — handle defensively).
                children = it.get("childInterests") or []
                if children:
                    walk(cat_name, children)

        for cat in cats:
            cat_name = cat.get("name") or ""
            walk(cat_name, cat.get("interests") or [])

    cols = {
        "mentions": "id, source_document_id, entity_type_hint, raw_name, raw_attributes, dob_year",
        "relationship_assertions":
            "id, source_document_id, statement_type, from_mention_id, to_mention_id, valid_from, valid_to, raw_attributes",
    }
    parts = [SOURCE_SEED_SQL,
             # Idempotent re-ingest: drop any prior Lords load first (FK cascade removes its
             # mentions + assertions + resolutions), so re-running never duplicates rows or
             # collides on the (source_code, external_ref) unique key. The raw layer is the
             # only home for this data; recompute rebuilds the resolution layer from it.
             "delete from public.source_documents where source_code = 'lords_interests';",
             f"insert into public.source_documents (id, source_code, external_ref, url, title, content_hash, raw) "
             f"values ({s(doc_id)}, 'lords_interests', 'register-of-lords-interests', {s(MAPI)}, "
             f"{s('Register of Lords Interests')}, null, null);"]
    for t in ("mentions", "relationship_assertions"):
        if rows[t]:
            parts.append(f"insert into public.{t} ({cols[t]}) values\n" + ",\n".join(rows[t]) + ";")
    return "\n\n".join(parts), stats


# ──────────────────────────── roster ────────────────────────────

def fetch_all_lords(take: int | None) -> list:
    """Page through Members/Search (House=2, current only) 20/page. `take=None` fetches
    the whole current roster (~791 as of the register's last count) — depth is the goal."""
    members = []
    skip = 0
    while take is None or len(members) < take:
        batch = get(f"{MAPI}/api/Members/Search?House={HOUSE_LORDS}&IsCurrentMember=true"
                     f"&skip={skip}&take=20").get("items", [])
        if not batch:
            break
        members.extend(batch)
        skip += 20
    return members if take is None else members[:take]


def main(argv):
    take = int(argv[1]) if len(argv) > 1 else None
    members = fetch_all_lords(take)
    print(f"fetched {len(members)} current Lords; pulling their registered interests…")

    doc_id = str(uuid.uuid4())
    sql, stats = build_sql(members, doc_id)

    print(f"interests seen: {stats['interests_seen']}  "
          f"extracted: {stats['extracted']}  skipped: {stats['skipped']}")
    if stats["examples"]:
        print("examples:")
        for peer, st, org, raw_text in stats["examples"][:5]:
            print(f"  {peer} -> {st} -> {org}   [raw: {raw_text!r}]")

    db = os.environ.get("SUPABASE_DB_URL")
    if db and stats["extracted"]:
        apply_sql(db, sql)
        print("applied via SUPABASE_DB_URL")
    else:
        print("nothing to apply" if not stats["extracted"] else "SUPABASE_DB_URL not set; not applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
