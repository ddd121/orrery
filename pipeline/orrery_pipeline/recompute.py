"""Recompute the resolved graph from raw (Milestones 3-7), in order.

The pipeline writes the resolved graph; this is the one command that rebuilds it after new
raw has landed. Two modes:

  reset  — clear the resolved layer + delete the Parliament raw, so the loaders can re-land
           it cleanly (the resolved layer's FKs otherwise block deleting the old mentions).
  build  — resolution -> edges -> scrutiny -> conflict motifs, in order (the default).

Typical broaden-the-seed run (between is where the loaders go):

    python -m orrery_pipeline.recompute reset
    python -m orrery_pipeline.ingestion.parliament 60
    python -m orrery_pipeline.ingestion.parliament_interests 60
    python -m orrery_pipeline.recompute build

NB `reset` empties the live graph until `build` finishes — run the whole sequence in one go.

Uses pg8000 directly. Unlike companies_house.apply_sql (which splits generated SQL on blank
lines), this splits the hand-written .sql files into statements respecting '...' string
literals, so their comments + multi-statement bodies run faithfully. Stdlib + pg8000 only.
"""

from __future__ import annotations

import os
import ssl
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

HERE = Path(__file__).resolve().parent

# resolution -> edges -> scrutiny -> §7 conflict motifs. Order matters.
BUILD = [
    HERE / "resolution" / "resolve_v3.sql",
    HERE / "graph" / "edges_v2.sql",
    HERE / "graph" / "scrutiny_v1.sql",
    HERE / "graph" / "motifs_v2.sql",
]

# Clear the resolved layer (so the raw can be deleted past its FKs) + drop the Parliament raw
# so the corrected loaders re-land it. CH + EC raw is untouched; resolve_v3 rebuilds from all.
RESET = """
truncate public.statement_assertions, public.statements,
         public.mention_resolutions, public.canonical_entities restart identity cascade;
delete from public.relationship_assertions where source_document_id in
  (select id from public.source_documents where source_code in ('parliament', 'parliament_interests'));
delete from public.mentions where source_document_id in
  (select id from public.source_documents where source_code in ('parliament', 'parliament_interests'));
delete from public.source_documents where source_code in ('parliament', 'parliament_interests');
"""


def split_statements(sql: str) -> list[str]:
    """Split a SQL script into statements, ignoring ';' inside single-quoted literals and
    stripping -- comments (full-line AND inline) so a stray apostrophe or ';' in a comment
    can't break the parse. Sufficient for our INSERT/UPDATE/TRUNCATE files (no dollar-quotes)."""
    out, buf, in_str = [], [], False
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if not in_str and ch == "-" and i + 1 < n and sql[i + 1] == "-":
            while i < n and sql[i] != "\n":  # skip the comment to end of line
                i += 1
            continue
        if ch == "'":
            in_str = not in_str
        if ch == ";" and not in_str:
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def connect(db_url: str):
    import pg8000.native  # pure-Python; installs on any Python incl. 3.14

    u = urlparse(db_url)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return pg8000.native.Connection(
        user=unquote(u.username or "postgres"),
        password=unquote(u.password or ""),
        host=u.hostname,
        port=u.port or 5432,
        database=(u.path or "/postgres").lstrip("/"),
        ssl_context=ctx,
    )


def run_script(con, sql: str, label: str) -> None:
    for stmt in split_statements(sql):
        con.run(stmt)
    print(f"  ✓ {label}")


def main(argv: list[str]) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows console defaults to cp1252
    except Exception:
        pass
    mode = argv[1] if len(argv) > 1 else "build"
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("SUPABASE_DB_URL not set")
        return 1
    con = connect(db_url)
    try:
        con.run("begin")  # one transaction per run: a failure rolls back, never half-empties
        if mode == "reset":
            print("reset: clearing resolved layer + Parliament raw…")
            run_script(con, RESET, "reset")
        elif mode == "build":
            print("build: rebuilding the resolved graph…")
            for f in BUILD:
                run_script(con, f.read_text(encoding="utf-8"), f.name)
        else:
            con.run("rollback")
            print(f"unknown mode {mode!r} (use reset|build)")
            return 2
        con.run("commit")
    except Exception:
        try:
            con.run("rollback")
        except Exception:
            pass
        raise
    finally:
        con.close()
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
