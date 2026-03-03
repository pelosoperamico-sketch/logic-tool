import "./style.css";
import { evaluateRuleset } from "./logicEngine.js";

const LS_KEY = "logic-tool.presets.v1";

const DEFAULT_RULESET = {
  name: "Esempio: scoring cliente",
  rules: [
    {
      id: "R1",
      name: "Cliente VIP",
      when: { all: [{ fact: "customer.tier", op: "eq", value: "vip" }] },
      then: [
        { type: "set", path: "result.isVip", value: true },
        { type: "inc", path: "result.score", value: 50 },
        { type: "push", path: "result.messages", value: "Cliente VIP (+50)" }
      ]
    },
    {
      id: "R2",
      name: "Sconto se carrello > 200",
      when: { all: [{ fact: "cart.total", op: "gt", value: 200 }] },
      then: [
        { type: "set", path: "result.discountPct", value: 10 },
        { type: "push", path: "result.messages", value: "Sconto 10% per carrello > 200" }
      ]
    },
    {
      id: "R3",
      name: "Rischio alto se email usa dominio sospetto",
      when: { any: [
        { fact: "customer.email", op: "regex", value: "@(mailinator|tempmail|guerrillamail)\\." },
        { fact: "customer.country", op: "in", value: ["XX", "YY"] }
      ]},
      then: [
        { type: "set", path: "result.risk", value: "high" },
        { type: "push", path: "result.messages", value: "Rischio alto: email/paese" }
      ]
    }
  ]
};

const DEFAULT_INPUT = {
  customer: { tier: "vip", email: "mario@mailinator.com", country: "IT" },
  cart: { total: 240, items: 3 },
  result: { score: 0, messages: [] }
};

const app = document.querySelector("#app");
app.innerHTML = `
  <div class="container">
    <div class="header">
      <div class="title">Logic Tool</div>
      <div class="sub">Rule engine semplice (JSON in → JSON out) con trace e preset</div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <div class="kpi">
          <div class="pill">Repo-friendly</div>
          <div class="pill">Live reload</div>
          <div class="pill">End-to-end</div>
        </div>
        <div class="row">
          <select id="presetSelect" style="min-width:220px"></select>
          <button id="savePreset">Salva preset</button>
          <button id="deletePreset">Elimina preset</button>
        </div>
      </div>
      <div class="small" style="margin-top:8px">
        Suggerimento: modifica ruleset/input e premi <b>Valuta</b>. Il risultato va in <b>Output</b>.
      </div>
    </div>

    <div class="grid" style="margin-top:16px">
      <div class="card">
        <h2>Ruleset (JSON)</h2>
        <textarea id="ruleset"></textarea>
        <div class="row" style="margin-top:10px">
          <button id="validate">Valida JSON</button>
          <button class="primary" id="run">Valuta</button>
          <span id="status" class="small"></span>
        </div>
      </div>

      <div class="card">
        <h2>Input (JSON)</h2>
        <textarea id="input"></textarea>
      </div>

      <div class="card">
        <h2>Output</h2>
        <pre class="out" id="output"></pre>
      </div>

      <div class="card">
        <h2>Trace</h2>
        <pre class="out" id="trace"></pre>
      </div>
    </div>

    <div class="footer">
      Operatori: <code>eq, neq, gt, gte, lt, lte, includes, in, exists, regex</code> •
      Azioni: <code>set, push, inc</code>
    </div>
  </div>
`;

const el = {
  ruleset: $("#ruleset"),
  input: $("#input"),
  run: $("#run"),
  validate: $("#validate"),
  output: $("#output"),
  trace: $("#trace"),
  status: $("#status"),
  presetSelect: $("#presetSelect"),
  savePreset: $("#savePreset"),
  deletePreset: $("#deletePreset"),
};

const presets = loadPresets();
ensureDefaultPreset(presets);

renderPresetSelect();
loadPresetIntoEditors(el.presetSelect.value);

