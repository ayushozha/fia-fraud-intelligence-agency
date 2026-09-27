import type { Ctx, Route } from "../context.ts";
import { extract, memorableConfig, type Trace } from "../../../integrations/memorable/client.ts";
import { manualProcedure, procedureFromDraft, syntheticReconstruction, validateTrace } from "../../../integrations/memorable/reconstruction.ts";
import { openLocalStore } from "../../../integrations/memorable/local-store.ts";
import { canonical, privateNeedles, scanFiles, sha256, verifyPackage, type Json } from "../../../packages/publication/package.ts";
import { pinnedKeys } from "../../../packages/publication/keys.ts";
import { runAcceptance, type PolicyFact } from "../../../packages/publication/acceptance.ts";
import { activeProcedure } from "../../../packages/publication/active.ts";
import { elapsed, gate, getCandidate, latestImport, readQuarantine, stageRecord, type Candidate } from "../../../packages/publication/state.ts";
import type { DraftProcedure } from "../../../packages/publication/draft.ts";

export function register(ctx: Ctx): Route[] {
  const routes: Route[] = [
    {
      method: "GET",
      path: "/api/procedures/active",
      handler: async (_req, res, url) => {
        const active = await activeProcedure(ctx, { recall: url.searchParams.get("recall") !== "0" });
        if (!active) return ctx.send(res, 404, { error: "no active procedure in this workspace" });
        ctx.send(res, 200, active);
      },
    },
  ];
  return ctx.workspace === "northline" ? [...routes, ...northline(ctx)] : [...routes, ...harbor(ctx)];
}

