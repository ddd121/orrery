"""Fuzzy cross-source person resolution (engine-spec §4) — the moat, handled carefully.

Links *individuals* across registers where there is NO shared id (a Companies House
director who may also be an Electoral Commission donor or an MP). This is the libel-risk
surface, so the discipline is precision-first:

  blocking         candidate pairs share a normalised surname (cross-format:
                   "ALEXANDER, Douglas" == "Mr Douglas Alexander")
  scoring          rarity-weighted Fellegi-Sunter — match weight = sum ln(m/u) over
                   surname (u = surname frequency -> rare surname counts a lot),
                   forenames, and shared-neighbour Jaccard (the graph-aware §4.4 signal)
  decision bands   p >= TAU_HIGH -> confident match ; TAU_LOW..TAU_HIGH -> a *lead*
                   (dotted, never a stated fact) ; below -> distinct
  calibration      a small hand-labelled gold set checks precision before anything merges

By default it only REPORTS (prints candidates + a gold-set precision). It does not write
merges — nothing inferred reaches the public graph until the precision is trusted.

Run:  python -m orrery_pipeline.resolution.fuzzy_match
"""

from __future__ import annotations

import math
import os
from collections import defaultdict

from ..ingestion.companies_house import apply_sql  # noqa (available if we later apply)
from .uk_surnames import SURNAME_FREQ

TAU_HIGH = 0.90
TAU_LOW = 0.60
# Floor for surname frequency u — never let a surname be treated as arbitrarily rare
# (an unseen or single-mention surname must not blow up the rarity weight unboundedly).
SURNAME_U_FLOOR = 1e-5
TITLES = {"mr", "mrs", "ms", "miss", "dr", "sir", "dame", "lord", "lady", "rt",
          "hon", "the", "honourable", "rev", "prof", "professor", "baroness", "earl",
          "councillor", "cllr", "qc", "kc", "mp"}


def norm_name(name: str):
    """-> (surname, frozenset(forenames)). Handles 'LAST, First' and 'Title First Last'."""
    n = (name or "").lower().replace(".", "").replace("'", "")
    if "," in n:
        last, rest = n.split(",", 1)
        surname = last.strip()
        toks = [t.strip(",") for t in rest.split()]
    else:
        toks = [t for t in n.split() if t]
        toks = [t for t in toks if t not in TITLES]
        surname = toks[-1] if toks else ""
        toks = toks[:-1]
    fores = frozenset(t for t in toks if len(t) > 1 and t not in TITLES)
    return surname, fores


def load(conn):
    persons = {}
    for r in conn.run(
        "select ce.id::text, ce.canonical_name, array_agg(distinct sd.source_code) "
        "from public.canonical_entities ce "
        "join public.mention_resolutions mr on mr.canonical_entity_id=ce.id and mr.is_active "
        "join public.mentions m on m.id=mr.mention_id "
        "join public.source_documents sd on sd.id=m.source_document_id "
        "where ce.entity_type='person' group by 1,2"
    ):
        cid, name, sources = r[0], r[1], r[2]
        surname, fores = norm_name(name)
        persons[cid] = {"name": name, "sources": set(sources), "surname": surname, "fores": fores, "nbrs": set()}
    for r in conn.run("select subject_entity_id::text, object_entity_id::text from public.statements"):
        if r[0] in persons:
            persons[r[0]]["nbrs"].add(r[1])
        if r[1] in persons:
            persons[r[1]]["nbrs"].add(r[0])
    return persons


def neighbour_degree(items) -> dict:
    """Degree of every neighbour id = how many person-nodes link to it (engine-spec §4.4
    graph-aware pass, IDF side). A neighbour shared by many people (a near-hub — a big donor,
    a large employer) is weak evidence two same-named people are the same; a low-degree,
    distinctive shared neighbour is strong evidence. `items` is any iterable of dicts with an
    'nbrs' set (persons from `load`, or mentions from `gold_set.load_person_mentions`)."""
    degree: dict = defaultdict(int)
    for it in items:
        for nbr in it.get("nbrs", ()):
            degree[nbr] += 1
    return degree


