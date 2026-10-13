"""``serve`` — the generic entry: load the shell config, build the named panes, serve."""

import logging
from collections.abc import Callable, Mapping

from .logging import setup_logging
from .shell.web_app import WebApp
from .shell.web_pane import WebPane
from .shell.webapp_config import WebAppConfig, parse_args

logger = logging.getLogger(__name__)


def serve(builders: Mapping[str, Callable[[], WebPane]],
          description: str = "Web application: registered panes in one service.") -> int:
    """Parse ``--config``, build the panes named in ``WEBAPP_PANES`` from ``builders``, serve."""
    setup_logging()
    # Werkzeug logs every request at INFO; real problems still surface at WARNING.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    args = parse_args(description)
    config = WebAppConfig.from_yaml(args.config)
    unknown = [slug for slug in config.WEBAPP_PANES if slug not in builders]
    if unknown:
        raise SystemExit(
            f"unknown pane slug(s) in WEBAPP_PANES: {unknown}; "
            f"known: {sorted(builders)}"
        )
    panes = [builders[slug]() for slug in config.WEBAPP_PANES]
    WebApp(config, panes).serve()
    return 0
