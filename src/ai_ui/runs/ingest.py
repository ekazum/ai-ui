"""``RecordIngest`` — fold run records into the runs DB.

Idempotent rescan: every record under the root is upserted into ``runs``;
each file the project's ``RecordReader`` names lands in ``metrics`` (CSV rows,
long format) or ``documents`` (JSON / YAML), skipped while its mtime is
unchanged (``sources``). The reader also supplies handlers for its own store
files, and the table row and figures stored per run (``table_row`` / ``plots``),
recomputed only for runs whose files changed.
"""

import csv
import json
import logging
import math
import sqlite3
from collections.abc import Callable, Mapping
from contextlib import closing
from pathlib import Path
from typing import Protocol

import yaml

from . import SCHEMA_PATH

logger = logging.getLogger(__name__)

# (db, run_id, record, path): ingest one project store file; marks ``path`` itself.
SourceHandler = Callable[[sqlite3.Connection, str, Path, Path], None]


class RecordReader(Protocol):
    """What a project declares about its records."""

    # Record-relative CSVs → metrics family.
    csv_families: Mapping[str, str]
    # Record-relative JSONs → documents name.
    json_documents: Mapping[str, str]
    # Record-relative YAMLs → documents name (stored as JSON).
    yaml_documents: Mapping[str, str]

    def sources(self, record: Path) -> list[tuple[Path, SourceHandler]]:
        """The project's store files under ``record`` and their handlers, in order."""
        ...

    def row(self, record: Path, kind: str) -> dict:
        """The run's flat table row."""
        ...

    def plots(self, record: Path, kind: str) -> list[tuple[str, str, str]]:
        """The run's figures as ``(slug, caption, png_base64)``."""
        ...


