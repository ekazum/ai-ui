"""Minimal ai-ui app: three synthetic training runs in the runs pane.

Run from anywhere: ``python examples/minimal/app.py``, then open
http://127.0.0.1:8050. The first start writes the records under
``examples/minimal/records/``; the reader supplies no figures, so the pane
draws each run from its metrics.
"""

import csv
import json
import math
import os
import random
from pathlib import Path

from ai_ui import serve
from ai_ui.runs.ingest import RecordIngest, RecordReader
from ai_ui.runs.runs_config import RunsConfig
from ai_ui.runs.runs_pane import SLUG, RunsPane
from ai_ui.runs.runs_spec import RunsSpec, RunsTab

HERE = Path(__file__).resolve().parent

SPEC = RunsSpec(
    tabs=(RunsTab("models", "Models", ("model",)),),
    leading_columns=("run_id", "label", "status", "created_at",
                     "final_loss", "test_accuracy"),
)


class Reader(RecordReader):
    """The example's record layout: a training CSV, a one-row test CSV, no figures."""

    csv_families = {"train.csv": "train", "test.csv": "test"}
    json_documents: dict[str, str] = {}
    yaml_documents = {"config.yaml": "config"}

    def sources(self, record: Path) -> list:
        return []

    def row(self, record: Path, kind: str) -> dict:
        meta = json.loads((record / "meta.json").read_text())
        with open(record / "train.csv", newline="") as fh:
            last = list(csv.DictReader(fh))[-1]
        with open(record / "test.csv", newline="") as fh:
            test = next(csv.DictReader(fh))
        return {**{k: meta[k] for k in ("run_id", "label", "status", "created_at")},
                "final_loss": round(float(last["loss"]), 4),
                "test_accuracy": round(float(test["accuracy"]), 4)}

    def plots(self, record: Path, kind: str) -> list:
        return []


def write_records(root: Path) -> None:
    """Three runs that differ in learning rate; 60 steps of loss and accuracy each, rewritten on every start."""
    for i, lr in enumerate((0.1, 0.03, 0.01)):
        record = root / f"run_{i}_lr{lr}"
        record.mkdir(parents=True, exist_ok=True)
        rng = random.Random(i)
        meta = {"run_id": record.name, "kind": "model", "label": f"lr={lr}",
                "created_at": f"2026-01-0{i + 1}T12:00:00", "status": "completed"}
        (record / "meta.json").write_text(json.dumps(meta, indent=2))
        (record / "config.yaml").write_text(f"lr: {lr}\nsteps: 60\n")
        rows = []
        for step in range(60):
            loss = 2.0 * math.exp(-lr * 40 * step / 60) + 0.05 * rng.random()
            rows.append({"loss": loss, "accuracy": 1 - loss / 2.2})
        with open(record / "train.csv", "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["loss", "accuracy"])
            writer.writeheader()
            writer.writerows(rows)
        with open(record / "test.csv", "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["accuracy", "loss"])
            writer.writeheader()
            writer.writerow({"accuracy": rows[-1]["accuracy"] - 0.02,
                             "loss": rows[-1]["loss"] + 0.03})


def build_runs() -> RunsPane:
    config = RunsConfig.from_yaml(HERE / "config" / "runs.yaml")
    write_records(config.root_path)
    return RunsPane(config, SPEC, RecordIngest(config.root_path, config.db_path, Reader()))


if __name__ == "__main__":
    os.chdir(HERE)   # config paths below are relative to the example
    raise SystemExit(serve({SLUG: build_runs}, "ai-ui minimal example"))
