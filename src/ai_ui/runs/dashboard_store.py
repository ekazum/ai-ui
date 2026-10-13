"""``DashboardStore`` — the dashboard's data layer over the benchmark DB.

Pure SQLite reader plus run deletion: the run table and the pre-rendered
figures come from ``benchmarks.db`` as written by ``BenchmarkIngest`` — the
serving path never opens a record file.
"""

import json
import logging
import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from .runs_spec import RunsSpec

logger = logging.getLogger(__name__)


class DashboardStore:
    """Read/delete access to the benchmark DB."""

    def __init__(self, db_path: Path, root: Path, spec: RunsSpec) -> None:
        self._db_path = Path(db_path)
        self._root = Path(root)
        self._spec = spec
        self._selected: set[str] = set()   # in-memory; survives reloads, not restart

    @property
    def root(self) -> Path:
        return self._root

    @contextmanager
    def _connect(self) -> "Iterator[sqlite3.Connection]":
        # Fresh connection per call: handler threads + the ingest writer
        # coexist. Closed on the way out — the connection's own context
        # manager commits but never closes, and this runs per request.
        con = sqlite3.connect(str(self._db_path), timeout=30)
        try:
            with con:
                yield con
        finally:
            con.close()

    def index(self, kind: str) -> dict[str, Any]:
        """Table payload for one tab + its plot kinds, the tab list and the live selection."""
        tab_kinds = self._spec.tab(kind).kinds
        marks = ",".join("?" * len(tab_kinds))
        with self._connect() as db:
            rows = self._rows(db, tab_kinds)
            kinds = [{"slug": s, "caption": c} for s, c in db.execute(
                "SELECT slug, caption FROM plots JOIN runs USING (run_id) "
                f"WHERE runs.kind IN ({marks}) GROUP BY slug, caption ORDER BY MIN(ord)",
                tab_kinds)]
        return {"columns": self._columns(rows), "rows": rows, "n": len(rows),
                "root": str(self._root), "kinds": kinds,
                "selected": self.get_selection(), "kind": kind,
                "tabs": [{"slug": t.slug, "caption": t.caption}
                         for t in self._spec.tabs]}

    @staticmethod
    def _rows(db: sqlite3.Connection, kinds: tuple[str, ...]) -> list[dict[str, Any]]:
        """One flat dict per run: stored ``table_row`` + live status overlay."""
        out = []
        marks = ",".join("?" * len(kinds))
        for run_id, status in db.execute(
                f"SELECT run_id, status FROM runs WHERE kind IN ({marks})", kinds):
            doc = db.execute(
                "SELECT json FROM documents WHERE run_id = ? AND name = 'table_row'",
                (run_id,)).fetchone()
            row = json.loads(doc[0]) if doc else {"run_id": run_id}
            row["status"] = status or row.get("status", "")
            out.append(row)
        out.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        return out

    def _columns(self, rows: list[dict[str, Any]]) -> list[str]:
        """Union of row keys: leading columns first, the rest alphabetical."""
        seen = {k for row in rows for k in row}
        lead = [c for c in self._spec.leading_columns if c in seen]
        return lead + sorted(seen - set(lead))

    def plots(self, run_id: str) -> list[dict[str, str]] | None:
        """Stored figures for one run, or ``None`` if the run is unknown."""
        run_id = unquote(run_id)
        with self._connect() as db:
            if not self._known(db, run_id):
                return None
            return [{"slug": s, "caption": c, "png": p} for s, c, p in db.execute(
                "SELECT slug, caption, png FROM plots WHERE run_id = ? "
                "ORDER BY ord", (run_id,))]

    def get_selection(self) -> list[str]:
        return sorted(self._selected)

    def set_selection(self, run_ids: list[str]) -> None:
        """Replace the selection, keeping only ids present in the DB."""
        with self._connect() as db:
            self._selected = {r for r in run_ids if self._known(db, str(r))}

    @staticmethod
    def _known(db: sqlite3.Connection, run_id: str) -> bool:
        return db.execute("SELECT 1 FROM runs WHERE run_id = ?",
                          (run_id,)).fetchone() is not None

    def delete(self, run_id: str) -> bool:
        """Remove a run's files and all its DB rows. True if allowed and done."""
        run_id = unquote(run_id)
        with self._connect() as db:
            row = db.execute(
                "SELECT record_dir FROM runs WHERE run_id = ?",
                (run_id,)).fetchone()
            if row is None:
                return False
            record = Path(row[0]).resolve()
            if record.parent != self._root.resolve():   # traversal guard
                return False
            try:
                shutil.rmtree(record)
            except OSError as exc:   # e.g. an actively-training run
                logger.warning("failed to delete run %s: %s", run_id, exc)
                return False
            for table in ("runs", "metrics", "documents", "sources", "plots"):
                db.execute(f"DELETE FROM {table} WHERE run_id = ?", (run_id,))
        self._selected.discard(run_id)
        logger.info("deleted benchmark run %s", run_id)
        return True
