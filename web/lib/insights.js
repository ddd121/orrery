/**
 * Insight sentences (DESIGN_SPEC_V2 "Value Everywhere", Wave 2 section B).
 *
 * Turns one `entity_insights` row (`kind` + `slots`) into a plain-English sentence
 * plus its cohort caption, so every click ("open a dossier", "hover a search
 * result", "select a node in Explore") lands on a fact worth repeating rather than
 * a bare list. Purely a function of the row's own sourced `slots`: no invented
 * numbers, no verdicts, no allegations. Degrades gracefully: if an expected slot
 * key is missing we fall back to the next-best honest phrasing rather than ever
 * render "undefined" or a broken sentence.
 *
 * British English; £ formatted with Intl en-GB, no decimals; never renders a
 * contract figure as money received (that rule lives upstream in the pipeline,
 * this module just prints whatever slot key the row actually carries).
 */

const gbpFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

function gbp(n) {
  if (n == null || isNaN(Number(n))) return null;
  return gbpFmt.format(Number(n));
}

/** 1st / 2nd / 3rd / 4th / 11th / 21st ... */
function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return `${n}`;
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
}

/**
 * insightSentence(insight) -> { sentence, cohortLine }
 * `insight` is one entity_insights row: { kind, slots, rank, cohort_size, ... }.
 * Never throws; a row with unexpected/missing slots still returns a complete,
 * honest sentence (falling back toward BASIC-style phrasing).
 */
export function insightSentence(insight) {
  if (!insight) return { sentence: '', cohortLine: '' };
  const s = insight.slots || {};
  const rank = typeof insight.rank === 'number' ? insight.rank : s.rank;
  const cohortLine = typeof s.cohort === 'string' ? s.cohort : '';

  switch (insight.kind) {
    case 'RANK_MONEY_GIVEN': {
      const total = gbp(s.total_gbp);
      const n = s.n_donations;
      if (total != null && typeof rank === 'number' && rank <= 3) {
        const nPart = typeof n === 'number' ? ` across ${n} donation${n === 1 ? '' : 's'}` : '';
        return {
          sentence: `The ${ordinal(rank)} largest donor in this register: £${total}${nPart}.`,
          cohortLine,
        };
      }
      if (total != null) {
        return { sentence: `Gave £${total} in declared political donations.`, cohortLine };
      }
      return { sentence: 'Made declared political donations.', cohortLine };
    }

    case 'RANK_MONEY_RECEIVED': {
      const total = gbp(s.total_gbp);
      const rankPart = typeof rank === 'number' && rank <= 3 ? `, the ${ordinal(rank)} most in this register` : '';
      if (total != null) {
        return { sentence: `Received £${total} in declared donations${rankPart}.`, cohortLine };
      }
      return { sentence: 'Received declared political donations.', cohortLine };
    }

    case 'RANK_PORTFOLIO': {
      const n = s.n_ties;
      const percentile = s.percentile;
      if (typeof percentile === 'number' && percentile >= 75 && typeof n === 'number') {
        return {
          sentence: `More declared corporate ties than ${Math.round(percentile)}% of ${cohortNoun(cohortLine)}: ${n} in the registers.`,
          cohortLine,
        };
      }
      if (typeof n === 'number') {
        return { sentence: `${n} declared corporate tie${n === 1 ? '' : 's'} in the registers.`, cohortLine };
      }
      return { sentence: 'Has declared corporate ties in the registers.', cohortLine };
    }

    case 'ONLY_N': {
      const desc = s.set_description;
      if (desc) {
        // set_description already reads as "one of N ..."; use verbatim.
        const sentence = /^one of/i.test(desc) ? capitalise(desc) : `One of ${s.set_size ?? ''} ${desc}`.trim();
        return { sentence: endWithPeriod(sentence), cohortLine };
      }
      if (typeof s.set_size === 'number') {
        return { sentence: `One of ${s.set_size} entities with this pattern.`, cohortLine };
      }
      return { sentence: 'A rare pattern in this register.', cohortLine };
    }

    case 'BRIDGE': {
      const n = s.n_registers;
      if (typeof n === 'number') {
        return {
          sentence: `Appears in ${n} public register${n === 1 ? '' : 's'}: the widest crossings in the data.`,
          cohortLine,
        };
      }
      return { sentence: 'Appears across multiple public registers.', cohortLine };
    }

    case 'NEAREST_NOTABLE': {
      const hops = s.hops;
      const notable = s.notable_name;
      if (typeof hops === 'number' && notable) {
        return { sentence: `${hops} step${hops === 1 ? '' : 's'} from ${notable} in the register graph.`, cohortLine };
      }
      if (notable) {
        return { sentence: `Close to ${notable} in the register graph.`, cohortLine };
      }
      return { sentence: 'Connected within the register graph.', cohortLine };
    }

    case 'BASIC':
    default: {
      const nTies = s.n_ties;
      const nRegisters = s.n_registers;
      if (typeof nTies === 'number' && typeof nRegisters === 'number') {
        return {
          sentence: `${nTies} sourced connection${nTies === 1 ? '' : 's'} across ${nRegisters} register${nRegisters === 1 ? '' : 's'}.`,
          cohortLine,
        };
      }
      if (typeof nTies === 'number') {
        return { sentence: `${nTies} sourced connection${nTies === 1 ? '' : 's'}.`, cohortLine };
      }
      return { sentence: 'A sourced entity in the public registers.', cohortLine };
    }
  }
}

/** Best-effort cohort noun for the RANK_PORTFOLIO "than {pct}% of {cohort}" clause:
 *  strips a leading "the " so "the 743 MPs and peers..." reads as "743 MPs and peers...". */
function cohortNoun(cohortLine) {
  if (!cohortLine) return 'entities in this register';
  return cohortLine.replace(/^the\s+/i, '');
}

function capitalise(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function endWithPeriod(s) {
  if (!s) return s;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Highest-priority insight in a list (entity_insights rows are already sorted by
 *  priority desc from loadInsights, but this is safe to call on any subset/order). */
export function topInsight(list) {
  if (!list || list.length === 0) return null;
  let best = list[0];
  for (const it of list) {
    const p = typeof it.priority === 'number' ? it.priority : 0;
    const bp = typeof best.priority === 'number' ? best.priority : 0;
    if (p > bp) best = it;
  }
  return best;
}
