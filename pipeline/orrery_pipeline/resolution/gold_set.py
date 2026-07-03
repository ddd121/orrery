"""Bootstrap gold set for calibrating the cross-source person matcher (engine-spec §6).

We need labelled (same-person / different-person) pairs to fit a calibration curve and
measure precision — but hand-labelling thousands of pairs is not available for v1. So we
*bootstrap* labels from the deterministic dedup (`dedupe_v1.sql`), which already made
precision-safe decisions we trust:

  POSITIVES (same person)   — two person mentions that either (a) ALREADY resolve to one canonical
                              entity (a deterministic id match — same Parliament member id, CH
                              officer id, EC DonorId — established they are the same person), or
                              (b) share a normalised name-key AND a *specific* (non-hub) graph
                              neighbour, OR a DOB-year (the merges dedupe_v1 performs, §4.4).
                              e.g. "COWLING, Tom" and "Tom Cowling" co-directing one named company;
                              or "Kirith Entwistle" and "Kirith Entwistle MP" across two registers.
  NEGATIVES (different)      — (a) HARD: two person mentions with the SAME name-key that resolved
                              to DIFFERENT canonical entities, with NO shared specific neighbour and
                              NO DOB-year match — the pairs dedupe_v1 deliberately LEFT apart (the
                              three "Martin Taylor"s with distinct EC donor ids). (b) EASY: a random
                              sample of different-surname pairs.

Why this is honest, and its ceiling: the positives include the deterministically-certain
same-person pairs (shared id) plus the easy graph-corroborated ones. The genuinely-ambiguous band
— same name, DIFFERENT resolved entities, no shared specific neighbour — is what the hard negatives
represent, and bootstrap labelling cannot adjudicate whether any of *those* are really the same
person (that needs hand-labels or LLM adjudication, §4.5). So this gold set validates the reliability
of the score honestly (a monotonic curve) and is conservative in that ambiguous middle. NB an earlier
version mislabelled same-canonical cross-source pairs as hard negatives, which inverted the curve —
fixed by the same_canonical check below.

EVERYTHING IS KEYED BY STABLE MENTION-ID PAIRS. Canonical-entity ids are regenerated on every
resolution run (resolve_v3 truncates + rebuilds); mention ids are immutable raw-layer keys. A
gold set keyed by canonical ids would rot on the next build — so we never do that.

Read-only. Produces label rows; writes nothing to the graph.
"""

from __future__ import annotations

import random
import re
from collections import defaultdict

from .fuzzy_match import norm_name

TITLES = {
    "mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "lord", "lady", "rt", "hon",
    "honourable", "the", "rev", "reverend", "prof", "professor", "baroness", "baron",
    "earl", "viscount", "councillor", "cllr", "qc", "kc", "mp",
}

# Hub entity types excluded as "specific neighbour" connectors — mirrors dedupe_v1's HUB GUARD.
# Sharing a party / government body is NOT evidence two same-named people are the same person.
HUB_TYPES = {"party", "government_body"}


def name_key(name: str) -> str:
    """Normalised sorted-token person name key — mirrors dedupe_v1.sql tmp_pkey.namekey.

    lowercase -> non-alphanumerics to spaces -> drop title tokens -> sort -> join.
    "COWLING, Tom" and "Mr Tom Cowling" both -> "cowling tom".
    """
    s = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower())
    toks = [t for t in s.split() if t and t not in TITLES]
    return " ".join(sorted(toks))


def load_person_mentions(con):
    """Each person mention with its raw form, source, name-key, surname, DOB-year, neighbours.

    A mention is 'person' if its active resolution points at a person canonical entity. We carry
    the mention id (stable), the canonical id (for inspection only), raw name, source code, and
    the set of *specific* (non-hub) canonical neighbours reachable from that mention via raw
    relationship_assertions. Neighbours are canonical ids (the graph endpoints dedupe_v1 uses).
    """
    rows = con.run(
        """
        select m.id::text, m.raw_name, sd.source_code,
               mr.canonical_entity_id::text,
               coalesce(m.raw_attributes->>'date_of_birth','') as dob,
               coalesce(m.dob_year::text,'')                    as dob_year
        from public.mentions m
        join public.mention_resolutions mr on mr.mention_id = m.id and mr.is_active
        join public.canonical_entities ce on ce.id = mr.canonical_entity_id
        join public.source_documents sd on sd.id = m.source_document_id
        where ce.entity_type = 'person'
        """
    )
    mentions: dict[str, dict] = {}
    for mid, raw, src, cid, dob, dob_year in rows:
        surname, fores = norm_name(raw)
        by = ""
        if dob and len(dob) >= 4 and dob[:4].isdigit():
            by = dob[:4]
        elif dob_year:
            by = dob_year
        mentions[mid] = {
            "raw": raw, "src": src, "cid": cid,
            "key": name_key(raw), "surname": surname, "fores": fores,
            "dob": dob, "birth_year": by, "nbrs": set(),
        }

    # Specific (non-hub) neighbour canonical ids per mention, from raw assertions.
    hub_ids = {
        r[0] for r in con.run(
            "select id::text from public.canonical_entities where entity_type in ('party','government_body')"
        )
    }
    # map mention -> canonical (active) for BOTH endpoints of each assertion
    m2c = {r[0]: r[1] for r in con.run(
        "select mention_id::text, canonical_entity_id::text "
        "from public.mention_resolutions where is_active"
    )}
    for frm, tom in con.run(
        "select from_mention_id::text, to_mention_id::text from public.relationship_assertions"
    ):
        fc, tc = m2c.get(frm), m2c.get(tom)
        if not fc or not tc or fc == tc:
            continue
        # neighbour of the 'from' mention is the 'to' canonical (if specific), and vice-versa
        if frm in mentions and tc not in hub_ids:
            mentions[frm]["nbrs"].add(tc)
        if tom in mentions and fc not in hub_ids:
            mentions[tom]["nbrs"].add(fc)
    return mentions


