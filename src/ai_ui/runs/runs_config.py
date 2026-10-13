"""``RunsConfig`` — typed configuration for the runs pane.

Loaded once from a YAML file (via ``RunsConfig.from_yaml``) and consumed by
``RunsPane`` to open the runs DB, read the per-run records, and pace the
rescan loop that keeps the DB following live runs.
"""

import logging
from pathlib import Path

from pydantic import field_validator

from ..yaml_config import YamlConfig

logger = logging.getLogger(__name__)

DB_FILENAME = "runs.db"


class RunsConfig(YamlConfig):
    """Typed, immutable runs pane configuration."""

    # Directory holding the per-run records.
    RUNS_ROOT: str = "runs"
    # Runs DB path; null = runs.db under the records directory.
    RUNS_DB: str | None = None
    # Seconds between record rescans into the DB (> 0).
    RUNS_INGEST_INTERVAL_SECONDS: float = 30.0

    @property
    def root_path(self) -> Path:
        """The records directory as a path."""
        return Path(self.RUNS_ROOT)

    @property
    def db_path(self) -> Path:
        """The runs DB, defaulted under the records directory."""
        if self.RUNS_DB:
            return Path(self.RUNS_DB)
        return self.root_path / DB_FILENAME

    def log_loaded(self) -> None:
        logger.info(
            "RunsConfig loaded: root=%s, db=%s, ingest_interval=%ss",
            self.root_path, self.db_path, self.RUNS_INGEST_INTERVAL_SECONDS,
        )

    @field_validator("RUNS_ROOT")
    @classmethod
    def _non_empty_path(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("RUNS_ROOT must be a non-empty path")
        return value

    @field_validator("RUNS_INGEST_INTERVAL_SECONDS")
    @classmethod
    def _positive_interval(cls, value: float) -> float:
        if value <= 0:
            raise ValueError(
                f"RUNS_INGEST_INTERVAL_SECONDS must be > 0; got {value}"
            )
        return value
