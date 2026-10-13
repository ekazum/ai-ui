"""``RunsSpec`` — what a project declares for the runs pane: its tabs and the table's leading columns."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RunsTab:
    """One tab: ``slug`` is the ``kind`` query value, ``kinds`` the run kinds it shows."""

    slug: str
    caption: str
    kinds: tuple[str, ...]


@dataclass(frozen=True)
class RunsSpec:
    """Tabs in display order (the first is the default) and the leading table columns."""

    tabs: tuple[RunsTab, ...]
    leading_columns: tuple[str, ...] = ()

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
