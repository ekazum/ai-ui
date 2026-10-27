"""``WebPane`` — the contract a pane implements.

See ``docs/ARCHITECTURE.md`` §3. A pane is constructed once at startup and
registered with ``WebApp``, which mounts its blueprint under a URL prefix taken
from its slug, places its fragment in the page, and starts whatever background
threads it keeps for the life of the process. A pane owns its own configuration
file and its own data sources.
"""

from abc import ABC, abstractmethod
from pathlib import Path

from flask import Blueprint

from .menu_item import MenuItem


class WebPane(ABC):
    """One independent surface hosted by the shell."""

    @property
    @abstractmethod
    def slug(self) -> str:
        """Identifier for the pane's URL prefix and its tab."""

    @property
    @abstractmethod
    def title(self) -> str:
        """The label shown on the pane's tab."""

    @abstractmethod
    def blueprint(self) -> Blueprint:
        """The blueprint carrying the pane's routes and its static folder."""

    @abstractmethod
    def fragment(self) -> Path:
        """Path to the pane's markup partial."""

    def assets(self) -> list[str]:
        """Asset file names the shell loads with the page; default none.

        Names are resolved against the blueprint's static path, and the shell
        emits a stylesheet link or a deferred script tag per extension, so a
        fragment carries markup only.
        """
        return []

    def top_fragment(self) -> Path | None:
        """Markup the shell keeps in the top area whatever detail is shown; default none."""
        return None

    def modules(self) -> tuple[MenuItem, ...]:
        """Entries the pane adds to the Modules menu; default none."""
        return ()

    def details(self) -> tuple[MenuItem, ...]:
        """Entries the pane adds to the Details menu; default one entry for the whole pane."""
        return (MenuItem(self.slug, self.title),)

    def start(self) -> None:
        """Start the background threads the pane keeps; default is none."""
