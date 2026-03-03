import { uid, nowIso, toNumber } from "./utils.js";
import * as db from "./db.js";

export const MovementType = {
  IN: "IN",          // carico su un magazzino
  OUT: "OUT",        // scarico da un magazzino
  TRANSFER: "XFER",  // trasferimento tra magazzini
  ADJUST: "ADJ",     // rettifica su un magazzino (qty può essere + o -)
  REVERSAL: "REV",   // storno automatico (generato dall'app)
};

export async function seedIfEmpty() {
  const [products, warehouses] = await Promise.all([db.getAll("products"), db.getAll("warehouses")]);
  if (products.length === 0) {
    await createProduct({ sku: "SKU-001", name: "Prodotto Demo", uom: "PZ" });
  }
  if (warehouses.length === 0) {
    await createWarehouse({ code: "WH-A", name: "Magazzino A" });
    await createWarehouse({ code: "WH-B", name: "Magazzino B" });
  }
}

export async function createProduct({ sku, name, uom }) {
  sku = String(sku ?? "").trim();
  name = String(name ?? "").trim();
  uom = String(uom ?? "PZ").trim();
  if (!sku) throw new Error("SKU obbligatorio");
  if (!name) throw new Error("Nome obbligatorio");

  const existing = await db.getByIndex("products", "by_sku", sku);
  if (existing) throw new Error(`SKU già esistente: ${sku}`);

  const p = { id: uid("prod"), sku, name, uom, createdAt: nowIso() };
  await db.put("products", p);
  return p;
}

export async function createWarehouse({ code, name }) {
  code = String(code ?? "").trim().toUpperCase();
  name = String(name ?? "").trim();
  if (!code) throw new Error("Codice magazzino obbligatorio");
  if (!name) throw new Error("Nome magazzino obbligatorio");

  const existing = await db.getByIndex("warehouses", "by_code", code);
  if (existing) throw new Error(`Codice già esistente: ${code}`);

  const w = { id: uid("wh"), code, name, createdAt: nowIso() };
  await db.put("warehouses", w);
  return w;
}

export async function listAll() {
  const [products, warehouses, movements] = await Promise.all([
    db.getAll("products"),
    db.getAll("warehouses"),
    db.getAll("movements"),
  ]);
  movements.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  products.sort((a, b) => a.sku.localeCompare(b.sku));
  warehouses.sort((a, b) => a.code.localeCompare(b.code));
  return { products, warehouses, movements };
}

export async function addMovement(mv) {
  // mv: {type, at?, reason?, lines:[...]}
  const type = mv?.type;
  const at = mv?.at ? String(mv.at) : nowIso();
  const reason = String(mv?.reason ?? "").trim();

  if (![MovementType.IN, MovementType.OUT, MovementType.TRANSFER, MovementType.ADJUST].includes(type)) {
    throw new Error("Tipo movimento non valido");
  }

  const lines = Array.isArray(mv?.lines) ? mv.lines : [];
  if (lines.length === 0) throw new Error("Almeno una riga movimento è obbligatoria");

  // Normalize & validate lines
  const normalized = lines.map((l) => ({
    productId: String(l.productId ?? ""),
    qty: toNumber(l.qty),
    whId: l.whId ? String(l.whId) : undefined,
    fromWhId: l.fromWhId ? String(l.fromWhId) : undefined,
    toWhId: l.toWhId ? String(l.toWhId) : undefined,
    note: String(l.note ?? "").trim(),
  }));

  for (const [i, l] of normalized.entries()) {
    if (!l.productId) throw new Error(`Riga ${i + 1}: prodotto mancante`);
    if (!Number.isFinite(l.qty) || l.qty === 0) throw new Error(`Riga ${i + 1}: quantità non valida (≠ 0)`);
    if (type === MovementType.IN || type === MovementType.OUT || type === MovementType.ADJUST) {
      if (!l.whId) throw new Error(`Riga ${i + 1}: magazzino mancante`);
      if (type !== MovementType.ADJUST && l.qty < 0) throw new Error(`Riga ${i + 1}: quantità deve essere positiva`);
    }
    if (type === MovementType.TRANSFER) {
      if (!l.fromWhId || !l.toWhId) throw new Error(`Riga ${i + 1}: magazzino origine/destinazione obbligatori`);
      if (l.fromWhId === l.toWhId) throw new Error(`Riga ${i + 1}: origine e destinazione uguali`);
      if (l.qty < 0) throw new Error(`Riga ${i + 1}: quantità deve essere positiva`);
    }
  }

  // Stock check (no negative stock) for OUT and TRANSFER
  const { products, warehouses, movements } = await listAll();
  const stock = computeStock({ movements, products, warehouses });

  if (type === MovementType.OUT) {
    for (const l of normalized) {
      const key = `${l.productId}::${l.whId}`;
      const onHand = stock.byProdWh.get(key) ?? 0;
      if (onHand - l.qty < 0) {
        throw new Error("Giacenza insufficiente per lo scarico (stock negativo non consentito)");
      }
    }
  }
  if (type === MovementType.TRANSFER) {
    for (const l of normalized) {
      const key = `${l.productId}::${l.fromWhId}`;
      const onHand = stock.byProdWh.get(key) ?? 0;
      if (onHand - l.qty < 0) {
        throw new Error("Giacenza insufficiente per il trasferimento (stock negativo non consentito)");
      }
    }
  }

  const rec = {
    id: uid("mv"),
    type,
    at,
    reason,
    lines: normalized,
    createdAt: nowIso(),
  };
  await db.put("movements", rec);
  return rec;
}

