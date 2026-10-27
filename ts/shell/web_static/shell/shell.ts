"use strict";

// The pane-initialiser registry. A pane's script assigns its initialiser as
// window.aiUiPanes["<slug>"]; the shell calls it once, the first time that pane
// is shown, or at load for a pane with markup in the top area. The guard is
// idempotent, so pane scripts and the shell may set it up in either order.
window.aiUiPanes = window.aiUiPanes || {};
window.aiUiView = null;

// The Modules and Details menus, the detail area, and first-show pane initialisation.
class Shell {
  initialised: Set<string>;
  modules: HTMLElement;
  details: HTMLElement;
  panes: HTMLElement;
  view: AiUiView;

  constructor() {
    this.initialised = new Set();
    this.modules = document.getElementById("shell-modules")!;
    this.details = document.getElementById("shell-details")!;
    this.panes = document.getElementById("shell-panes")!;
    this.modules.addEventListener("click", e => this._onModuleClick(e));
    this.details.addEventListener("click", e => this._onDetailClick(e));

    const saved = this._saved();
    const first = this.modules.querySelector<HTMLElement>("button[data-module]");
    const module = saved && this._moduleButton(saved.module) ? saved.module : (first ? first.dataset.module! : "");
    this.view = {module: module, pane: saved ? saved.pane : "", item: saved ? saved.item : ""};
    this._show();
  }

  _saved(): AiUiView | null {
    try {
      return JSON.parse(localStorage.getItem("shell.view") || "null");
    } catch {
      return null;
    }
  }

  _moduleButton(slug: string): HTMLElement | null {
    return this.modules.querySelector<HTMLElement>('button[data-module="' + CSS.escape(slug) + '"]');
  }

  // A Details entry belongs to the module when it names no modules or lists this one.
  _fits(el: HTMLElement): boolean {
    const modules = el.dataset.modules;
    return modules === undefined || !this.view.module || modules.split(" ").includes(this.view.module);
  }

  _onModuleClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest<HTMLElement>("button[data-module]");
    if (!btn) return;
    this.view.module = btn.dataset.module!;
    this._show();
  }

  _onDetailClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest<HTMLElement>("button[data-item]");
    if (!btn) return;
    this.view.pane = btn.dataset.pane!;
    this.view.item = btn.dataset.item!;
    this._show();
  }

  // Apply this.view: mark the module, hide the Details entries of other modules, fall back to the first entry left
  // when the picked one is gone, show its pane, and tell the panes.
  _show(): void {
    this.modules.querySelectorAll<HTMLElement>("button[data-module]").forEach(b =>
      b.classList.toggle("active", b.dataset.module === this.view.module));
    const buttons = Array.from(this.details.querySelectorAll<HTMLElement>("button[data-item]"));
    buttons.forEach(b => {
      const group = b.parentElement!.closest<HTMLElement>(".shell-group");
      b.hidden = !this._fits(b) || (group !== null && !this._fits(group));
    });
    this.details.querySelectorAll<HTMLElement>(".shell-group").forEach(g => {
      g.hidden = !g.querySelector("button[data-item]:not([hidden])");
    });
    const visible = buttons.filter(b => !b.hidden);
    const picked = visible.find(b => b.dataset.pane === this.view.pane && b.dataset.item === this.view.item)
      || visible[0];
    if (!picked) return;
    this.view.pane = picked.dataset.pane!;
    this.view.item = picked.dataset.item!;
    buttons.forEach(b => b.classList.toggle("active", b === picked));
    this.panes.querySelectorAll<HTMLElement>("section[data-pane]").forEach(s => {
      s.hidden = s.dataset.pane !== this.view.pane;
    });
    localStorage.setItem("shell.view", JSON.stringify(this.view));
    window.aiUiView = {...this.view};
    // Panes with markup in the top area are on screen whatever is picked.
    document.querySelectorAll<HTMLElement>("#shell-top > section[data-pane]").forEach(s =>
      this._init(s.dataset.pane!));
    this._init(this.view.pane);
    document.dispatchEvent(new CustomEvent<AiUiView>("ai-ui:view", {detail: {...this.view}}));
  }

  _init(slug: string): void {
    if (this.initialised.has(slug)) return;
    this.initialised.add(slug);
    const init = window.aiUiPanes[slug];
    if (typeof init === "function") init();
  }
}

new Shell();
