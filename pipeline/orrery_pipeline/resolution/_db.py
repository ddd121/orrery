"""Tiny shared DB helper for the resolution analysis scripts.

The Supabase session pooler occasionally resets the first TLS connection from this
host (WinError 10053 / connection aborted) — the same connect pattern recompute.py
and fuzzy_match.py use, just flaky on the first attempt. So: connect with a few
retries. Read-only callers only here; nothing in this package writes the graph.

Stdlib + pg8000 (pure-Python) only, matching the rest of the pipeline.
"""

from __future__ import annotations

import os
import ssl
import time
import urllib.parse as up


def connect(retries: int = 5, backoff: float = 1.5):
    """Open a pg8000.native connection from SUPABASE_DB_URL, retrying transient resets."""
    import pg8000.native

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("SUPABASE_DB_URL not set (load it from .env first).")
    u = up.urlparse(url)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    last = None
    for attempt in range(1, retries + 1):
        try:
            return pg8000.native.Connection(
                user=up.unquote(u.username or "postgres"),
                password=up.unquote(u.password or ""),
                host=u.hostname,
                port=u.port or 5432,
                database=(u.path or "/postgres").lstrip("/"),
                ssl_context=ctx,
                timeout=30,
            )
        except Exception as e:  # noqa: BLE001 — transient pooler resets are broad
            last = e
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise SystemExit(f"could not connect after {retries} attempts: {last!r}")


def project_ref() -> str:
    """The Supabase project ref embedded in SUPABASE_DB_URL (for the safety assert)."""
    url = os.environ.get("SUPABASE_DB_URL", "")
    user = up.urlparse(url).username or ""
    # pooler user looks like 'postgres.<ref>'
    return user.split(".", 1)[1] if "." in user else ""
