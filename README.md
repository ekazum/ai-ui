# ai-ui

A web shell and a runs dashboard for ML experiment records: one Flask service, independent panes, a SQLite runs DB kept current by a rescan of record directories.

## Parts

- **Shell** (`ai_ui.shell`): `WebPane` is the pane contract (slug, title, blueprint, fragment, assets, background threads); `WebApp` composes the page and serves it.
- **Runs pane** (`ai_ui.runs`): run table, per-run figures, selection, deletion. A project declares its tabs and leading columns as a `RunsSpec`, and its record layout as a `RecordReader` for `RecordIngest`.
- **Entry** (`ai_ui.serve`): loads the shell config, builds the panes it names, serves.

## Use

```python
from ai_ui import serve
from ai_ui.runs.ingest import RecordIngest
from ai_ui.runs.runs_config import RunsConfig
from ai_ui.runs.runs_pane import RunsPane
from ai_ui.runs.runs_spec import RunsSpec, RunsTab

SPEC = RunsSpec(tabs=(RunsTab("model", "Models", ("model",)),),
                leading_columns=("run_id", "label", "status"))

def build_runs():
    config = RunsConfig.from_yaml("config/runs.yaml")
    ingest = RecordIngest(config.root_path, config.db_path, MyReader())
    return RunsPane(config, SPEC, ingest)

if __name__ == "__main__":
    raise SystemExit(serve({"runs": build_runs}))
```

A record is a directory under the runs root with a `meta.json` (`run_id`, `kind`, `label`, `created_at`, `status`). `MyReader` supplies the file maps (`csv_families`, `json_documents`, `yaml_documents`), `sources(record)`, `row(record, kind)` and `plots(record, kind)`.

## Example

`python examples/minimal/app.py` writes three synthetic training runs and serves them on http://127.0.0.1:8050.
Its reader (`examples/minimal/app.py`, about 25 lines) supplies no figures, so the pane draws each run from its
metrics.

`AGENTS.md` lists the signatures, the assembly order and the rules to keep.

## License

Apache-2.0
