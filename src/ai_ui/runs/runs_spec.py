"""``RunsSpec`` — what a project declares for the runs pane: its tabs, their topics and the table's columns."""

from dataclasses import dataclass

from .runs_topic import RunsTopic


@dataclass(frozen=True)
class RunsTab:
    """One tab: ``slug`` is the ``kind`` query value, ``kinds`` the run kinds it shows."""

    slug: str
    caption: str
    kinds: tuple[str, ...]
    topics: tuple[RunsTopic, ...] = ()


@dataclass(frozen=True)
class RunsSpec:
    """Tabs in display order (the first is the default), the table columns, the configuration documents.

    ``table_columns`` are the only columns the run table shows, in this order. A results topic shows
    the columns it claims, a table column included; a column neither shows goes under Other. Empty,
    the table shows every column.
    """

    tabs: tuple[RunsTab, ...]
    table_columns: tuple[str, ...] = ()
    config_documents: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.tabs:
            raise ValueError("RunsSpec needs at least one tab")
        slugs = [tab.slug for tab in self.tabs]
        if len(set(slugs)) != len(slugs):
            raise ValueError(f"RunsSpec tabs have duplicate slugs: {slugs}")

    def tab(self, slug: str | None) -> RunsTab:
        """The tab for ``slug``; the first tab when ``slug`` is unknown or empty."""
        for tab in self.tabs:
            if tab.slug == slug:
                return tab
        return self.tabs[0]
