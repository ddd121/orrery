"""Calibration (engine-spec §6) — make a match score mean something, and pick a merge
threshold at a target precision. "A 70% must be right ~70% of the time, or it's theatre."

Pure-Python isotonic regression (pool-adjacent-violators), so it installs anywhere. Fit it
against a GOLD SET of hand-labelled candidate pairs (1 = same person, 0 = different),
keyed by STABLE identifiers (the underlying mention-id pair, or the pair of official source
keys) — NOT canonical-entity ids, which are regenerated on every resolution run.

A trustworthy precision number needs a REPRESENTATIVE gold set (~thousands of pairs across
the score range). The current bounded slice has too few cross-source candidate pairs to fit
one honestly, so this module ships the machinery + a deterministic self-test; the real gold
set arrives with broader data (the Register of Members' Interests, more donors/directors).
Until it's fitted, fuzzy_match.py stays REPORT-ONLY — nothing inferred reaches the graph.
"""

from __future__ import annotations


def isotonic(labels_by_ascending_score: list[int]) -> list[float]:
    """Pool-adjacent-violators -> a monotone non-decreasing calibrated probability per point."""
    blocks = [[float(y), 1] for y in labels_by_ascending_score]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] / blocks[i][1] > blocks[i + 1][0] / blocks[i + 1][1]:
            blocks[i][0] += blocks[i + 1][0]
            blocks[i][1] += blocks[i + 1][1]
            del blocks[i + 1]
            if i > 0:
                i -= 1
        else:
            i += 1
    out: list[float] = []
    for total, count in blocks:
        out += [total / count] * count
    return out


def calibrate(pairs: list[tuple[float, int]]):
    """pairs: (raw_score, gold_label). Returns (calibrated_probabilities, pairs_sorted_ascending)."""
    sp = sorted(pairs)
    return isotonic([l for _, l in sp]), sp


def threshold_for_precision(pairs: list[tuple[float, int]], target: float):
    """Lowest raw score at/above which 'predict same person' achieves >= target precision."""
    best = None
    tp = fp = 0
    for score, label in sorted(pairs, reverse=True):
        tp += label
        fp += 1 - label
        if tp + fp and tp / (tp + fp) >= target:
            best = score
    return best


def reliability(pairs: list[tuple[float, int]], bins: int = 5):
    """Reliability diagram as rows: (mean predicted score, observed same-rate, n) per bin."""
    sp = sorted(pairs)
    n = len(sp)
    rows = []
    for b in range(bins):
        chunk = sp[b * n // bins:(b + 1) * n // bins]
        if chunk:
            rows.append((sum(s for s, _ in chunk) / len(chunk),
                         sum(l for _, l in chunk) / len(chunk), len(chunk)))
    return rows


def report(pairs, targets=(0.90, 0.95)):
    print(f"gold set: {len(pairs)} labelled pairs ({sum(l for _, l in pairs)} same, "
          f"{sum(1 - l for _, l in pairs)} different)")
    print("reliability (mean score -> observed same-rate):")
    for s, f, c in reliability(pairs):
        print(f"  score~{s:.2f}  observed_same={f:.2f}  (n={c})")
    for t in targets:
        thr = threshold_for_precision(pairs, t)
        print(f"  merge threshold for >= {t:.0%} precision: "
              + (f"score >= {thr:.3f}" if thr is not None else "unattainable on this gold set"))


def _selftest():
    # deterministic synthetic gold set: higher score => more likely the same person
    gold = [(0.10, 0), (0.20, 0), (0.30, 0), (0.40, 0), (0.45, 0), (0.55, 0),
            (0.60, 1), (0.62, 0), (0.70, 1), (0.72, 0), (0.80, 1), (0.85, 1),
            (0.88, 0), (0.90, 1), (0.92, 1), (0.95, 1), (0.96, 1), (0.97, 1),
            (0.98, 1), (0.99, 1)]
    report(gold)
    cal, _ = calibrate(gold)
    assert cal == sorted(cal), "calibration must be monotone non-decreasing"
    assert threshold_for_precision(gold, 0.95) is not None
    print("calibration self-test OK (machinery verified; awaiting a representative gold set)")


if __name__ == "__main__":
    _selftest()
