# ai-ui Configuration Reference

Each configuration is a YAML file loaded and validated at startup by its schema. Keys use `UPPER_SNAKE_CASE`.
Unknown keys are rejected (`extra="forbid"`), so the yaml and the schema must change together.

## `WebAppConfig` (`ai_ui/shell/webapp_config.py`)

Shell configuration; the path is given by `--config` (default `config/webapp.yaml`).

| Key            | Type        | Default       | Used by  | Description                                                    |
|----------------|-------------|---------------|----------|----------------------------------------------------------------|
| `WEBAPP_HOST`  | `str`       | `"127.0.0.1"` | `WebApp` | Bind address; loopback keeps the service tunnel-only           |
| `WEBAPP_PORT`  | `int`       | `8000`        | `WebApp` | TCP port the service listens on (1-65535)                      |
| `WEBAPP_PANES` | `list[str]` | `[]`          | `serve`  | Pane slugs to register, in tab order; empty = shell only       |
| `WEBAPP_TITLE` | `str`       | `"Runs"`      | `WebApp` | Page title and heading shown by the shell                      |

## `BenchmarkConfig` (`ai_ui/runs/benchmark_config.py`)

Runs pane configuration; the project passes the path when it builds the pane.

| Key                                 | Type          | Default             | Used by         | Description                                                     |
|-------------------------------------|---------------|---------------------|-----------------|-----------------------------------------------------------------|
| `BENCHMARK_ROOT`                    | `str`         | `data/benchmarks`   | `BenchmarkPane` | Directory holding the per-run records                           |
| `BENCHMARK_DB`                      | `str \| None` | `null`              | `BenchmarkPane` | Runs DB path; `null` = `benchmarks.db` under the root           |
| `BENCHMARK_INGEST_INTERVAL_SECONDS` | `float`       | `30.0`              | `BenchmarkPane` | Seconds between record rescans into the DB (> 0)                |
