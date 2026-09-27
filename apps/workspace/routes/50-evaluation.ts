import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Route } from "../context.ts";
import type { StageRef } from "../../../packages/contracts/workflow.ts";
import { getCandidate } from "../../../packages/publication/state.ts";
import { runDefender, CHECKLIST, type DefenderRun, type ModelSettings, type ScenarioCase } from "../../../packages/evaluator/defender.ts";
import { aggregate, loadLabels, promotionGate, scoreCase, EVALUATOR_REVISION } from "../../../packages/evaluator/score.ts";

const RIVER_SHIM = process.env.RIVER_SHIM_URL ?? "http://127.0.0.1:7110";
const QM_UNAVAILABLE = "QM swarm unavailable: the QM dev instance runs the mock harness and FIA has no QM source-auth credentials (CORE_SIGNING_SECRET + PORTAL_IDENTITY_SECRET) to open a root session and spawn workers";

const TEST_PROCEDURE = [
  "TEST PROCEDURE (evaluator self-test, not a Memorable output):",
  "1. Read the full thread and transcripts for any payment-change claim.",
  "2. Compare against the supplier record and payment history.",
  "3. If bank details differ from the record, call the contact on file (never a number from the request) and hold until confirmed.",
  "4. Release only when details match the record or were independently confirmed; cite source ids.",
].join("\n");