export function computeStock({ movements, products, warehouses }) {
  // Returns:
  // - byProdWh: Map("prodId::whId" -> qty)
  // - byProd: Map(prodId -> qtyTotal)
  // - byWh: Map(whId -> qtyTotal)  (sum of absolute across products is not meaningful; here is net qty across all products)
  const byProdWh = new Map();
  const byProd = new Map();
  const byWh = new Map();

  const applyDelta = (prodId, whId, delta) => {
    const key = `${prodId}::${whId}`;
    byProdWh.set(key, (byProdWh.get(key) ?? 0) + delta);
    byProd.set(prodId, (byProd.get(prodId) ?? 0) + delta);
    byWh.set(whId, (byWh.get(whId) ?? 0) + delta);
  };

  for (const mv of movements) {
    if (mv?.reversedBy) continue; // if reversed, ignore original
    const type = mv.type;
    for (const l of mv.lines || []) {
      const qty = toNumber(l.qty);
      if (!qty) continue;

      if (type === MovementType.IN) applyDelta(l.productId, l.whId, +qty);
      else if (type === MovementType.OUT) applyDelta(l.productId, l.whId, -qty);
      else if (type === MovementType.ADJUST) applyDelta(l.productId, l.whId, +qty);
      else if (type === MovementType.TRANSFER) {
        applyDelta(l.productId, l.fromWhId, -qty);
        applyDelta(l.productId, l.toWhId, +qty);
      } else if (type === MovementType.REVERSAL) {
        // REV stores already inverted deltas in lines (we store as ADJ-like for simplicity)
        // But we will encode REV as explicit effect using same structure:
        // - IN: qty negative, OUT qty positive, XFER swaps.
        // We'll just treat it with mv.meta.originalType if present? To keep simple, we don't compute special here.
      }
    }
  }

  // ensure missing keys for UI can be treated as 0
  return { byProdWh, byProd, byWh };
}

export async function reverseMovement(movementId) {
  const movements = await db.getAll("movements");
  const mv = movements.find((m) => m.id === movementId);
  if (!mv) throw new Error("Movimento non trovato");
  if (mv.reversedBy) throw new Error("Movimento già stornato");
  if (mv.type === MovementType.REVERSAL) throw new Error("Non puoi stornare uno storno");

  // Create reversal movement that cancels the effects
  const revLines = (mv.lines || []).map((l) => {
    const qty = toNumber(l.qty);
    if (mv.type === MovementType.IN) return { productId: l.productId, qty: -qty, whId: l.whId, note: `Storno IN ${mv.id}` };
    if (mv.type === MovementType.OUT) return { productId: l.productId, qty: +qty, whId: l.whId, note: `Storno OUT ${mv.id}` };
    if (mv.type === MovementType.ADJUST) return { productId: l.productId, qty: -qty, whId: l.whId, note: `Storno ADJ ${mv.id}` };
    if (mv.type === MovementType.TRANSFER) {
      return { productId: l.productId, qty: +qty, fromWhId: l.toWhId, toWhId: l.fromWhId, note: `Storno XFER ${mv.id}` };
    }
    return l;
  });

  // For transfer reversal, we still use type TRANSFER and qty positive
  const revType = mv.type === MovementType.TRANSFER ? MovementType.TRANSFER : MovementType.ADJUST;

  const rev = await addMovement({
    type: revType,
    at: nowIso(),
    reason: `STORNO di ${mv.id}`,
    lines: revLines.map((l) => {
      if (revType === MovementType.TRANSFER) {
        return { productId: l.productId, qty: Math.abs(toNumber(l.qty)), fromWhId: l.fromWhId, toWhId: l.toWhId, note: l.note };
      }
      return { productId: l.productId, qty: toNumber(l.qty), whId: l.whId, note: l.note };
    }),
  });

  // Mark original as reversed
  mv.reversedBy = rev.id;
  await db.put("movements", mv);

  // Mark reversal record as reverses
  rev.reverses = mv.id;
  await db.put("movements", rev);

  return rev;
}

export async function deleteProduct(productId) {
  const movements = await db.getAll("movements");
  const used = movements.some((m) => (m.lines || []).some((l) => l.productId === productId));
  if (used) throw new Error("Impossibile eliminare: prodotto usato nei movimenti");
  await db.del("products", productId);
}

export async function deleteWarehouse(whId) {
  const movements = await db.getAll("movements");
  const used = movements.some((m) => (m.lines || []).some((l) => l.whId === whId || l.fromWhId === whId || l.toWhId === whId));
  if (used) throw new Error("Impossibile eliminare: magazzino usato nei movimenti");
  await db.del("warehouses", whId);
}
