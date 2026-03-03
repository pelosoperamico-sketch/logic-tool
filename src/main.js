import "./style.css";
import { downloadText, pickFileText, fmtDate, toNumber } from "./lib/utils.js";
import * as inv from "./lib/inventory.js";
import * as db from "./lib/db.js";

const state = {
  tab: "dashboard",
  data: { products: [], warehouses: [], movements: [] },
  filters: {
    q: "",
    type: "ALL",
    from: "",
    to: "",
    whId: "ALL",
    productId: "ALL",
  },
  notice: null,
};

const app = document.querySelector("#app");

renderShell();
boot();

async function boot() {
  try {
    await inv.seedIfEmpty();
    await refresh();
    setNotice("Pronto. Dati salvati in locale (IndexedDB).", false);
  } catch (e) {
    setNotice(String(e?.message || e), true);
  }
}

async function refresh() {
  state.data = await inv.listAll();
  render();
}

function renderShell() {
  app.innerHTML = `
    <div class="container">
      <div class="topbar">
        <div class="brand">
          <h1>Magazzino</h1>
          <div class="muted">Movimenti • Giacenze • Backup</div>
        </div>
        <div class="row">
          <button id="btnExport">Export JSON</button>
          <button id="btnImport">Import JSON</button>
          <button class="danger" id="btnReset" title="Cancella tutti i dati">Reset</button>
        </div>
      </div>

      <div class="nav" id="nav">
        ${tabBtn("dashboard", "Dashboard")}
        ${tabBtn("movimenti", "Movimenti")}
        ${tabBtn("articoli", "Articoli")}
        ${tabBtn("magazzini", "Magazzini")}
        ${tabBtn("giacenze", "Giacenze")}
      </div>

      <div id="notice"></div>

      <div id="view" style="margin-top:12px;"></div>

      <div class="footer">
        Tip: non chiudere il terminale Vite se vuoi la preview live. Ogni salvataggio aggiorna la pagina.
      </div>
    </div>
  `;

  $("#btnExport").addEventListener("click", onExport);
  $("#btnImport").addEventListener("click", onImport);
  $("#btnReset").addEventListener("click", onReset);

  $("#nav").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    state.tab = btn.dataset.tab;
    render();
  });
}

function render() {
  // tabs UI
  for (const el of document.querySelectorAll(".tab")) {
    el.classList.toggle("active", el.dataset.tab === state.tab);
  }

  // notice
  const notice = $("#notice");
  if (!state.notice) notice.innerHTML = "";
  else {
    notice.innerHTML = `<div class="notice ${state.notice.isErr ? "err" : ""}">${escapeHtml(state.notice.msg)}</div>`;
  }

  // view
  const view = $("#view");
  if (state.tab === "dashboard") view.innerHTML = renderDashboard();
  else if (state.tab === "movimenti") view.innerHTML = renderMovimenti();
  else if (state.tab === "articoli") view.innerHTML = renderArticoli();
  else if (state.tab === "magazzini") view.innerHTML = renderMagazzini();
  else if (state.tab === "giacenze") view.innerHTML = renderGiacenze();
  else view.innerHTML = "";

  bindViewHandlers();
}

