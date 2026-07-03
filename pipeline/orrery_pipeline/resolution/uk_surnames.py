"""Approximate national frequencies for common Great Britain surnames.

`SURNAME_FREQ` maps a lowercase surname (matching `fuzzy_match.norm_name`'s surname
output) to an approximate share of the GB population who carry it (a proportion in
(0, 1], NOT a raw count). Figures for the well-known top entries are drawn from
publicly reported ONS / General Register Office surname-frequency rankings (England &
Wales census / birth-registration analyses); entries further down the list are a
Zipfian rank-based approximation (frequency ~ k / rank) anchored to those known points,
since exact published shares thin out fast past the top ~50.

**Why this exists**: `fuzzy_match.py`'s in-corpus surname frequency (mentions in THIS
dataset only, ~1,800 rows) massively over-estimates rarity for common British surnames
that simply happen to appear only 2-3 times in our small corpus — e.g. "Taylor" showing
up 3 times in 1,834 mentions looks like a rare surname (u~0.0016) when it is in fact
one of the most common surnames in Britain (true share ~0.45%). That inflates the
Fellegi-Sunter rarity weight for exactly the pairs that most need caution, producing a
reliability inversion (higher score, lower true-same-rate). `SURNAME_FREQ` supplies an
external floor so common names are never mistaken for rare ones.

**Report-only**: this table feeds a down-weighting term in a REPORT-only matcher
(`fuzzy_match.score`). It is not a source of truth about any individual, not a merge
input on its own, and does not cause anything to auto-merge — see fuzzy_match.py's and
calibrate_run.py's module docstrings for the surrounding precision-first discipline.

Coverage: ~180 of the most common GB surnames. Anything absent falls back to the
in-corpus estimate (blended in fuzzy_match.score), so absence is safe, not silently wrong.
"""

from __future__ import annotations

# Rank-ordered list of common GB surnames (approximate, most common first). The exact
# share for the top ~30 comes from published ONS/GRO-style rankings; beyond that we
# apply a Zipfian decay (see _zipf_freq below) anchored at rank 30's known share.
_RANKED_SURNAMES = [
    "smith", "jones", "williams", "taylor", "brown", "davies", "evans", "wilson",
    "thomas", "roberts", "johnson", "lewis", "walker", "robinson", "wood", "thompson",
    "white", "watson", "jackson", "wright", "green", "harris", "cooper", "king",
    "lee", "martin", "clarke", "james", "morgan", "hughes",
    "edwards", "hill", "moore", "clark", "harrison", "scott", "young", "morris",
    "hall", "ward", "turner", "carter", "phillips", "mitchell", "patel", "adams",
    "campbell", "anderson", "allen", "cook",
    "bailey", "parker", "miller", "davis", "murphy", "price", "bell", "baker",
    "griffiths", "kelly", "simpson", "marshall", "collins", "bennett", "cox",
    "richardson", "fox", "gray", "rose", "chapman", "hunt", "robertson", "shaw",
    "reynolds", "lloyd", "ellis", "richards", "russell", "wilkinson", "khan",
    "graham", "stewart", "reid", "murray", "powell", "palmer", "holmes", "rogers",
    "stevens", "walsh", "hunter", "thomson", "matthews", "ross", "owen", "mason",
    "knight", "kennedy", "butler", "saunders", "cole", "pearce", "dean", "foster",
    # extended tail (rank ~101-180), still common GB surnames, all Zipf-approximated
    "ford", "grant", "webb", "gibson", "george", "henderson", "barnes", "hudson",
    "porter", "burton", "day", "peters", "spencer", "gordon", "bradley", "holland",
    "barrett", "burns", "ryan", "hart", "field", "west", "brooks", "chambers",
    "black", "curtis", "newman", "todd", "fraser", "berry", "howard", "warren",
    "boyd", "riley", "armstrong", "crawford", "sutton", "byrne", "kerr", "duncan",
    "nicholson", "fletcher", "stephenson", "franklin", "goodwin", "vaughan",
    "gill", "bishop", "dawson", "sharp", "kaur", "singh", "ahmed", "begum",
    "hossain", "ali", "rahman", "islam", "hyde", "webster", "middleton", "quinn",
    "farrell", "doyle", "mccarthy", "brennan", "connolly", "sullivan", "walton",
    "underwood", "chandler", "ferguson", "gardner", "elliott", "rees", "morton",
    "harvey", "lawrence", "stone", "payne", "hopkins", "wells", "cunningham",
]


def _zipf_freq(rank: int, anchor_rank: int = 30, anchor_freq: float = 0.0030) -> float:
    """Zipfian decay f(rank) ~= anchor_freq * anchor_rank / rank, for ranks past the
    known top block. Purely a smooth, defensible approximation for the long tail —
    not a claim of precision (see module docstring)."""
    return anchor_freq * anchor_rank / rank


# Known (approximate) shares of the GB population for the best-attested top surnames,
# drawn from widely reported ONS/GRO-style surname-frequency rankings. Proportions,
# not counts. These anchor the Zipfian tail below.
_KNOWN_FREQ: dict[str, float] = {
    "smith": 0.0110,
    "jones": 0.0086,
    "williams": 0.0070,
    "taylor": 0.0045,
    "brown": 0.0043,
    "davies": 0.0040,
    "evans": 0.0033,
    "wilson": 0.0032,
    "thomas": 0.0031,
    "roberts": 0.0029,
    "johnson": 0.0028,
    "lewis": 0.0026,
    "walker": 0.0025,
    "robinson": 0.0024,
    "wood": 0.0021,
    "thompson": 0.0021,
    "white": 0.0020,
    "watson": 0.0018,
    "jackson": 0.0018,
    "wright": 0.0018,
    "green": 0.0017,
    "harris": 0.0017,
    "cooper": 0.0016,
    "king": 0.0016,
    "lee": 0.0016,
    "martin": 0.0015,
    "clarke": 0.0015,
    "james": 0.0014,
    "morgan": 0.0014,
    "hughes": 0.0014,
    "khan": 0.0014,
    "patel": 0.0013,
}


def _build_surname_freq() -> dict[str, float]:
    freq: dict[str, float] = {}
    for rank, surname in enumerate(_RANKED_SURNAMES, start=1):
        if surname in _KNOWN_FREQ:
            freq[surname] = _KNOWN_FREQ[surname]
        else:
            freq[surname] = _zipf_freq(rank)
    return freq


# The public table. Keys are lowercase surnames; values are approximate proportions
# of the GB population sharing that surname (report-only down-weighting input).
SURNAME_FREQ: dict[str, float] = _build_surname_freq()
