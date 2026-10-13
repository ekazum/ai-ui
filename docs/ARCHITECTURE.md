# ai-ui Architecture

## Table of Contents

1. [Overview](#1-overview)
2. [Modules](#2-modules)
3. [Pane Contract](#3-pane-contract)
4. [Page Composition](#4-page-composition)
5. [Request Routing](#5-request-routing)
6. [Runs Pane](#6-runs-pane)
7. [Configuration](#7-configuration)
8. [Design Principles](#8-design-principles)
9. [Directory Structure](#9-directory-structure)

---

## 1. Overview

A single HTTP service hosting a project's web surfaces as independent panes behind one entry point. The shell owns
binding, request routing, static serving and page composition; the panes supply the content. The runs pane is the
pane this package ships: a table of run records, their stored figures, selection and deletion, over a SQLite DB that
a rescan keeps current.

The service runs as one process. `serve` loads the shell configuration, builds each pane the configuration names
from the builders the project passes in, registers that pane's routes and assets, starts the pane's background
threads, and then serves until stopped.

A viewer receives one document holding a tab bar and one container per registered pane. Selecting a tab reveals that
pane's container and initialises its script the first time it is shown.

---

## 2. Modules

| File                        | Class / function                   | Role                                                              |
|-----------------------------|------------------------------------|-------------------------------------------------------------------|
| `serve.py`                  | `serve`                            | Entry: shell config, pane builders by slug, serving               |
| `yaml_config.py`            | `YamlConfig`                       | Typed YAML config base                                            |
| `logging.py`                | `setup_logging`                    | Root logger to stdout                                             |
| `shell/webapp_config.py`    | `WebAppConfig`                     | Shell configuration: bind address, port, pane slugs, title        |
| `shell/web_pane.py`         | `WebPane`                          | The contract a pane implements                                    |
| `shell/web_app.py`          | `WebApp`                           | Pane registry, page assembly, the Flask application and server    |
| `shell/web_static/`         |                                    | Shell markup, script and stylesheet                               |
| `runs/runs_spec.py`         | `RunsSpec`, `RunsTab`              | The project's tabs (run kinds per tab) and leading table columns  |
| `runs/benchmark_config.py`  | `BenchmarkConfig`                  | Runs pane configuration: records root, DB path, rescan interval   |
| `runs/benchmark_pane.py`    | `BenchmarkPane`                    | Runs pane routes and the rescan loop                              |
| `runs/dashboard_store.py`   | `DashboardStore`                   | Read and delete access to the runs DB                             |
| `runs/ingest.py`            | `RecordIngest`, `RecordReader`     | Rescan of records into the DB; the project's record description   |
| `runs/db_schema.sql`        |                                    | Runs DB schema                                                    |
| `runs/static/`              |                                    | Runs pane markup, script and stylesheet                           |

---

## 3. Pane Contract

- `slug` — identifier for the pane's URL prefix and its tab
- `title` — the label on its tab
- `blueprint()` — the Flask blueprint carrying the pane's routes and its static folder
- `fragment()` — path to its markup partial
- `assets()` — stylesheet and script file names the shell loads with the page
- `start()` — background threads the pane keeps for the life of the process

A pane owns its own configuration file and its own data sources.

---

## 4. Page Composition

The shell's markup supplies the title, the tab bar and one container per registered pane; each pane's fragment is
placed in its container, and its assets are served under a path derived from its slug. The shell emits the asset
tags itself, from the names the pane declares, so a fragment carries markup only. Three conventions keep panes clear
of one another:

- element identifiers carry the pane's slug as a prefix
- each pane's stylesheet is scoped to its container
- each pane's script registers an initialiser as `window.aiUiPanes[slug]`, which the shell calls when that pane is
  first shown

---

## 5. Request Routing

The shell is a Flask application. Each pane's blueprint is registered under a URL prefix derived from its slug, so
Werkzeug resolves that pane's routes and serves its static folder. The shell registers its own routes for the
composed page and for its own assets.

---

## 6. Runs Pane

A run record is a directory under the records root holding `meta.json` (`run_id`, `kind`, `label`, `created_at`,
`status`) and whatever files the project writes. The runs DB holds five tables:

| Table       | Content                                                          |
|-------------|------------------------------------------------------------------|
| `runs`      | One row per record: identity, kind, status, directory, meta      |
| `metrics`   | Long format: run, family, step, metric, numeric or text value    |
| `documents` | Named JSON documents per run, including the run's `table_row`    |
| `sources`   | The files ingested per run and their mtimes                      |
| `plots`     | Figures per run as base64 PNG, in display order                  |

`RecordIngest` rescans the records root on the pane's interval. It upserts each record into `runs`, ingests the files
the project's `RecordReader` names (CSV families into `metrics`, JSON and YAML into `documents`, and the project's own
store files through their handlers), and skips any file whose mtime is unchanged. For each run with a changed file it
stores the reader's table row and figures.

`RunsSpec` names the tabs, the run kinds each tab shows and the columns that lead the table. The API returns the tab
list with the table, so the browser renders whatever tabs the project declares.

Routes, under the pane's slug: `GET api/runs?kind=<tab>`, `GET api/runs/<run_id>/plots`, `PUT api/selection`,
`DELETE api/runs/<run_id>`. The pane has no route that starts a run.

---

## 7. Configuration

`WebAppConfig` carries the bind address, the listening port, the slugs of the panes to register and the page title.
`BenchmarkConfig` carries the records root, the DB path and the rescan interval. Both are read once at startup; see
`CONFIGURATION.md`.

---

## 8. Design Principles

- The shell depends on the pane contract, and a pane reaches the shell through that contract alone.
- Panes are independent: separate routes, assets, configuration and background threads.
- A project supplies data through `RunsSpec` and `RecordReader`; the package names no project, run kind or file.
- Configuration is validated at startup and passed down.
- A new capability arrives as a new pane, leaving the shell as it is.

---

## 9. Directory Structure

```text
src/ai_ui/
  __init__.py
  serve.py
  yaml_config.py
  logging.py
  shell/
    webapp_config.py
    web_pane.py
    web_app.py
    web_static/
      index.html
      shell/
        shell.js
        shell.css
  runs/
    runs_spec.py
    benchmark_config.py
    benchmark_pane.py
    dashboard_store.py
    ingest.py
    db_schema.sql
    static/
      benchmark_pane.html
      app.js
      benchmark.css
docs/
  ARCHITECTURE.md
  CONFIGURATION.md
```
