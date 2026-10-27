"""``MenuItem`` — one entry of the shell's Modules or Details menu."""

from dataclasses import dataclass


@dataclass(frozen=True)
class MenuItem:
    """A menu entry: ``modules`` limits a Details entry to those module slugs (``None`` = every module)."""

    slug: str
    caption: str
    modules: tuple[str, ...] | None = None
    children: tuple["MenuItem", ...] = ()
