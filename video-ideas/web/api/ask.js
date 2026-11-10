// Ask Claude a question about one video idea. The answer is saved under the idea (idea.qa) and stays there.
// POST {id, question}       -> asks, saves, returns {item}
// POST {id, remove: qaId}   -> deletes one saved question and answer
// Uses Michael's own Anthropic key, and his Soul Knowledge books through the Solia MCP server.
import Anthropic from "@anthropic-ai/sdk";
import { keyOk, body, loadAll, updateIdea, okId } from "../lib/store.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY from the Vercel project
const MODEL = "claude-opus-5-5";

const SYSTEM = `You help Michael Armstrong research short videos for his spiritual Instagram and YouTube channels about past lives, souls and the afterlife.
He is looking at one video idea from his own library and asks you a question about it.

How to answer:
- Check the facts in his Soul Knowledge books with the soul_knowledge tools (search the books, read the passage) before you answer. Prefer the exact book and passage the idea comes from.
- Say which book and page your facts come from, briefly, like "(Journey of Souls, p. 9)".
- If the books do not cover something, say so plainly instead of guessing.
- Write in plain, simple words, like talking to a friend. Short sentences. No jargon.
- Keep it short: about 80 to 200 words, unless he asks for more (for example a full script).
- Plain text only. You may use short "- " bullet lines. No headings, no bold, no tables.`;

function ideaText(it) {
  const lines = [
    `Title: ${it.title || ""}`,
    `Summary: ${it.desc || ""}`,
    `Book: ${it.book || ""}${it.author ? " by " + it.author : ""}${it.loc ? " (" + it.loc + ")" : ""}`,
    it.series ? `Series: ${it.series}` : "",
    (it.hooks || []).filter(Boolean).length ? "Hooks:\n" + it.hooks.filter(Boolean).map((h, i) => `${i + 1}. ${h}`).join("\n") : "",
    (it.points || []).filter(Boolean).length ? "Talking points:\n" + it.points.filter(Boolean).map((p) => `- ${p}`).join("\n") : "",
    it.notes ? `Michael's notes: ${it.notes}` : "",
  ];
  const past = (it.qa || []).filter((x) => x.status === "done").slice(-4);
  if (past.length) lines.push("Earlier questions about this idea:\n" + past.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n"));
  return lines.filter(Boolean).join("\n");
}

async function askClaude(it, question) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["mcp-client-2025-11-20", "server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    mcp_servers: [{ type: "url", url: process.env.SOUL_KNOWLEDGE_MCP_URL, name: "soul_knowledge" }],
    tools: [{ type: "mcp_toolset", mcp_server_name: "soul_knowledge" }],
    messages: [{ role: "user", content: `${ideaText(it)}\n\nMichael's question: ${question}` }],
  };
  let msg;
  // Server-side tool runs can pause; continue a few times with the same conversation.
  for (let turn = 0; turn < 4; turn++) {
    msg = await client.beta.messages.stream(params).finalMessage();
    if (msg.stop_reason !== "pause_turn") break;
    params.messages = [...params.messages, { role: "assistant", content: msg.content }];
  }
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to answer that one.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("No answer came back.");
  return { text, usage: msg.usage };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!keyOk(req)) return res.status(401).json({ error: "locked" });
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const { id, question, remove } = body(req);
  if (!okId(id)) return res.status(400).json({ error: "bad request" });

  if (remove) {
    await updateIdea(id, (r) => ({ ...r, qa: (r.qa || []).filter((x) => x.id !== remove) }));
    return res.status(200).json({ ok: true });
  }

  const q = String(question || "").trim().slice(0, 2000);
  if (!q) return res.status(400).json({ error: "empty question" });
  const { rows } = await loadAll();
  const idea = rows.find((r) => r.id === id);
  if (!idea) return res.status(404).json({ error: "no such idea" });

  // Save the question first so it shows as "thinking" even if the page is closed.
  const item = { id: "qa-" + Date.now().toString(36), q, status: "thinking", at: new Date().toISOString() };
  await updateIdea(id, (r) => ({ ...r, qa: [...(r.qa || []), item] }));

  let done;
  try {
    const { text, usage } = await askClaude(idea, q);
    done = { ...item, status: "done", a: text, answeredAt: new Date().toISOString(),
      tokens: { in: usage?.input_tokens || 0, out: usage?.output_tokens || 0 } };
  } catch (err) {
    console.error("ask failed", err?.status || "", err?.message || err);
    done = { ...item, status: "error", a: "Couldn't get an answer. Tap Try again." };
  }
  await updateIdea(id, (r) => ({ ...r, qa: (r.qa || []).map((x) => (x.id === item.id ? done : x)) }));
  return res.status(200).json({ item: done });
}
