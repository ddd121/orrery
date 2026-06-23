"""ORRERY pipeline — ingestion, entity resolution, and confidence propagation.

The pipeline WRITES the resolved graph into the shared Supabase Postgres; the
web app only READS it. Keep that boundary clean (see ../CLAUDE.md).

Milestone 1 is scaffold-only. Modules arrive per milestone:
  ingestion/   Companies House loader (M2); Electoral Commission + Parliament (M6)
  resolution/  Splink Fellegi-Sunter + gold set + calibration (M3)
  graph/       edge confidence/strength + bounded path propagation (M4)
"""

__version__ = "0.1.0"
