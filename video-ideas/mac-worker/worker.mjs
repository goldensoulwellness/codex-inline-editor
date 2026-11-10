#!/usr/bin/env node
// Soul Videos picture maker (runs on Michael's Mac as LaunchAgent com.michael.soulvideos).
// Every 45 seconds it asks the site for ideas whose "Make story pictures" button was tapped,
// makes each planned picture with Codex on Michael's ChatGPT plan (never a paid image API),
// trims it to Instagram story size (1080x1920), keeps a copy in ~/Pictures/Claude Images/Soul Videos,
// and uploads it so the iPhone app can save it to Photos.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const HOME = homedir();
const BASE = "https://video-ideas-delta.vercel.app";
const KEY = readFileSync(join(HOME, ".config/video-ideas/key"), "utf8").trim();
const MAKE_IMAGE = join(HOME, ".claude/skills/make-image/scripts/make_image_codex.py");
const OUT_ROOT = join(HOME, "Pictures/Claude Images/Soul Videos");
const POLL_MS = 45_000;
const AT_ONCE = 3;

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function api(method, path, payload) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "x-key": KEY, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}`);
  return r.json();
}

async function size(file) {
  const { stdout } = await run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  return { w: Number(/pixelWidth: (\d+)/.exec(stdout)[1]), h: Number(/pixelHeight: (\d+)/.exec(stdout)[1]) };
}

// Center-crop to 9:16, then scale to 1080x1920 JPEG.
async function toStory(src, dest) {
  const { w, h } = await size(src);
  const cropW = Math.min(w, Math.round((h * 9) / 16));
  const cropH = Math.min(h, Math.round((cropW * 16) / 9));
  const tmp = dest + ".tmp.png";
  copyFileSync(src, tmp);
  await run("/usr/bin/sips", ["-c", String(cropH), String(cropW), tmp]);
  await run("/usr/bin/sips", ["-z", "1920", "1080", "-s", "format", "jpeg", "-s", "formatOptions", "88", tmp, "--out", dest]);
  rmSync(tmp, { force: true });
}

async function makeOne(idea, n, item, folder) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { stdout } = await run("/usr/bin/python3", [MAKE_IMAGE, item.prompt, "--shape", "tall",
        "--name", `soul-video-${idea.id.slice(0, 24)}-${n + 1}`], { timeout: 16 * 60_000, maxBuffer: 4 << 20 });
      const png = stdout.split("\n").map((s) => s.trim()).find((s) => /\.(png|jpe?g|webp)$/i.test(s) && existsSync(s));
      if (!png) throw new Error(stdout.trim().split("\n").pop() || "no picture");
      const safe = (item.label || `Picture ${n + 1}`).replace(/[^\w ,'-]+/g, "").slice(0, 50);
      const dest = join(folder, `${String(n + 1).padStart(2, "0")} ${safe}.jpg`);
      await toStory(png, dest);
      const data = readFileSync(dest).toString("base64");
      await api("POST", "/api/pics", { id: idea.id, action: "upload", n, data });
      log("made", idea.id, n + 1);
      return true;
    } catch (err) {
      log("picture failed", idea.id, n + 1, "try", attempt, String(err.message || err).slice(0, 300));
      if (/limit|NOT_LOGGED_IN|NO_CODEX/i.test(String(err.message))) return false;
    }
  }
  return false;
}

async function makeSet(idea) {
  const { pics } = await api("POST", "/api/pics", { id: idea.id, action: "claim" });
  const items = pics?.items || [];
  const folder = join(OUT_ROOT, (idea.title || idea.id).replace(/[^\w ,'-]+/g, "").slice(0, 60));
  mkdirSync(folder, { recursive: true });
  log("making", items.length, "pictures for", idea.id);
  const todo = items.map((item, n) => ({ item, n })).filter((x) => !x.item.path);
  let made = items.length - todo.length;
  let next = 0;
  const workers = Array.from({ length: AT_ONCE }, async () => {
    while (next < todo.length) {
      const { item, n } = todo[next++];
      if (await makeOne(idea, n, item, folder)) made++;
    }
  });
  await Promise.all(workers);
  if (made > 0) await api("POST", "/api/pics", { id: idea.id, action: "done" });
  else await api("POST", "/api/pics", { id: idea.id, action: "failed", error: "Codex couldn't make the pictures. It may be out of picture credits for now. Try again later." });
  log("finished", idea.id, `${made}/${items.length}`);
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const waiting = await api("GET", "/api/pics?pending=1");
    for (const idea of waiting) await makeSet(idea);
  } catch (err) {
    log("check failed", String(err.message || err).slice(0, 200));
  } finally {
    busy = false;
  }
}

log("Soul Videos picture maker started");
tick();
setInterval(tick, POLL_MS);
