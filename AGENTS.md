# ai-ui — notes for AI coding tools

ai-ui gives a web shell that hosts independent panes in one Flask service, and a runs pane that shows ML experiment
records from a SQLite runs DB it keeps current by rescanning the record directories. A project adds a dashboard by
describing its records to the runs pane, or by writing its own pane.

Install: `pip install "ai-ui @ git+https://github.com/ekazum/ai-ui.git@v0.4.3"`.

## What ai-ui provides, what the project writes

| Area | ai-ui provides | The project writes |
|---|---|---|
| Shell | `WebApp`, `WebPane` (the pane contract), `serve`, `WebAppConfig` | `config/webapp.yaml`; a `WebPane` subclass for a pane of its own |
| Runs pane | `RunsPane`, `RecordIngest`, `RunsStore`, `RunsSpec`, `RunsTab`, `RunsConfig` | a `RecordReader` subclass, a `RunsSpec`, `config/runs.yaml` |
| Records | the runs DB schema and ingest | one directory per run with `meta.json` and its own files |

## Signatures

```python
from ai_ui import serve
serve(builders: Mapping[str, Callable[[], WebPane]], description="...") -> int
    # reads --config (default config/webapp.yaml); builds the panes named in WEBAPP_PANES, in that order

ai_ui.shell.web_pane.WebPane             # slug, title, blueprint(), fragment(), assets() = [], start() = no threads
ai_ui.shell.web_app.WebApp(config, panes)   .app  .serve()

ai_ui.runs.runs_spec.RunsTab(slug, caption, kinds: tuple[str, ...])   # slug is the ?kind= value
ai_ui.runs.runs_spec.RunsSpec(tabs: tuple[RunsTab, ...], leading_columns: tuple[str, ...] = ())
ai_ui.runs.runs_config.RunsConfig.from_yaml(path)   .root_path  .db_path
ai_ui.runs.ingest.RecordIngest(root, db_path, reader, default_kind="run")   .run()
ai_ui.runs.runs_pane.RunsPane(config, spec, ingest, title="Runs")    # SLUG = "runs"

class RecordReader:                      # ai_ui.runs.ingest
    csv_families: dict[str, str]         # file name -> metrics family, one row per step
    json_documents: dict[str, str]       # file name -> document name
    yaml_documents: dict[str, str]
    def sources(self, record) -> list[tuple[Path, Callable[[sqlite3.Connection, str, Path, Path], None]]]: ...
        # the project's own store files and a handler each; [] when there are none
    def row(self, record, kind) -> dict: ...                     # the run's flat table row
    def plots(self, record, kind) -> list[tuple[str, str, str]]: ...   # (slug, caption, png_base64); [] draws from metrics
```

Handlers in `sources` write with `RecordIngest.write_rows(db, run_id, family, rows)` and
`RecordIngest.write_document(db, run_id, name, payload)`.

## Assembly

A runs dashboard (see `examples/minimal/app.py`):

1. Each run writes a directory under `RUNS_ROOT` with `meta.json` holding `run_id`, `kind`, `label`, `created_at`,
   `status`, plus its CSV / JSON / YAML files.
2. Write a `RecordReader` naming those files and building the table row.
3. `SPEC = RunsSpec(tabs=(RunsTab("models", "Models", ("model",)),), leading_columns=("run_id", "label", ...))`.
4. A builder: `RunsPane(RunsConfig.from_yaml(p), SPEC, RecordIngest(config.root_path, config.db_path, Reader()))`.
5. `raise SystemExit(serve({"runs": build_runs}))`, with `WEBAPP_PANES: [runs]` in `config/webapp.yaml`.

A pane of its own: subclass `WebPane`; prefix element ids with the slug, scope its stylesheet to its container, and
register its script as `window.aiUiPanes[slug]`; add its builder to the `serve` mapping and its slug to
`WEBAPP_PANES`.

## Rules that are easy to break

- `serve` builds only the panes listed in `WEBAPP_PANES`, and exits naming any listed slug that is not a key of its
  mapping.
- `RunsTab.kinds` are values of `meta.json`'s `kind`; a run whose kind no tab lists is in the DB but on no tab.
- Ingest skips files whose mtime is unchanged; a reader change shows only after the files are touched or the DB is
  rebuilt.
- `WEBAPP_HOST` defaults to loopback; reach it through an SSH tunnel rather than binding a public address.
- Config files reject unknown keys; the YAML and the schema change together.
- Relative paths in the YAML resolve against the working directory.
- `DELETE api/runs/<run_id>` removes the run's directory as well as its rows.

## Examples

- `examples/minimal/app.py` — three synthetic runs, a 25-line reader, no figures;
  `python examples/minimal/app.py`, then http://127.0.0.1:8050.

## The five repos

| Repo | Gives | Depends on |
|---|---|---|
| [ai-runtime](https://github.com/ekazum/ai-runtime) | threads, `SHUTDOWN_SENTINEL`, `ThreadStages`, GPU batching, service supervision, SQLite stores, checkpoint managers, `YamlConfig`, logging | standard library; `[torch]`, `[config]` |
| [ai-llm](https://github.com/ekazum/ai-llm) | an LLM generation service: engine, GPU worker, server, client, stats store | ai-runtime |
| ai-ui | the web shell and runs dashboard above | ai-runtime |
| [rl-core](https://github.com/ekazum/rl-core) | RL threads and data types: PPO, prioritized replay, Q-network inference, DQN learner, checkpoint writer | ai-runtime |
| [ai-pipeline](https://github.com/ekazum/ai-pipeline) | data preparation stages | ai-runtime; `[embed]`, `[llm]`, `[reduce]` |
