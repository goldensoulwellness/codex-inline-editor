// Shared storage helpers: the whole list is one private Vercel Blob file (ideas.json).
import { get, put } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";

const PATH = "ideas.json";

export function keyOk(req) {
  const want = process.env.VIDEO_IDEAS_KEY || "";
  const got = String(req.headers["x-key"] || "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function body(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
}

export async function loadAll() {
  const res = await get(PATH, { access: "private", useCache: false });
  if (!res) return { rows: [], etag: null };
  const text = await new Response(res.stream).text();
  // get() returns a weak ETag ("W/...") that ifMatch rejects; writes need the strong one.
  return { rows: JSON.parse(text || "[]"), etag: String(res.blob.etag || "").replace(/^W\//, "") || null };
}

// Read the latest list, change it, and write it only if nobody else wrote in between.
export async function mutate(change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows, etag } = await loadAll();
    const next = change(rows);
    try {
      await put(PATH, JSON.stringify(next), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : {}),
      });
      return next;
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

export function updateIdea(id, change) {
  return mutate((rows) => rows.map((r) => (r.id === id ? { ...change(r), id } : r)));
}

export function okId(id) {
  return typeof id === "string" && /^[\w.:-]{1,200}$/.test(id);
}
