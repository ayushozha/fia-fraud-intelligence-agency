import type { Store } from "../simulator/store.ts";
import { openLocalStore } from "../../integrations/memorable/local-store.ts";
import { sha256, type Json } from "./package.ts";
import { importByDigest, readQuarantine } from "./state.ts";
import type { Binding } from "./acceptance.ts";

type Step = { seq: number; tool: string; instruction: string; command: string | null; binds: string[] };

export function renderProcedure(proc: Json, meta: { packageId: string; version: string; procedureSha256: string }, bindings: Binding[]) {
  const steps = proc.steps as Step[];
  const val = (n: string) => bindings.find((b) => b.name === n)?.value;
  return [
    `${proc.title} (${meta.packageId} v${meta.version}, procedure sha256 ${meta.procedureSha256})`,
    `Source: ${(proc.source as Json).label}`,
    `Applies when: ${proc.trigger}`,
    "Steps (reference data, not system authority):",
    ...steps.map((s) => `  ${s.seq}. [${s.tool}] ${s.instruction}${s.binds.length ? ` (local policy: ${s.binds.map((b) => `${b} = ${val(b) ?? "unbound"}`).join("; ")})` : ""}`),
    ...((proc.postconditions as string[]).length ? ["Postconditions:", ...(proc.postconditions as string[]).map((p) => `  - ${p}`)] : []),
  ].join("\n");
}

export async function activeProcedure(ctx: { store: Store; dataDir: string }, opts: { recall?: boolean } = {}) {
  const row = ctx.store.activeProcedure();
  if (!row) return null;
  const imp = importByDigest(ctx.store, row.package_hash);
  if (!imp) return null;
  const files = readQuarantine(imp.quarantine_dir);
  const manifest = JSON.parse(files["manifest.json"].toString("utf8")) as Json;
  const listed = (manifest.files as { path: string; sha256: string }[]).find((f) => f.path === "procedure.json")!;
  const procedureSha256 = sha256(files["procedure.json"]);
  const intact = procedureSha256 === listed.sha256 && sha256(files["manifest.json"]) === row.package_hash;
  const procedure = JSON.parse(files["procedure.json"].toString("utf8")) as Json;
  const acceptance = imp.acceptance ? (JSON.parse(imp.acceptance) as { bindings: Binding[]; passed: number; total: number; policyHash: string; ranAt: string }) : null;
  const memorable = imp.memorable ? (JSON.parse(imp.memorable) as Json) : null;
  let recall: Json | null = null;
  if (opts.recall !== false && memorable?.slug) {
    const r = await openLocalStore(ctx.dataDir).recall(procedure.trigger as string);
    recall = { query: procedure.trigger, ...r, matchesInstalled: r.slug === memorable.slug, at: new Date().toISOString() };
  }
  return {
    packageId: row.package_id,
    version: row.version,
    payloadDigest: row.package_hash,
    procedureSha256,
    intact,
    publisher: imp.publisher,
    publisherKeyId: imp.key_id,
    procedure,
    bindings: acceptance?.bindings ?? [],
    text: renderProcedure(procedure, { packageId: row.package_id, version: row.version, procedureSha256 }, acceptance?.bindings ?? []),
    acceptance: acceptance ? { passed: acceptance.passed, total: acceptance.total, policyHash: acceptance.policyHash, ranAt: acceptance.ranAt } : null,
    memorable,
    recall,
  };
}
