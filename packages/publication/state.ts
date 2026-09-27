import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../simulator/store.ts";
import type { StageId } from "../contracts/workflow.ts";
import type { DraftProcedure, StageRecord } from "./draft.ts";
import { PACKAGE_FILES } from "./schema.ts";
import type { Files } from "./package.ts";

export const settled = (status: string | undefined) => status === "done" || status === "reduced";

export function stageRecord(store: Store, id: StageId): StageRecord {
  const s = store.stages().find((x) => x.id === id);
  return { id, status: s?.status ?? "not_run", detail: s?.detail ?? "", refs: s?.refs ?? [], updated_at: s?.updatedAt ?? null };
}

export function gate(store: Store, ids: StageId[]) {
  const missing = ids.map((id) => stageRecord(store, id)).filter((s) => !settled(s.status));
  return { ok: missing.length === 0, reason: missing.map((s) => `${s.id} is ${s.status}`).join("; ") };
}

export const elapsed = (started: number) => ({ label: "Elapsed", value: `${((Date.now() - started) / 1000).toFixed(1)} s` });

export type Candidate = {
  candidate_id: string;
  source: DraftProcedure["source"];
  created_at: string;
  extraction: null | { request_id: string; endpoint: string; http_status: number; judge: unknown; refused: string | null; at: string };
  reconstruction: null | { trace: unknown; sha256: string; approved_at: string; edited_by_owner: boolean };
  draft: unknown;
  procedure: DraftProcedure;
  procedure_sha256: string;
  edits: { at: string; actor: string; field: string; before: unknown; after: unknown; note: string | null }[];
};

export function getCandidate(store: Store): Candidate | null {
  const raw = store.getMeta("procedure_candidate");
  return raw ? (JSON.parse(raw) as Candidate) : null;
}

export function ensureImportsTable(store: Store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, package_id TEXT NOT NULL, version TEXT NOT NULL, payload_digest TEXT NOT NULL, publisher TEXT NOT NULL, key_id TEXT NOT NULL, status TEXT NOT NULL, verification TEXT NOT NULL, acceptance TEXT, memorable TEXT, quarantine_dir TEXT NOT NULL, updated_at TEXT NOT NULL)`);
}

export type ImportRow = { id: string; package_id: string; version: string; payload_digest: string; publisher: string; key_id: string; status: string; verification: string; acceptance: string | null; memorable: string | null; quarantine_dir: string; updated_at: string };

export function latestImport(store: Store): ImportRow | null {
  ensureImportsTable(store);
  return (store.db.prepare("SELECT * FROM imports ORDER BY updated_at DESC LIMIT 1").get() as ImportRow | undefined) ?? null;
}

export function importByDigest(store: Store, digest: string): ImportRow | null {
  ensureImportsTable(store);
  return (store.db.prepare("SELECT * FROM imports WHERE payload_digest = ? ORDER BY updated_at DESC LIMIT 1").get(digest) as ImportRow | undefined) ?? null;
}

export function readQuarantine(dir: string): Files {
  return Object.fromEntries(PACKAGE_FILES.filter((f) => existsSync(join(dir, f))).map((f) => [f, readFileSync(join(dir, f))]));
}
