-- Runs DB: per-run metrics, documents and figures.
-- One row per run in `runs`; CSV rows land in `metrics` (long format, one
-- row per cell), JSON artefacts in `documents`, ingest bookkeeping in
-- `sources`, pre-rendered figures in `plots`.

CREATE TABLE IF NOT EXISTS runs (
    run_id     TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,           -- agent | reward_model | rm_combiner
    label      TEXT,
    created_at TEXT,
    status     TEXT,
    record_dir TEXT NOT NULL,
    meta       TEXT NOT NULL            -- meta.json
);

CREATE TABLE IF NOT EXISTS metrics (
    run_id  TEXT NOT NULL,
    family  TEXT NOT NULL,              -- validation | test | llm | buffer | ...
    step    INTEGER NOT NULL,           -- source-file row index (order preserved)
    metric  TEXT NOT NULL,              -- source column name
    value   REAL,                       -- numeric cell, else NULL
    text    TEXT,                       -- non-numeric cell, else NULL
    PRIMARY KEY (run_id, family, step, metric)
);

CREATE TABLE IF NOT EXISTS documents (
    run_id TEXT NOT NULL,
    name   TEXT NOT NULL,               -- run_summary | llm_answer | curves | ...
    json   TEXT NOT NULL,
    PRIMARY KEY (run_id, name)
);

CREATE TABLE IF NOT EXISTS sources (
    run_id TEXT NOT NULL,
    path   TEXT NOT NULL,
    mtime  REAL NOT NULL,
    PRIMARY KEY (run_id, path)
);

CREATE TABLE IF NOT EXISTS plots (
    run_id  TEXT NOT NULL,
    ord     INTEGER NOT NULL,           -- display order (report's figure order)
    slug    TEXT NOT NULL,              -- e.g. learning-curves
    caption TEXT NOT NULL,
    png     TEXT NOT NULL,              -- base64-encoded PNG
    PRIMARY KEY (run_id, slug)
);

