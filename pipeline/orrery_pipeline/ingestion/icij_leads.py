"""ICIJ Offshore Leaks lead-matching (The Front Page, Wave A.4) -- a standalone, best-effort
script, NOT part of `recompute build`.

Downloads the free ICIJ Offshore Leaks bulk-data zip (Offshore Leaks / Panama Papers / Bahamas
Leaks / Paradise Papers / Pandora Papers, ~810k offshore entities, ODbL/CC-BY-SA, no account
needed), stream-parses the entities-node CSV inside it, and exact-normalised-name matches it
against OUR canonical COMPANY names only.

This is LEADS ONLY (CLAUDE.md THE LINE): a name match is never a merge, never a finding, never a
statement. It is written to `public.offshore_leads`, a dotted lead the UI renders with a "names
can coincide" disclaimer and a link back to the ICIJ record. Companies only -- persons are
deliberately excluded (a person name match against a leak dataset is exactly the kind of coincidal
false-identification THE LINE forbids without a much stronger corroboration signal than a bare
name).

If the download errors or runs past the time budget, this SKIPS GRACEFULLY: prints why, writes
nothing, exits 0. Idempotent per run: delete-all + insert.

Stdlib + pg8000 only. Reuses companies_house's SQL-safe quoting/applier and
companies_from_interests' name-key base (the same legal-suffix-stripped, sorted-token key used to
bridge declared company names onto Companies House).

Usage:
    python -m orrery_pipeline.ingestion.icij_leads
"""

from __future__ import annotations

import csv
import hashlib
import io
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from .companies_from_interests import name_key
from .companies_house import apply_sql, s

ZIP_URL = "https://offshoreleaks-data.icij.org/offshoreleaks/csv/full-oldb.LATEST.zip"
ENTITIES_MEMBER = "nodes-entities.csv"
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "icij"
CACHE_FILE = CACHE_DIR / "full-oldb.LATEST.zip"
DOWNLOAD_BUDGET_S = 8 * 60  # ~8 minutes, per the plan
CHUNK = 1024 * 1024  # 1 MiB
NODE_URL = "https://offshoreleaks.icij.org/nodes/{node_id}"


def ensure_downloaded() -> Path | None:
    """Return the local zip path, downloading it if not already cached. None (and prints why) on
    any failure or if the time budget is exceeded -- the caller must skip gracefully."""
    if CACHE_FILE.exists() and CACHE_FILE.stat().st_size > 0:
        print(f"using cached bulk file: {CACHE_FILE} ({CACHE_FILE.stat().st_size:,} bytes)")
        return CACHE_FILE

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = CACHE_FILE.with_suffix(".part")
    start = time.monotonic()
    try:
        req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "orrery-pipeline/0.1 (research)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            total = r.headers.get("Content-Length")
            total = int(total) if total else None
            written = 0
            with open(tmp_path, "wb") as f:
                while True:
                    if time.monotonic() - start > DOWNLOAD_BUDGET_S:
                        raise TimeoutError(f"download exceeded {DOWNLOAD_BUDGET_S}s budget")
                    chunk = r.read(CHUNK)
                    if not chunk:
                        break
                    f.write(chunk)
                    written += len(chunk)
                    if total:
                        print(f"  downloading… {written:,}/{total:,} bytes "
                              f"({100 * written / total:.0f}%)", end="\r")
                    else:
                        print(f"  downloading… {written:,} bytes", end="\r")
        print()
        tmp_path.rename(CACHE_FILE)
        return CACHE_FILE
    except Exception as e:  # network error, timeout, HTTP error, disk error -- skip gracefully
        print(f"download failed, skipping ICIJ leads gracefully: {e}")
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass
        return None


def fetch_company_names(con) -> dict[str, list[tuple[str, str, str]]]:
    """base name-key -> list of (entity_id, canonical_name, suffix_class) for every canonical
    company. The suffix class rides along so matching can demand CLASS EQUALITY: folding plc
    onto LIMITED (or a bare name onto either) produced false same-name leads on big listed
    companies, which is insinuation even with a disclaimer. Precision over recall."""
    rows = con.run("select id, canonical_name from public.canonical_entities where entity_type = 'company'")
    by_key: dict[str, list[tuple[str, str, str]]] = {}
    for entity_id, name in rows:
        base, cls = name_key(name or "")
        # require a distinctive base: two or more tokens, so a single common word
        # ("noble", "opal") can never anchor a lead on its own.
        if not base or len(base.split()) < 2:
            continue
        by_key.setdefault(base, []).append((str(entity_id), name, cls))
    return by_key


