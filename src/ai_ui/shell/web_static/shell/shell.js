"use strict";

// The pane-initialiser registry. A pane's script assigns its initialiser as
// window.aiUiPanes["<slug>"]; the shell calls it once, the first time that pane
// is shown. The guard is idempotent, so pane scripts and the shell may set it
// up in either order.
window.aiUiPanes = window.aiUiPanes || {};

// Tab switching and first-show pane initialisation.
class Shell {
  constructor() {
    this.initialised = new Set();
    this.tabs = document.getElementById("shell-tabs");
    this.panes = document.getElementById("shell-panes");
    this.tabs.addEventListener("click", e => this._onTabClick(e));

    const saved = localStorage.getItem("shell.pane");
    const first = this.tabs.querySelector("button[data-pane]");
    this._show(this._known(saved) ? saved : (first ? first.dataset.pane : null));
  }

  _known(slug) {
    return !!(slug && this.tabs.querySelector('button[data-pane="' + CSS.escape(slug) + '"]'));
  }

  _onTabClick(e) {
    const btn = e.target.closest("button[data-pane]");
    if (btn) this._show(btn.dataset.pane);
  }

  _show(slug) {
    if (!slug) return;
    localStorage.setItem("shell.pane", slug);
    this.tabs.querySelectorAll("button[data-pane]").forEach(b =>
      b.classList.toggle("active", b.dataset.pane === slug));
    this.panes.querySelectorAll("section[data-pane]").forEach(s => {
      s.hidden = s.dataset.pane !== slug;
    });
    if (this.initialised.has(slug)) return;
    this.initialised.add(slug);
    const init = window.aiUiPanes[slug];
    if (typeof init === "function") init();
  }
}

new Shell();
