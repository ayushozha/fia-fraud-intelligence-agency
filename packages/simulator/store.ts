import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { IncidentReplay, Receipt, SponsorId, WorkspaceFixture } from "../contracts/types.ts";
import type { StageId, StageRef, StageStatus, Usage } from "../contracts/workflow.ts";
import { randomUUID } from "node:crypto";

export type Store = ReturnType<typeof openStore>;

export function openStore(file: string, fixture: WorkspaceFixture) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, issued_at TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, sent_at TEXT NOT NULL, trust_state TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, status TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_queue (id TEXT PRIMARY KEY, invoice_ids TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS procedures (package_hash TEXT PRIMARY KEY, package_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, sponsor TEXT NOT NULL, stage TEXT NOT NULL, external_ref TEXT NOT NULL, artifact_hash TEXT, recorded_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_stages (id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT NOT NULL, refs TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_usage (seq INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, sponsor TEXT NOT NULL, op TEXT NOT NULL, units REAL NOT NULL, unit TEXT NOT NULL, ref TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
  `);

  const seeded = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
  if (!seeded) {
    db.exec("BEGIN");
    const sup = db.prepare("INSERT INTO suppliers (id, body) VALUES (?, ?)");
    for (const s of fixture.suppliers) sup.run(s.id, JSON.stringify(s));
    const inv = db.prepare("INSERT INTO invoices (id, supplier_id, issued_at, amount_cents, status, body) VALUES (?, ?, ?, ?, ?, ?)");
    for (const i of fixture.invoices) inv.run(i.id, i.supplierId, i.issuedAt, i.amountCents, i.status, JSON.stringify(i));
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', ?), ('workspace', ?), ('canary', ?)").run(new Date().toISOString(), fixture.workspace, fixture.canary);
    db.exec("COMMIT");
    audit("system", "seed", `${fixture.suppliers.length} suppliers, ${fixture.invoices.length} invoices`);
  }

  function audit(actor: string, action: string, detail: string) {
    db.prepare("INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)").run(new Date().toISOString(), actor, action, detail);
  }

  function count(table: string, where = "1=1") {
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n);
  }

  function loadReplay(replay: IncidentReplay, actor: string) {
    const existing = db.prepare("SELECT id FROM incidents WHERE id = ?").get(replay.id);
    if (existing) return { created: false };
    db.exec("BEGIN");
    const inv = db.prepare("INSERT OR IGNORE INTO invoices (id, supplier_id, issued_at, amount_cents, status, body) VALUES (?, ?, ?, ?, ?, ?)");
    for (const i of replay.invoices) inv.run(i.id, i.supplierId, i.issuedAt, i.amountCents, i.status, JSON.stringify(i));
    const msg = db.prepare("INSERT OR IGNORE INTO messages (id, thread_id, sent_at, trust_state, body) VALUES (?, ?, ?, 'unverified', ?)");
    for (const m of replay.messages) msg.run(m.id, m.threadId, m.sentAt, JSON.stringify(m));
    db.prepare("INSERT INTO incidents (id, status, title, created_at, body) VALUES (?, 'replay_loaded', ?, ?, ?)").run(replay.id, replay.title, new Date().toISOString(), JSON.stringify(replay));
    db.exec("COMMIT");
    audit(actor, "incident.replay_loaded", replay.id);
    return { created: true };
  }

  function receipts(): Receipt[] {
    return (db.prepare("SELECT * FROM receipts ORDER BY recorded_at").all() as Record<string, string>[]).map((r) => ({
      id: r.id, sponsor: r.sponsor as Receipt["sponsor"], stage: r.stage, externalRef: r.external_ref, artifactHash: r.artifact_hash ?? null, recordedAt: r.recorded_at,
    }));
  }

  function incidents() {
    return (db.prepare("SELECT id, status, title, created_at FROM incidents ORDER BY created_at").all() as Record<string, string>[]);
  }

  function activeProcedure() {
    return (db.prepare("SELECT package_id, version, package_hash FROM procedures WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").get() as Record<string, string> | undefined) ?? null;
  }

  function daily(table: string, dateCol: string, where = "1=1", days = 14) {
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const rows = db.prepare(`SELECT substr(${dateCol}, 1, 10) AS d, COUNT(*) AS n FROM ${table} WHERE ${where} AND substr(${dateCol}, 1, 10) >= ? GROUP BY d`).all(since) as { d: string; n: number }[];
    const byDay = new Map(rows.map((r) => [r.d, Number(r.n)]));
    return Array.from({ length: days }, (_, i) => byDay.get(new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10)) ?? 0);
  }

  function windowDelta(table: string, dateCol: string, where = "1=1") {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const q = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} AND ${dateCol} >= ? AND ${dateCol} < ?`);
    const current = Number((q.get(iso(now - 30 * 86400000), iso(now + 1000)) as { n: number }).n);
    const previous = Number((q.get(iso(now - 60 * 86400000), iso(now - 30 * 86400000)) as { n: number }).n);
    return { current, previous, pct: previous ? Math.round(((current - previous) / previous) * 100) : null };
  }

  function recentAudit(limit = 10) {
    return db.prepare("SELECT seq, at, actor, action, detail FROM audit ORDER BY seq DESC LIMIT ?").all(limit) as Record<string, string>[];
  }

  function setStage(id: StageId, status: StageStatus, detail: string, refs: StageRef[] = []) {
    db.prepare("INSERT INTO workflow_stages (id, status, detail, refs, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, detail = excluded.detail, refs = excluded.refs, updated_at = excluded.updated_at").run(id, status, detail, JSON.stringify(refs), new Date().toISOString());
    audit("workflow", `stage.${id}`, `${status}: ${detail}`);
  }

  function stages() {
    return (db.prepare("SELECT * FROM workflow_stages").all() as Record<string, string>[]).map((r) => ({ id: r.id as StageId, status: r.status as StageStatus, detail: r.detail, refs: JSON.parse(r.refs) as StageRef[], updatedAt: r.updated_at }));
  }

  function recordUsage(agent: string, sponsor: string, op: string, units: number, unit: string, ref: string) {
    db.prepare("INSERT INTO agent_usage (agent, sponsor, op, units, unit, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(agent, sponsor, op, units, unit, ref, new Date().toISOString());
  }

  function usage(limit = 200): Usage[] {
    return db.prepare("SELECT agent, sponsor, op, units, unit, ref, at FROM agent_usage ORDER BY seq DESC LIMIT ?").all(limit) as Usage[];
  }

  function addReceipt(sponsor: SponsorId, stage: string, externalRef: string, artifactHash: string | null = null) {
    db.prepare("INSERT INTO receipts (id, sponsor, stage, external_ref, artifact_hash, recorded_at) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), sponsor, stage, externalRef, artifactHash, new Date().toISOString());
  }

  function getMeta(key: string) {
    return ((db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value) ?? null;
  }

  function setMeta(key: string, value: string) {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  function lastAudit() {
    return (db.prepare("SELECT at, actor, action, detail FROM audit ORDER BY seq DESC LIMIT 1").get() as Record<string, string> | undefined) ?? null;
  }

  return { db, audit, count, loadReplay, receipts, incidents, activeProcedure, lastAudit, daily, windowDelta, recentAudit, setStage, stages, recordUsage, usage, addReceipt, getMeta, setMeta };
}