function bindViewHandlers() {
  if (state.tab === "articoli") {
    $("#addProduct")?.addEventListener("click", onAddProduct);
    $("#productsTable")?.addEventListener("click", async (e) => {
      const id = e.target.closest("[data-del]")?.dataset.del;
      if (!id) return;
      try {
        await inv.deleteProduct(id);
        await refresh();
        setNotice("Prodotto eliminato.", false);
      } catch (err) {
        setNotice(err.message || String(err), true);
      }
    });
  }

  if (state.tab === "magazzini") {
    $("#addWh")?.addEventListener("click", onAddWarehouse);
    $("#whTable")?.addEventListener("click", async (e) => {
      const id = e.target.closest("[data-del]")?.dataset.del;
      if (!id) return;
      try {
        await inv.deleteWarehouse(id);
        await refresh();
        setNotice("Magazzino eliminato.", false);
      } catch (err) {
        setNotice(err.message || String(err), true);
      }
    });
  }

  if (state.tab === "movimenti") {
    $("#addMovement")?.addEventListener("click", onAddMovement);
    $("#mvTable")?.addEventListener("click", async (e) => {
      const id = e.target.closest("[data-rev]")?.dataset.rev;
      if (!id) return;
      try {
        await inv.reverseMovement(id);
        await refresh();
        setNotice("Movimento stornato (creato movimento di storno).", false);
      } catch (err) {
        setNotice(err.message || String(err), true);
      }
    });

    // filters
    $("#f_q")?.addEventListener("input", (e) => { state.filters.q = e.target.value; render(); });
    $("#f_type")?.addEventListener("change", (e) => { state.filters.type = e.target.value; render(); });
    $("#f_wh")?.addEventListener("change", (e) => { state.filters.whId = e.target.value; render(); });
    $("#f_prod")?.addEventListener("change", (e) => { state.filters.productId = e.target.value; render(); });
    $("#f_from")?.addEventListener("change", (e) => { state.filters.from = e.target.value; render(); });
    $("#f_to")?.addEventListener("change", (e) => { state.filters.to = e.target.value; render(); });
  }

  if (state.tab === "giacenze") {
    $("#stock_wh")?.addEventListener("change", (e) => {
      state.filters.whId = e.target.value;
      render();
    });
  }
}

