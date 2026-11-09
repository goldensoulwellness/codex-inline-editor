// Video Ideas storage: one private Vercel Blob file holding the whole list.
// GET  -> the list (array of ideas)
// POST {op: "create"|"update"|"remove", id, data} -> applies one change
// Every request needs the private key in the "x-key" header.
import { get, put } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";

const PATH = "ideas.json";
const MAX_BODY = 200_000;

function keyOk(req) {
  const want = process.env.VIDEO_IDEAS_KEY || "";
  const got = String(req.headers["x-key"] || "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function load() {
  const res = await get(PATH, { access: "private", useCache: false });
  if (!res) return { rows: [], etag: null };
  const text = await new Response(res.stream).text();
  // get() returns a weak ETag ("W/...") that ifMatch rejects; writes need the strong one.
  return { rows: JSON.parse(text || "[]"), etag: String(res.blob.etag || "").replace(/^W\//, "") || null };
}

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
    const { rows } = await load();
    return res.status(200).json(rows);
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { op, id, data } = body;
    if (!["create", "update", "remove"].includes(op) || typeof id !== "string" || !/^[\w.:-]{1,200}$/.test(id)) {
      return res.status(400).json({ error: "bad request" });
    }
    if (JSON.stringify(data || {}).length > MAX_BODY) return res.status(413).json({ error: "too big" });

    // Read, change, write only if nobody else wrote in between; retry a few times.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { rows, etag } = await load();
      const next = apply(rows, op, id, data || {});
      try {
        await put(PATH, JSON.stringify(next), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          ...(etag ? { ifMatch: etag } : {}),
        });
        return res.status(200).json({ ok: true });
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
      }
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method" });
}