def build_gold(mentions: dict[str, dict], rng_seed: int = 17,
               max_easy_negatives: int = 400):
    """Return labelled pairs as dicts keyed by stable mention-id pairs.

    Each row: {mid_a, mid_b, label (1=same,0=diff), kind, name_a, name_b, src_a, src_b,
               shared_neighbours (list of canonical ids), reason}.
    Pairs are unordered; we always store mid_a < mid_b.
    """
    rng = random.Random(rng_seed)
    by_key: dict[str, list[str]] = defaultdict(list)
    for mid, m in mentions.items():
        if m["key"]:
            by_key[m["key"]].append(mid)

    pos: list[dict] = []
    hard_neg: list[dict] = []
    seen: set[tuple[str, str]] = set()

    # Same-name-key blocks: classify each within-block pair as positive (shared specific
    # neighbour or DOB-year) or hard negative (neither) — the exact dedupe_v1 decision boundary.
    for key, ids in by_key.items():
        if len(ids) < 2:
            continue
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = sorted((ids[i], ids[j]))
                if (a, b) in seen:
                    continue
                seen.add((a, b))
                ma, mb = mentions[a], mentions[b]
                shared = ma["nbrs"] & mb["nbrs"]
                dob_match = bool(
                    (ma["birth_year"] and ma["birth_year"] == mb["birth_year"])
                )
                # Two mentions that ALREADY resolve to one canonical entity are, by definition,
                # the same person — deterministic id resolution (a shared Parliament member id,
                # CH officer id, etc.) established it. Labelling such a pair a "hard negative"
                # just because their per-mention neighbourhoods don't overlap in this slice is
                # a label bug: it put ~97% of the bootstrap's "different people" pool on
                # genuinely-same people (e.g. 'Kirith Entwistle' vs 'Kirith Entwistle MP' across
                # the Members API and the interests register), which inverted the reliability
                # curve. Treat same-canonical as a positive; only DIFFERENT canonical entities
                # with no shared neighbour / DOB are the true held-apart residual.
                same_canonical = bool(ma["cid"]) and ma["cid"] == mb["cid"]
                row = {
                    "mid_a": a, "mid_b": b,
                    "name_a": ma["raw"], "name_b": mb["raw"],
                    "src_a": ma["src"], "src_b": mb["src"],
                    "key": key,
                    "shared_neighbours": sorted(shared),
                    "cid_a": ma["cid"], "cid_b": mb["cid"],
                }
                if same_canonical or shared or dob_match:
                    row["label"] = 1
                    row["kind"] = (
                        "pos_same_canonical" if same_canonical
                        else "pos_same_name_shared_nbr" if shared
                        else "pos_same_name_dob"
                    )
                    row["reason"] = (
                        f"same name-key '{key}'; "
                        + ("one resolved entity already (deterministic id match)" if same_canonical
                           else f"shares {len(shared)} specific neighbour(s)" if shared
                           else f"same birth-year {ma['birth_year']}")
                    )
                    pos.append(row)
                else:
                    row["label"] = 0
                    row["kind"] = "neg_same_name_no_link"
                    row["reason"] = (
                        f"same name-key '{key}' but DIFFERENT resolved entities with NO shared "
                        f"specific neighbour and no DOB-year match — held apart by dedupe_v1"
                    )
                    hard_neg.append(row)

    # Easy negatives: random different-surname person pairs (almost surely different people).
    ids_all = list(mentions.keys())
    easy_neg: list[dict] = []
    tries = 0
    target = min(max_easy_negatives, max(len(pos) + len(hard_neg), 50))
    while len(easy_neg) < target and tries < target * 40:
        tries += 1
        a, b = rng.sample(ids_all, 2)
        a, b = sorted((a, b))
        if (a, b) in seen:
            continue
        ma, mb = mentions[a], mentions[b]
        if ma["surname"] and ma["surname"] == mb["surname"]:
            continue  # same surname handled by the blocked path; keep easy-neg cross-surname
        seen.add((a, b))
        easy_neg.append({
            "mid_a": a, "mid_b": b, "label": 0, "kind": "neg_random_diff_name",
            "name_a": ma["raw"], "name_b": mb["raw"], "src_a": ma["src"], "src_b": mb["src"],
            "key": "", "shared_neighbours": [], "cid_a": ma["cid"], "cid_b": mb["cid"],
            "reason": "random different-surname pair (different people)",
        })

    return {"positives": pos, "hard_negatives": hard_neg, "easy_negatives": easy_neg}
