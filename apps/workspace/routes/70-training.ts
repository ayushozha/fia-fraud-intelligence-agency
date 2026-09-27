import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import type { Ctx, Route } from "../context.ts";
import type { StageRef } from "../../../packages/contracts/workflow.ts";
import type { ProcedureContext } from "../../../integrations/river/prompt.ts";
import { PROMOTION_GATE, gate, renderTrainingSet, riverKeyConfigured, runVariant, sha256, shimHealth, sidecar, summarize, type VariantReport } from "../../../integrations/river/runner.ts";

type Run = {
  id: string;
  status: "building" | "training" | "evaluating" | "trained" | "failed";
  startedAt: string;
  finishedAt: string | null;
  approvedDatasetHash: string;
  procedure: { source: string; packageId: string | null; packageHash: string | null; steps: number };
  dataset: Record<string, any> | null;
  training: Record<string, any> | null;
  comparison: Record<string, any> | null;
  adapter: Record<string, any> | null;
  error: string | null;
};

const BASE_MODEL = "Qwen/Qwen3.5-9B";

export function register(ctx: Ctx): Route[] {
  if (ctx.workspace !== "harbor") return [];
  const riverData = join(ctx.dataDir, "river");
  const modelsDir = join(ctx.dataDir, "models");
  mkdirSync(riverData, { recursive: true });
  mkdirSync(modelsDir, { recursive: true });
  let active: Promise<void> | null = null;

  const runDir = (id: string) => join(riverData, "runs", id);
  const saveRun = (run: Run) => {
    mkdirSync(runDir(run.id), { recursive: true });
    writeFileSync(join(runDir(run.id), "run.json"), JSON.stringify(run, null, 2) + "\n");
    ctx.store.setMeta("training.latest", run.id);
  };
  const loadRun = (id: string | null): Run | null => {
    if (!id) return null;
    const f = join(runDir(id), "run.json");
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Run) : null;
  };
  const latest = () => loadRun(ctx.store.getMeta("training.latest"));
  const stageOf = (id: string) => ctx.store.stages().find((s) => s.id === id);
  const elapsed = (from: string, to: string | null) => {
    const s = Math.round((Date.parse(to ?? new Date().toISOString()) - Date.parse(from)) / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  };
  const token = () => readFileSync(join(ctx.dataDir, "owner.token"), "utf8").trim();
  const port = Number(process.env.PORT ?? 7102);

  function findSteps(v: unknown, depth = 0): string[] | null {
    if (depth > 6 || !v || typeof v !== "object") return null;
    if (Array.isArray(v)) {
      if (v.length >= 3 && v.every((x) => typeof x === "string" && x.length > 12)) return v as string[];
      if (v.length >= 3 && v.every((x) => x && typeof x === "object" && typeof (x as any).text === "string")) return v.map((x) => (x as any).text);
      for (const x of v) {
        const r = findSteps(x, depth + 1);
        if (r) return r;
      }
      return null;
    }
    const o = v as Record<string, unknown>;
    for (const k of ["steps", "procedure", "instructions", "checklist", "content"]) {
      if (k in o) {
        const r = findSteps(o[k], depth + 1);
        if (r) return r;
        if (typeof o[k] === "string" && (o[k] as string).split("\n").filter((l) => /^\s*(\d+[.)]|[-*•])\s+/.test(l)).length >= 3) return (o[k] as string).split("\n").filter((l) => /^\s*(\d+[.)]|[-*•])\s+/.test(l)).map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s+/, "").trim());
      }
    }
    for (const x of Object.values(o)) {
      const r = findSteps(x, depth + 1);
      if (r) return r;
    }
    return null;
  }

  async function procedureContext(): Promise<ProcedureContext> {
    const active = ctx.store.activeProcedure();
    for (const path of ["/api/procedures/active", "/api/acceptance/latest", "/api/memorable/procedures/active", "/api/procedures"]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(4000) });
        if (!res.ok) continue;
        const steps = findSteps(await res.json());
        if (steps) return { source: `harbor installed procedure (${path})`, packageId: active?.package_id ?? null, packageHash: active?.package_hash ?? null, steps };
      } catch {}
    }
    const ref = JSON.parse(readFileSync(join(ctx.root, "fixtures", "training", "procedure-context.json"), "utf8")) as { steps: string[] };
    return { source: "reference procedure text (fixtures/training/procedure-context.json); installed procedure text not exposed by this workspace", packageId: active?.package_id ?? null, packageHash: active?.package_hash ?? null, steps: ref.steps };
  }

  async function buildDataset(dir: string) {
    mkdirSync(dir, { recursive: true });
    const procedure = await procedureContext();
    const rendered = renderTrainingSet(ctx.root, join(dir, "rendered.train.jsonl"), procedure);
    writeFileSync(join(dir, "procedure-context.json"), JSON.stringify(procedure, null, 2) + "\n");
    const r = await sidecar(ctx.root, ["build-dataset", "--rendered", join(dir, "rendered.train.jsonl"), "--out", dir]);
    const last = r.events.at(-1) as Record<string, any> | undefined;
    if (r.code !== 0 || !last?.ok) throw new Error(`dataset build failed: ${last?.error ?? r.stderr.slice(-400)}`);
    const split = JSON.parse(readFileSync(join(ctx.root, "fixtures", "training", "split-manifest.json"), "utf8"));
    return { procedure, rendered, manifest: last, split };
  }

  function refsFor(run: Run): StageRef[] {
    const refs: StageRef[] = [];
    if (run.training?.training_run_id) refs.push({ label: "River training run id", value: run.training.training_run_id });
    if (run.training?.session_id) refs.push({ label: "River session id", value: run.training.session_id });
    if (run.training?.checkpoint?.path) refs.push({ label: "Checkpoint id", value: run.training.checkpoint.path });
    if (run.dataset?.dataset?.sha256) refs.push({ label: "Dataset hash", value: `sha256:${run.dataset.dataset.sha256}` });
    if (run.training?.attestation?.id) refs.push({ label: "Dataset attestation id", value: run.training.attestation.id });
    if (run.comparison?.reportHash) refs.push({ label: "Comparison report hash", value: `sha256:${run.comparison.reportHash}` });
    if (run.adapter?.adapterHash) refs.push({ label: "Adapter hash", value: `sha256:${run.adapter.adapterHash}` });
    refs.push({ label: "Elapsed", value: elapsed(run.startedAt, run.finishedAt) });
    return refs;
  }

  function settle(run: Run) {
    const refs = refsFor(run);
    if (run.status === "failed") return ctx.store.setStage("training", "failed", `River training failed: ${run.error}. Incumbent procedure-only defender stays active. A reduced path (procedure-only, failed integration disclosed) can be chosen by the owner.`, refs);
    if (!run.comparison) return;
    const c = run.comparison;
    const verdict = c.promoted ? `Candidate PROMOTED on validation: ${c.summary.candidate} vs incumbent ${c.summary.incumbent}.` : `Candidate REJECTED (${c.reasons.join("; ")}). Incumbent procedure-only defender stays active.`;
    if (!run.adapter) {
      return ctx.store.setStage("training", "blocked", `Real River training done (${run.training?.steps?.length ?? 0} steps, checkpoint ${run.training?.checkpoint?.path}). ${verdict} Waiting for owner export: download the PEFT LoRA for that checkpoint from River Console → Checkpoints into data/harbor/models/, then POST /api/training/adapter {"approve": true}. (reduced path: keep procedure-only defender)`, refs);
    }
    const a = run.adapter;
    ctx.store.setStage("training", "done", `${verdict} Exported adapter inspected: ${a.files.length} files, sha256:${String(a.adapterHash).slice(0, 12)}…, base ${a.baseModel ?? "unknown"} ${a.baseMatches ? "(matches)" : "(MISMATCH)"}. Local load: ${a.localLoad.status} — ${a.localLoad.detail}`, refs);
  }

  async function compare(run: Run) {
    run.status = "evaluating";
    saveRun(run);
    const health = await shimHealth();
    if (!health.ok) throw new Error(`River inference shim unavailable at ${process.env.RIVER_SHIM_URL ?? "http://127.0.0.1:7110"} (start integrations/river/serve.sh)`);
    const procedure = JSON.parse(readFileSync(join(runDir(run.id), "dataset", "procedure-context.json"), "utf8")) as ProcedureContext;
    const checkpoint = run.training!.checkpoint.path as string;
    const reports: VariantReport[] = [];
    for (const v of ["checklist", "checklist_procedure", "checklist_procedure_adapter"] as const) {
      ctx.store.setStage("training", "running", `Measured comparison on ${v.replaceAll("_", " + ")} (validation split, same base on River serving)…`, refsFor(run));
      reports.push(await runVariant(ctx.root, v, procedure, checkpoint, (d, t) => {
        if (d % 8 === 0 || d === t) ctx.store.setStage("training", "running", `Measured comparison: ${v.replaceAll("_", " + ")} ${d}/${t} validation cases`, refsFor(run));
      }));
    }
    for (const r of reports) for (const c of r.results) if (c.requestId) ctx.store.recordUsage("jordan", "river", `eval.${r.variant}`, c.tokens, "tokens", c.requestId);
    const g = gate(reports[1], reports[2]);
    const body = { evaluatedAt: new Date().toISOString(), split: "validation", gate: PROMOTION_GATE, runtime: { service: "River serving via FIA shim", base: BASE_MODEL, decoding: { temperature: 0, max_tokens: 400, seed: 7 } }, variants: reports };
    const text = JSON.stringify(body, null, 2) + "\n";
    writeFileSync(join(runDir(run.id), "comparison.json"), text);
    run.comparison = { reportHash: sha256(text), file: relative(ctx.root, join(runDir(run.id), "comparison.json")), promoted: g.promoted, reasons: g.reasons, summary: { checklist: summarize(reports[0]), incumbent: summarize(reports[1]), candidate: summarize(reports[2]) }, evaluatedAt: body.evaluatedAt };
    run.status = "trained";
    run.finishedAt = new Date().toISOString();
    saveRun(run);
    ctx.store.audit("jordan", "training.comparison", `${g.promoted ? "promoted" : "rejected"}: ${g.reasons.join("; ") || "gate passed"}`);
  }

  async function train(run: Run, steps: number) {
    const dir = runDir(run.id);
    run.status = "training";
    saveRun(run);
    ctx.store.setStage("training", "running", `River: opening session and creating ${BASE_MODEL} LoRA model…`, refsFor(run));
    const r = await sidecar(ctx.root, ["train", "--dataset-dir", join(dir, "dataset"), "--out", join(dir, "training"), "--name", `harbor-defender-${run.id.slice(0, 8)}`, "--steps", String(steps)], (e) => {
      if (e.event === "step") ctx.store.setStage("training", "running", `River training step ${e.step}/${steps}: loss_mean ${Number(e.loss_mean).toFixed(4)}`, refsFor(run));
      if (e.event === "model") ctx.store.addReceipt("river", "training", `training_run:${e.training_run_id}`, run.dataset?.dataset?.sha256 ?? null);
    });
    const resultFile = join(dir, "training", "result.json");
    run.training = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, "utf8")) : null;
    if (!run.training?.ok) throw new Error(run.training?.error ?? r.stderr.slice(-400) ?? "training sidecar failed");
    const t = run.training;
    ctx.store.addReceipt("river", "training", `attestation:${t.attestation.id}`, t.dataset_sha256);
    ctx.store.addReceipt("river", "training", t.checkpoint.path, t.dataset_sha256);
    ctx.store.recordUsage("jordan", "river", "training.forward_backward", t.steps.reduce((a: number, s: any) => a + Number(s.num_tokens ?? 0), 0), "tokens", t.training_run_id);
    ctx.store.recordUsage("jordan", "river", "training.optim_step", t.steps.length, "steps", t.training_run_id);
    ctx.store.audit("jordan", "training.checkpoint", `${t.checkpoint.path} after ${t.steps.length} steps`);
    saveRun(run);
  }

  function start(run: Run, steps: number) {
    active = (async () => {
      try {
        await train(run, steps);
        await compare(run);
      } catch (err) {
        run.status = "failed";
        run.error = err instanceof Error ? err.message : String(err);
        run.finishedAt = new Date().toISOString();
        saveRun(run);
      }
      settle(run);
    })().finally(() => {
      active = null;
    });
  }

  function hashTree(dir: string) {
    const files: { path: string; bytes: number; sha256: string }[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d).sort()) {
        const p = join(d, f);
        if (f.startsWith(".")) continue;
        if (statSync(p).isDirectory()) walk(p);
        else files.push({ path: relative(dir, p), bytes: statSync(p).size, sha256: createHash("sha256").update(readFileSync(p)).digest("hex") });
      }
    };
    walk(dir);
    return files;
  }

  function safetensorsHeader(file: string) {
    const buf = readFileSync(file);
    const n = Number(buf.readBigUInt64LE(0));
    const header = JSON.parse(buf.subarray(8, 8 + n).toString("utf8")) as Record<string, { dtype: string; shape: number[] }>;
    const tensors = Object.entries(header).filter(([k]) => k !== "__metadata__");
    return { tensors: tensors.length, dtypes: [...new Set(tensors.map(([, v]) => v.dtype))], sample: tensors.slice(0, 3).map(([k, v]) => `${k} ${JSON.stringify(v.shape)}`) };
  }

  function locateAdapter(): string | null {
    const candidates: string[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 3) return;
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p, depth + 1);
        else if (f === "adapter_config.json") candidates.push(d);
      }
    };
    for (const f of readdirSync(modelsDir)) {
      const p = join(modelsDir, f);
      if (/\.(zip)$/i.test(f) && !existsSync(p.replace(/\.zip$/i, ""))) execFileSync("unzip", ["-q", "-o", p, "-d", p.replace(/\.zip$/i, "")]);
      if (/\.(tar\.gz|tgz|tar)$/i.test(f)) {
        const out = p.replace(/\.(tar\.gz|tgz|tar)$/i, "");
        if (!existsSync(out)) {
          mkdirSync(out, { recursive: true });
          execFileSync("tar", ["-xf", p, "-C", out]);
        }
      }
    }
    walk(modelsDir, 0);
    return candidates.sort((a, b) => statSync(join(b, "adapter_config.json")).mtimeMs - statSync(join(a, "adapter_config.json")).mtimeMs)[0] ?? null;
  }

  async function installAdapter(run: Run) {
    const dir = locateAdapter();
    if (!dir) return { error: `No PEFT adapter found. Download the LoRA for ${run.training?.checkpoint?.path ?? "the trained checkpoint"} from River Console → Checkpoints and place its folder (adapter_config.json + adapter_model.safetensors) or .zip in ${relative(ctx.root, modelsDir)}/.` };
    const files = hashTree(dir);
    const adapterHash = sha256(files.map((f) => `${f.path}:${f.sha256}`).join("\n"));
    const cfg = JSON.parse(readFileSync(join(dir, "adapter_config.json"), "utf8")) as Record<string, any>;
    const st = files.find((f) => f.path.endsWith(".safetensors"));
    const tensors = st ? safetensorsHeader(join(dir, st.path)) : null;
    const baseModel = cfg.base_model_name_or_path ?? null;
    const baseMatches = typeof baseModel === "string" && baseModel.replace(/-FP8$/, "").endsWith("Qwen3.5-9B");
    const ggufOut = join(modelsDir, `harbor-defender-${adapterHash.slice(0, 12)}.gguf`);
    const conv = await sidecar(ctx.root, ["convert", "--adapter-dir", dir, "--outfile", ggufOut]);
    const cv = (conv.events.at(-1) ?? { ok: false, error: conv.stderr.slice(-300) }) as Record<string, any>;
    const localLoad = cv.ok
      ? { status: "converted_not_loaded", detail: `PEFT → GGUF LoRA conversion succeeded (sha256:${String(cv.sha256).slice(0, 12)}…). No local base-model runtime is installed (owner chose River-hosted inference, no local model download), so the adapter was not loaded locally; serving uses the River checkpoint.`, gguf: { file: relative(ctx.root, ggufOut), sha256: cv.sha256, bytes: cv.bytes } }
      : { status: "incompatible_or_failed", detail: `PEFT → GGUF conversion did not complete: ${String(cv.error ?? "unknown").slice(0, 200)}. No local runtime load was possible.`, log: String(cv.log_tail ?? "").slice(-800) };
    const manifest = {
      recordedAt: new Date().toISOString(),
      workspace: "harbor",
      base: { id: BASE_MODEL, tokenizerRevision: "c202236235762e1c871ad0ccb60c8ee5ba337b9a" },
      adapter: { format: "PEFT LoRA", source: "River Console → Checkpoints download (owner-attested)", riverCheckpoint: run.training?.checkpoint?.path ?? null, trainingRunId: run.training?.training_run_id ?? null, dir: relative(ctx.root, dir), hash: `sha256:${adapterHash}`, files, rank: cfg.r ?? null, alpha: cfg.lora_alpha ?? null, targetModules: cfg.target_modules ?? null, baseModelInConfig: baseModel, baseMatches, tensors },
      runtime: { serving: "River ChatCompleteFromCheckpoint via FIA shim (integrations/river/serve.py)", localConversion: "llama.cpp convert_lora_to_gguf.py", llamaCppCommit: gitHead(join(ctx.root, "integrations", "river", "vendor", "llama.cpp")), localLoad, contextLimit: null, quantization: "server-side (River)" },
      dataset: { sha256: run.dataset?.dataset?.sha256 ?? null, attestation: run.training?.attestation?.id ?? null },
      comparison: run.comparison ? { reportHash: run.comparison.reportHash, promoted: run.comparison.promoted } : null,
      status: run.comparison?.promoted ? "active_candidate" : "rejected_candidate_retained",
    };
    writeFileSync(join(modelsDir, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    ctx.store.addReceipt("river", "training", `adapter:${basename(dir)}`, adapterHash);
    ctx.store.audit("owner", "training.adapter_installed", `sha256:${adapterHash} ${localLoad.status}`);
    return { adapterHash, dir: relative(ctx.root, dir), files, baseModel, baseMatches, localLoad, manifest: relative(ctx.root, join(modelsDir, "runtime-manifest.json")) };
  }

  function gitHead(dir: string) {
    try {
      return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  }

  const view = (run: Run | null) => ({
    running: Boolean(active),
    run,
    runtimeManifest: existsSync(join(modelsDir, "runtime-manifest.json")) ? JSON.parse(readFileSync(join(modelsDir, "runtime-manifest.json"), "utf8")) : null,
    activeModel: run?.comparison?.promoted && run.training?.checkpoint?.path ? { base: BASE_MODEL, checkpoint: run.training.checkpoint.path } : { base: BASE_MODEL, checkpoint: null, note: "incumbent: base model + installed procedure" },
  });

  return [
    {
      method: "GET",
      path: "/api/training/latest",
      handler: (_req, res) => ctx.send(res, 200, view(latest())),
    },
    {
      method: "GET",
      path: "/api/training/dataset",
      handler: async (_req, res) => {
        const dir = join(riverData, "preview");
        try {
          const d = await buildDataset(dir);
          ctx.send(res, 200, { split: d.split, procedure: { source: d.procedure.source, packageId: d.procedure.packageId, packageHash: d.procedure.packageHash, steps: d.procedure.steps }, dataset: d.manifest.dataset, tokenizer: d.manifest.tokenizer, source: d.manifest.source });
        } catch (err) {
          ctx.send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    {
      method: "POST",
      path: "/api/workflow/training/run",
      handler: async (req, res) => {
        const body = await ctx.readJson(req);
        const prereq = stageOf("harbor_investigation");
        if (!prereq || !["done", "reduced"].includes(prereq.status)) return ctx.send(res, 409, { error: "harbor_investigation must be done (or reduced) before training" });
        if (active) return ctx.send(res, 202, { status: "running", ...view(latest()) });
        const prev = latest();
        if (body.reduced === true) {
          if (body.approve !== true) return ctx.send(res, 409, { error: "Owner approval required to choose the reduced path (procedure-only defender, River failure disclosed)" });
          const why = prev?.status === "failed" ? `River training failed: ${prev.error}` : prev?.adapter?.localLoad ? `local adapter load: ${prev.adapter.localLoad.status}` : "owner chose not to complete adapter export";
          ctx.store.setStage("training", "reduced", `Reduced (owner-chosen): procedure-only local defender retained; ${why}. Claim removed: "training improved protection" / full trained-offline completion.`, prev ? refsFor(prev) : []);
          ctx.store.audit("owner", "training.reduced", why);
          return ctx.send(res, 200, { status: "reduced", reason: why });
        }
        if (prev && prev.status === "trained" && body.retrain !== true) {
          settle(prev);
          return ctx.send(res, 200, { replayed: true, note: "Saved, timestamped training record replayed; pass {\"retrain\": true, \"approve\": true} to train a new candidate.", ...view(prev) });
        }
        if (!riverKeyConfigured(ctx.root)) {
          ctx.store.setStage("training", "blocked", "RIVER_API_KEY not set. Dataset, sidecar and comparison are ready; add the key to .env and rerun. (reduced path: procedure-only defender)", []);
          return ctx.send(res, 503, { error: "RIVER_API_KEY not set" });
        }
        const id = randomUUID();
        const dir = join(runDir(id), "dataset");
        let d;
        try {
          d = await buildDataset(dir);
        } catch (err) {
          return ctx.send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        const hash = String(d.manifest.dataset.sha256);
        if (body.approve !== true) {
          return ctx.send(res, 409, { error: `Owner approval required: approve cloud training with River on dataset sha256:${hash.slice(0, 16)}… (${d.manifest.dataset.examples} synthetic corrected trajectories, ${d.split.splits.train.families.length} scenario families; no Harbor private records).`, datasetHash: hash, examples: d.manifest.dataset.examples, procedureSource: d.procedure.source });
        }
        if (typeof body.datasetHash === "string" && body.datasetHash.replace(/^sha256:/, "") !== hash) return ctx.send(res, 409, { error: `approved dataset hash does not match the rebuilt dataset sha256:${hash}` });
        const steps = Math.max(1, Math.min(40, Number(body.steps ?? 10)));
        const run: Run = { id, status: "building", startedAt: new Date().toISOString(), finishedAt: null, approvedDatasetHash: hash, procedure: { source: d.procedure.source, packageId: d.procedure.packageId, packageHash: d.procedure.packageHash, steps: d.procedure.steps.length }, dataset: { ...d.manifest, split: d.split }, training: null, comparison: null, adapter: null, error: null };
        saveRun(run);
        ctx.store.audit("owner", "training.dataset_approved", `sha256:${hash}`);
        start(run, steps);
        ctx.send(res, 202, { status: "running", runId: id, datasetHash: `sha256:${hash}`, steps });
      },
    },
    {
      method: "POST",
      path: "/api/training/compare",
      handler: async (req, res) => {
        const body = await ctx.readJson(req);
        const run = latest();
        if (!run?.training?.checkpoint?.path) return ctx.send(res, 409, { error: "no trained checkpoint to compare" });
        if (active) return ctx.send(res, 202, { status: "running" });
        if (body.approve !== true) return ctx.send(res, 409, { error: "Owner approval required to re-run the measured comparison (uses River inference)" });
        active = compare(run).catch((err) => {
          run.error = `comparison failed: ${err instanceof Error ? err.message : String(err)}`;
          saveRun(run);
        }).then(() => settle(run)).finally(() => {
          active = null;
        });
        ctx.send(res, 202, { status: "running", runId: run.id });
      },
    },
    {
      method: "POST",
      path: "/api/training/adapter",
      handler: async (req, res) => {
        const body = await ctx.readJson(req);
        const run = latest();
        if (!run?.training?.checkpoint?.path) return ctx.send(res, 409, { error: "no River training checkpoint recorded yet" });
        if (body.approve !== true) return ctx.send(res, 409, { error: `Owner approval required: confirm the adapter placed in ${relative(ctx.root, modelsDir)}/ was downloaded from River Console for ${run.training.checkpoint.path}` });
        try {
          const result = await installAdapter(run);
          if ("error" in result) return ctx.send(res, 409, result);
          run.adapter = result;
          saveRun(run);
          settle(run);
          ctx.send(res, 200, view(run));
        } catch (err) {
          ctx.send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  ];
}
