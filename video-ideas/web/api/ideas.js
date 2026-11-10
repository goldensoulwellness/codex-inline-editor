// Video Ideas storage.
// GET  -> the list (array of ideas)
// POST {op: "create"|"update"|"remove", id, data} -> applies one change
// Every request needs the private key in the "x-key" header.
import { keyOk, body, loadAll, mutate, okId } from "../lib/store.js";

const MAX_BODY = 200_000;

function apply(rows, op, id, data) {
  if (op === "create") {
    if (rows.some((r) => r.id === id)) return rows;
    return rows.concat([{ ...data, id }]);
  }
  if (op === "update") return rows.map((r) => (r.id === id ? { ...r, ...data, id } : r));
  if (op === "remove") return rows.filter((r) => r.id !== id);
  throw new Error("bad op");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!keyOk(req)) return res.status(401).json({ error: "locked" });

  if (req.method === "GET") {
    const { rows } = await loadAll();
    return res.status(200).json(rows);
  }

  if (req.method === "POST") {
    const { op, id, data } = body(req);
    if (!["create", "update", "remove"].includes(op) || !okId(id)) return res.status(400).json({ error: "bad request" });
    if (JSON.stringify(data || {}).length > MAX_BODY) return res.status(413).json({ error: "too big" });
    // Questions and pictures are written only by their own endpoints.
    const clean = { ...(data || {}) };
    delete clean.qa;
    delete clean.pics;
    await mutate((rows) => apply(rows, op, id, clean));
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method" });
}
