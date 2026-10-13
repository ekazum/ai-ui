"""``BenchmarkConfig`` — typed configuration for the Training-Runs pane.

Loaded once from ``config/benchmark.yaml`` (via ``BenchmarkConfig.from_yaml``)
and consumed by ``BenchmarkPane`` to open the telemetry DB, read the per-run
records, and pace the rescan loop that keeps the DB following live runs.
"""

import logging
from pathlib import Path

from pydantic import field_validator

from ..yaml_config import YamlConfig

logger = logging.getLogger(__name__)

DB_FILENAME = "benchmarks.db"


class BenchmarkConfig(YamlConfig):
    """Typed, immutable Training-Runs configuration."""

    # Benchmarks directory holding the per-run records.
    BENCHMARK_ROOT: str = "data/benchmarks"
    # Telemetry DB path; null = benchmarks.db under the benchmarks directory.
    BENCHMARK_DB: str | None = None
    # Seconds between record rescans into the DB (> 0).
    BENCHMARK_INGEST_INTERVAL_SECONDS: float = 30.0

    @property
    def root_path(self) -> Path:
        """The benchmarks directory as a path."""
        return Path(self.BENCHMARK_ROOT)

    @property
    def db_path(self) -> Path:
        """The telemetry DB, defaulted under the benchmarks directory."""
        if self.BENCHMARK_DB:
            return Path(self.BENCHMARK_DB)
        return self.root_path / DB_FILENAME

    def log_loaded(self) -> None:
        logger.info(
            "BenchmarkConfig loaded: root=%s, db=%s, ingest_interval=%ss",
            self.root_path, self.db_path,
            self.BENCHMARK_INGEST_INTERVAL_SECONDS,
        )

    @field_validator("BENCHMARK_ROOT")
    @classmethod
    def _non_empty_path(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("BENCHMARK_ROOT must be a non-empty path")
        return value

    @field_validator("BENCHMARK_INGEST_INTERVAL_SECONDS")
    @classmethod
    def _positive_interval(cls, value: float) -> float:
        if value <= 0:
            raise ValueError(
                f"BENCHMARK_INGEST_INTERVAL_SECONDS must be > 0; got {value}"
            )
        return value
