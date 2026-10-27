"use strict";
// The pane's blueprint is mounted under its slug, so every request is relative
// to this base rather than to the page root.
const API_BASE = "runs/";
// Runs in these states never change again; any other status is treated as
// live and its figures are re-fetched while it stays checked.
const FINAL_STATUSES = new Set(["completed", "failed", "submit_failed",
    "cancelled", "timeout", "finished", "done"]);
// Live runs' figures are re-fetched every this many table refreshes (7s each).
const PLOT_REFRESH_EVERY = 4;
function esc(s) {
    return String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// --- default metric view ---------------------------------------------------
// Used when a run has no stored figures: one block per metrics family; series
// with several steps become line charts, single values a key/value table.
const CHART_W = 300, CHART_H = 150, CHART_PAD = 34;
function fmt(v) {
    if (!isFinite(v))
        return String(v);
    const a = Math.abs(v);
    return (a !== 0 && (a < 1e-3 || a >= 1e5)) ? v.toExponential(2) : String(+v.toPrecision(4));
}
function lineChart(name, points) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x1 === x0)
        x1 = x0 + 1;
    if (y1 === y0) {
        y0 -= 0.5;
        y1 += 0.5;
    }
    const sx = (x) => CHART_PAD + (x - x0) / (x1 - x0) * (CHART_W - CHART_PAD - 6);
    const sy = (y) => CHART_H - 18 - (y - y0) / (y1 - y0) * (CHART_H - 30);
    const line = points.map(p => sx(p[0]).toFixed(1) + "," + sy(p[1]).toFixed(1)).join(" ");
    return `<figure class="curve"><figcaption>${esc(name)}</figcaption>` +
        `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" width="${CHART_W}" height="${CHART_H}" role="img" aria-label="${esc(name)}">` +
        `<line class="axis" x1="${CHART_PAD}" y1="${CHART_H - 18}" x2="${CHART_W - 6}" y2="${CHART_H - 18}"/>` +
        `<line class="axis" x1="${CHART_PAD}" y1="12" x2="${CHART_PAD}" y2="${CHART_H - 18}"/>` +
        `<text x="${CHART_PAD - 3}" y="16" text-anchor="end">${esc(fmt(y1))}</text>` +
        `<text x="${CHART_PAD - 3}" y="${CHART_H - 18}" text-anchor="end">${esc(fmt(y0))}</text>` +
        `<text x="${CHART_PAD}" y="${CHART_H - 4}">${esc(fmt(x0))}</text>` +
        `<text x="${CHART_W - 6}" y="${CHART_H - 4}" text-anchor="end">${esc(fmt(x1))}</text>` +
        `<polyline points="${line}"/></svg></figure>`;
}
function metricsHtml(metrics) {
    const families = Object.keys(metrics || {});
    if (families.length === 0)
        return '<p class="muted">no figures and no numeric metrics.</p>';
    let html = "";
    for (const family of families) {
        const series = metrics[family];
        const names = Object.keys(series);
        const curves = names.filter(n => series[n].length > 1);
        const scalars = names.filter(n => series[n].length === 1);
        html += `<div class="metric-family"><h3>${esc(family)}</h3>`;
        if (curves.length)
            html += '<div class="curves">' + curves.map(n => lineChart(n, series[n])).join("") + "</div>";
        if (scalars.length) {
            html += '<table class="scalars"><tbody>' + scalars.map(n => `<tr><td>${esc(n)}</td><td>${esc(fmt(series[n][0][1]))}</td></tr>`).join("") + "</tbody></table>";
        }
        html += "</div>";
    }
    return html;
}
// --- API client ------------------------------------------------------------
class DashboardClient {
    async index(kind) {
        const res = await fetch(API_BASE + "api/runs?kind=" + encodeURIComponent(kind));
        if (!res.ok)
            throw new Error("api/runs " + res.status);
        return await res.json(); // {columns, rows, n, root, kinds, selected}
    }
    async plots(id) {
        const res = await fetch(API_BASE + "api/runs/" + encodeURIComponent(id) + "/plots");
        if (!res.ok)
            return null;
        return (await res.json()).plots; // [{slug, caption, png}]
    }
    async metrics(id) {
        const res = await fetch(API_BASE + "api/runs/" + encodeURIComponent(id) + "/metrics");
        if (!res.ok)
            return null;
        return (await res.json()).metrics; // {family: {metric: [[step, value], ...]}}
    }
    async deleteRun(id) {
        const res = await fetch(API_BASE + "api/runs/" + encodeURIComponent(id), { method: "DELETE" });
        return res.ok;
    }
    async putSelection(ids) {
        try {
            await fetch(API_BASE + "api/selection", {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ selected: ids }),
            });
        }
        catch (_e) { /* selection is best-effort; ignore transient errors */ }
    }
}
// --- controller ------------------------------------------------------------
class Dashboard {
    client;
    kind;
    tabSlugs;
    columns;
    rows;
    kinds;
    checked;
    loaded;
    loadedStatus;
    refreshCount;
    selectionSynced;
    kindState;
    sortCol;
    sortDir;
    filter;
    controlsBuilt;
    timer;
    thead;
    tbody;
    controlsEl;
    sectionsEl;
    sourceEl;
    statusEl;
    tabsEl;
    constructor() {
        this.client = new DashboardClient();
        // Active tab, restored across page reloads; the server resolves an unknown
        // or empty value to its first tab and returns the tab list with the data.
        this.kind = localStorage.getItem("dash.tab") || "";
        this.tabSlugs = "";
        this.columns = [];
        this.rows = [];
        this.kinds = []; // [{slug, caption}]
        this.checked = new Set(); // selected run ids (shown + delete targets)
        this.loaded = new Set(); // run ids whose sections are in the DOM
        this.loadedStatus = {}; // run id -> status seen when its section was last drawn
        this.refreshCount = 0; // table refreshes so far; paces the figure re-fetch
        this.selectionSynced = false; // restore backend selection once, on first load
        this.kindState = {}; // slug -> visible?
        this.sortCol = null;
        this.sortDir = 1;
        this.filter = "";
        this.controlsBuilt = false;
        this.timer = null;
        this.thead = document.querySelector("#runs thead");
        this.tbody = document.querySelector("#runs tbody");
        this.controlsEl = document.getElementById("controls");
        this.sectionsEl = document.getElementById("sections");
        this.sourceEl = document.getElementById("source");
        this.statusEl = document.getElementById("status");
        this.tabsEl = document.getElementById("tabs");
        document.getElementById("search").addEventListener("input", e => {
            this.filter = e.target.value.toLowerCase();
            this._renderBody();
        });
        document.getElementById("live").addEventListener("change", e => this._setLive(e.target.checked));
        document.getElementById("tabs").addEventListener("click", e => this._onTabClick(e));
        this.thead.addEventListener("click", e => this._onHeaderClick(e));
        this.tbody.addEventListener("click", e => this._onBodyClick(e));
        this.controlsEl.addEventListener("click", e => this._onControlsClick(e));
        this.refresh().then(() => this._setLive(true));
    }
    // -- tabs -----------------------------------------------------------------
    _renderTabs(tabs, active) {
        const slugs = tabs.map(t => t["slug"]).join("|");
        if (slugs !== this.tabSlugs) {
            this.tabSlugs = slugs;
            this.tabsEl.innerHTML = tabs.map(t => `<button data-tab="${esc(t["slug"])}">${esc(t["caption"])}</button>`).join("");
        }
        this.tabsEl.querySelectorAll("button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === active));
    }
    _onTabClick(e) {
        const btn = e.target.closest("button[data-tab]");
        if (!btn || btn.dataset.tab === this.kind)
            return;
        document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b === btn));
        this.kind = btn.dataset.tab;
        localStorage.setItem("dash.tab", this.kind);
        // Per-tab run state: sections/columns/plot kinds differ between kinds.
        this.sectionsEl.innerHTML = "";
        this.loaded.clear();
        this.loadedStatus = {};
        this.kindState = {};
        this.controlsBuilt = false;
        this.sortCol = null;
        void this.refresh();
    }
    // -- data -----------------------------------------------------------------
    async refresh() {
        let data;
        try {
            data = await this.client.index(this.kind);
        }
        catch (err) {
            this.statusEl.textContent = "error: " + err.message;
            return;
        }
        if (data.kind && data.kind !== this.kind) {
            this.kind = data.kind;
            localStorage.setItem("dash.tab", this.kind);
        }
        this._renderTabs(data.tabs || [], this.kind);
        this.columns = data.columns;
        this.rows = data.rows;
        // A figure kind that first appears later (a run reaching eval) needs its toggle.
        const slugs = (kinds) => kinds.map(k => k["slug"]).join("|");
        const kindsChanged = this.controlsBuilt && slugs(data.kinds || []) !== slugs(this.kinds);
        this.kinds = data.kinds || [];
        // Restore the backend-persisted selection once, on the first load (survives a
        // browser refresh; the periodic refresh must not clobber the live selection).
        if (!this.selectionSynced) {
            this.selectionSynced = true;
            this.checked = new Set(data.selected || []);
        }
        this.sourceEl.textContent = data.n + " run(s) · source: " + data.root;
        this.statusEl.textContent = "updated " + new Date().toLocaleTimeString();
        if (!this.controlsBuilt || kindsChanged) {
            this._buildControls();
            this.controlsBuilt = true;
        }
        this._renderHead();
        this._renderBody();
        // Sections for checked runs of this tab (first load + after a tab switch).
        // A drawn section is re-fetched when the run's status changed since it was
        // drawn (its final figures, once) and, every PLOT_REFRESH_EVERY refreshes,
        // while the run is still live (its figures grow as it trains).
        this.refreshCount += 1;
        const pollLive = this.refreshCount % PLOT_REFRESH_EVERY === 0;
        for (const r of this.rows) {
            const id = String(r["run_id"]);
            if (!this.checked.has(id))
                continue;
            if (!this.loaded.has(id)) {
                await this._ensureSection(id);
                continue;
            }
            const status = String(r["status"] || "");
            const live = !FINAL_STATUSES.has(status.toLowerCase());
            if (status !== this.loadedStatus[id] || (pollLive && live))
                await this._reloadSection(id);
        }
    }
    _setLive(on) {
        document.getElementById("live").checked = on;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (on)
            this.timer = setInterval(() => this.refresh(), 7000);
    }
    _rowById(id) { return this.rows.find(r => String(r["run_id"]) === id); }
    _displayCols() { return this.columns.filter(c => c !== "run_id"); } // run_id kept in data, not shown
    // -- controls -------------------------------------------------------------
    _buildControls() {
        // Per-tab visibility, restored across page reloads; default visible.
        const saved = JSON.parse(localStorage.getItem("dash.kinds." + this.kind) || "{}");
        for (const k of this.kinds)
            this.kindState[k["slug"]] = saved[k["slug"]] !== false;
        const kindBoxes = this.kinds.map(k => `<label><input type="checkbox" data-kind="${esc(k["slug"])}" ${this.kindState[k["slug"]] ? "checked" : ""}> ${esc(k["caption"])}</label>`).join("") || '<span class="muted">no plots</span>';
        this.controlsEl.innerHTML =
            '<fieldset><legend>Runs</legend>' +
                '<button type="button" data-runs="all">All</button> ' +
                '<button type="button" data-runs="none">None</button> ' +
                '<button type="button" class="danger" data-runs-delete>Delete</button>' +
                '<span class="muted"> (select in the table; Delete removes the selected runs)</span>' +
                '</fieldset>' +
                '<fieldset><legend>Show graphs</legend>' +
                '<button type="button" data-kinds="all">All</button> ' +
                '<button type="button" data-kinds="none">None</button> ' +
                kindBoxes + '</fieldset>';
    }
    _onControlsClick(e) {
        const t = e.target;
        if (t.dataset.runsDelete !== undefined) {
            void this._deleteSelected();
            return;
        }
        if (t.dataset.runs) {
            void this._setAllRuns(t.dataset.runs === "all");
            return;
        }
        if (t.dataset.kinds) {
            const on = t.dataset.kinds === "all";
            this.controlsEl.querySelectorAll("input[data-kind]").forEach(cb => {
                cb.checked = on;
                this._setKind(cb.dataset.kind, on);
            });
            return;
        }
        if (t.dataset.kind !== undefined)
            this._setKind(t.dataset.kind, t.checked);
    }
    _setKind(slug, on) {
        this.kindState[slug] = on;
        localStorage.setItem("dash.kinds." + this.kind, JSON.stringify(this.kindState));
        this.sectionsEl.querySelectorAll(".plot-" + slug).forEach(f => { f.hidden = !on; });
    }
    // -- table ----------------------------------------------------------------
    _renderHead() {
        const cells = ['<th class="nosort">select</th>'];
        this._displayCols().forEach((c, i) => {
            const arrow = (this.sortCol === c) ? (this.sortDir === 1 ? " ▲" : " ▼") : "";
            const cls = (c === "label") ? ' class="col-label"' : "";
            cells.push(`<th${cls} data-i="${i}">${esc(c)}${arrow}</th>`);
        });
        this.thead.innerHTML = "<tr>" + cells.join("") + "</tr>";
    }
    _onHeaderClick(e) {
        const th = e.target.closest("th");
        if (!th || th.dataset.i === undefined)
            return;
        const col = this._displayCols()[Number(th.dataset.i)];
        if (this.sortCol === col)
            this.sortDir *= -1;
        else {
            this.sortCol = col;
            this.sortDir = 1;
        }
        this._renderHead();
        this._renderBody();
    }
    _visibleRows() {
        let rows = this.rows;
        if (this.sortCol !== null) {
            const c = this.sortCol, dir = this.sortDir;
            rows = [...rows].sort((a, b) => {
                const x = a[c], y = b[c];
                const nx = (x === null || x === undefined || x === "") ? NaN : Number(x);
                const ny = (y === null || y === undefined || y === "") ? NaN : Number(y);
                if (!isNaN(nx) && !isNaN(ny))
                    return (nx - ny) * dir;
                return String(x === null || x === undefined ? "" : x)
                    .localeCompare(String(y === null || y === undefined ? "" : y)) * dir;
            });
        }
        if (this.filter) {
            rows = rows.filter(r => this.columns.map(c => r[c]).join(" ").toLowerCase().includes(this.filter));
        }
        return rows;
    }
    _renderBody() {
        const rows = this._visibleRows();
        this.tbody.innerHTML = rows.map(r => {
            const id = String(r["run_id"]);
            const chk = this.checked.has(id) ? "checked" : "";
            const cells = [`<td><input type="checkbox" class="run-cb" data-run="${esc(id)}" ${chk}></td>`];
            for (const c of this._displayCols()) {
                if (c === "label") {
                    const txt = r["label"] || id; // fall back to run_id when unlabeled
                    cells.push(`<td class="col-label"><a href="#run-${esc(id)}" class="run-link" data-run="${esc(id)}">${esc(txt)}</a></td>`);
                }
                else {
                    const v = r[c];
                    cells.push(`<td>${esc(v === null || v === undefined ? "" : v)}</td>`);
                }
            }
            return `<tr>${cells.join("")}</tr>`;
        }).join("");
    }
    _onBodyClick(e) {
        const link = e.target.closest("a.run-link");
        if (link) {
            e.preventDefault();
            void this._gotoRun(link.dataset.run);
            return;
        }
        const t = e.target;
        if (t.classList.contains("run-cb")) {
            void this._toggleRun(t.dataset.run, t.checked);
        }
    }
    async _gotoRun(id) {
        // Ensure the run's section exists (select + load it if needed), then scroll to it.
        if (!this.checked.has(id)) {
            const cb = this.tbody.querySelector('.run-cb[data-run="' + CSS.escape(id) + '"]');
            if (cb)
                cb.checked = true;
            await this._toggleRun(id, true);
        }
        else {
            await this._ensureSection(id);
        }
        const sec = document.getElementById("run-" + id);
        if (sec) {
            sec.hidden = false;
            sec.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }
    // -- sections -------------------------------------------------------------
    async _toggleRun(id, on) {
        if (on) {
            this.checked.add(id);
            await this._ensureSection(id);
            const sec = document.getElementById("run-" + id);
            if (sec)
                sec.hidden = false;
        }
        else {
            this.checked.delete(id);
            const sec = document.getElementById("run-" + id);
            if (sec)
                sec.hidden = true;
        }
        await this._saveSelection();
    }
    async _setAllRuns(on) {
        if (on) {
            for (const r of this._visibleRows()) {
                const cb = this.tbody.querySelector('.run-cb[data-run="' + CSS.escape(String(r["run_id"])) + '"]');
                if (cb)
                    cb.checked = true;
                await this._toggleRun(String(r["run_id"]), true);
            }
        }
        else {
            this.tbody.querySelectorAll(".run-cb").forEach(cb => { cb.checked = false; });
            for (const id of [...this.checked])
                await this._toggleRun(id, false);
        }
        await this._saveSelection();
    }
    _saveSelection() {
        return this.client.putSelection([...this.checked]);
    }
    async _ensureSection(id) {
        if (this.loaded.has(id))
            return;
        this.loaded.add(id);
        const sec = document.createElement("section");
        sec.id = "run-" + id;
        this.sectionsEl.appendChild(sec);
        await this._fillSection(sec, id);
    }
    // Re-fetch a drawn run's figures and redraw its section in place.
    async _reloadSection(id) {
        const sec = document.getElementById("run-" + id);
        if (!sec) {
            this.loaded.delete(id);
            await this._ensureSection(id);
            return;
        }
        await this._fillSection(sec, id);
    }
    async _fillSection(sec, id) {
        const plots = await this.client.plots(id);
        const row = this._rowById(id);
        const label = row && row["label"] ? " — " + row["label"] : "";
        const status = row ? row["status"] : "";
        const created = row ? row["created_at"] : "";
        let html = `<h2>${esc(id)}${esc(label)}</h2>`;
        html += `<p class="muted">status: ${esc(status)} · created: ${esc(created)}</p>`;
        if (!plots || plots.length === 0) {
            // No project figures: draw the run's stored metrics instead.
            html += metricsHtml(await this.client.metrics(id));
        }
        else {
            for (const p of plots) {
                html += `<figure class="plot-${esc(p["slug"])}"><figcaption>${esc(p["caption"])}</figcaption>` +
                    `<img loading="lazy" alt="${esc(p["caption"])}" src="data:image/png;base64,${p["png"]}"></figure>`;
            }
        }
        sec.innerHTML = html;
        this.loadedStatus[id] = String(status || "");
        // apply current per-kind visibility to the freshly added figures
        sec.querySelectorAll("figure").forEach(f => {
            const slug = (f.className.match(/plot-(\S+)/) || [])[1];
            if (slug && this.kindState[slug] === false)
                f.hidden = true;
        });
    }
    async _deleteSelected() {
        // Only the current tab's runs; the selection set spans tabs.
        const ids = [...this.checked].filter(id => this._rowById(id));
        if (ids.length === 0) {
            window.alert("No runs selected in this tab.");
            return;
        }
        const names = ids.map(id => { const r = this._rowById(id); return (r && r["label"]) ? String(r["label"]) : id; });
        if (!window.confirm("Delete " + ids.length + " selected run(s)?\n\n" +
            names.map(n => "  • " + n).join("\n") + "\n\n" +
            "This removes their directories and checkpoints."))
            return;
        const failed = [];
        for (const id of ids) {
            if (await this.client.deleteRun(id)) {
                this.checked.delete(id);
                this.loaded.delete(id);
                delete this.loadedStatus[id];
                const sec = document.getElementById("run-" + id);
                if (sec)
                    sec.remove();
            }
            else {
                failed.push(id);
            }
        }
        await this._saveSelection();
        await this.refresh();
        if (failed.length)
            window.alert("Delete failed for: " + failed.join(", "));
    }
}
// The shell calls this the first time the runs tab is shown, so the
// table load and the refresh timer start with the pane rather than the page.
window.aiUiPanes = window.aiUiPanes || {};
window.aiUiPanes["runs"] = () => new Dashboard();