def stream_matches(zip_path: Path, our_companies: dict[str, list[tuple[str, str]]]):
    """Yield (entity_id, our_name, icij_name, icij_jurisdiction, source_leak, node_id) for every
    ICIJ entities-node row whose normalised base name-key exactly matches one of ours. Streams the
    member CSV out of the zip -- never loads the whole (~200MB) file into memory."""
    with zipfile.ZipFile(zip_path) as z:
        with z.open(ENTITIES_MEMBER) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")
            reader = csv.DictReader(text)
            for row in reader:
                icij_name = (row.get("name") or "").strip()
                if not icij_name:
                    continue
                base, cls = name_key(icij_name)
                if not base or base not in our_companies:
                    continue
                source_leak = (row.get("sourceID") or "").strip() or None
                # National corporate registries inside the leak bundles (Malta, Samoa, Cook
                # Islands and similar) are ordinary company registers, not offshore-secrecy
                # material: a match there says nothing lead-worthy. Skip them.
                if source_leak and "corporate registry" in source_leak.lower():
                    continue
                jurisdiction = (row.get("jurisdiction_description") or row.get("jurisdiction") or "").strip() or None
                node_id = (row.get("node_id") or "").strip() or None
                for entity_id, our_name, our_cls in our_companies[base]:
                    # STRICT suffix-class equality: plc never folds onto LIMITED, a bare name
                    # never onto either. A lead must be the same name in full, class included.
                    if cls != our_cls:
                        continue
                    yield entity_id, our_name, icij_name, jurisdiction, source_leak, node_id


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("SUPABASE_DB_URL not set (put it in .env / the environment); skipping.")
        return 0

    zip_path = ensure_downloaded()
    if zip_path is None:
        return 0  # already printed why; write nothing

    import pg8000.native
    import ssl
    from urllib.parse import unquote, urlparse

    u = urlparse(db_url)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    con = pg8000.native.Connection(
        user=unquote(u.username or "postgres"),
        password=unquote(u.password or ""),
        host=u.hostname,
        port=u.port or 5432,
        database=(u.path or "/postgres").lstrip("/") or "postgres",
        ssl_context=ctx,
    )
    try:
        our_companies = fetch_company_names(con)
    finally:
        con.close()
    print(f"canonical companies considered for matching: "
          f"{sum(len(v) for v in our_companies.values())} across {len(our_companies)} distinct name-keys")

    try:
        matches = list(stream_matches(zip_path, our_companies))
    except Exception as e:  # corrupt zip / missing member -- skip gracefully, never crash
        print(f"could not parse the ICIJ bulk file, skipping gracefully: {e}")
        return 0

    print(f"ICIJ entity rows matched: {len(matches)}")

    rows = []
    seen_ids = set()
    for entity_id, our_name, icij_name, jurisdiction, source_leak, node_id in matches:
        lead_id = hashlib.md5(f"OFFSHORE_LEAD|{entity_id}|{node_id}".encode()).hexdigest()
        if lead_id in seen_ids:
            continue
        seen_ids.add(lead_id)
        node_url = NODE_URL.format(node_id=node_id) if node_id else None
        rows.append(
            f"({s(lead_id)}, {s(entity_id)}, {s(icij_name)}, {s(jurisdiction)}, "
            f"{s(source_leak)}, {s(node_id)}, {s(node_url)}, now())"
        )
        print(f"  MATCHED  {our_name!r} (ours) == {icij_name!r} (ICIJ, {source_leak}, "
              f"{jurisdiction}, node {node_id})")

    parts = ["delete from public.offshore_leads;"]
    if rows:
        parts.append(
            "insert into public.offshore_leads "
            "(id, entity_id, icij_name, icij_jurisdiction, source_leak, icij_node_id, icij_url, matched_at) "
            "values\n" + ",\n".join(rows) + ";"
        )
    apply_sql(db_url, "\n\n".join(parts))
    print(f"offshore_leads rebuilt: {len(rows)} row(s) written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