class RecordIngest:
    """Scans records into the SQLite runs store."""

    SCHEMA_PATH = SCHEMA_PATH

    def __init__(self, root: Path, db_path: Path, reader: RecordReader,
                 default_kind: str = "run") -> None:
        # Resolved so ``sources`` paths match across invocation directories.
        self._root = Path(root).resolve()
        self._db_path = Path(db_path)
        self._reader = reader
        self._default_kind = default_kind

    def run(self) -> None:
        """Rescan every record into the store."""
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        n_runs = 0
        # ``closing`` as well as the connection's own commit-on-exit: a
        # connection context manager never closes, and this runs on a loop.
        with closing(sqlite3.connect(str(self._db_path))) as db, db:
            db.executescript(self.SCHEMA_PATH.read_text(encoding="utf-8"))
            for meta_path in sorted(self._root.glob("*/meta.json")):
                self._ingest_record(db, meta_path.parent)
                n_runs += 1
        logger.info("%s: %d runs scanned into %s.",
                    type(self).__name__, n_runs, self._db_path)

    def _ingest_record(self, db: sqlite3.Connection, record: Path) -> None:
        """Upsert one record's identity, files and store contents."""
        with open(record / "meta.json", encoding="utf-8") as fh:
            meta = json.load(fh)
        run_id = meta.get("run_id", record.name)
        kind = meta.get("kind", self._default_kind)
        db.execute(
            "INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(run_id) DO UPDATE SET "
            "kind=excluded.kind, label=excluded.label, status=excluded.status, "
            "meta=excluded.meta",
            (run_id, kind, meta.get("label"), meta.get("created_at"),
             meta.get("status"), str(record), json.dumps(meta)),
        )
        changed = False
        for rel, family in self._reader.csv_families.items():
            path = record / rel
            if path.is_file() and self.stale(db, run_id, path):
                self._ingest_csv(db, run_id, family, path)
                changed = True
        for path, handler in self._reader.sources(record):
            if path.is_file() and self.stale(db, run_id, path):
                handler(db, run_id, record, path)
                changed = True
        for rel, name in self._reader.json_documents.items():
            path = record / rel
            if path.is_file() and self.stale(db, run_id, path):
                self._ingest_json(db, run_id, name, path)
                changed = True
        for rel, name in self._reader.yaml_documents.items():
            path = record / rel
            if path.is_file() and self.stale(db, run_id, path):
                self._ingest_yaml(db, run_id, name, path)
                changed = True
        if changed:
            self._ingest_row(db, run_id, record, kind)
            self._ingest_plots(db, run_id, record, kind)

    @staticmethod
    def stale(db: sqlite3.Connection, run_id: str, path: Path) -> bool:
        """Whether ``path`` changed since it was last ingested."""
        row = db.execute(
            "SELECT mtime FROM sources WHERE run_id = ? AND path = ?",
            (run_id, str(path)),
        ).fetchone()
        return row is None or row[0] != path.stat().st_mtime

    @staticmethod
    def mark(db: sqlite3.Connection, run_id: str, path: Path) -> None:
        """Record ``path``'s mtime as ingested."""
        db.execute(
            "INSERT OR REPLACE INTO sources VALUES (?, ?, ?)",
            (run_id, str(path), path.stat().st_mtime),
        )

    @staticmethod
    def write_rows(db: sqlite3.Connection, run_id: str,
                   family: str, rows: list[dict]) -> None:
        """Replace one family's rows with these, long format."""
        db.execute("DELETE FROM metrics WHERE run_id = ? AND family = ?",
                   (run_id, family))
        for step, row in enumerate(rows):
            for metric, cell in row.items():
                if cell is None:
                    continue
                value, text = ((cell, None) if isinstance(cell, (int, float))
                               else (None, str(cell)))
                db.execute(
                    "INSERT OR REPLACE INTO metrics VALUES (?,?,?,?,?,?)",
                    (run_id, family, step, metric, value, text))

    @staticmethod
    def write_document(db: sqlite3.Connection, run_id: str,
                       name: str, payload: str) -> None:
        """Replace one document."""
        db.execute("INSERT OR REPLACE INTO documents VALUES (?, ?, ?)",
                   (run_id, name, payload))

    def _ingest_csv(self, db: sqlite3.Connection, run_id: str,
                    family: str, path: Path) -> None:
        """Replace one family's rows with the CSV's cells (long format)."""
        db.execute("DELETE FROM metrics WHERE run_id = ? AND family = ?",
                   (run_id, family))
        with open(path, encoding="utf-8", newline="") as fh:
            for step, row in enumerate(csv.DictReader(fh)):
                for metric, cell in row.items():
                    if cell is None or cell == "":
                        continue
                    try:
                        value, text = float(cell), None
                    except ValueError:
                        value, text = None, cell
                    db.execute(
                        "INSERT OR REPLACE INTO metrics VALUES (?, ?, ?, ?, ?, ?)",
                        (run_id, family, step, metric, value, text),
                    )
        self.mark(db, run_id, path)
        logger.info("ingest: %s %s — %s.", run_id, family, path.name)

    def _ingest_row(self, db: sqlite3.Connection, run_id: str,
                    record: Path, kind: str) -> None:
        """Recompute the run's flat table row and store it as a document."""
        row = self._reader.row(record, kind)
        row = {k: None if isinstance(v, float) and not math.isfinite(v) else v
               for k, v in row.items()}       # NaN → null (strict JSON)
        self.write_document(db, run_id, "table_row", json.dumps(row))
        logger.info("ingest: %s document table_row.", run_id)

    def _ingest_plots(self, db: sqlite3.Connection, run_id: str,
                      record: Path, kind: str) -> None:
        """Re-render the run's figures and replace its stored PNGs."""
        imgs = self._reader.plots(record, kind)
        db.execute("DELETE FROM plots WHERE run_id = ?", (run_id,))
        for ord_, (slug, caption, png) in enumerate(imgs):
            db.execute("INSERT OR REPLACE INTO plots VALUES (?, ?, ?, ?, ?)",
                       (run_id, ord_, slug, caption, png))
        logger.info("ingest: %s plots — %d figure(s).", run_id, len(imgs))

    def _ingest_json(self, db: sqlite3.Connection, run_id: str,
                     name: str, path: Path) -> None:
        self.write_document(db, run_id, name, path.read_text(encoding="utf-8"))
        self.mark(db, run_id, path)
        logger.info("ingest: %s document %s.", run_id, name)

    def _ingest_yaml(self, db: sqlite3.Connection, run_id: str,
                     name: str, path: Path) -> None:
        payload = json.dumps(yaml.safe_load(path.read_text(encoding="utf-8")))
        self.write_document(db, run_id, name, payload)
        self.mark(db, run_id, path)
        logger.info("ingest: %s document %s.", run_id, name)
