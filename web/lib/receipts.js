/**
 * receipts.js: "the receipts", a plain markdown export of a finding's evidence, so a
 * visitor can paste sourced ties elsewhere without losing the citation. Facts only, in
 * the same order and wording as THE EVIDENCE on the finding page: never a verdict.
 */

/** Format "retrieved" date as en-GB, e.g. "6 July 2026". */
function enGBDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * buildReceipts({ title, ties, url }) -> a markdown string:
 *   ## {title}
 *   - {other name}: {rel}, {amount} ({confidence}% confidence, via {method})
 *   ...
 *   Source: ORRERY, {url}, retrieved {en-GB date}. Every line cites its public register.
 *
 * `ties` is the same shape as `tiesOf`/evidence rows: { other: {name}, rel, amount,
 * confidence (0-1), method }. Amount is optional and only appended when present.
 */
export function buildReceipts({ title, ties, url }) {
  const lines = [`## ${title}`, ''];
  for (const t of ties || []) {
    const name = t.other?.name ?? 'Unknown';
    const pct = Math.round((t.confidence ?? 0) * 100);
    const amountPart = t.amount ? `, ${t.amount}` : '';
    lines.push(`- ${name}: ${t.rel}${amountPart} (${pct}% confidence, via ${t.method})`);
  }
  lines.push('');
  lines.push(`Source: ORRERY, ${url}, retrieved ${enGBDate()}. Every line cites its public register.`);
  return lines.join('\n');
}

/**
 * copyReceipts(...) builds the receipts markdown and writes it to the clipboard,
 * returning a promise the caller can await to show a confirmation state. Rejects if
 * the clipboard API is unavailable or the write throws (e.g. insecure context).
 */
export async function copyReceipts(args) {
  const md = buildReceipts(args);
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard unavailable');
  }
  await navigator.clipboard.writeText(md);
  return md;
}