function northline(ctx: Ctx): Route[] {
  const needles = privateNeedles(ctx.fixture as never);
  let inFlight = false;

  function reconstruction(): Trace {
    const saved = ctx.store.getMeta("extraction_reconstruction");
    if (saved) return JSON.parse(saved) as Trace;
    const t = syntheticReconstruction(`fia-northline-${Date.now().toString(36)}`);
    ctx.store.setMeta("extraction_reconstruction", JSON.stringify(t));
    return t;
  }

  const scanTrace = (t: unknown) => scanFiles({ "reconstruction.json": Buffer.from(JSON.stringify(t)) }, needles);

  function saveCandidate(c: Omit<Candidate, "candidate_id" | "procedure_sha256">) {
    const procedure_sha256 = sha256(canonical(c.procedure));
    const full: Candidate = { ...c, candidate_id: `CAND-${procedure_sha256.slice(0, 12)}`, procedure_sha256 };
    ctx.store.setMeta("procedure_candidate", JSON.stringify(full));
    return full;
  }

  return [
    {
      method: "GET",
      path: "/api/workflow/extraction/preview",
      handler: (_req, res) => {
        const t = reconstruction();
        const cfg = memorableConfig(ctx.root);
        ctx.send(res, 200, {
          gate: gate(ctx.store, ["confirmation"]),
          memorable: { configured: Boolean(cfg.apiKey), endpoint: `${cfg.baseUrl}/v1/extract` },
          request_body: t,
          reconstruction_sha256: sha256(canonical(t)),
          privacy_scan: { needles: needles.length, hits: scanTrace(t) },
          approve: 'POST /api/workflow/extraction/run {"approve":true} sends exactly request_body (optionally {"approve":true,"reconstruction":{...edited}})',
          reduced: 'POST /api/workflow/extraction/run {"reduced":true} uses a manually authored procedure (not Memorable)',
        });
      },
    },
    {
      method: "GET",
      path: /^\/api\/(procedure-candidate|procedures\/candidate)$/,
      handler: (_req, res) => {
        const c = getCandidate(ctx.store);
        if (!c) return ctx.send(res, 404, { error: "no procedure candidate yet" });
        ctx.send(res, 200, c);
      },
    },
    {
      method: "POST",
      path: "/api/procedure-candidate/edits",
      handler: async (req, res) => {
        const c = getCandidate(ctx.store);
        if (!c) return ctx.send(res, 409, { error: "no procedure candidate yet" });
        if (stageRecord(ctx.store, "publication").status === "done") return ctx.send(res, 409, { error: "already published; edits need a new version" });
        const body = await ctx.readJson(req);
        const note = typeof body.note === "string" ? body.note.slice(0, 400) : null;
        const at = new Date().toISOString();
        const proc: DraftProcedure = JSON.parse(JSON.stringify(c.procedure));
        const edits: Candidate["edits"] = [];
        const errs: string[] = [];
        if (typeof body.title === "string") {
          if (!body.title.trim() || body.title.length > 200) errs.push("title must be 1-200 chars");
          else if (body.title !== proc.title) (edits.push({ at, actor: "owner", field: "title", before: proc.title, after: body.title, note }), (proc.title = body.title));
        }
        if (Array.isArray(body.steps)) {
          for (const e of body.steps as { seq?: number; instruction?: string }[]) {
            const step = proc.steps.find((s) => s.seq === e.seq);
            if (!step || typeof e.instruction !== "string" || !e.instruction.trim() || e.instruction.length > 600) {
              errs.push(`step ${e.seq}: needs an existing seq and a 1-600 char instruction`);
              continue;
            }
            if (step.instruction !== e.instruction) (edits.push({ at, actor: "owner", field: `steps[${step.seq}].instruction`, before: step.instruction, after: e.instruction, note }), (step.instruction = e.instruction));
          }
        }
        for (const field of ["applicability", "limitations"] as const) {
          const v = body[field];
          if (v === undefined) continue;
          if (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== "string" || !x.trim() || x.length > 400)) errs.push(`${field} must be up to 20 strings of 1-400 chars`);
          else if (canonical(v) !== canonical(proc[field])) (edits.push({ at, actor: "owner", field, before: proc[field], after: v, note }), (proc[field] = v as string[]));
        }
        if (errs.length) return ctx.send(res, 422, { error: "invalid edits", errors: errs });
        const hits = scanFiles({ "procedure.json": Buffer.from(JSON.stringify(proc)) }, needles);
        if (hits.length) return ctx.send(res, 422, { error: "edit contains private identifiers", hits });
        if (!edits.length) return ctx.send(res, 200, { unchanged: true, candidate: c });
        const saved = saveCandidate({ ...c, procedure: proc, edits: [...c.edits, ...edits] });
        const st = stageRecord(ctx.store, "extraction");
        const refs = st.refs.filter((r) => !/^(Owner edits|Procedure hash|Candidate id)$/.test(r.label));
        ctx.store.setStage("extraction", st.status as "done", st.detail, [...refs, { label: "Candidate id", value: saved.candidate_id }, { label: "Procedure hash", value: saved.procedure_sha256 }, { label: "Owner edits", value: `${saved.edits.length} recorded` }]);
        ctx.store.audit("owner", "procedure.edited", `${edits.length} edit(s) → ${saved.candidate_id}`);
        ctx.send(res, 200, { edits, candidate: saved });
      },
    },
    {
      method: "POST",
      path: "/api/workflow/extraction/run",
      handler: async (req, res) => {
        const started = Date.now();
        const g = gate(ctx.store, ["confirmation"]);
        if (!g.ok) return ctx.send(res, 409, { error: `extraction needs the owner-confirmed incident first: ${g.reason}` });
        const body = await ctx.readJson(req);
        const existing = getCandidate(ctx.store);
        if (existing && body.force !== true && (existing.source.kind === "memorable_extraction" || body.reduced === true)) {
          return ctx.send(res, 200, { idempotent: true, candidate: existing, stage: stageRecord(ctx.store, "extraction") });
        }
        if (inFlight) return ctx.send(res, 409, { error: "extraction already running" });

        if (body.reduced === true) {
          const c = saveCandidate({ source: manualProcedure().source, created_at: new Date().toISOString(), extraction: null, reconstruction: null, draft: null, procedure: manualProcedure(), edits: [] });
          ctx.store.setStage("extraction", "reduced", "Owner chose the reduced path: manually authored procedure — not Memorable extraction. No Memorable receipt exists for this stage.", [
            { label: "Candidate id", value: c.candidate_id },
            { label: "Procedure hash", value: c.procedure_sha256 },
            { label: "Source", value: "manually authored — not Memorable" },
            elapsed(started),
          ]);
          ctx.store.audit("owner", "extraction.reduced", c.candidate_id);
          return ctx.send(res, 200, { reduced: true, candidate: c });
        }

        if (body.approve !== true) {
          return ctx.send(res, 409, { error: 'owner approval required: review GET /api/workflow/extraction/preview (the exact synthetic reconstruction sent to Memorable), then POST {"approve":true}' });
        }
        const cfg = memorableConfig(ctx.root);
        if (!cfg.apiKey) {
          ctx.store.setStage("extraction", "blocked", 'MEMORABLE_API_KEY not set. Owner may continue reduced: POST {"reduced":true} uses a manually authored procedure (not Memorable).', [{ label: "Missing", value: "MEMORABLE_API_KEY" }]);
          return ctx.send(res, 503, { error: "MEMORABLE_API_KEY not set", reduced: 'POST {"reduced":true}' });
        }
        const trace = (body.reconstruction ?? reconstruction()) as Trace;
        const errs = validateTrace(trace);
        if (errs.length) return ctx.send(res, 422, { error: "reconstruction rejected by FIA schema", errors: errs });
        const hits = scanTrace(trace);
        if (hits.length) return ctx.send(res, 422, { error: "reconstruction contains private identifiers; nothing was sent", hits });
        const original = reconstruction();
        const edited = canonical(trace) !== canonical(original);
        const traceSha = sha256(canonical(trace));

        inFlight = true;
        ctx.store.setStage("extraction", "running", "Sending the owner-approved synthetic reconstruction to Memorable POST /v1/extract.", [{ label: "Reconstruction hash", value: traceSha }]);
        try {
          const r = await extract({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }, trace);
          if (!r.ok) {
            ctx.store.setStage("extraction", "failed", `${r.error}. Confirmed incident preserved; publication stopped. Owner may continue reduced: POST {"reduced":true}.`, [...(r.requestId ? [{ label: "Request ID", value: r.requestId }] : []), elapsed(started)]);
            return ctx.send(res, r.httpStatus === 401 || r.httpStatus === 403 ? 503 : 502, { error: r.error, requestId: r.requestId });
          }
          if (r.refused) {
            ctx.store.addReceipt("memorable", "extraction", `request_id ${r.requestId} (refused: ${r.refused})`, traceSha);
            ctx.store.setStage("extraction", "blocked", `Memorable refused the extraction (${r.refused}); nothing stored. Owner may continue reduced: POST {"reduced":true}.`, [{ label: "Request ID", value: r.requestId }, elapsed(started)]);
            return ctx.send(res, 503, { error: `Memorable refused: ${r.refused}`, requestId: r.requestId });
          }
          const mapped = procedureFromDraft(r.draft, trace);
          if (mapped.errors.length) {
            ctx.store.setStage("extraction", "failed", `Extracted draft rejected: ${mapped.errors.join("; ")}`, [{ label: "Request ID", value: r.requestId }, elapsed(started)]);
            return ctx.send(res, 422, { error: "extracted draft uses tools outside the FIA allowlist", errors: mapped.errors, requestId: r.requestId });
          }
          const at = new Date().toISOString();
          const c = saveCandidate({
            source: mapped.procedure.source,
            created_at: at,
            extraction: { request_id: r.requestId, endpoint: `${cfg.baseUrl}/v1/extract`, http_status: r.httpStatus, judge: r.judge, refused: null, at },
            reconstruction: { trace, sha256: traceSha, approved_at: at, edited_by_owner: edited },
            draft: r.draft,
            procedure: mapped.procedure,
            edits: edited ? [{ at, actor: "owner", field: "reconstruction", before: sha256(canonical(original)), after: traceSha, note: "owner edited the synthetic reconstruction before sending" }] : [],
          });
          ctx.store.addReceipt("memorable", "extraction", `request_id ${r.requestId}`, traceSha);
          ctx.store.recordUsage("jordan", "memorable", "extract", trace.tool_calls.length, "tool_calls", `request ${r.requestId}`);
          ctx.store.audit("owner", "extraction.approved", `synthetic reconstruction ${traceSha.slice(0, 12)} sent to Memorable; request ${r.requestId}`);
          ctx.store.setStage("extraction", "done", `Memorable extracted a ${c.procedure.steps.length}-step draft "${c.procedure.title}" from the owner-approved synthetic reconstruction (no private identifiers; privacy scan clean).`, [
            { label: "Memorable request ID", value: r.requestId },
            { label: "Candidate id", value: c.candidate_id },
            { label: "Procedure hash", value: c.procedure_sha256 },
            { label: "Reconstruction hash", value: traceSha },
            { label: "Owner edits", value: `${c.edits.length} recorded` },
            elapsed(started),
          ]);
          ctx.send(res, 200, { candidate: c });
        } finally {
          inFlight = false;
        }
      },
    },
  ];
}

