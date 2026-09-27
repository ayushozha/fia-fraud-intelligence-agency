import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SponsorId, SponsorState } from "../packages/contracts/types.ts";
import { gbrainBin } from "./gbrain/knowledge-store.ts";

export type Probe = { id: SponsorId; name: string; role: string; state: SponsorState; detail: string };

function run(cmd: string, args: string[], timeoutMs = 8000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, env: { ...process.env, CI: "1" } }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}`.trim() });
    });
  });
}

function onPath(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = join(dir, bin);
    if (dir && existsSync(p)) return p;
  }
  return null;
}

async function gbrain(): Promise<Probe> {
  const base = { id: "gbrain" as const, name: "GBrain", role: "Private memory" };
  const bin = gbrainBin();
  if (!bin) return { ...base, state: "not_installed", detail: "No local gbrain CLI on PATH. Each workspace needs its own local, keyless brain." };
  const r = await run(bin, ["--version"]);
  return r.code === 0 ? { ...base, state: "ready", detail: `Local CLI ${r.out.split("\n")[0]}` } : { ...base, state: "unreachable", detail: r.out.slice(0, 200) };
}

async function memorable(): Promise<Probe> {
  const base = { id: "memorable" as const, name: "Memorable", role: "Procedure learning" };
  return process.env.MEMORABLE_API_KEY
    ? { ...base, state: "ready", detail: "API key configured for POST /v1/extract." }
    : { ...base, state: "needs_auth", detail: "MEMORABLE_API_KEY not set." };
}

async function qm(): Promise<Probe> {
  const base = { id: "qm" as const, name: "QM", role: "Evaluation" };
  const url = process.env.QM_CORE_URL ?? "http://localhost:8081";
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? { ...base, state: "ready", detail: `QM core healthy at ${url}. FIA evaluation board not yet wired.` } : { ...base, state: "unreachable", detail: `QM core at ${url} returned ${res.status}.` };
  } catch {
    return { ...base, state: "unreachable", detail: `QM core not reachable at ${url}.` };
  }
}

async function river(): Promise<Probe> {
  const base = { id: "river" as const, name: "River", role: "Model training" };
  return process.env.RIVER_API_KEY
    ? { ...base, state: "ready", detail: "API key configured." }
    : { ...base, state: "needs_auth", detail: "RIVER_API_KEY not set." };
}

async function ufo(): Promise<Probe> {
  const base = { id: "ufo" as const, name: "UFO", role: "Workflow" };
  const bin = onPath("ufo") ?? join(homedir(), ".ufo", "bin", "ufo");
  if (!existsSync(bin)) return { ...base, state: "not_installed", detail: "ufo client not installed." };
  const home = join(homedir(), ".ufo");
  const hasSession = existsSync(home) && readdirSync(home).some((f) => f !== "bin");
  return hasSession
    ? { ...base, state: "ready", detail: `Client at ${bin} with a stored session.` }
    : { ...base, state: "needs_auth", detail: "ufo client installed; run `ufo login`." };
}

async function superset(): Promise<Probe> {
  const base = { id: "superset" as const, name: "Superset", role: "Review" };
  const bin = process.env.SUPERSET_BIN ?? join(homedir(), ".superset", "bin", "superset");
  if (!existsSync(bin)) return { ...base, state: "not_installed", detail: "Superset CLI not found." };
  const r = await run(bin, ["auth", "whoami", "--json"]);
  if (r.code !== 0) return { ...base, state: "needs_auth", detail: "Superset CLI not logged in; run `superset auth login`." };
  return { ...base, state: "ready", detail: "Superset CLI authenticated; Pages publishing available." };
}

let cache: { at: number; value: Probe[] } | null = null;

export async function probeSponsors(maxAgeMs = 20000): Promise<Probe[]> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.value;
  const value = await Promise.all([gbrain(), memorable(), qm(), river(), ufo(), superset()]);
  cache = { at: Date.now(), value };
  return value;
}
