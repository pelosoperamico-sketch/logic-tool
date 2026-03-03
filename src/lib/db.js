const DB_NAME = "magazzino_db";
const DB_VER = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;

      // products: {id, sku, name, uom, createdAt}
      const products = db.createObjectStore("products", { keyPath: "id" });
      products.createIndex("by_sku", "sku", { unique: true });
      products.createIndex("by_name", "name", { unique: false });

      // warehouses: {id, code, name, createdAt}
      const warehouses = db.createObjectStore("warehouses", { keyPath: "id" });
      warehouses.createIndex("by_code", "code", { unique: true });

      // movements: {id, type, at, reason, lines:[...], reversedBy?, reverses?}
      // line: {productId, qty, fromWhId?, toWhId?, whId?}
      const movements = db.createObjectStore("movements", { keyPath: "id" });
      movements.createIndex("by_at", "at", { unique: false });
      movements.createIndex("by_type", "type", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const p = fn(store);
    t.oncomplete = () => resolve(p);
    t.onerror = () => reject(t.error);
  });
}

export async function getAll(storeName) {
  return tx(storeName, "readonly", (s) => new Promise((res, rej) => {
    const r = s.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  }));
}

export async function put(storeName, value) {
  return tx(storeName, "readwrite", (s) => new Promise((res, rej) => {
    const r = s.put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

export async function del(storeName, key) {
  return tx(storeName, "readwrite", (s) => new Promise((res, rej) => {
    const r = s.delete(key);
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
  }));
}

export async function clear(storeName) {
  return tx(storeName, "readwrite", (s) => new Promise((res, rej) => {
    const r = s.clear();
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
  }));
}

export async function getByIndex(storeName, indexName, key) {
  return tx(storeName, "readonly", (s) => new Promise((res, rej) => {
    const idx = s.index(indexName);
    const r = idx.get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => rej(r.error);
  }));
}

export async function exportAll() {
  const [products, warehouses, movements] = await Promise.all([
    getAll("products"),
    getAll("warehouses"),
    getAll("movements"),
  ]);
  return { version: 1, exportedAt: new Date().toISOString(), products, warehouses, movements };
}

export async function importAll(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Payload non valido");
  if (!Array.isArray(payload.products) || !Array.isArray(payload.warehouses) || !Array.isArray(payload.movements)) {
    throw new Error("Payload incompleto (products/warehouses/movements)");
  }

  // Simple restore: wipe then insert
  await Promise.all([clear("products"), clear("warehouses"), clear("movements")]);
  for (const p of payload.products) await put("products", p);
  for (const w of payload.warehouses) await put("warehouses", w);
  for (const m of payload.movements) await put("movements", m);
}
