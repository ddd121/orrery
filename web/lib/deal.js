/**
 * The Deal sampler (DESIGN_SPEC_V2 "The Deal sampler") + the headline templates
 * (Step 2, section D). Client-only, deterministic-safe: everything here is a pure
 * function of a seed, never `Math.random` in the substance: only a seeded PRNG.
 *
 * The serendipity is in the SAMPLING ORDER, never the facts: every finding is a
 * materialised, sourced structural pattern already gated on confidence upstream
 * (pipeline `findings_v1.sql`). This module only decides which four to deal, and
 * how to phrase them in plain English.
 */

/* ------------------------------ visitor id ------------------------------ */
const VISITOR_KEY = 'orrery.visitorId';

/** Read/create a stable per-browser id. Only ever touch localStorage client-side
 *  (call from a useEffect); returns null during SSR / before the effect runs. */
export function getOrCreateVisitorId() {
  if (typeof window === 'undefined') return null;
  try {
    let id = window.localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    // localStorage can throw in locked-down/private contexts, so fall back to a
    // session-only id so the sampler still works, just without persistence.
    return `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Today's date as YYYY-MM-DD, used verbatim in the seed string (stable within a day). */
export function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------ seeded PRNG ------------------------------ */
/* xmur3 string hash -> 32-bit seed, then mulberry32 as the PRNG. Small, dependency-free,
   and deterministic: the same string always yields the same stream of doubles. */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** hashString(seedStr) -> a 32-bit unsigned int, stable for a given string. */
export function hashString(seedStr) {
  return xmur3(String(seedStr))();
}

/** Build a seeded PRNG (returns doubles in [0,1)) from any string. */
export function makeRng(seedStr) {
  return mulberry32(hashString(seedStr));
}

/* ------------------------------ the sampler ------------------------------ */
/**
 * Deal a hand of 4 findings from the (already QUIET_PORTFOLIO-excluded) pool,
 * sorted by surprise desc. Deterministic given `seedStr` + `excludeIds`.
 *  - Slot 1: uniform pick from the top 10 by surprise (the guaranteed wow).
 *  - Slots 2-4: weighted sample without replacement over the whole pool,
 *    weight = exp(-rank/25) (rank = position in the surprise-sorted pool).
 *  - Diversity: no two dealt findings share a shape_code or any member entity id
 *    (resample on collision, bounded tries).
 *  - `excludeIds` (session "seen" set) is removed from the pool before dealing;
 *    if that empties the pool, the caller is expected to have reset "seen" first.
 */
export function dealHand(findingsSortedDesc, seedStr, excludeIds = new Set()) {
  const rng = makeRng(seedStr);
  const pool = findingsSortedDesc.filter((f) => !excludeIds.has(f.id));
  if (pool.length === 0) return [];

  const top10 = pool.slice(0, 10);
  const hand = [];
  const usedShapes = new Set();
  const usedEntities = new Set();

  const collides = (f) =>
    usedShapes.has(f.shape_code) || (f.member_entity_ids || []).some((id) => usedEntities.has(id));
  const take = (f) => {
    hand.push(f);
    usedShapes.add(f.shape_code);
    for (const id of f.member_entity_ids || []) usedEntities.add(id);
  };

  // slot 1: uniform from the top 10
  {
    const tries = Math.min(top10.length, 20);
    let picked = null;
    const order = [...top10];
    for (let t = 0; t < tries && order.length; t++) {
      const idx = Math.floor(rng() * order.length);
      const cand = order.splice(idx, 1)[0];
      if (!collides(cand)) { picked = cand; break; }
    }
    if (!picked && top10.length) picked = top10[Math.floor(rng() * top10.length)];
    if (picked) take(picked);
  }

  // slots 2-4: weighted sample without replacement, weight = exp(-rank/25)
  while (hand.length < 4) {
    const remaining = pool.filter((f) => !hand.includes(f));
    if (remaining.length === 0) break;

    // try up to `maxTries` weighted draws looking for a non-colliding candidate;
    // if all fail, relax the diversity rule rather than deal a short hand.
    const maxTries = 30;
    let picked = null;
    for (let t = 0; t < maxTries; t++) {
      const cand = weightedPick(remaining, pool, rng);
      if (cand && !collides(cand)) { picked = cand; break; }
    }
    if (!picked) picked = weightedPick(remaining, pool, rng) || remaining[0];
    take(picked);
  }

  return hand;
}

/** One weighted draw over `candidates`, weight exp(-rank/25) where rank is the
 *  candidate's position in `fullPoolSortedDesc` (so weight reflects true surprise rank). */
function weightedPick(candidates, fullPoolSortedDesc, rng) {
  if (candidates.length === 0) return null;
  const rankOf = (f) => fullPoolSortedDesc.indexOf(f);
  const weights = candidates.map((f) => Math.exp(-rankOf(f) / 25));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return candidates[Math.floor(rng() * candidates.length)];
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/* ------------------------------ headline templates ------------------------------ */
const gbpFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
/** Format a GBP figure with thousands separators, no currency decimals: "5,000,000". */
function gbp(n) {
  if (n == null || isNaN(Number(n))) return null;
  return gbpFmt.format(Number(n));
}

function truncate(s, n = 40) {
  if (!s) return s;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* Natural donee phrasing so a party short-name reads correctly in a sentence:
   "to the Conservatives", "to Labour", "to Reform UK", not "to the Conservative". */
const PARTY_PHRASE = {
  Conservative: 'the Conservatives',
  Conservatives: 'the Conservatives',
  'Conservative and Unionist Party': 'the Conservatives',
  Labour: 'Labour',
  'Labour Party': 'the Labour Party',
  'Liberal Democrat': 'the Liberal Democrats',
  'Liberal Democrats': 'the Liberal Democrats',
  Green: 'the Green Party',
  'Green Party': 'the Green Party',
  'Reform UK': 'Reform UK',
  'Scottish National Party': 'the SNP',
  SNP: 'the SNP',
  'Plaid Cymru': 'Plaid Cymru',
};
function partyPhrase(name) {
  if (!name) return 'the party';
  if (PARTY_PHRASE[name]) return PARTY_PHRASE[name];
  return /\b(party|uk|democrats|conservatives|greens)\b/i.test(name) ? `the ${name}` : name;
}

/**
 * A plain-English, fact-only headline built from a finding's `slots`. Never a verdict.
 * CRITICAL: LOOP_CLOSED reports the CONTRACT COUNT, never any contract £ total:
 * `contract_total_gbp` is a framework ceiling, not money received, and must never be
 * stated as such.
 */
export function headlineFor(finding) {
  const s = finding.slots || {};
  switch (finding.shape_code) {
    case 'LOOP_CLOSED': {
      const donation = gbp(s.donation_gbp);
      const count = s.contract_count;
      const parts = [];
      if (donation) parts.push(`${s.company} gave £${donation} to ${partyPhrase(s.party)}.`);
      else parts.push(`${s.company} is a donor to ${partyPhrase(s.party)}.`);
      if (count != null) parts.push(`It also holds ${count} public ${count === 1 ? 'contract' : 'contracts'}.`);
      return parts.join(' ');
    }
    case 'SHARED_BENCH':
      return `${s.org} is tied to ${s.n_people} parliamentarians.`;
    case 'FAMILY_DESK':
      return `${s.person_a} and ${s.person_b} are both tied to ${s.company}.`;
    case 'BIG_MONEY': {
      const amount = gbp(s.amount_gbp);
      return amount
        ? `${s.donor} gave £${amount} to ${partyPhrase(s.recipient)}.`
        : `${s.donor} made a donation to ${partyPhrase(s.recipient)}.`;
    }
    case 'CROSSING':
      return `${s.entity} appears in ${s.n_registers} public registers.`;
    case 'SECTOR_OVERLAP':
      return s.overlap
        ? `${s.mp} sits where their declared interests overlap with ${s.overlap}.`
        : `${s.mp} sits where their declared interests overlap.`;
    case 'NEW_ON_REGISTER':
      return `New on the register: ${s.subject} and ${s.object}.`;
    default:
      return 'A sourced structural pattern in the public registers.';
  }
}

const SHAPE_LABELS = {
  LOOP_CLOSED: 'LOOP CLOSED',
  SHARED_BENCH: 'SHARED BENCH',
  FAMILY_DESK: 'FAMILY DESK',
  BIG_MONEY: 'BIG MONEY',
  CROSSING: 'CROSSING',
  SECTOR_OVERLAP: 'SECTOR OVERLAP',
  NEW_ON_REGISTER: 'NEW ON THE REGISTER',
};

/** The shape stamp text for a finding's `shape_code`. */
export function shapeLabel(shapeCode) {
  return SHAPE_LABELS[shapeCode] ?? shapeCode;
}

/**
 * The pivotal member entity id for a finding: the CENTRE of its mini orrery, and the
 * entity a click-through opens. LOOP_CLOSED/CROSSING -> the company; SHARED_BENCH ->
 * the org; FAMILY_DESK -> the shared company; BIG_MONEY -> the donor; else the first member.
 */
export function pivotEntityId(finding, nodesById) {
  const ids = finding.member_entity_ids || [];
  if (ids.length === 0) return null;
  const s = finding.slots || {};

  const findByName = (name) => {
    if (!name) return null;
    for (const id of ids) if (nodesById[id]?.name === name) return id;
    return null;
  };

  switch (finding.shape_code) {
    case 'LOOP_CLOSED':
    case 'CROSSING':
      return findByName(s.company) ?? findByName(s.entity) ?? ids[0];
    case 'BIG_MONEY':
      return findByName(s.donor) ?? ids[0];
    case 'SHARED_BENCH':
      return findByName(s.org) ?? ids[0];
    case 'FAMILY_DESK':
      return findByName(s.company) ?? ids[0];
    default:
      return ids[0];
  }
}

export { truncate };