function harbor(ctx: Ctx): Route[] {
  let inFlight = false;

  async function harborPolicy(): Promise<PolicyFact[]> {
    const ev = await ctx.maya.evidence(ctx.fixture.suppliers[0].id, "maya");
    return ev.policy.map((p: { id: string | number; text: string; provenance: string }) => ({ id: p.id, text: p.text, provenance: p.provenance }));
  }

  return [
    {
      method: "GET",
      path: "/api/imports",
      handler: (_req, res) => {
        const row = latestImport(ctx.store);
        if (!row) return ctx.send(res, 404, { error: "nothing imported" });
        ctx.send(res, 200, { ...row, verification: JSON.parse(row.verification), acceptance: row.acceptance ? JSON.parse(row.acceptance) : null, memorable: row.memorable ? JSON.parse(row.memorable) : null });
      },
    },
    {
      method: "POST",
      path: "/api/workflow/acceptance/run",
      handler: async (req, res) => {
        const started = Date.now();
        const g = gate(ctx.store, ["import_quarantine"]);
        if (!g.ok) return ctx.send(res, 409, { error: `acceptance needs a quarantined package: ${g.reason}` });
        const imp = latestImport(ctx.store);
        if (!imp || imp.status === "rejected") return ctx.send(res, 409, { error: "no verified package in quarantine" });
        if (!ctx.maya.connected) return ctx.send(res, 503, { error: "Harbor's private GBrain (Maya) is not connected; acceptance cannot read local policy" });
        if (inFlight) return ctx.send(res, 409, { error: "acceptance already running" });
        const body = await ctx.readJson(req);
        const approve = body.approve === true || body.reduced === true;
        inFlight = true;
        try {
          const files = readQuarantine(imp.quarantine_dir);
          const v = verifyPackage(files, { pinned: pinnedKeys(ctx.root), recipient: ctx.workspace });
          const policy = await harborPolicy();
          const report = runAcceptance(v, policy, "Harbor");
          ctx.store.db.prepare("UPDATE imports SET acceptance = ?, status = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(report), report.ok ? (imp.status === "active" ? "active" : "recipient_tested") : "quarantined", new Date().toISOString(), imp.id);
          const factRefs = [...new Set(report.bindings.filter((b) => b.factId).map((b) => b.factId!))].map((id) => ({ label: "GBrain policy fact", value: `#${id}` }));
          const baseRefs = [
            { label: "Package", value: `${imp.package_id}@${imp.version}` },
            { label: "Payload digest", value: imp.payload_digest },
            { label: "Harbor acceptance", value: `${report.passed}/${report.total} passed` },
            { label: "Harbor policy hash", value: report.policyHash },
            ...factRefs,
          ];
          ctx.store.audit("fia", "acceptance.tested", `${imp.id}: ${report.passed}/${report.total}`);
          if (!report.ok) {
            ctx.store.setStage("acceptance", "failed", `Harbor acceptance failed ${report.total - report.passed}/${report.total}: ${report.tests.filter((t) => !t.ok).map((t) => t.id).join(", ")}. Package stays quarantined.`, [...baseRefs, elapsed(started)]);
            return ctx.send(res, 422, { error: "Harbor acceptance tests failed; not activated", report });
          }
          if (!approve) {
            ctx.store.setStage("acceptance", "running", `Tested against Harbor's policies. Ready for your review. (${report.passed}/${report.total} local acceptance checks passed; awaiting owner activation of this exact version.)`, [...baseRefs, { label: "Owner approval", value: "required" }, elapsed(started)]);
            return ctx.send(res, 409, { error: 'owner approval required to activate: POST {"approve":true}', report });
          }

          const proc = v.procedure as Json;
          const cfg = memorableConfig(ctx.root);
          const local = openLocalStore(ctx.dataDir);
          let memorable: Json;
          let status: "done" | "reduced" = "done";
          const sessionId = `harbor-${imp.package_id}-${imp.version}-${imp.payload_digest.slice(0, 12)}`;
          const steps = proc.steps as { seq: number; tool: string; instruction: string; command: string | null; binds: string[] }[];
          const trace = {
            session_id: sessionId,
            task_description: String(proc.trigger).slice(0, 200),
            harness: "fia",
            tool_calls: steps.map((s) => ({ name: s.tool, input: { description: s.instruction, command: s.command ?? [s.tool, ...s.binds.map((b) => `--${b}`)].join(" ") }, result: { exit_code: 0 } })),
          };
          const failReduced = (reason: string) => {
            if (body.reduced === true) {
              status = "reduced";
              return { reduced: true, reason, label: "activated without Harbor's Memorable local store (reduced); recall serves verified quarantine bytes" };
            }
            return null;
          };
          if (!cfg.apiKey) {
            const r = failReduced("MEMORABLE_API_KEY not set (memorable ingest calls the Memorable extraction service)");
            if (!r) {
              ctx.store.setStage("acceptance", "blocked", 'MEMORABLE_API_KEY not set: Harbor cannot store the procedure in its Memorable local store. Owner may continue reduced: POST {"reduced":true}.', [...baseRefs, { label: "Missing", value: "MEMORABLE_API_KEY" }]);
              return ctx.send(res, 503, { error: "MEMORABLE_API_KEY not set" });
            }
            memorable = r;
          } else {
            const setup = await local.setup();
            const ing = setup.ok ? await local.ingest(trace, { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }) : { ok: false, slug: null, out: setup.out };
            const rec = ing.ok ? await local.recall(String(proc.trigger)) : null;
            if (!ing.ok || !rec?.ok || rec.slug !== ing.slug) {
              const reason = !ing.ok ? `memorable ingest failed: ${ing.out.slice(0, 300)}` : `local recall did not return the installed procedure: ${rec?.output.slice(0, 300)}`;
              const r = failReduced(reason);
              if (!r) {
                ctx.store.setStage("acceptance", "blocked", `${reason}. Owner may continue reduced: POST {"reduced":true}.`, [...baseRefs, elapsed(started)]);
                return ctx.send(res, 503, { error: reason });
              }
              memorable = r;
            } else {
              memorable = { slug: ing.slug, sessionId, home: local.home, ingest: ing.out, recall: { query: proc.trigger, slug: rec.slug, similarity: rec.similarity, elapsedMs: rec.elapsedMs, cloudCredentials: false }, storedAt: new Date().toISOString() };
              ctx.store.addReceipt("memorable", "acceptance", `local store ${ing.slug} (Harbor MEMORABLE_HOME); offline recall similarity ${rec.similarity ?? "?"}`, imp.payload_digest);
              ctx.store.recordUsage("jordan", "memorable", "ingest", steps.length, "tool_calls", ing.slug!);
              ctx.store.recordUsage("jordan", "memorable", "recall", 1, "queries", ing.slug!);
            }
          }
          const now = new Date().toISOString();
          ctx.store.db.exec("BEGIN");
          ctx.store.db.prepare("UPDATE procedures SET status = 'superseded', updated_at = ? WHERE status = 'active' AND package_hash != ?").run(now, imp.payload_digest);
          ctx.store.db.prepare("INSERT INTO procedures (package_hash, package_id, version, status, updated_at) VALUES (?, ?, ?, 'active', ?) ON CONFLICT(package_hash) DO UPDATE SET status = 'active', updated_at = excluded.updated_at").run(imp.payload_digest, imp.package_id, imp.version, now);
          ctx.store.db.prepare("UPDATE imports SET status = 'active', memorable = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(memorable), now, imp.id);
          ctx.store.db.exec("COMMIT");
          ctx.store.audit("owner", "procedure.activated", `${imp.id} ${imp.payload_digest.slice(0, 16)}${status === "reduced" ? " (reduced)" : ""}`);
          const memRefs = memorable.slug ? [{ label: "Memorable memory slug", value: String(memorable.slug) }, { label: "Memorable recall evidence", value: `offline recall → ${memorable.slug} (similarity ${(memorable.recall as Json).similarity})` }] : [{ label: "Memorable local store", value: "reduced: not stored" }];
          ctx.store.setStage(
            "acceptance",
            status,
            status === "done"
              ? `Harbor owner activated ${imp.package_id} v${imp.version} after ${report.passed}/${report.total} local acceptance tests; stored in Harbor's own Memorable store and recalled locally.`
              : `Reduced: Harbor owner activated ${imp.package_id} v${imp.version} after ${report.passed}/${report.total} local acceptance tests, without Harbor's Memorable local store (${String(memorable.reason)}).`,
            [...baseRefs, ...memRefs, { label: "Owner approval", value: `activated ${now}` }, elapsed(started)],
          );
          ctx.send(res, 200, { activated: true, status, report, memorable, active: await activeProcedure(ctx, { recall: false }) });
        } finally {
          inFlight = false;
        }
      },
    },
  ];
}
