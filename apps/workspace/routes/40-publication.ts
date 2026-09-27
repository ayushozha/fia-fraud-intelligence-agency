import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Route } from "../context.ts";
import { buildPayload, decodeFiles, encodeFiles, privateNeedles, scanFiles, signPackage, verifyPackage, type Json } from "../../../packages/publication/package.ts";
import { loadKeyPair, pinnedKeys, relayToken } from "../../../packages/publication/keys.ts";
import { draftPackage, PACKAGE_ID, PACKAGE_VERSION } from "../../../packages/publication/draft.ts";
import { PACKAGE_FILES } from "../../../packages/publication/schema.ts";
import { elapsed, ensureImportsTable, gate, getCandidate, stageRecord } from "../../../packages/publication/state.ts";

const RELAY = process.env.RELAY_URL ?? "http://127.0.0.1:7103";
const RECIPIENTS = ["harbor"];

async function relay(dataDir: string, path: string, init: RequestInit = {}) {
  const token = relayToken(dataDir);
  if (!token) return { status: 0, data: { error: "relay token missing: run node packages/publication/provision.ts" } as Json };
  try {
    const res = await fetch(`${RELAY}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(20000) });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as Json };
  } catch (err) {
    return { status: 0, data: { error: `relay unreachable at ${RELAY}: ${err instanceof Error ? err.message : String(err)}` } as Json };
  }
}

export function register(ctx: Ctx): Route[] {
  return ctx.workspace === "northline" ? northline(ctx) : harbor(ctx);
}

function northline(ctx: Ctx): Route[] {
  const needles = privateNeedles(ctx.fixture as never);
  let inFlight = false;

  function build(recipients: string[]) {
    const candidate = getCandidate(ctx.store);
    if (!candidate) return { error: "no procedure candidate (run extraction first)" };
    const key = loadKeyPair(ctx.dataDir);
    if (!key) return { error: "no signing key in the Northline data dir: run node packages/publication/provision.ts" };
    const pin = pinnedKeys(ctx.root)[key.keyId];
    if (!pin || pin.participant !== ctx.workspace) return { error: `signing key ${key.keyId} is not pinned in fixtures/network-keys.json` };
    const pinKey = `${candidate.procedure_sha256}|${recipients.join(",")}|${JSON.stringify(stageRecord(ctx.store, "evaluation"))}`;
    let createdAt = ctx.store.getMeta("publication_created_at");
    if (!createdAt || ctx.store.getMeta("publication_created_for") !== pinKey) {
      createdAt = new Date().toISOString();
      ctx.store.setMeta("publication_created_at", createdAt);
      ctx.store.setMeta("publication_created_for", pinKey);
    }
    const input = draftPackage({ publisher: ctx.workspace, keyId: key.keyId, createdAt, recipients, procedure: candidate.procedure, evaluation: stageRecord(ctx.store, "evaluation") });
    const payload = buildPayload(input);
    return { candidate, key, payload, hits: scanFiles(payload.files, needles) };
  }

  return [
    {
      method: "GET",
      path: "/api/workflow/publication/preview",
      handler: (_req, res) => {
        const b = build(RECIPIENTS);
        if ("error" in b) return ctx.send(res, 409, { error: b.error });
        ctx.store.setMeta("publication_previewed_digest", b.payload.payloadDigest);
        ctx.send(res, 200, {
          gate: gate(ctx.store, ["extraction", "evaluation", "review"]),
          payload_digest: b.payload.payloadDigest,
          recipients: RECIPIENTS,
          publisher_key_id: b.key.keyId,
          privacy_scan: { needles: needles.length, hits: b.hits },
          files: Object.fromEntries(Object.entries(b.payload.files).map(([k, v]) => [k, k.endsWith(".jsonl") ? v.toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(v.toString("utf8"))])),
          also_signed: ["review-attestation.json (review stage refs + owner approval of this digest and recipients)", "signature.ed25519"],
          approve: 'POST /api/workflow/publication/run {"approve":true,"payload_digest":"<digest>","recipients":["harbor"]}',
        });
      },
    },
    {
      method: "POST",
      path: "/api/workflow/publication/run",
      handler: async (req, res) => {
        const started = Date.now();
        const ext = stageRecord(ctx.store, "extraction");
        if (ext.status !== "done" && ext.status !== "reduced") return ctx.send(res, 409, { error: `publication needs extraction done (currently ${ext.status})` });
        const g = gate(ctx.store, ["evaluation", "review"]);
        if (!g.ok) return ctx.send(res, 409, { error: `publication needs evaluation and review done or reduced: ${g.reason}` });
        const body = await ctx.readJson(req);
        if (body.approve !== true) return ctx.send(res, 409, { error: 'owner approval required: review GET /api/workflow/publication/preview, then POST {"approve":true}' });
        const published = ctx.store.getMeta("publication");
        if (published && body.force !== true) return ctx.send(res, 200, { idempotent: true, ...JSON.parse(published) });
        if (inFlight) return ctx.send(res, 409, { error: "publication already running" });
        const recipients = Array.isArray(body.recipients) ? (body.recipients as string[]).slice().sort() : RECIPIENTS;
        if (recipients.some((r) => !RECIPIENTS.includes(r)) || !recipients.length) return ctx.send(res, 422, { error: `recipients must be a subset of ${RECIPIENTS.join(", ")}` });
        const b = build(recipients);
        if ("error" in b) return ctx.send(res, 409, { error: b.error });
        if (typeof body.payload_digest === "string" && body.payload_digest !== b.payload.payloadDigest) return ctx.send(res, 409, { error: "stale approval: the package changed since that digest was approved", current: b.payload.payloadDigest });
        if (b.hits.length) {
          ctx.store.setStage("publication", "failed", `Outbound privacy scan found private identifiers (${b.hits.map((h) => `${h.kind} in ${h.file}`).join(", ")}); nothing published.`, [elapsed(started)]);
          return ctx.send(res, 422, { error: "privacy scan failed; nothing published", hits: b.hits });
        }
        inFlight = true;
        try {
          const digest = b.payload.payloadDigest;
          const approvedAt = new Date().toISOString();
          const review = stageRecord(ctx.store, "review");
          const attestation = { schema_version: "fia.attestation/1", package_id: PACKAGE_ID, version: PACKAGE_VERSION, payload_digest: digest, review, owner_approval: { actor: "owner", workspace: ctx.workspace, approved_at: approvedAt, payload_digest: digest, recipients } };
          const signed = signPackage(b.payload.files, attestation, b.key);
          const self = verifyPackage(signed, { pinned: pinnedKeys(ctx.root), recipient: recipients[0] });
          if (!self.ok) {
            ctx.store.setStage("publication", "failed", `Self-verification failed before publishing: ${self.errors.join("; ")}`, [elapsed(started)]);
            return ctx.send(res, 422, { error: "outbound package failed schema/signature self-check", errors: self.errors });
          }
          const hits = scanFiles(signed, needles);
          if (hits.length) return ctx.send(res, 422, { error: "privacy scan failed on attestation; nothing published", hits });
          const outbox = join(ctx.dataDir, "outbox", `${PACKAGE_ID}@${PACKAGE_VERSION}`);
          mkdirSync(outbox, { recursive: true });
          for (const f of PACKAGE_FILES) writeFileSync(join(outbox, f), signed[f]);
          ctx.store.audit("owner", "publication.approved", `digest ${digest} → ${recipients.join(", ")}`);
          const r = await relay(ctx.dataDir, "/api/relay/packages", { method: "POST", body: JSON.stringify({ files: encodeFiles(signed) }) });
          if (r.status === 0) {
            ctx.store.setStage("publication", "failed", `Signed but not published: ${r.data.error}`, [{ label: "Payload digest", value: digest }, elapsed(started)]);
            return ctx.send(res, 503, { error: r.data.error });
          }
          if (r.status !== 201 && r.status !== 200) {
            ctx.store.setStage("publication", "failed", `Relay rejected the package (${r.status}): ${String(r.data.error)} ${((r.data.errors as string[]) ?? []).join("; ")}`, [{ label: "Payload digest", value: digest }, elapsed(started)]);
            return ctx.send(res, 502, { error: "relay rejected package", relay: r.data });
          }
          const record = { packageId: PACKAGE_ID, version: PACKAGE_VERSION, payloadDigest: digest, keyId: b.key.keyId, recipients, approvedAt, publishedAt: r.data.publishedAt, relayBytes: r.data.bytes, candidateId: b.candidate.candidate_id, procedureSource: b.candidate.source.label };
          ctx.store.setMeta("publication", JSON.stringify(record));
          ctx.store.setStage("publication", "done", `Owner approved payload ${digest.slice(0, 16)}… for ${recipients.join(", ")}; Ed25519-signed and published to the restricted relay (procedure, synthetic tests, measured report, review attestation and signature only).`, [
            { label: "Package", value: `${PACKAGE_ID}@${PACKAGE_VERSION}` },
            { label: "Payload digest", value: digest },
            { label: "Signing key", value: b.key.keyId },
            { label: "Recipients", value: recipients.join(", ") },
            { label: "Procedure source", value: b.candidate.source.label },
            { label: "Owner approval", value: `approved ${approvedAt}` },
            elapsed(started),
          ]);
          ctx.send(res, 201, record);
        } finally {
          inFlight = false;
        }
      },
    },
  ];
}

function harbor(ctx: Ctx): Route[] {
  ensureImportsTable(ctx.store);
  return [
    {
      method: "POST",
      path: "/api/workflow/import_quarantine/run",
      handler: async (req, res) => {
        const started = Date.now();
        const body = await ctx.readJson(req);
        const inbox = await relay(ctx.dataDir, "/api/relay/inbox");
        if (inbox.status === 0) return ctx.send(res, 503, { error: inbox.data.error });
        if (inbox.status !== 200) return ctx.send(res, 502, { error: `relay inbox ${inbox.status}: ${String(inbox.data.error)}` });
        const list = (inbox.data.packages ?? []) as { packageId: string; version: string; publisher: string }[];
        const pick = list.filter((p) => p.publisher !== ctx.workspace && (!body.package_id || p.packageId === body.package_id) && (!body.version || p.version === body.version)).at(-1);
        if (!pick) return ctx.send(res, 409, { error: "no package addressed to Harbor on the relay yet (publication not done)" });
        const dl = await relay(ctx.dataDir, `/api/relay/packages/${pick.packageId}/${pick.version}`);
        if (dl.status !== 200) return ctx.send(res, dl.status === 0 ? 503 : 502, { error: `download failed (${dl.status}): ${String(dl.data.error)}` });
        const files = decodeFiles((dl.data.files ?? {}) as Record<string, unknown>);
        const id = `${pick.packageId}@${pick.version}`;
        const dir = join(ctx.dataDir, "quarantine", id);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        for (const [name, buf] of Object.entries(files)) if ((PACKAGE_FILES as readonly string[]).includes(name)) writeFileSync(join(dir, name), buf, { mode: 0o444 });
        const v = verifyPackage(files, { pinned: pinnedKeys(ctx.root), recipient: ctx.workspace });
        const now = new Date().toISOString();
        const prior = ctx.store.db.prepare("SELECT status FROM imports WHERE id = ?").get(id) as { status: string } | undefined;
        const status = v.ok ? (prior?.status === "active" ? "active" : "quarantined") : "rejected";
        ctx.store.db.prepare("INSERT INTO imports (id, package_id, version, payload_digest, publisher, key_id, status, verification, acceptance, memorable, quarantine_dir, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_digest = excluded.payload_digest, status = excluded.status, verification = excluded.verification, updated_at = excluded.updated_at").run(id, pick.packageId, pick.version, v.payloadDigest ?? "", v.publisher ?? pick.publisher, v.keyId ?? "", status, JSON.stringify({ ok: v.ok, checks: v.checks, errors: v.errors }), dir, now);
        ctx.store.audit("fia", v.ok ? "import.quarantined" : "import.rejected", `${id}: ${v.ok ? v.payloadDigest : v.errors.join("; ")}`);
        const refs = [{ label: "Package", value: id }, { label: "Payload digest", value: v.payloadDigest ?? "n/a" }, { label: "Publisher key", value: `${v.keyId} (pinned: ${v.checks.find((c) => c.name === "signature")?.ok ? "yes" : "no"})` }, { label: "Checks", value: v.checks.map((c) => `${c.name}:${c.ok ? "ok" : "FAIL"}`).join(" ") }, elapsed(started)];
        if (!v.ok) {
          ctx.store.setStage("import_quarantine", "failed", `Rejected ${id}: ${v.errors.join("; ")}`, refs);
          return ctx.send(res, 422, { error: "package rejected", id, verification: v.checks });
        }
        ctx.store.setStage("import_quarantine", "done", `Downloaded ${id} from ${v.publisher} into Harbor quarantine. Signature (pinned key), integrity, strict schema, recipient scope and tool allowlist verified. Not active until Harbor tests and its owner approves.`, refs);
        ctx.send(res, 200, { id, status, payloadDigest: v.payloadDigest, checks: v.checks });
      },
    },
  ];
}
