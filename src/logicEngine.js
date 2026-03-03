// Mini Rule Engine: valuta regole JSON su un input JSON e produce output + trace.
// Regole supportate:
// - all / any: array di condizioni (AND/OR)
// - not: condizione negata
// - condition semplice: { fact:"path.a.b", op:"eq|neq|gt|gte|lt|lte|includes|in|exists|regex", value:any }
// Azioni supportate:
// - set: { type:"set", path:"result.flag", value:true }
// - push: { type:"push", path:"result.messages", value:"..." }
// - inc: { type:"inc", path:"result.score", value: 10 }

export function evaluateRuleset(ruleset, input) {
  const start = Date.now();
  const trace = [];
  const out = deepClone(input ?? {});
  if (!out.result) out.result = {};

  const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
  let fired = 0;

  for (const rule of rules) {
    const when = rule?.when ?? { all: [] };
    const matched = evalExpr(when, out, trace, `rule:${rule?.id ?? "?"}`);
    if (matched) {
      fired++;
      trace.push({ type: "rule-fired", id: rule?.id ?? null, name: rule?.name ?? null });
      applyActions(rule?.then ?? [], out, trace, `rule:${rule?.id ?? "?"}`);
    } else {
      trace.push({ type: "rule-skipped", id: rule?.id ?? null, name: rule?.name ?? null });
    }
  }

  return {
    ok: true,
    meta: { rules: rules.length, fired, ms: Date.now() - start },
    output: out,
    trace,
  };
}

function evalExpr(expr, ctx, trace, scope) {
  if (!expr || typeof expr !== "object") return false;

  if (Array.isArray(expr.all)) {
    const res = expr.all.every((e, idx) => evalExpr(e, ctx, trace, `${scope}/all[${idx}]`));
    trace.push({ type: "eval", scope, op: "all", result: res });
    return res;
  }
  if (Array.isArray(expr.any)) {
    const res = expr.any.some((e, idx) => evalExpr(e, ctx, trace, `${scope}/any[${idx}]`));
    trace.push({ type: "eval", scope, op: "any", result: res });
    return res;
  }
  if (expr.not) {
    const res = !evalExpr(expr.not, ctx, trace, `${scope}/not`);
    trace.push({ type: "eval", scope, op: "not", result: res });
    return res;
  }

  // condizione semplice
  const factPath = expr.fact;
  const op = expr.op;
  const val = expr.value;

  const fact = getPath(ctx, factPath);
  const res = evalCond(fact, op, val);
  trace.push({ type: "cond", scope, fact: factPath, op, value: val, factValue: fact, result: res });
  return res;
}

function evalCond(fact, op, value) {
  switch (op) {
    case "eq": return fact === value;
    case "neq": return fact !== value;
    case "gt": return typeof fact === "number" && fact > value;
    case "gte": return typeof fact === "number" && fact >= value;
    case "lt": return typeof fact === "number" && fact < value;
    case "lte": return typeof fact === "number" && fact <= value;
    case "includes":
      return (typeof fact === "string" && String(fact).includes(String(value))) ||
             (Array.isArray(fact) && fact.includes(value));
    case "in":
      return Array.isArray(value) && value.includes(fact);
    case "exists":
      return fact !== undefined && fact !== null;
    case "regex":
      try {
        const re = new RegExp(String(value));
        return typeof fact === "string" && re.test(fact);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function applyActions(actions, ctx, trace, scope) {
  const arr = Array.isArray(actions) ? actions : [];
  for (const [i, a] of arr.entries()) {
    const type = a?.type;
    const path = a?.path;
    const value = a?.value;

    if (!type || !path) {
      trace.push({ type: "action-error", scope, index: i, error: "Missing type/path" });
      continue;
    }

    if (type === "set") {
      setPath(ctx, path, value);
      trace.push({ type: "action", scope, action: "set", path, value });
    } else if (type === "push") {
      const cur = getPath(ctx, path);
      const next = Array.isArray(cur) ? cur : [];
      next.push(value);
      setPath(ctx, path, next);
      trace.push({ type: "action", scope, action: "push", path, value });
    } else if (type === "inc") {
      const cur = getPath(ctx, path);
      const base = typeof cur === "number" ? cur : 0;
      const delta = typeof value === "number" ? value : 1;
      setPath(ctx, path, base + delta);
      trace.push({ type: "action", scope, action: "inc", path, value: delta });
    } else {
      trace.push({ type: "action-error", scope, index: i, error: `Unknown action: ${type}` });
    }
  }
}

function getPath(obj, path) {
  if (!path || typeof path !== "string") return undefined;
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function deepClone(x) {
  return x == null ? x : JSON.parse(JSON.stringify(x));
}
