import { createServer, type ServerResponse } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { STAGES } from "../../packages/contracts/workflow.ts";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
const port = Number(process.env.PORT ?? 7100);

const workspaces = {
  northline: { url: process.env.NORTHLINE_URL ?? "http://127.0.0.1:7101", tokenFile: join(root, "data", "northline", "owner.token") },
  harbor: { url: process.env.HARBOR_URL ?? "http://127.0.0.1:7102", tokenFile: join(root, "data", "harbor", "owner.token") },
};
const relayUrl = process.env.RELAY_URL ?? "http://127.0.0.1:7103";

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function forward(ws: keyof typeof workspaces, path: string, method: string, body?: string, timeoutMs = 15000) {
  const { url, tokenFile } = workspaces[ws];
  const token = readFileSync(tokenFile, "utf8").trim();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` })) };
}

type Json = Record<string, unknown>;

function walk(dir: string): { path: string; size: number }[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [{ path: p, size: statSync(p).size }];
  });
}

function readManifest(file: string): Json | null {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function packageDetails(relay: Json | null) {
  const listed = Array.isArray(relay?.packages) ? (relay.packages as unknown[]) : [];
  if (listed.some((p) => p && typeof p === "object")) return listed as Json[];
  const dir = join(root, "data", "relay", "packages");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => {
    const p = join(dir, name);
    const files = statSync(p).isDirectory() ? walk(p) : [{ path: p, size: statSync(p).size }];
    const manifestFile = files.find((f) => f.path.endsWith("manifest.json"));
    const manifest = manifestFile ? readManifest(manifestFile.path) : null;
    const distribution = manifest?.distribution as Json | string | undefined;
    return {
      id: (manifest?.package_id as string) ?? name,
      version: (manifest?.version as string) ?? null,
      title: (manifest?.title as string) ?? null,
      bytes: files.reduce((n, f) => n + f.size, 0),
      files: files.map((f) => f.path.slice(p.length + 1) || name),
      signed: files.some((f) => /signature/.test(f.path)),
      publisherKeyId: (manifest?.publisher_key_id as string) ?? null,
      recipients: typeof distribution === "object" && distribution ? ((distribution.recipients ?? distribution.named_recipients ?? []) as string[]) : [],
      distribution: typeof distribution === "string" ? distribution : ((distribution?.mode as string) ?? null),
      payloadDigest: (manifest?.payload_digest as string) ?? null,
    };
  });
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getJson(ws: keyof typeof workspaces, path: string) {
  const r = await forward(ws, path, "GET");
  if (r.status >= 400) throw new Error((r.json as Json)?.error as string ?? `${r.status}`);
  return r.json;
}

async function workflowView() {
  const [n, h, relay] = await Promise.all([
    settle(getJson("northline", "/api/workflow")),
    settle(getJson("harbor", "/api/workflow")),
    settle(fetch(`${relayUrl}/api/relay/status`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json() as Promise<Json>)),
  ]);
  const byId = new Map<string, Json>();
  for (const r of [n, h]) if (r.ok && Array.isArray(r.value)) for (const s of r.value as Json[]) byId.set(s.id as string, s);
  const reach = { northline: n.ok ? null : n.error, harbor: h.ok ? null : h.error };
  const stages = STAGES.map((s) => {
    const live = byId.get(s.id);
    const error = reach[s.workspace];
    return live ? { ...s, ...live, reachable: true } : { ...s, status: "not_run", detail: error ? `Workspace unreachable: ${error}` : "", refs: [], updatedAt: null, reachable: !error };
  });
  const relayStatus = relay.ok ? relay.value : null;
  return { stages, unreachable: reach, relay: relayStatus ? { ...relayStatus, packages: packageDetails(relayStatus) } : null, relayError: relay.ok ? null : relay.error, at: new Date().toISOString() };
}

const gbrainTokenUnits = new Set(["tokens", "token"]);

function summarizeUsage(rows: Json[]) {
  const agents: Record<string, { gbrainTokens: number; modelTokens: number; ops: Record<string, number>; entries: Json[] }> = {};
  for (const r of rows) {
    const a = (agents[r.agent as string] ??= { gbrainTokens: 0, modelTokens: 0, ops: {}, entries: [] });
    const sponsor = String(r.sponsor);
    const unit = String(r.unit);
    const units = Number(r.units) || 0;
    a.entries.push(r);
    if (sponsor === "gbrain") {
      if (unit === "chars") a.gbrainTokens += units / 4;
      else if (gbrainTokenUnits.has(unit)) a.gbrainTokens += units;
      a.ops.gbrain = (a.ops.gbrain ?? 0) + 1;
    } else if (unit === "tokens" || unit === "token") {
      a.modelTokens += units;
      a.ops[sponsor] = (a.ops[sponsor] ?? 0) + 1;
    } else {
      a.ops[sponsor] = (a.ops[sponsor] ?? 0) + (unit === "ops" || unit === "op" || unit === "calls" ? units : 1);
    }
  }
  for (const a of Object.values(agents)) {
    a.gbrainTokens = Math.round(a.gbrainTokens);
    a.entries = a.entries.slice(-12).reverse();
  }
  return agents;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    const m = url.pathname.match(/^\/ws\/(northline|harbor)(\/api\/.*)$/);
    if (m) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const r = await forward(m[1] as keyof typeof workspaces, m[2] + url.search, req.method ?? "GET", chunks.length ? Buffer.concat(chunks).toString() : undefined, /\/api\/workflow\/[a-z_]+\/run$/.test(m[2]) ? 900000 : 15000);
      return send(res, r.status, r.json);
    }
    if (req.method === "GET" && url.pathname === "/workflow") return send(res, 200, await workflowView());
    const u = url.pathname.match(/^\/usage\/(northline|harbor)$/);
    if (req.method === "GET" && u) {
      const rows = (await getJson(u[1] as keyof typeof workspaces, "/api/usage")) as Json[];
      return send(res, 200, { workspace: u[1], agents: summarizeUsage(Array.isArray(rows) ? rows : []) });
    }
    if (req.method === "GET" && url.pathname === "/demo/fixtures") {
      const nl = JSON.parse(readFileSync(join(root, "fixtures", "northline.json"), "utf8"));
      const hb = JSON.parse(readFileSync(join(root, "fixtures", "harbor.json"), "utf8"));
      const casesDir = join(root, "fixtures", "harbor-cases");
      const cases = existsSync(casesDir) ? readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(casesDir, f), "utf8"))) : [];
      const supplierName = (list: Json[], id: unknown) => (list.find((x) => x.id === id)?.name as string) ?? String(id);
      const shape = (r: Json | null, suppliers: Json[]) => r && { id: r.id, title: r.title, supplier: supplierName(suppliers, r.supplierId), invoices: r.invoices, messages: (r.messages as Json[]).map((m) => ({ from: m.from, subject: m.subject, body: m.body, sentAt: m.sentAt })) };
      return send(res, 200, { synthetic: true, northline: shape(nl.replay, nl.suppliers), harbor: cases.map((c) => shape(c, hb.suppliers)) });
    }
    if (url.pathname === "/relay/status") {
      const r = await fetch(`${relayUrl}/api/relay/status`, { signal: AbortSignal.timeout(5000) });
      return send(res, r.status, await r.json());
    }
    const page = url.pathname === "/" ? "index.html" : /^\/demo\/?$/.test(url.pathname) ? "demo.html" : /^\/workspace\/(northline|harbor)\/?$/.test(url.pathname) ? "workspace.html" : url.pathname;
    const file = normalize(join(publicDir, page));
    if (!file.startsWith(publicDir) || !existsSync(file)) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  } catch (err) {
    send(res, 503, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(port, "127.0.0.1", () => console.log(`[console] presenter shell on http://127.0.0.1:${port}`));
