"use strict";
// The pane's blueprint is mounted under its slug, so every request is relative
// to this base rather than to the page root.
const API_BASE = "runs/";
const PANE_SLUG = "runs";
// The Details item that shows the selected runs' configuration documents
// (runs_pane.py CONFIG_ITEM); every other runs item is a results topic.
const CONFIG_ITEM = "configuration";
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
// --- configuration view ----------------------------------------------------
// One row per document key ("name.key"), one column per run; rows whose values
// differ between the runs are marked.
function configHtml(runs) {
    if (runs.length === 0)
        return '<p class="muted">select runs in the table to compare their configuration.</p>';
    const show = (v) => (v !== null && typeof v === "object") ? JSON.stringify(v) : v;
    const flat = runs.map(([, docs]) => {
        const out = {};
        for (const [name, doc] of Object.entries(docs)) {
            if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
                for (const [key, value] of Object.entries(doc))
                    out[name + "." + key] = show(value);
            }
            else {
                out[name] = show(doc);
            }
        }
        return out;
    });
    const keys = [...new Set(flat.flatMap(f => Object.keys(f)))].sort();
    if (keys.length === 0)
        return '<p class="muted">the selected runs have no configuration documents.</p>';
    const head = "<tr><th>parameter</th>" + runs.map(([label]) => `<th>${esc(label)}</th>`).join("") + "</tr>";
    const body = keys.map(k => {
        const values = flat.map(f => esc(f[k]));
        const cls = runs.length > 1 && new Set(values).size > 1 ? ' class="differs"' : "";
        return `<tr${cls}><td>${esc(k)}</td>` + values.map(v => `<td>${v}</td>`).join("") + "</tr>";
    }).join("");
    return `<div class="tablewrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
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
    async documents(id) {
        const res = await fetch(API_BASE + "api/runs/" + encodeURIComponent(id) + "/documents");
        if (!res.ok)
            return null;
        return (await res.json()).documents; // {name: document}
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
    item;
    shown;
    columns;
    rows;
    topics;
    checked;
    loaded;
    loadedStatus;
    documents;
    configHtml;
    refreshCount;
    selectionSynced;
    sortCol;
    sortDir;
    filter;
    controlsBuilt;
    timer;
    thead;
    tbody;
    controlsEl;
    configEl;
    sectionsEl;
    sourceEl;
    statusEl;
    constructor() {
        this.client = new DashboardClient();
        // The shell's menus pick the tab (Modules) and what the detail area shows
        // (Details); the server resolves an unknown or empty tab to its first one.
        const view = window.aiUiView;
        this.kind = view ? view.module : "";
        this.item = view && view.pane === PANE_SLUG ? view.item : CONFIG_ITEM;
        this.shown = !!view && view.pane === PANE_SLUG;
        this.columns = [];
        this.rows = [];
        this.topics = {}; // topic slug -> its figure slugs, for this tab
        this.checked = new Set(); // selected run ids (shown + delete targets)
        this.loaded = new Set(); // run ids whose sections are in the DOM
        this.loadedStatus = {}; // run id -> status seen when its section was last drawn
        this.documents = {}; // run id -> its configuration documents, fetched once
        this.configHtml = ""; // the configuration table last drawn
        this.refreshCount = 0; // table refreshes so far; paces the figure re-fetch
        this.selectionSynced = false; // restore backend selection once, on first load
        this.sortCol = null;
        this.sortDir = 1;
        this.filter = "";
        this.controlsBuilt = false;
        this.timer = null;
        this.thead = document.querySelector("#runs thead");
        this.tbody = document.querySelector("#runs tbody");
        this.controlsEl = document.getElementById("controls");
        this.configEl = document.getElementById("config");
        this.sectionsEl = document.getElementById("sections");
        this.sourceEl = document.getElementById("source");
        this.statusEl = document.getElementById("status");
        document.getElementById("search").addEventListener("input", e => {
            this.filter = e.target.value.toLowerCase();
            this._renderBody();
        });
        document.getElementById("live").addEventListener("change", e => this._setLive(e.target.checked));
        document.addEventListener("ai-ui:view", e => this._onView(e.detail));
        this.thead.addEventListener("click", e => this._onHeaderClick(e));
        this.tbody.addEventListener("click", e => this._onBodyClick(e));
        this.controlsEl.addEventListener("click", e => this._onControlsClick(e));
        this.refresh().then(() => this._setLive(true));
    }
    // -- menus ----------------------------------------------------------------
    _onView(view) {
        if (view.module !== this.kind) {
            this.kind = view.module;
            // Per-tab run state: sections/columns differ between kinds.
            this.sectionsEl.innerHTML = "";
            this.loaded.clear();
            this.loadedStatus = {};
            this.controlsBuilt = false;
            this.sortCol = null;
            this.shown = view.pane === PANE_SLUG;
            if (this.shown)
                this.item = view.item;
            void this.refresh();
            return;
        }
        this.shown = view.pane === PANE_SLUG;
        if (!this.shown)
            return;
        this.item = view.item;
        void this._syncDetail();
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
        if (data.kind)
            this.kind = data.kind;
        const tab = (data.tabs || []).find(t => t["slug"] === this.kind);
        this.topics = {};
        for (const topic of (tab ? tab.topics : []))
            this.topics[topic["slug"]] = new Set(topic.plots);
        this.columns = data.columns;
        this.rows = data.rows;
        // Restore the backend-persisted selection once, on the first load (survives a
        // browser refresh; the periodic refresh must not clobber the live selection).
        if (!this.selectionSynced) {
            this.selectionSynced = true;
            this.checked = new Set(data.selected || []);
        }
        this.sourceEl.textContent = data.n + " run(s) · source: " + data.root;
        this.statusEl.textContent = "updated " + new Date().toLocaleTimeString();
        if (!this.controlsBuilt) {
            this._buildControls();
            this.controlsBuilt = true;
        }
        this._renderHead();
        this._renderBody();
        this.refreshCount += 1;
        await this._syncDetail(this.refreshCount % PLOT_REFRESH_EVERY === 0);
    }
    // Fill the detail area for the picked item; nothing while another pane holds it.
    async _syncDetail(pollLive = false) {
        if (!this.shown)
            return;
        const config = this.item === CONFIG_ITEM;
        this.configEl.hidden = !config;
        this.sectionsEl.hidden = config;
        if (config) {
            await this._renderConfig();
            return;
        }
        this.sectionsEl.querySelectorAll("section").forEach(sec => this._applyTopic(sec));
        // Sections for checked runs of this tab (first load + after a tab switch).
        // A drawn section is re-fetched when the run's status changed since it was
        // drawn (its final figures, once) and, every PLOT_REFRESH_EVERY refreshes,
        // while the run is still live (its figures grow as it trains).
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
    // The checked runs of this tab, one column each, in table order.
    async _renderConfig() {
        const runs = [];
        for (const r of this.rows) {
            const id = String(r["run_id"]);
            if (!this.checked.has(id))
                continue;
            if (!(id in this.documents))
                this.documents[id] = await this.client.documents(id);
            runs.push([String(r["label"] || id), this.documents[id] || {}]);
        }
        // Redraw only on a change, so the periodic refresh keeps the table's scroll position.
        const html = configHtml(runs);
        if (html !== this.configHtml) {
            this.configHtml = html;
            this.configEl.innerHTML = html;
        }
    }
    // Show only the picked topic's figures, or all of them for an item that is no topic (a tab without topics);
    // a run drawn from its metrics shows under every topic.
    _applyTopic(sec) {
        const plots = this.topics[this.item];
        let any = false;
        sec.querySelectorAll("figure[data-plot]").forEach(f => {
            f.hidden = !!plots && !plots.has(f.dataset.plot);
            any = any || !f.hidden;
        });
        const none = sec.querySelector(".no-topic");
        if (none)
            none.hidden = any;
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
        this.controlsEl.innerHTML =
            '<fieldset><legend>Runs</legend>' +
                '<button type="button" data-runs="all">All</button> ' +
                '<button type="button" data-runs="none">None</button> ' +
                '<button type="button" class="danger" data-runs-delete>Delete</button>' +
                '<span class="muted"> (select in the table; Delete removes the selected runs)</span>' +
                '</fieldset>';
    }
    _onControlsClick(e) {
        const t = e.target;
        if (t.dataset.runsDelete !== undefined) {
            void this._deleteSelected();
            return;
        }
        if (t.dataset.runs) {
            void this._setAllRuns(t.dataset.runs === "all");
        }
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
        if (on)
            this.checked.add(id);
        else
            this.checked.delete(id);
        if (this.shown && this.item === CONFIG_ITEM) {
            await this._renderConfig();
        }
        else if (on) {
            if (this.shown)
                await this._ensureSection(id);
            const sec = document.getElementById("run-" + id);
            if (sec)
                sec.hidden = false;
        }
        else {
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
            html += '<p class="muted no-topic">no graphs for this topic.</p>';
            for (const p of plots) {
                html += `<figure data-plot="${esc(p["slug"])}"><figcaption>${esc(p["caption"])}</figcaption>` +
                    `<img loading="lazy" alt="${esc(p["caption"])}" src="data:image/png;base64,${p["png"]}"></figure>`;
            }
        }
        sec.innerHTML = html;
        this.loadedStatus[id] = String(status || "");
        this._applyTopic(sec);
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
                delete this.documents[id];
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
// The table sits in the shell's top area, so the shell calls this at page load.
window.aiUiPanes = window.aiUiPanes || {};
window.aiUiPanes["runs"] = () => new Dashboard();
