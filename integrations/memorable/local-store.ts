import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function memorableBin(): string | null {
  const candidates = [process.env.MEMORABLE_BIN, ...(process.env.PATH ?? "").split(":").filter(Boolean).map((d) => join(d, "memorable")), "/opt/homebrew/bin/memorable", "/usr/local/bin/memorable"];
  return candidates.find((p): p is string => Boolean(p && existsSync(p))) ?? null;
}

export type LocalStore = ReturnType<typeof openLocalStore>;

export function openLocalStore(dataDir: string) {
  const home = join(dataDir, "memorable");
  mkdirSync(home, { recursive: true, mode: 0o700 });

  function run(args: string[], opts: { cloud?: { apiKey: string; baseUrl: string }; stdin?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string }> {
    const bin = memorableBin();
    if (!bin) return Promise.resolve({ code: 127, out: "memorable-cli not installed (npm i -g memorable-cli)" });
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("MEMORABLE_")) env[k] = v;
    Object.assign(env, { MEMORABLE_HOME: home, MEMORABLE_NO_KEYCHAIN: "1", NO_COLOR: "1", CI: "1", MEMORABLE_AUTO_INGEST: "0" });
    if (opts.cloud) Object.assign(env, { MEMORABLE_API_KEY: opts.cloud.apiKey, MEMORABLE_API_URL: opts.cloud.baseUrl });
    return new Promise((resolve) => {
      const child = execFile(bin, args, { env, timeout: opts.timeoutMs ?? 60000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ code, out: `${stdout}${stderr}`.replace(/\x1b\[[0-9;]*m/g, "").trim() });
      });
      if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
      else child.stdin?.end();
    });
  }

  async function setup() {
    await run(["init"]);
    const enabled = await run(["enable"]);
    return { ok: enabled.code === 0, out: enabled.out };
  }

  async function ingest(trace: object, cloud: { apiKey: string; baseUrl: string }) {
    const file = join(home, "last-ingest-trace.json");
    writeFileSync(file, JSON.stringify(trace), { mode: 0o600 });
    const r = await run(["ingest", file], { cloud, timeoutMs: 90000 });
    const slug = r.out.match(/stored (procedures\/[A-Za-z0-9._\/-]+)/)?.[1] ?? null;
    return { ok: r.code === 0 && Boolean(slug), slug, out: r.out.slice(0, 2000) };
  }

  async function recall(query: string) {
    const started = Date.now();
    const r = await run(["recall", query], { timeoutMs: 20000 });
    const slug = r.out.match(/(procedures\/[A-Za-z0-9._\/-]+)/)?.[1] ?? null;
    const similarity = Number(r.out.match(/^\s*([0-9.]+)\s+procedures\//m)?.[1] ?? NaN);
    return { ok: r.code === 0 && Boolean(slug), slug, similarity: Number.isFinite(similarity) ? similarity : null, output: r.out.slice(0, 6000), elapsedMs: Date.now() - started, cloudCredentials: false, memorableHome: home };
  }

  async function list() {
    const r = await run(["list", "--json"], { timeoutMs: 20000 });
    try {
      return JSON.parse(r.out) as unknown[];
    } catch {
      return [];
    }
  }

  return { home, setup, ingest, recall, list };
}
