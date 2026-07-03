"""Calibration moat — the report (engine-spec §6). Ties the bootstrap gold set
(`gold_set.py`) to the Fellegi-Sunter matcher (`fuzzy_match.py`) and the calibration
machinery (`calibration.py`):

  1. build labelled person-pairs (positives = trusted dedup merges; hard negatives = same
     name held apart; easy negatives = random different-surname), keyed by stable mention ids;
  2. score every pair with the F-S matcher;
  3. fit calibration + report precision at target thresholds + a reliability diagram;
  4. list the CROSS-SOURCE merges the matcher would propose above the validated threshold.

REPORT-ONLY. Writes nothing to the graph. No inferred person-merge goes live until a human
accepts the proposals below — the line we hold. The precision here is bounded by the bootstrap
(it validates the ends of the score range well; the genuinely-ambiguous middle needs hand-labels
or LLM adjudication) — see gold_set.py's docstring.

Run:  python -m orrery_pipeline.resolution.calibrate_run
"""

from __future__ import annotations

import os
import ssl
import statistics
import urllib.parse as up
from collections import defaultdict

from . import calibration, fuzzy_match, gold_set


def connect():
    u = up.urlparse(os.environ["SUPABASE_DB_URL"])
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    import pg8000.native
    return pg8000.native.Connection(
        user=up.unquote(u.username or "postgres"), password=up.unquote(u.password or ""),
        host=u.hostname, port=u.port or 5432,
        database=(u.path or "/postgres").lstrip("/"), ssl_context=ctx,
    )


def surname_u(items) -> dict:
    freq: dict = defaultdict(int)
    for m in items:
        if m["surname"]:
            freq[m["surname"]] += 1
    total = sum(freq.values()) or 1
    return {s: c / total for s, c in freq.items()}


def main() -> int:
    try:
        import sys
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    con = connect()
    try:
        mentions = gold_set.load_person_mentions(con)
        gold = gold_set.build_gold(mentions)
        su = surname_u(mentions.values())
        nd = fuzzy_match.neighbour_degree(mentions.values())

        pairs: list[tuple[float, int]] = []
        per_kind: dict[str, list[float]] = defaultdict(list)
        for kind in ("positives", "hard_negatives", "easy_negatives"):
            for row in gold[kind]:
                a, b = mentions.get(row["mid_a"]), mentions.get(row["mid_b"])
                if not a or not b:
                    continue
                p, _ = fuzzy_match.score(a, b, su, nd)
                pairs.append((p, row["label"]))
                per_kind[kind].append(p)

        print("=== ORRERY calibration report (bootstrap gold set) ===")
        print(f"{len(mentions)} person mentions; gold pairs: "
              f"{len(gold['positives'])} positive, {len(gold['hard_negatives'])} hard-neg, "
              f"{len(gold['easy_negatives'])} easy-neg\n")
        for kind in ("positives", "hard_negatives", "easy_negatives"):
            xs = sorted(per_kind[kind])
            if xs:
                print(f"  {kind:14}: n={len(xs):3}  score min={xs[0]:.3f} "
                      f"median={xs[len(xs) // 2]:.3f} max={xs[-1]:.3f}")
        print()
        calibration.report(pairs, targets=(0.95, 0.97))
        if per_kind["positives"] and per_kind["hard_negatives"]:
            print(f"\n  separation: positives mean={statistics.mean(per_kind['positives']):.3f} "
                  f"vs hard-neg mean={statistics.mean(per_kind['hard_negatives']):.3f} "
                  "(want a clear gap)")

        # Proposed cross-source merges above the validated threshold — for human review only.
        thr = calibration.threshold_for_precision(pairs, 0.97) or fuzzy_match.TAU_HIGH
        persons = fuzzy_match.load(con)
        cands = fuzzy_match.candidates(persons, surname_u(persons.values()))
        proposed = [c for c in cands if c[4] and c[0] >= thr]
        print(f"\nproposed CROSS-SOURCE merges at score >= {thr:.3f} ({len(proposed)}) "
              "— FOR HUMAN REVIEW, none auto-applied:")
        for p, j, ai, bi, _ in proposed[:25]:
            print(f"  p={p:.3f} j={j:.2f}  {persons[ai]['name']!r} <-> {persons[bi]['name']!r}")
        if not proposed:
            print("  (none clears the validated precision bar in this slice — "
                  "nothing inferred would go public)")
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
