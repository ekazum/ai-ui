"""``WebAppConfig`` — typed configuration for the web application shell.

Loaded once from ``config/webapp.yaml`` (via ``WebAppConfig.from_yaml``) and
passed to ``WebApp``, which registers the named panes and binds the server.
Each pane's own settings live in that pane's configuration file.
``parse_args`` is the module's only module-level function.
"""

import argparse
import logging
from pathlib import Path

from pydantic import field_validator

from ..yaml_config import YamlConfig

logger = logging.getLogger(__name__)


def parse_args(description: str) -> argparse.Namespace:
    """Parse command line arguments for the web application entry point.

    Returns:
        argparse.Namespace with the following attributes:
            config: Path — path to webapp.yaml
    """
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--config", type=Path, default=Path("config/webapp.yaml"),
        help="Shell configuration (default config/webapp.yaml).",
    )
    return parser.parse_args()


class WebAppConfig(YamlConfig):
    """Typed, immutable shell configuration."""

    # Bind address; loopback keeps the service reachable over an SSH tunnel only.
    WEBAPP_HOST: str = "127.0.0.1"
    # TCP port the service listens on (1-65535).
    WEBAPP_PORT: int = 8000
    # Pane slugs to register, in tab order; empty = shell only.
    WEBAPP_PANES: list[str] = []
    # Page title and heading shown by the shell.
    WEBAPP_TITLE: str = "Runs"

    def log_loaded(self) -> None:
        logger.info(
            "WebAppConfig loaded: host=%s, port=%d, panes=%s",
            self.WEBAPP_HOST, self.WEBAPP_PORT, self.WEBAPP_PANES,
        )

    @field_validator("WEBAPP_HOST")
    @classmethod
    def _non_empty_host(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("WEBAPP_HOST must be a non-empty bind address")
        return value

    @field_validator("WEBAPP_PORT")
    @classmethod
    def _port_in_range(cls, value: int) -> int:
        if not 1 <= value <= 65535:
            raise ValueError(f"WEBAPP_PORT must be in [1, 65535]; got {value}")
        return value

    @field_validator("WEBAPP_PANES")
    @classmethod
    def _distinct_slugs(cls, value: list[str]) -> list[str]:
        if any(not slug.strip() for slug in value):
            raise ValueError(f"WEBAPP_PANES entries must be non-empty; got {value}")
        if len(set(value)) != len(value):
            raise ValueError(f"WEBAPP_PANES contains duplicate slugs: {value}")
        return value
