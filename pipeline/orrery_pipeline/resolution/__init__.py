"""Entity resolution — the recomputable layer that clusters mentions into canonical
entities. v1 is deterministic on official Companies House identifiers; probabilistic
(Splink / Fellegi-Sunter) + calibration is introduced for cross-source matching (M6),
where fuzzy linkage across registers earns its keep."""
