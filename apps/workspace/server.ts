import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../../packages/simulator/store.ts";
import { probeSponsors } from "../../integrations/probes.ts";
import { createMaya } from "./maya.ts";
import type { SponsorStatus, WorkspaceFixture, WorkspaceId } from "../../packages/contracts/types.ts";
import { STAGES } from "../../packages/contracts/workflow.ts";
import type { Ctx, Route } from "./context.ts";
import { pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspace = process.env.WORKSPACE as WorkspaceId;
if (workspace !== "northline" && workspace !== "harbor") throw new Error("WORKSPACE must be northline or harbor");
const port = Number(process.env.PORT ?? (workspace === "northline" ? 7101 : 7102));

const dataDir = join(root, "data", workspace);
mkdirSync(dataDir, { recursive: true });
const tokenFile = join(dataDir, "owner.token");
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(24).toString("hex"), { mode: 0o600 });
const ownerToken = readFileSync(tokenFile, "utf8").trim();

const fixture = JSON.parse(readFileSync(join(root, "fixtures", `${workspace}.json`), "utf8")) as WorkspaceFixture;
const store = openStore(join(dataDir, "workspace.db"), fixture);
const maya = createMaya(fixture, store, join(dataDir, "gbrain"));
if (fixture.replay && store.incidents().some((i) => i.id === fixture.replay!.id) && !store.stages().some((s) => s.id === "incident_replay")) {
  store.setStage("incident_replay", "done", `Synthetic historical replay ${fixture.replay.id} loaded: 2 invoices totaling $9,400 and a bank-change request.`, [{ label: "Incident", value: fixture.replay.id }]);
}
void maya.start().then(async () => {
  const pending = fixture.replay && store.incidents().some((i) => i.id === fixture.replay!.id) && !store.count("receipts", "stage = 'unverified_observation'");
  if (pending && maya.connected) await maya.recordObservations(fixture.replay!.messages, fixture.suppliers);
});

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage) {
  const header = req.headers.authorization ?? "";
  const presented = Buffer.from(header.replace(/^Bearer /, ""));
  const expected = Buffer.from(ownerToken);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function alert() {
  const open = store.incidents().filter((i) => i.status !== "closed");
  if (open.length) return { level: "alert", label: "High alert", reason: `${open.length} open incident${open.length > 1 ? "s" : ""}: ${open[0].title}` };
  const active = store.activeProcedure();
  if (active) return { level: "protected", label: "Protected", reason: `Active defense ${active.package_id} v${active.version}` };
  return { level: "monitoring", label: "Monitoring", reason: "No open incidents and no installed defense package." };
}

async function summary() {
  const sponsors = await probeSponsors();
  const state = (id: string) => sponsors.find((s) => s.id === id)!;
  const held = store.count("payment_queue", "status = 'held'");
  const connected = (id: string) => state(id).state === "ready" || state(id).state === "verified";
  const agentStatus = (backedBy: string, id: string) => {
    if (id === "maya") {
      const m = maya.state;
      if (m.phase === "ready") return { label: "Monitoring", tone: "on", detail: `Private GBrain (${m.server}) connected.` };
      if (m.phase === "seeding") return { label: `Loading ${m.done}/${m.total}`, tone: "active", detail: "Writing verified supplier facts and policy to private GBrain." };
      if (m.phase === "connecting") return { label: "Connecting", tone: "active", detail: "Starting private GBrain." };
      return { label: "Not connected", tone: "off", detail: m.error };
    }
    if (backedBy !== "fia" && !connected(backedBy)) return { label: "Not connected", tone: "off", detail: state(backedBy).detail };
    if (id === "lena" && held) return { label: `Holding ${held}`, tone: "active", detail: `${held} simulated payment(s) on hold.` };
    return { label: "Monitoring", tone: "on", detail: backedBy === "fia" ? "Local FIA service ready." : state(backedBy).detail };
  };
  const procedure = store.activeProcedure();
  return {
    workspace,
    name: fixture.name,
    tagline: fixture.tagline,
    mark: fixture.mark,
    alert: alert(),
    agents: fixture.agents.map((a) => ({ ...a, status: agentStatus(a.backedBy, a.id) })),
    records: { suppliers: store.count("suppliers"), invoices: store.count("invoices"), unverifiedMessages: store.count("messages", "trust_state = 'unverified'"), heldPayments: held },
    incidents: store.incidents(),
    replayAvailable: Boolean(fixture.replay),
    activeProcedure: procedure ? `${procedure.package_id} v${procedure.version}` : null,
    activeModel: null,
    retrieval: maya.state.phase === "ready" ? `GBrain local, keyword search (${maya.state.server})` : "unavailable",
    connection: "online",
    lastAudit: store.lastAudit(),
    stats: {
      threatsDetected: { value: store.count("incidents"), series: store.daily("incidents", "created_at"), delta: store.windowDelta("incidents", "created_at"), source: "FIA incident records in this workspace" },
      threatsBlocked: { value: held, series: store.daily("payment_queue", "updated_at", "status = 'held'"), delta: store.windowDelta("payment_queue", "updated_at", "status = 'held'"), source: "Simulated payments currently held" },
    },
    activity: store.recentAudit(8),
  };
}

function gbrainLocal(): { state: SponsorStatus["state"]; detail: string } {
  const m = maya.state;
  if (m.phase === "ready") return { state: "ready", detail: `This workspace's private brain (${m.server}), keyless PGLite, own data directory.` };
  if (m.phase === "unavailable") return { state: "unreachable", detail: m.error };
  return { state: "ready", detail: "Private brain starting." };
}

async function evidence(): Promise<SponsorStatus[]> {
  const receipts = store.receipts();
  return (await probeSponsors()).map((p) => {
    const mine = receipts.filter((r) => r.sponsor === p.id);
    const local = p.id === "gbrain" ? gbrainLocal() : null;
    return { ...p, ...(local ?? {}), state: mine.length ? "verified" : (local?.state ?? p.state), receipts: mine };
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function workflow() {
  const saved = new Map(store.stages().map((s) => [s.id, s]));
  return STAGES.filter((s) => s.workspace === workspace).map((s) => ({ ...s, status: "not_run", detail: "", refs: [], updatedAt: null, ...(saved.get(s.id) ?? {}) }));
}

const ctx: Ctx = { workspace, fixture, store, maya, root, dataDir, send, readJson };
const routes: Route[] = [];
for (const file of readdirSync(join(root, "apps", "workspace", "routes")).filter((f) => f.endsWith(".ts")).sort()) {
  const mod = (await import(pathToFileURL(join(root, "apps", "workspace", "routes", file)).href)) as { register: (c: Ctx) => Route[] };
  routes.push(...mod.register(ctx));
}

createServer(async (req, res) => {
  try {
    if (!authorized(req)) return send(res, 403, { error: "forbidden" });
    const url = new URL(req.url ?? "/", "http://localhost");
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = typeof r.path === "string" ? (r.path === url.pathname ? [url.pathname] : null) : url.pathname.match(r.path);
      if (match) return await r.handler(req, res, url, match);
    }
    if (req.method === "GET" && url.pathname === "/api/workflow") return send(res, 200, workflow());
    if (req.method === "GET" && url.pathname === "/api/usage") return send(res, 200, store.usage());
    if (req.method === "GET" && url.pathname === "/api/workspace") return send(res, 200, await summary());
    if (req.method === "GET" && url.pathname === "/api/integration-evidence") return send(res, 200, await evidence());
    if (req.method === "POST" && url.pathname === "/api/incidents") {
      const body = await readJson(req);
      if (body.fixture !== "historical_replay") return send(res, 422, { error: "unknown fixture" });
      if (!fixture.replay) return send(res, 422, { error: "this workspace has no historical replay fixture" });
      const result = store.loadReplay(fixture.replay, "owner");
      if (result.created) store.setStage("incident_replay", "done", `Synthetic historical replay ${fixture.replay.id} loaded: 2 invoices totaling $9,400 and a bank-change request.`, [{ label: "Incident", value: fixture.replay.id }]);
      let observations: string[] = [];
      if (result.created) {
        try {
          observations = await maya.recordObservations(fixture.replay.messages, fixture.suppliers);
        } catch (err) {
          store.audit("maya", "gbrain.observations_failed", err instanceof Error ? err.message : String(err));
        }
      }
      return send(res, result.created ? 201 : 200, { incident: fixture.replay.id, created: result.created, gbrainObservations: observations });
    }
    if (req.method === "GET" && url.pathname === "/api/suppliers") {
      const focus = fixture.replay?.supplierId ?? null;
      return send(res, 200, { focus, suppliers: fixture.suppliers.map((s) => ({ id: s.id, name: s.name })) });
    }
    if (req.method === "GET" && url.pathname === "/api/agents/maya/evidence") {
      if (!maya.connected) return send(res, 503, { error: "knowledge unavailable: private GBrain not connected" });
      return send(res, 200, await maya.evidence(url.searchParams.get("supplier") ?? ""));
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(port, "127.0.0.1", () => console.log(`[${workspace}] workspace service on http://127.0.0.1:${port}`));
