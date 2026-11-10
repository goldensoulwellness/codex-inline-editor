// One story picture, from the private store. GET ?path=pics/<id>/<file>.jpg with the x-key header.
import { get } from "@vercel/blob";
import { keyOk } from "../lib/store.js";

export default async function handler(req, res) {
  if (!keyOk(req)) return res.status(401).json({ error: "locked" });
  const path = String(req.query.path || "");
  if (!/^pics\/[\w.:-]{1,200}\/[\w.-]{1,80}\.jpg$/.test(path)) return res.status(400).json({ error: "bad path" });
  const found = await get(path, { access: "private" });
  if (!found) return res.status(404).json({ error: "missing" });
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable"); // each picture's path never changes
  const buf = Buffer.from(await new Response(found.stream).arrayBuffer());
  return res.status(200).send(buf);
}