el.run.addEventListener("click", () => {
  const parsed = parseBoth();
  if (!parsed) return;

  const res = evaluateRuleset(parsed.ruleset, parsed.input);
  el.output.textContent = JSON.stringify(res.output, null, 2);
  el.trace.textContent = JSON.stringify({ meta: res.meta, trace: res.trace }, null, 2);
  setStatus(`OK • regole=${res.meta.rules} • attivate=${res.meta.fired} • ${res.meta.ms}ms`, true);
});

el.validate.addEventListener("click", () => {
  const parsed = parseBoth(false);
  if (!parsed) return;
  setStatus("JSON valido ✅", true);
});

el.presetSelect.addEventListener("change", () => {
  loadPresetIntoEditors(el.presetSelect.value);
});

el.savePreset.addEventListener("click", () => {
  const name = prompt("Nome preset:", el.presetSelect.value || "Nuovo preset");
  if (!name) return;
  const parsed = parseBoth(false);
  if (!parsed) return;

  presets[name] = {
    ruleset: parsed.ruleset,
    input: parsed.input,
    updatedAt: new Date().toISOString(),
  };
  savePresets(presets);
  renderPresetSelect(name);
  setStatus(`Preset salvato: ${name}`, true);
});

el.deletePreset.addEventListener("click", () => {
  const name = el.presetSelect.value;
  if (!name) return;
  if (name === "Esempio") return alert("Non puoi eliminare il preset Esempio.");
  if (!confirm(`Eliminare preset "${name}"?`)) return;
  delete presets[name];
  savePresets(presets);
  renderPresetSelect("Esempio");
  loadPresetIntoEditors("Esempio");
  setStatus(`Preset eliminato: ${name}`, true);
});

// init editor values
if (!presets["Esempio"]) {
  presets["Esempio"] = { ruleset: DEFAULT_RULESET, input: DEFAULT_INPUT, updatedAt: new Date().toISOString() };
  savePresets(presets);
}
el.ruleset.value = JSON.stringify(presets["Esempio"].ruleset, null, 2);
el.input.value = JSON.stringify(presets["Esempio"].input, null, 2);

function $(q){ return document.querySelector(q); }

function parseJSON(text, label) {
  try {
    return JSON.parse(text);
  } catch (e) {
    setStatus(`Errore JSON in ${label}: ${e.message}`, false);
    return null;
  }
}

function parseBoth(showOutput = true) {
  const ruleset = parseJSON(el.ruleset.value, "Ruleset");
  if (!ruleset) return null;
  const input = parseJSON(el.input.value, "Input");
  if (!input) return null;

  if (showOutput) {
    el.output.textContent = "";
    el.trace.textContent = "";
  }
  return { ruleset, input };
}

function setStatus(msg, ok) {
  el.status.textContent = msg;
  el.status.className = ok ? "small ok" : "small error";
}

function loadPresets(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function savePresets(obj){
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

function ensureDefaultPreset(p){
  if (!p["Esempio"]) {
    p["Esempio"] = { ruleset: DEFAULT_RULESET, input: DEFAULT_INPUT, updatedAt: new Date().toISOString() };
    savePresets(p);
  }
}

function renderPresetSelect(selectName){
  const names = Object.keys(presets).sort((a,b)=> a.localeCompare(b));
  el.presetSelect.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  el.presetSelect.value = selectName && presets[selectName] ? selectName : (presets["Esempio"] ? "Esempio" : names[0] || "");
}

function loadPresetIntoEditors(name){
  const p = presets[name];
  if (!p) return;
  el.ruleset.value = JSON.stringify(p.ruleset, null, 2);
  el.input.value = JSON.stringify(p.input, null, 2);
  el.output.textContent = "";
  el.trace.textContent = "";
  setStatus(`Preset caricato: ${name}`, true);
}

function escapeHtml(s){
  return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
