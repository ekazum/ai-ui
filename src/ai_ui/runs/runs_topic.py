"""``RunsTopic`` — one results topic of a runs tab: the figures it shows."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RunsTopic:
    """One results topic of a tab: ``plots`` are the figure slugs it shows."""

    slug: str
    caption: str
    plots: tuple[str, ...]
