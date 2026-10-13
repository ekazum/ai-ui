"""``RunsPane`` — the runs pane.

See ``docs/ARCHITECTURE.md`` §3. Wraps ``RunsStore`` and the project's
ingest: the blueprint carries the run table, the per-run figures, the
selection and run deletion, and ``start`` runs the rescan loop that keeps the
DB following live runs. Read-only apart from DELETE; there is a run table but
no launch route, so the web surface cannot submit jobs.
"""

import logging
import threading
import time
from pathlib import Path
from typing import Protocol

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue

from ..shell.web_pane import WebPane
from .runs_config import RunsConfig
from .runs_spec import RunsSpec
from .runs_store import RunsStore

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
SLUG = "runs"


class Rescan(Protocol):
    """What the rescan loop needs: one pass over the records into the DB."""

    def run(self) -> None: ...


class RunsPane(WebPane):
    """Runs: the table, the stored figures, selection and deletion."""

    def __init__(self, config: RunsConfig, spec: RunsSpec, ingest: Rescan,
                 title: str = "Runs") -> None:
        """Open the store over the runs DB and keep the project's ingest."""
        self._config = config
        self._spec = spec
        self._store = RunsStore(config.db_path, config.root_path, spec)
        self._ingest = ingest
        self._title = title

    @property
    def slug(self) -> str:
        return SLUG

    @property
    def title(self) -> str:
        return self._title

    def fragment(self) -> Path:
        return STATIC_DIR / "runs_pane.html"

    def assets(self) -> list[str]:
        return ["runs.css", "app.js"]

    def blueprint(self) -> Blueprint:
        """The pane's routes and its static folder."""
        blueprint = Blueprint(
            self.slug, __name__,
            static_folder=str(STATIC_DIR), static_url_path="/static",
        )
        blueprint.add_url_rule("/api/runs", "runs", self._runs)
        blueprint.add_url_rule(
            "/api/runs/<path:run_id>/plots", "plots", self._plots,
        )
        blueprint.add_url_rule(
            "/api/runs/<path:run_id>/metrics", "metrics", self._metrics,
        )
        blueprint.add_url_rule(
            "/api/selection", "selection", self._selection, methods=["PUT"],
        )
        blueprint.add_url_rule(
            "/api/runs/<path:run_id>", "delete_run", self._delete_run,
            methods=["DELETE"],
        )
        return blueprint

    def start(self) -> None:
        """Run the rescan loop for the life of the process."""
        threading.Thread(
            target=self._ingest_loop, name="runs-ingest", daemon=True,
        ).start()

    def _ingest_loop(self) -> None:
        """Rescan records into the DB forever; errors are logged, never fatal.

        Every exception, not a listed few: a pass reads records a live run is
        writing, so it can fail in ways this file cannot enumerate, and one
        such pass must cost an interval rather than every later update.
        """
        while True:
            try:
                self._ingest.run()
            except Exception as exc:
                logger.exception("ingest pass failed: %s", exc)
            time.sleep(self._config.RUNS_INGEST_INTERVAL_SECONDS)

    def _runs(self) -> ResponseReturnValue:
        """Table payload for one tab, plus plot kinds, the tab list and the selection."""
        kind = self._spec.tab(request.args.get("kind")).slug
        return jsonify(self._store.index(kind))

    def _plots(self, run_id: str) -> ResponseReturnValue:
        """One run's stored figures."""
        plots = self._store.plots(run_id)
        if plots is None:
            return jsonify({"error": "not found"}), 404
        return jsonify({"plots": plots})

    def _metrics(self, run_id: str) -> ResponseReturnValue:
        """One run's numeric metrics by family; the page draws them when the run has no figures."""
        metrics = self._store.metrics(run_id)
        if metrics is None:
            return jsonify({"error": "not found"}), 404
        return jsonify({"metrics": metrics})

    def _selection(self) -> ResponseReturnValue:
        """Replace the selected-run set, kept in memory by the store."""
        payload = request.get_json(silent=True)
        run_ids = payload.get("selected", []) if isinstance(payload, dict) else None
        if not isinstance(run_ids, list):
            return jsonify({"error": "bad request"}), 400
        self._store.set_selection([str(run_id) for run_id in run_ids])
        return jsonify({"selected": self._store.get_selection()})

    def _delete_run(self, run_id: str) -> ResponseReturnValue:
        """Remove a run's directory and its DB rows."""
        if self._store.delete(run_id):
            return jsonify({"deleted": run_id})
        return jsonify({"error": "not found"}), 404
