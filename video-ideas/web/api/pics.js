// Story pictures for one video idea (Instagram story size, 1080x1920).
// The page asks for them; Claude plans one picture per beat of the video; the Mac worker
// (mac-worker/worker.mjs) makes each picture with Codex on Michael's ChatGPT plan and uploads it here.
//
// POST {id, action: "request"}           page: plan the pictures and queue them
// POST {id, action: "clear"}             page: forget the set (so it can be made again)
// GET  ?pending=1                        worker: ideas waiting for pictures
// POST {id, action: "claim"}             worker: start making them
// POST {id, action: "upload", n, data}   worker: one finished picture (base64 JPEG)
// POST {id, action: "done" | "failed", error}
import Anthropic from "@anthropic-ai/sdk";
import { put } from "@vercel/blob";
import { keyOk, body, loadAll, updateIdea, okId } from "../lib/store.js";

const client = new Anthropic();
const STALE_MS = 40 * 60 * 1000; // a claimed set that never finished goes back in line

const PLAN_SYSTEM = `You plan the background pictures for one short vertical video (Instagram story / Reel size, 9:16).
Michael films himself talking about a true past-life or afterlife story from a book. The pictures appear behind or between his talking shots, one for each beat of the story.

Plan 6 to 9 pictures, in the order they appear in the video: the opening hook, then one per talking point, then a calm closing picture.
For each picture write:
- label: 2 to 5 plain words saying which beat it is for (for example "Hook: the arrow", "Point 3: leaving the body").
- prompt: a full image description for an image generator.

Rules for every prompt:
- One consistent look for the whole set: cinematic film still, photorealistic, soft natural light, muted warm colors, gentle mood. Say this in every prompt.
- Vertical 9:16 framing with the main subject in the center third, so the sides can be trimmed.
- Show the story: the people, places and moments from it, with historically right clothes and settings. Spiritual moments (leaving the body, light, the spirit world) look soft and luminous, not scary or gory.
- No text, letters, numbers, captions, logos or watermarks in the picture.
- No real famous people's faces. Ordinary people only.`;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    pictures: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, prompt: { type: "string" } },
        required: ["label", "prompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["pictures"],
  additionalProperties: false,
};

async function plan(it) {
  const idea = [
    `Title: ${it.title}`, `Summary: ${it.desc}`, `Book: ${it.book} by ${it.author}`,
    "Hooks:\n" + (it.hooks || []).filter(Boolean).map((h, i) => `${i + 1}. ${h}`).join("\n"),
    "Talking points:\n" + (it.points || []).filter(Boolean).map((p, i) => `${i + 1}. ${p}`).join("\n"),
    it.notes ? `Notes: ${it.notes}` : "",
  ].filter(Boolean).join("\n");
  const msg = await client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: PLAN_SCHEMA } },
    system: PLAN_SYSTEM,
    messages: [{ role: "user", content: idea }],
  }).finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("refused");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const pictures = JSON.parse(text).pictures.slice(0, 10);
  if (!pictures.length) throw new Error("empty plan");
  return pictures.map((p) => ({ label: String(p.label).slice(0, 80), prompt: String(p.prompt).slice(0, 3000) }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!keyOk(req)) return res.status(401).json({ error: "locked" });

  if (req.method === "GET") {
    const { rows } = await loadAll();
    const now = Date.now();
    const waiting = rows.filter((r) => r.pics && (r.pics.status === "queued" ||
      (r.pics.status === "making" && now - Date.parse(r.pics.claimedAt || 0) > STALE_MS)));
    return res.status(200).json(waiting.map((r) => ({ id: r.id, title: r.title, pics: r.pics })));
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const b = body(req);
  const { id, action } = b;
  if (!okId(id)) return res.status(400).json({ error: "bad request" });
  const now = new Date().toISOString();

  if (action === "request") {
    const { rows } = await loadAll();
    const idea = rows.find((r) => r.id === id);
    if (!idea) return res.status(404).json({ error: "no such idea" });
    if (idea.pics && ["planning", "queued", "making"].includes(idea.pics.status)) return res.status(200).json({ pics: idea.pics });
    await updateIdea(id, (r) => ({ ...r, pics: { status: "planning", requestedAt: now } }));
    try {
      const items = await plan(idea);
      const pics = { status: "queued", requestedAt: now, items };
      await updateIdea(id, (r) => ({ ...r, pics }));
      return res.status(200).json({ pics });
    } catch (err) {
      console.error("plan failed", err?.status || "", err?.message || err);
      const pics = { status: "failed", requestedAt: now, error: "Couldn't plan the pictures. Try again." };
      await updateIdea(id, (r) => ({ ...r, pics }));
      return res.status(200).json({ pics });
    }
  }

  if (action === "clear") {
    await updateIdea(id, (r) => { const { pics, ...rest } = r; return rest; });
    return res.status(200).json({ ok: true });
  }

  if (action === "claim") {
    const next = await updateIdea(id, (r) => ({ ...r, pics: { ...r.pics, status: "making", claimedAt: now } }));
    return res.status(200).json({ pics: next.find((r) => r.id === id)?.pics });
  }

  if (action === "upload") {
    const n = Number(b.n);
    const data = Buffer.from(String(b.data || ""), "base64");
    if (!Number.isInteger(n) || n < 0 || n > 20 || data.length < 1000 || data.length > 4_000_000) return res.status(400).json({ error: "bad picture" });
    const path = `pics/${id}/${String(n + 1).padStart(2, "0")}-${Date.now().toString(36)}.jpg`;
    await put(path, data, { access: "private", contentType: "image/jpeg", addRandomSuffix: false });
    await updateIdea(id, (r) => {
      const items = (r.pics?.items || []).map((x, i) => (i === n ? { ...x, path } : x));
      return { ...r, pics: { ...r.pics, items } };
    });
    return res.status(200).json({ path });
  }

  if (action === "done" || action === "failed") {
    await updateIdea(id, (r) => ({ ...r, pics: { ...r.pics, status: action,
      ...(action === "done" ? { doneAt: now } : { error: String(b.error || "Couldn't make the pictures.").slice(0, 300) }) } }));
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "bad action" });
}
