# ORRERY pipeline

Python service that **writes** the resolved graph the web app **reads**. It owns
ingestion (bulk / incremental / scrapers), entity resolution (Splink + a gold
set + calibration), and confidence/strength propagation. It talks to the shared
Supabase Postgres over `SUPABASE_DB_URL`; it never renders UI.

Scaffold-only at Milestone 1 — no logic yet.

## Environment (Windows → WSL2)

Run this side under **WSL2** (Splink and the data tooling are smoother there).
The Windows host has Python 3.14, which is ahead of what Splink and several deps
support — pin a **3.11 or 3.12** venv:

```bash
# inside WSL2, from the repo's pipeline/ directory
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .            # installs the Tier-1 deps from pyproject.toml
cp ../.env.example .env     # then fill in SUPABASE_DB_URL, ANTHROPIC_API_KEY, COMPANIES_HOUSE_API_KEY
```

## Layout (filled in per milestone)

```
orrery_pipeline/
  ingestion/   Companies House loader (M2); Electoral Commission + Parliament (M6)
  resolution/  blocking → Splink Fellegi-Sunter → graph-aware pass → LLM adjudication → calibration (M3)
  graph/       edge confidence + strength; bounded path propagation, serial multiply + noisy-OR (M4)
```

See [`../CLAUDE.md`](../CLAUDE.md) and the engine spec
[`../docs/resolution-confidence-engine-spec.md`](../docs/resolution-confidence-engine-spec.md).