function renderDashboard() {
  const { products, warehouses, movements } = state.data;
  const stock = inv.computeStock(state.data);
  const totalLines = movements.reduce((acc, m) => acc + (m.lines?.length || 0), 0);

  return `
    <div class="grid">
      <div class="card">
        <h2>Riepilogo</h2>
        <div class="kpis">
          <div class="kpi"><div class="muted">Articoli</div><b>${products.length}</b></div>
          <div class="kpi"><div class="muted">Magazzini</div><b>${warehouses.length}</b></div>
          <div class="kpi"><div class="muted">Movimenti</div><b>${movements.length}</b></div>
          <div class="kpi"><div class="muted">Righe mov.</div><b>${totalLines}</b></div>
        </div>
        <div class="muted" style="margin-top:10px">
          Stock negativo non consentito su scarichi e trasferimenti.
        </div>
      </div>

      <div class="card">
        <h2>Ultimi movimenti</h2>
        <div class="tablewrap">
          <table>
            <thead><tr><th>Data</th><th>Tipo</th><th>Note</th><th>Stato</th></tr></thead>
            <tbody>
              ${movements.slice(0, 8).map(m => `
                <tr>
                  <td>${escapeHtml(fmtDate(m.at))}</td>
                  <td><code>${escapeHtml(m.type)}</code></td>
                  <td>${escapeHtml(m.reason || "")}</td>
                  <td>${m.reversedBy ? `<span class="muted">stornato</span>` : `<span class="muted">ok</span>`}</td>
                </tr>
              `).join("") || `<tr><td colspan="4" class="muted">Nessun movimento</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h2>Giacenze (top)</h2>
        ${renderStockTop(stock)}
      </div>

      <div class="card">
        <h2>Azioni rapide</h2>
        <div class="row">
          <button class="primary" onclick="window.__go('movimenti')">Nuovo movimento</button>
          <button onclick="window.__go('articoli')">Nuovo articolo</button>
          <button onclick="window.__go('magazzini')">Nuovo magazzino</button>
        </div>
        <div class="muted" style="margin-top:10px">
          Suggerimento: crea prima articoli e magazzini, poi registra carichi/scarichi/trasferimenti.
        </div>
      </div>
    </div>
  `;
}

function renderStockTop(stock) {
  const { products, warehouses } = state.data;

  const rows = [];
  for (const p of products) {
    for (const w of warehouses) {
      const key = `${p.id}::${w.id}`;
      const qty = stock.byProdWh.get(key) ?? 0;
      if (qty !== 0) rows.push({ sku: p.sku, product: p.name, wh: w.code, qty, uom: p.uom });
    }
  }
  rows.sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));
  const top = rows.slice(0, 10);

  return `
    <div class="tablewrap">
      <table>
        <thead><tr><th>SKU</th><th>Articolo</th><th>Mag</th><th>Q.tà</th></tr></thead>
        <tbody>
          ${top.map(r => `
            <tr>
              <td><code>${escapeHtml(r.sku)}</code></td>
              <td>${escapeHtml(r.product)}</td>
              <td><code>${escapeHtml(r.wh)}</code></td>
              <td>${escapeHtml(String(r.qty))} <span class="muted">${escapeHtml(r.uom)}</span></td>
            </tr>
          `).join("") || `<tr><td colspan="4" class="muted">Nessuna giacenza non-zero</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderArticoli() {
  const { products } = state.data;
  return `
    <div class="grid">
      <div class="card">
        <h2>Nuovo articolo</h2>
        <div class="row">
          <input id="p_sku" placeholder="SKU (es. ABC-123)" />
          <input id="p_name" placeholder="Nome articolo" style="min-width:320px" />
          <input id="p_uom" class="small" placeholder="U.M. (PZ)" />
          <button class="primary" id="addProduct">Aggiungi</button>
        </div>
        <div class="muted" style="margin-top:10px">
          SKU deve essere unico.
        </div>
      </div>

      <div class="card">
        <h2>Elenco articoli</h2>
        <div class="tablewrap">
          <table id="productsTable">
            <thead><tr><th>SKU</th><th>Nome</th><th>U.M.</th><th></th></tr></thead>
            <tbody>
              ${products.map(p => `
                <tr>
                  <td><code>${escapeHtml(p.sku)}</code></td>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${escapeHtml(p.uom)}</td>
                  <td><button class="danger" data-del="${escapeHtml(p.id)}">Elimina</button></td>
                </tr>
              `).join("") || `<tr><td colspan="4" class="muted">Nessun articolo</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="muted" style="margin-top:10px">
          Non puoi eliminare articoli già usati nei movimenti.
        </div>
      </div>
    </div>
  `;
}

function renderMagazzini() {
  const { warehouses } = state.data;
  return `
    <div class="grid">
      <div class="card">
        <h2>Nuovo magazzino</h2>
        <div class="row">
          <input id="w_code" placeholder="Codice (es. WH-1)" />
          <input id="w_name" placeholder="Nome magazzino" style="min-width:320px" />
          <button class="primary" id="addWh">Aggiungi</button>
        </div>
        <div class="muted" style="margin-top:10px">
          Il codice viene salvato in maiuscolo ed è unico.
        </div>
      </div>

      <div class="card">
        <h2>Elenco magazzini</h2>
        <div class="tablewrap">
          <table id="whTable">
            <thead><tr><th>Codice</th><th>Nome</th><th></th></tr></thead>
            <tbody>
              ${warehouses.map(w => `
                <tr>
                  <td><code>${escapeHtml(w.code)}</code></td>
                  <td>${escapeHtml(w.name)}</td>
                  <td><button class="danger" data-del="${escapeHtml(w.id)}">Elimina</button></td>
                </tr>
              `).join("") || `<tr><td colspan="3" class="muted">Nessun magazzino</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="muted" style="margin-top:10px">
          Non puoi eliminare magazzini già usati nei movimenti.
        </div>
      </div>
    </div>
  `;
}

function renderMovimenti() {
  const { products, warehouses, movements } = state.data;

  const f = state.filters;

  const filtered = movements.filter((m) => {
    // type filter
    if (f.type !== "ALL" && m.type !== f.type) return false;
    // date range (input type=date gives YYYY-MM-DD)
    if (f.from) {
      const fromIso = new Date(f.from + "T00:00:00").toISOString();
      if (String(m.at) < fromIso) return false;
    }
    if (f.to) {
      const toIso = new Date(f.to + "T23:59:59").toISOString();
      if (String(m.at) > toIso) return false;
    }
    // wh filter: match any line
    if (f.whId !== "ALL") {
      const hit = (m.lines || []).some(l => l.whId === f.whId || l.fromWhId === f.whId || l.toWhId === f.whId);
      if (!hit) return false;
    }
    // product filter
    if (f.productId !== "ALL") {
      const hit = (m.lines || []).some(l => l.productId === f.productId);
      if (!hit) return false;
    }
    // q filter (sku/name/reason)
    if (f.q) {
      const q = f.q.toLowerCase();
      const reasonHit = (m.reason || "").toLowerCase().includes(q);
      const lineHit = (m.lines || []).some(l => {
        const p = products.find(x => x.id === l.productId);
        return (p?.sku || "").toLowerCase().includes(q) || (p?.name || "").toLowerCase().includes(q);
      });
      if (!reasonHit && !lineHit) return false;
    }
    return true;
  });

  return `
    <div class="card">
      <h2>Nuovo movimento</h2>
      <div class="row">
        <select id="mv_type">
          <option value="IN">Carico (IN)</option>
          <option value="OUT">Scarico (OUT)</option>
          <option value="XFER">Trasferimento (XFER)</option>
          <option value="ADJ">Rettifica (ADJ)</option>
        </select>

        <select id="mv_product">
          ${products.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.sku)} — ${escapeHtml(p.name)}</option>`).join("")}
        </select>

        <input id="mv_qty" class="small" placeholder="Quantità" value="1" />

        <select id="mv_wh" title="Magazzino (IN/OUT/ADJ)">
          ${warehouses.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.code)} — ${escapeHtml(w.name)}</option>`).join("")}
        </select>

        <select id="mv_from" title="Da (XFER)" style="display:none">
          ${warehouses.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.code)} — ${escapeHtml(w.name)}</option>`).join("")}
        </select>

        <select id="mv_to" title="A (XFER)" style="display:none">
          ${warehouses.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.code)} — ${escapeHtml(w.name)}</option>`).join("")}
        </select>

        <input id="mv_reason" placeholder="Causale / riferimento" style="min-width:320px" />

        <button class="primary" id="addMovement">Registra</button>
      </div>

      <div class="muted" style="margin-top:10px">
        Trasferimento: seleziona origine/destinazione. Rettifica: quantità può essere negativa o positiva.
      </div>
    </div>

    <div class="card" style="margin-top:12px">
      <div class="row" style="margin-bottom:10px">
        <h2 style="margin:0">Storico movimenti</h2>
        <div class="spacer"></div>
        <input id="f_q" placeholder="Cerca (SKU, nome, causale)" value="${escapeHtml(f.q)}" style="min-width:260px" />
        <select id="f_type">
          <option value="ALL">Tutti i tipi</option>
          <option value="IN" ${f.type==="IN"?"selected":""}>IN</option>
          <option value="OUT" ${f.type==="OUT"?"selected":""}>OUT</option>
          <option value="XFER" ${f.type==="XFER"?"selected":""}>XFER</option>
          <option value="ADJ" ${f.type==="ADJ"?"selected":""}>ADJ</option>
        </select>
        <select id="f_wh">
          <option value="ALL">Tutti i magazzini</option>
          ${warehouses.map(w => `<option value="${escapeHtml(w.id)}" ${f.whId===w.id?"selected":""}>${escapeHtml(w.code)}</option>`).join("")}
        </select>
        <select id="f_prod">
          <option value="ALL">Tutti gli articoli</option>
          ${products.map(p => `<option value="${escapeHtml(p.id)}" ${f.productId===p.id?"selected":""}>${escapeHtml(p.sku)}</option>`).join("")}
        </select>
        <input id="f_from" type="date" title="Da" value="${escapeHtml(f.from)}" class="small" />
        <input id="f_to" type="date" title="A" value="${escapeHtml(f.to)}" class="small" />
      </div>

      <div class="tablewrap">
        <table id="mvTable">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Causale</th>
              <th>Dettaglio</th>
              <th>Stato</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(m => renderMvRow(m, products, warehouses)).join("") || `
              <tr><td colspan="6" class="muted">Nessun movimento</td></tr>
            `}
          </tbody>
        </table>
      </div>

      <div class="muted" style="margin-top:10px">
        Lo storno crea un nuovo movimento che annulla l'effetto del precedente e marca l'originale come stornato.
      </div>
    </div>
  `;
}

function renderMvRow(m, products, warehouses) {
  const det = (m.lines || []).map((l) => {
    const p = products.find(x => x.id === l.productId);
    const sku = p?.sku || "???";
    const uom = p?.uom || "";
    if (m.type === "XFER") {
      const fw = warehouses.find(w => w.id === l.fromWhId)?.code || "???";
      const tw = warehouses.find(w => w.id === l.toWhId)?.code || "???";
      return `${escapeHtml(sku)} ${escapeHtml(String(l.qty))}${escapeHtml(uom)} ${escapeHtml(fw)}→${escapeHtml(tw)}`;
    } else {
      const w = warehouses.find(w => w.id === l.whId)?.code || "???";
      return `${escapeHtml(sku)} ${escapeHtml(String(l.qty))}${escapeHtml(uom)} @${escapeHtml(w)}`;
    }
  }).join("<br/>");

  const status = m.reversedBy
    ? `<span class="muted">stornato</span>`
    : (m.reverses ? `<span class="muted">storno</span>` : `<span class="muted">ok</span>`);

  const btn = (!m.reversedBy && !m.reverses)
    ? `<button data-rev="${escapeHtml(m.id)}">Storna</button>`
    : `<button disabled>Storna</button>`;

  return `
    <tr>
      <td>${escapeHtml(fmtDate(m.at))}</td>
      <td><code>${escapeHtml(m.type)}</code></td>
      <td>${escapeHtml(m.reason || "")}</td>
      <td>${det}</td>
      <td>${status}</td>
      <td>${btn}</td>
    </tr>
  `;
}

function renderGiacenze() {
  const { products, warehouses, movements } = state.data;
  const stock = inv.computeStock(state.data);

  const whFilter = state.filters.whId ?? "ALL";

  const whSelect = `
    <div class="row" style="margin-bottom:10px">
      <h2 style="margin:0">Giacenze</h2>
      <div class="spacer"></div>
      <select id="stock_wh">
        <option value="ALL">Tutti i magazzini</option>
        ${warehouses.map(w => `<option value="${escapeHtml(w.id)}" ${whFilter===w.id?"selected":""}>${escapeHtml(w.code)} — ${escapeHtml(w.name)}</option>`).join("")}
      </select>
    </div>
  `;

  const rows = [];
  for (const p of products) {
    for (const w of warehouses) {
      if (whFilter !== "ALL" && w.id !== whFilter) continue;
      const key = `${p.id}::${w.id}`;
      const qty = stock.byProdWh.get(key) ?? 0;
      rows.push({ sku: p.sku, name: p.name, uom: p.uom, wh: w.code, qty });
    }
  }

  // show only non-zero first, but keep all
  rows.sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));

  return `
    <div class="card">
      ${whSelect}
      <div class="tablewrap">
        <table>
          <thead><tr><th>SKU</th><th>Articolo</th><th>Magazzino</th><th>Giacenza</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><code>${escapeHtml(r.sku)}</code></td>
                <td>${escapeHtml(r.name)}</td>
                <td><code>${escapeHtml(r.wh)}</code></td>
                <td>${escapeHtml(String(r.qty))} <span class="muted">${escapeHtml(r.uom)}</span></td>
              </tr>
            `).join("") || `<tr><td colspan="4" class="muted">Nessun dato</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="muted" style="margin-top:10px">
        Calcolate dal libro movimenti (carichi +, scarichi -, trasferimenti -, +, rettifiche ±).
      </div>
    </div>
  `;
}

async function onAddProduct() {
  try {
    const sku = $("#p_sku").value;
    const name = $("#p_name").value;
    const uom = $("#p_uom").value || "PZ";
    await inv.createProduct({ sku, name, uom });
    await refresh();
    $("#p_sku").value = "";
    $("#p_name").value = "";
    $("#p_uom").value = "";
    setNotice("Articolo creato.", false);
  } catch (e) {
    setNotice(e.message || String(e), true);
  }
}

async function onAddWarehouse() {
  try {
    const code = $("#w_code").value;
    const name = $("#w_name").value;
    await inv.createWarehouse({ code, name });
    await refresh();
    $("#w_code").value = "";
    $("#w_name").value = "";
    setNotice("Magazzino creato.", false);
  } catch (e) {
    setNotice(e.message || String(e), true);
  }
}

async function onAddMovement() {
  try {
    const type = $("#mv_type").value;
    const productId = $("#mv_product").value;
    const qty = toNumber($("#mv_qty").value);
    const reason = $("#mv_reason").value;

    const whId = $("#mv_wh").value;
    const fromWhId = $("#mv_from").value;
    const toWhId = $("#mv_to").value;

    let lines;
    if (type === "XFER") {
      lines = [{ productId, qty, fromWhId, toWhId }];
    } else if (type === "ADJ") {
      // allow negative
      lines = [{ productId, qty, whId }];
    } else {
      if (qty <= 0) throw new Error("Quantità deve essere > 0");
      lines = [{ productId, qty, whId }];
    }

    await inv.addMovement({ type, reason, lines });
    await refresh();
    $("#mv_reason").value = "";
    setNotice("Movimento registrato.", false);
  } catch (e) {
    setNotice(e.message || String(e), true);
  }
}

function onTypeChangeUI() {
  const type = $("#mv_type").value;
  const wh = $("#mv_wh");
  const from = $("#mv_from");
  const to = $("#mv_to");

  if (type === "XFER") {
    wh.style.display = "none";
    from.style.display = "";
    to.style.display = "";
  } else {
    wh.style.display = "";
    from.style.display = "none";
    to.style.display = "none";
  }
}

async function onExport() {
  try {
    const payload = await db.exportAll();
    downloadText(`magazzino_backup_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload, null, 2));
    setNotice("Export completato.", false);
  } catch (e) {
    setNotice(e.message || String(e), true);
  }
}

