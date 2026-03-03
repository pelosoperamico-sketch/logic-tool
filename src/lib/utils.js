export function uid(prefix = "id") {
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(16)}_${rnd}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function toNumber(x, fallback = 0) {
  const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("it-IT"); } catch { return String(iso ?? ""); }
}

export function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function pickFileText(accept = ".json,application/json") {
  return new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = async () => {
      try {
        const file = inp.files?.[0];
        if (!file) return resolve(null);
        const text = await file.text();
        resolve(text);
      } catch (e) {
        reject(e);
      }
    };
    inp.click();
  });
}
