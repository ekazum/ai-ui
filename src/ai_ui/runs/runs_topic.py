"""``RunsTopic`` — one results topic of a runs tab: the figures and the table columns it shows."""

from dataclasses import dataclass

# A column pattern ending in this is a prefix: ``"best.*"`` matches every column starting ``"best."``.
WILDCARD = "*"


@dataclass(frozen=True)
class RunsTopic:
    """One results topic of a tab.

    ``plots`` are the figure slugs it shows. ``columns`` are the table-row columns it shows as a
    comparison table above its figures, each an exact column name or a prefix ending in ``*``.
    """

    slug: str
    caption: str
    plots: tuple[str, ...]
    columns: tuple[str, ...] = ()

    def claims(self, column: str) -> bool:
        """Whether one of this topic's column patterns matches ``column``."""
        return any(self._matches(pattern, column) for pattern in self.columns)

    def ordered(self, columns: list[str]) -> list[str]:
        """The given columns in this topic's pattern order, alphabetical within one prefix pattern."""
        out: list[str] = []
        for pattern in self.columns:
            out.extend(c for c in sorted(columns) if c not in out and self._matches(pattern, c))
        return out

    @staticmethod
    def _matches(pattern: str, column: str) -> bool:
        if pattern.endswith(WILDCARD):
            return column.startswith(pattern[:-len(WILDCARD)])
        return column == pattern