async function onImport() {
  try {
    const text = await pickFileText(".json,application/json");
    if (!text) return;
    const payload = JSON.parse(text);
    await db.importAll(payload);
    await refresh();
    setNotice("Import completato.", false);
  } catch (e) {
    setNotice(e.message || String(e), true);
  }
}

async function onReset() {
  if (!confirm("Reset totale: cancello articoli, magazzini e movimenti. Continuare?")) return;
  try {
    await Promise.all([db.clear("products"), db.clear("warehouses"), db.clear("movements")]);
    await inv.seedIfEmpty();
    await refresh();
    setNotice("Reset completato.", false);
  } catch (e) {
    setNotice(e.message || String(e), true);
  }
}

function setNotice(msg, isErr) {
  state.notice = { msg, isErr };
  render();
}

function tabBtn(id, label) {
  return `<button class="tab ${id===state.tab?"active":""}" data-tab="${id}">${label}</button>`;
}

function $(q) { return document.querySelector(q); }
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// allow quick nav from buttons
window.__go = (t) => { state.tab = t; render(); };

// bind type selector after first render
const _oldRender = render;
render = function() {
  _oldRender();
  if (state.tab === "movimenti") {
    $("#mv_type")?.addEventListener("change", onTypeChangeUI);
    onTypeChangeUI();
  }
};