function procedureText(p: { title: string; trigger: string; steps: { seq: number; instruction: string }[]; preconditions: string[]; postconditions: string[] }) {
  return [`${p.title}`, `Trigger: ${p.trigger}`, ...p.steps.map((s) => `${s.seq}. ${s.instruction}`), p.preconditions.length ? `Preconditions: ${p.preconditions.join("; ")}` : "", p.postconditions.length ? `Postconditions: ${p.postconditions.join("; ")}` : ""].filter(Boolean).join("\n");
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

export function register(ctx: Ctx): Route[] {
  if (ctx.workspace !== "northline") return [];
  const dir = join(ctx.dataDir, "evaluations");
  const stageDone = (id: string) => ctx.store.stages().some((s) => s.id === id && (s.status === "done" || s.status === "reduced"));
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  let running = false;

  async function evaluate(procedure: { text: string; source: string; sha256: string; candidateId: string | null }) {
    const started = Date.now();
    const casesRaw = readFileSync(join(ctx.root, "fixtures", "scenarios", "validation", "cases.json"), "utf8");
    const cases = (JSON.parse(casesRaw) as { cases: ScenarioCase[] }).cases;
    const labels = new Map(loadLabels("validation").map((l) => [l.id, l]));
    const manifest = JSON.parse(readFileSync(join(ctx.root, "fixtures", "scenarios", "manifest.json"), "utf8")) as Record<string, unknown>;
    const settings: ModelSettings = { baseUrl: RIVER_SHIM, model: "Qwen/Qwen3.5-9B", temperature: 0, maxTokens: 400, maxSteps: 8 };
    const jobs = cases.flatMap((c) => [{ c, arm: "baseline_checklist", proc: null as string | null }, { c, arm: "checklist_plus_procedure", proc: procedure.text }]);
    const runs = await pool(jobs, 8, (j) => runDefender(j.c, j.arm, j.proc, settings));
    const byArm = (arm: string) => runs.filter((r) => r.arm === arm);
    const scoreArm = (arm: string) => byArm(arm).map((r) => scoreCase(cases.find((c) => c.id === r.caseId)!, labels.get(r.caseId)!, r));
    const baseScores = scoreArm("baseline_checklist");
    const candScores = scoreArm("checklist_plus_procedure");
    const finalIds = (JSON.parse(readFileSync(join(ctx.root, "fixtures", "scenarios", "final", "cases.json"), "utf8")) as { cases: { id: string }[] }).cases.map((c) => c.id);
    const isolation = [
      { id: "procedure_has_no_workspace_canary", pass: !procedure.text.includes(ctx.fixture.canary) },
      { id: "procedure_has_no_final_case_ids", pass: finalIds.every((id) => !procedure.text.includes(id)) },
      { id: "defender_saw_only_validation_cases", pass: runs.every((r) => !finalIds.includes(r.caseId)) },
    ];
    const isolationFailures = isolation.filter((c) => !c.pass).length;
    const baseline = aggregate(baseScores);
    const candidate = aggregate(candScores);
    const errored = runs.filter((r) => r.error);
    const disagreements = cases.map((c) => {
      const b = baseScores.find((s) => s.caseId === c.id)!;
      const k = candScores.find((s) => s.caseId === c.id)!;
      return { caseId: c.id, family: c.family, kind: b.kind, expected: b.expected, baseline: b.decision, candidate: k.decision, baselineCorrect: b.correctVerificationHandling, candidateCorrect: k.correctVerificationHandling };
    }).filter((d) => d.baseline !== d.candidate || d.baselineCorrect !== d.candidateCorrect);
    const id = `eval-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const report = {
      report_id: id,
      workspace: ctx.workspace,
      created_at: new Date().toISOString(),
      suite: { name: manifest.suite, split: "validation", cases: cases.length, fraud: [...labels.values()].filter((l) => l.kind === "fraud").length, legitimate: [...labels.values()].filter((l) => l.kind === "legitimate").length, cases_sha256: sha(casesRaw), manifest_splits: manifest.splits, near_duplicate_check: manifest.near_duplicate_check, final_split: "locked, not run" },
      candidate_procedure: { source: procedure.source, candidate_id: procedure.candidateId, sha256: procedure.sha256 },
      evaluator: { revision: EVALUATOR_REVISION, code: ["packages/evaluator/score.ts", "packages/evaluator/defender.ts"], labels: "packages/evaluator/labels/validation.json (not visible to defender or scenario workers)" },
      configuration: { model: settings.model, runtime: "River inference via FIA shim (OpenAI-compatible chat completions)", endpoint: `${RIVER_SHIM}/v1/chat/completions`, temperature: settings.temperature, max_tokens: settings.maxTokens, max_steps: settings.maxSteps, tool_access: "identical simulator tools for both arms", checklist: CHECKLIST, arms: ["baseline_checklist", "checklist_plus_procedure"], concurrency: 8 },
      qm: { status: "unavailable", reason: QM_UNAVAILABLE, root_session_id: null, worker_session_ids: [] },
      metrics: { baseline, candidate },
      promotion: promotionGate(baseline, candidate, isolationFailures, errored.length),
      isolation_checks: isolation,
      disagreements,
      inference: { runs: runs.length, errored: errored.length, requests: runs.reduce((a, r) => a + r.requestIds.length, 0), prompt_tokens: runs.reduce((a, r) => a + r.usage.prompt_tokens, 0), completion_tokens: runs.reduce((a, r) => a + r.usage.completion_tokens, 0), parse_failures: runs.reduce((a, r) => a + r.parseFailures, 0) },
      cases: cases.map((c) => ({ caseId: c.id, family: c.family, baseline: { score: baseScores.find((s) => s.caseId === c.id), run: runs.find((r) => r.caseId === c.id && r.arm === "baseline_checklist") }, candidate: { score: candScores.find((s) => s.caseId === c.id), run: runs.find((r) => r.caseId === c.id && r.arm === "checklist_plus_procedure") } })),
      elapsed_ms: Date.now() - started,
    };
    return { report, runs, errored };
  }

  function save(report: { report_id: string }, test: boolean) {
    const target = test ? join(dir, "test") : dir;
    mkdirSync(target, { recursive: true });
    const text = JSON.stringify(report, null, 2) + "\n";
    writeFileSync(join(target, `${report.report_id}.json`), text);
    if (!test) writeFileSync(join(dir, "latest.json"), text);
    return sha(text);
  }

  return [
    {
      method: "GET",
      path: "/api/evaluations/latest",
      handler: (_req, res) => {
        const f = join(dir, "latest.json");
        if (!existsSync(f)) return ctx.send(res, 404, { error: "no validation report yet" });
        ctx.send(res, 200, JSON.parse(readFileSync(f, "utf8")));
      },
    },
    {
      method: "POST",
      path: "/api/workflow/evaluation/run",
      handler: async (req, res) => {
        const body = await ctx.readJson(req);
        const test = body.testProcedure === true;
        const cand = getCandidate(ctx.store);
        if (!test && (!stageDone("extraction") || !cand)) return ctx.send(res, 409, { error: "extraction stage is not done: no candidate procedure to evaluate. POST {\"testProcedure\":true} runs the evaluator self-test with a labeled test procedure (not recorded as the stage result)." });
        if (running) return ctx.send(res, 409, { error: "an evaluation is already running" });
        const health = await fetch(`${RIVER_SHIM}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false);
        if (!health) {
          if (!test) ctx.store.setStage("evaluation", "blocked", `River inference shim not reachable at ${RIVER_SHIM}; no defender runs executed.`, [{ label: "Missing", value: `${RIVER_SHIM}/health` }]);
          return ctx.send(res, 503, { error: `River inference shim not reachable at ${RIVER_SHIM}` });
        }
        running = true;
        const started = Date.now();
        try {
          const procedure = test || !cand
            ? { text: TEST_PROCEDURE, source: "evaluator_test_procedure", sha256: sha(TEST_PROCEDURE), candidateId: null }
            : { text: procedureText(cand.procedure), source: cand.procedure.source.kind, sha256: cand.procedure_sha256, candidateId: cand.candidate_id };
          if (!test) ctx.store.setStage("evaluation", "running", `Fixed FIA scorer running baseline vs candidate on the frozen validation split via River (${QM_UNAVAILABLE}).`, [{ label: "Procedure hash", value: procedure.sha256 }]);
          const { report, runs, errored } = await evaluate(procedure);
          const hash = save(report, test);
          const b = report.metrics.baseline;
          const c = report.metrics.candidate;
          const summary = `Validation ${report.suite.cases} cases (${report.suite.fraud} fraud / ${report.suite.legitimate} legitimate), same Qwen3.5-9B via River: correct handling ${c.correct_verification_handling.numerator}/${c.correct_verification_handling.denominator} with procedure vs ${b.correct_verification_handling.numerator}/${b.correct_verification_handling.denominator} checklist-only; unsafe ${c.unsafe_recommendations.numerator}/${c.unsafe_recommendations.denominator} vs ${b.unsafe_recommendations.numerator}/${b.unsafe_recommendations.denominator}; unnecessary holds ${c.unnecessary_terminal_holds.numerator}/${c.unnecessary_terminal_holds.denominator} vs ${b.unnecessary_terminal_holds.numerator}/${b.unnecessary_terminal_holds.denominator}; unauthorized state changes ${c.unauthorized_state_changes.numerator}. Gate: ${report.promotion.decision}.${errored.length ? ` ${errored.length} runs errored.` : ""}`;
          const reqIds = runs.flatMap((r) => r.requestIds);
          const refs: StageRef[] = [
            { label: "Report id", value: report.report_id },
            { label: "Report hash", value: hash },
            { label: "Procedure hash", value: procedure.sha256 },
            { label: "Evaluator revision", value: EVALUATOR_REVISION },
            { label: "River requests", value: String(reqIds.length) },
            ...reqIds.slice(0, 3).map((r, i) => ({ label: `River request id ${i + 1}`, value: r })),
            { label: "Elapsed", value: `${((Date.now() - started) / 1000).toFixed(1)} s` },
          ];
          if (!test) {
            const status = errored.length === runs.length ? "failed" : "reduced";
            ctx.store.setStage("evaluation", status, status === "failed" ? `All defender runs failed: ${errored[0]?.error}` : `reduced: ${QM_UNAVAILABLE}; fixed FIA scorer ran. ${summary}`, refs);
          }
          ctx.send(res, 200, { test, reportId: report.report_id, reportHash: hash, summary, metrics: report.metrics, promotion: report.promotion, disagreements: report.disagreements, qm: report.qm });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!test) ctx.store.setStage("evaluation", "failed", `Evaluation failed: ${msg}`, [{ label: "Elapsed", value: `${((Date.now() - started) / 1000).toFixed(1)} s` }]);
          ctx.send(res, 500, { error: msg });
        } finally {
          running = false;
        }
      },
    },
  ];
}
