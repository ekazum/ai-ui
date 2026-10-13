"""``WebApp`` — the Flask application built from the registered panes.

See ``WEBAPP_ARCHITECTURE.md`` §4 and §5. Mounts each pane's blueprint under a
URL prefix taken from its slug, composes the single document from the shell
markup, the panes' asset tags and their fragments, serves the shell's own
assets, and starts each pane's background threads before serving.
"""

import logging
from html import escape
from pathlib import Path

from flask import Blueprint, Flask, Response, send_from_directory

from .web_pane import WebPane
from .webapp_config import WebAppConfig

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "web_static"
SHELL_ASSET_DIR = STATIC_DIR / "shell"
ASSETS_MARKER = "<!-- assets -->"
TABS_MARKER = "<!-- tabs -->"
PANES_MARKER = "<!-- panes -->"
TITLE_MARKER = "<!-- title -->"
DEFAULT_STATIC_URL_PATH = "/static"


class WebApp:
    """Pane registry, page assembly, and the Flask application."""

    def __init__(self, config: WebAppConfig, panes: list[WebPane]) -> None:
        """Compose the page once and register every pane's blueprint."""
        self._config = config
        self._panes = list(panes)
        # One blueprint per pane, built once: registered below, and read during
        # composition for the static path its asset tags point at.
        self._blueprints = [(pane, pane.blueprint()) for pane in self._panes]
        self._page = self._compose()
        self._app = Flask(__name__, static_folder=None)
        for pane, blueprint in self._blueprints:
            self._app.register_blueprint(blueprint, url_prefix=f"/{pane.slug}")
        self._app.add_url_rule("/", "page", self._page_response)
        self._app.add_url_rule("/shell/<path:filename>", "shell_asset", self._shell_asset)
        logger.info(
            "WebApp: %d pane(s) registered: %s",
            len(self._panes), [pane.slug for pane in self._panes],
        )

    @property
    def app(self) -> Flask:
        """The Flask application, for serving and for tests (read-only)."""
        return self._app

    def _compose(self) -> str:
        """The single document: shell markup with asset tags, tabs and fragments."""
        assets = "".join(
            self._asset_tags(pane, blueprint) for pane, blueprint in self._blueprints
        )
        tabs = "".join(
            f'<button type="button" data-pane="{escape(pane.slug)}">'
            f'{escape(pane.title)}</button>'
            for pane in self._panes
        )
        sections = "".join(
            f'<section data-pane="{escape(pane.slug)}" hidden>'
            f'{pane.fragment().read_text(encoding="utf-8")}</section>'
            for pane in self._panes
        )
        markup = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
        return (markup.replace(ASSETS_MARKER, assets)
                .replace(TABS_MARKER, tabs)
                .replace(PANES_MARKER, sections)
                .replace(TITLE_MARKER, escape(self._config.WEBAPP_TITLE)))

    @staticmethod
    def _asset_tags(pane: WebPane, blueprint: Blueprint) -> str:
        """Stylesheet and script tags for one pane, under its static path.

        Each URL carries the file's mtime as a version stamp, so a changed
        asset changes its URL and browsers refetch on a plain reload.
        """
        base = f"/{pane.slug}{blueprint.static_url_path or DEFAULT_STATIC_URL_PATH}"
        static_dir = Path(blueprint.static_folder or ".")
        tags = []
        for name in pane.assets():
            stamp = int((static_dir / name).stat().st_mtime)
            href = escape(f"{base}/{name}?v={stamp}")
            if name.endswith(".css"):
                tags.append(f'<link rel="stylesheet" href="{href}">')
            else:
                tags.append(f'<script src="{href}" defer></script>')
        return "".join(tags)

    def _page_response(self) -> Response:
        """The composed document."""
        return Response(self._page, mimetype="text/html")

    @staticmethod
    def _shell_asset(filename: str) -> Response:
        """One of the shell's own assets, resolved within ``web_static/shell``."""
        return send_from_directory(SHELL_ASSET_DIR, filename)

    def serve(self) -> None:
        """Start each pane's background threads, then serve until stopped."""
        for pane in self._panes:
            pane.start()
        logger.info(
            "WebApp: serving on %s port %d",
            self._config.WEBAPP_HOST, self._config.WEBAPP_PORT,
        )
        self._app.run(
            host=self._config.WEBAPP_HOST,
            port=self._config.WEBAPP_PORT,
            threaded=True,
        )