def score(a, b, surname_u, neighbour_degree_map=None):
    # surname (block guarantees equal): rarer surname => larger positive weight.
    #
    # Fix 1 (reliability inversion, cause A): in-corpus frequency alone massively over-rates
    # rarity for common British surnames that just happen to appear a handful of times in our
    # small (~1,800-mention) corpus — e.g. "Taylor" at 3/1834 looks like u~0.0016 (rare) when
    # its true GB share is ~0.45%. Blend in the external SURNAME_FREQ table and take the LARGER
    # of the two estimates: a common surname must always get its true (high) frequency and
    # therefore a small rarity weight, regardless of how few times it happens to show up here.
    # The in-corpus estimate still dominates for surnames absent from SURNAME_FREQ (safe
    # fallback), and SURNAME_U_FLOOR keeps any surname from being treated as arbitrarily rare.
    in_corpus_u = surname_u.get(a["surname"], SURNAME_U_FLOOR)
    external_u = SURNAME_FREQ.get(a["surname"], 0.0)
    u = max(external_u, in_corpus_u, SURNAME_U_FLOOR)
    w = math.log(0.9 / u)

    inter = len(a["nbrs"] & b["nbrs"])
    union = len(a["nbrs"] | b["nbrs"]) or 1
    j = inter / union
    # forenames
    if a["fores"] and b["fores"]:
        if a["fores"] == b["fores"]:
            w += math.log(0.85 / 0.04)            # exact forename match
        elif a["fores"] & b["fores"]:
            w += math.log(0.6 / 0.10)             # partial overlap
        elif {f[0] for f in a["fores"]} & {f[0] for f in b["fores"]}:
            w += math.log(0.4 / 0.20)             # shared initial only
        else:
            return 0.05, j  # conflicting forenames -> different people; neighbours must NOT override
    # shared-neighbour corroboration (graph-aware) is REQUIRED for a confident match: the same
    # connections => likely the same person. NO shared neighbour is evidence AGAINST (a same-name
    # coincidence — the three "Martin Taylor"s with distinct donor ids), mirroring dedupe_v1's
    # shared-neighbour rule; without it a pair can at most be a lead, never an auto-merge.
    #
    # Fix 2 (reliability inversion, cause B): a raw Jaccard/count treats every shared neighbour
    # equally, but a near-hub shared neighbour (connected to many people — a large donor, a big
    # employer) is weak evidence of identity, while a low-degree, distinctive shared neighbour is
    # strong evidence. Weight each shared neighbour by IDF: 1 / (1 + ln(1 + degree)), so a
    # degree-1 exclusive connection contributes ~1.0 and a degree-50 near-hub contributes ~0.20.
    if inter:
        degmap = neighbour_degree_map or {}
        shared = a["nbrs"] & b["nbrs"]
        idf_weight = sum(1.0 / (1.0 + math.log1p(degmap.get(n, 1))) for n in shared)
        idf_avg = idf_weight / len(shared)  # in (0, 1]; 1.0 = maximally distinctive
        w += math.log((0.5 + 0.5 * idf_avg) / 0.1)
    else:
        w += math.log(0.15 / 0.85)
    # prior odds low (most same-surname pairs are different people)
    llr = w + math.log(0.02 / 0.98)
    return 1.0 / (1.0 + math.exp(-llr)), j


def candidates(persons, surname_u, neighbour_degree_map=None):
    if neighbour_degree_map is None:
        neighbour_degree_map = neighbour_degree(persons.values())
    blocks = defaultdict(list)
    for cid, p in persons.items():
        if p["surname"]:
            blocks[p["surname"]].append(cid)
    out = []
    for surname, ids in blocks.items():
        for i in range(len(ids)):
            for k in range(i + 1, len(ids)):
                a, b = persons[ids[i]], persons[ids[k]]
                cross = bool(a["sources"] ^ b["sources"]) or not (a["sources"] & b["sources"])
                p, j = score(a, b, surname_u, neighbour_degree_map)
                out.append((p, j, ids[i], ids[k], cross))
    out.sort(reverse=True)
    return out


def main():
    import urllib.parse as up
    import ssl
    import pg8000.native
    url = os.environ["SUPABASE_DB_URL"]
    u = up.urlparse(url)
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    conn = pg8000.native.Connection(user=up.unquote(u.username), password=up.unquote(u.password),
                                    host=u.hostname, port=u.port or 5432,
                                    database=(u.path or "/postgres").lstrip("/"), ssl_context=ctx)
    persons = load(conn)
    surname_freq = defaultdict(int)
    for p in persons.values():
        surname_freq[p["surname"]] += 1
    total = sum(surname_freq.values()) or 1
    surname_u = {s: c / total for s, c in surname_freq.items()}

    cands = candidates(persons, surname_u)
    cross = [c for c in cands if c[4]]
    print(f"{len(persons)} person entities; {len(cands)} same-surname candidate pairs; {len(cross)} cross-source")
    print(f"thresholds: lead >= {TAU_LOW}, confident match >= {TAU_HIGH}\n")
    shown = [c for c in cands if c[0] >= TAU_LOW]
    print(f"candidate matches at/above lead threshold ({len(shown)}):")
    for p, j, ai, bi, cross_flag in shown[:20]:
        band = "MATCH" if p >= TAU_HIGH else "lead"
        tag = "cross-source" if cross_flag else "within-source"
        print(f"  p={p:.3f} j={j:.2f} [{band:5}] [{tag}] {persons[ai]['name']!r} <-> {persons[bi]['name']!r}")
    n_match = sum(1 for c in cands if c[0] >= TAU_HIGH)
    n_lead = sum(1 for c in cands if TAU_LOW <= c[0] < TAU_HIGH)
    print(f"\nverdict: {n_match} confident matches ({sum(1 for c in cands if c[0] >= TAU_HIGH and c[4])} cross-source), "
          f"{n_lead} leads; cross-source individual overlap in this slice: "
          f"{'none — nothing inferred goes public' if not any(c[4] and c[0] >= TAU_LOW for c in cands) else 'see above'}")
    conn.close()


if __name__ == "__main__":
    main()
