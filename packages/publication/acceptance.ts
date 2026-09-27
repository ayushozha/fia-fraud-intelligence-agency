import { canonical, sha256, type Json, type Verification } from "./package.ts";
import { TOOL_ALLOWLIST } from "./schema.ts";

export type PolicyFact = { id: string | number; text: string; provenance: string };
export type AcceptanceTest = { id: string; name: string; ok: boolean; detail: string; evidence: string[] };
export type Binding = { name: string; value: string | number | null; factId: string | null; source: string | null };

type Step = { seq: number; tool: string; instruction: string; command: string | null; binds: string[] };

const FORBIDDEN = /\b(release|approve|publish|transfer|wire|send payment|pay now|execute payment|change recipients|disable|shell|curl|http[s]?:\/\/)\b/i;
const THRESHOLD = /(\$\s?\d)|(\b\d+\s*(day|days|hour|hours)\b)|(\b\d{3,}\s*(usd|dollars|cents)\b)/i;

export function resolveBindings(names: string[], policy: PolicyFact[]): Binding[] {
  return names.map((name) => {
    if (name === "reconcile_window_days") {
      const f = policy.find((p) => /within\s+(\d+)\s+days/i.test(p.text));
      return { name, value: f ? Number(f.text.match(/within\s+(\d+)\s+days/i)![1]) : null, factId: f ? String(f.id) : null, source: f?.provenance ?? null };
    }
    if (name === "independent_verification_route") {
      const f = policy.find((p) => /contact/i.test(p.text) && /(independent|established|vendor master|on file)/i.test(p.text));
      return { name, value: f ? "supplier contact recorded in the local vendor master, independent of the requesting message" : null, factId: f ? String(f.id) : null, source: f?.provenance ?? null };
    }
    return { name, value: null, factId: null, source: null };
  });
}

export function policyHash(policy: PolicyFact[]) {
  return sha256(canonical(policy.map((p) => ({ id: String(p.id), text: p.text })).sort((a, b) => a.id.localeCompare(b.id))));
}

export function runAcceptance(v: Verification, policy: PolicyFact[], workspace: string) {
  const tests: AcceptanceTest[] = [];
  const t = (id: string, name: string, ok: boolean, detail: string, evidence: string[] = []) => tests.push({ id, name, ok, detail, evidence });
  const m = (v.manifest ?? {}) as Json;
  const proc = (v.procedure ?? {}) as Json;
  const steps = (proc.steps ?? []) as Step[];
  const text = (s: Step) => `${s.instruction} ${s.command ?? ""}`;

  t("H-ACC-01", "Signature, integrity, schema and recipient scope re-verified from quarantine bytes", v.ok, v.ok ? `payload ${v.payloadDigest}` : v.errors.join("; "));

  const bindingNames = ((m.policy_bindings ?? []) as { name: string }[]).map((b) => b.name);
  const bindings = resolveBindings(bindingNames, policy);
  const unresolved = bindings.filter((b) => b.value === null);
  t("H-ACC-02", `Policy bindings resolve against ${workspace}'s own GBrain policy`, bindingNames.length > 0 && unresolved.length === 0, unresolved.length ? `unresolved: ${unresolved.map((b) => b.name).join(", ")}` : bindings.map((b) => `${b.name} = ${b.value}`).join("; "), bindings.filter((b) => b.factId).map((b) => `gbrain fact #${b.factId}`));

  const offList = steps.filter((s) => !(TOOL_ALLOWLIST as readonly string[]).includes(s.tool));
  const forbidden = steps.filter((s) => FORBIDDEN.test(text(s)));
  t("H-ACC-03", "Only model-visible allowlisted tools; no release/publish/network instructions", offList.length === 0 && forbidden.length === 0, offList.length || forbidden.length ? `offending steps: ${[...offList, ...forbidden].map((s) => s.seq).join(", ")}` : `${steps.length} steps use ${new Set(steps.map((s) => s.tool)).size} allowlisted tools`);

  const allText = [proc.title, proc.trigger, ...steps.map(text), ...((proc.preconditions ?? []) as string[]), ...((proc.postconditions ?? []) as string[])].join(" \n ");
  t("H-ACC-04", "No universal thresholds or amounts embedded (local policy decides)", !THRESHOLD.test(allText), THRESHOLD.test(allText) ? `found: ${allText.match(THRESHOLD)![0]}` : "no day windows, currency amounts or thresholds in procedure text");

  const hold = steps.find((s) => s.tool === "propose_payment_hold");
  const verify = steps.find((s) => s.tool === "propose_verification");
  t("H-ACC-05", "Unverified change keeps related payments on hold", Boolean(hold), hold ? `step ${hold.seq}: ${hold.instruction}` : "no propose_payment_hold step");

  t("H-ACC-06", "Verification uses the independently established route, not the requesting thread", Boolean(verify?.binds.includes("independent_verification_route")), verify ? `step ${verify.seq} binds ${verify.binds.join(", ") || "nothing"}` : "no propose_verification step");

  const reader = steps.find((s) => s.tool === "read_thread");
  t("H-ACC-07", `${workspace} case: a forwarded phone-message transcript is in scope`, Boolean(reader && /transcri/i.test(text(reader))), reader ? `step ${reader.seq}: ${text(reader).slice(0, 160)}` : "no read_thread step");

  const recon = steps.find((s) => s.tool === "list_related_invoices");
  const window = bindings.find((b) => b.name === "reconcile_window_days");
  t("H-ACC-08", `Related invoices reconciled with ${workspace}'s own window`, Boolean(recon?.binds.includes("reconcile_window_days") && window?.value), recon && window?.value ? `step ${recon.seq} uses local window ${window.value} days (gbrain fact #${window.factId})` : "reconciliation step or local window missing", window?.factId ? [`gbrain fact #${window.factId}`] : []);

  const uncovered = v.tests.filter((c) => (c.expected === "hold_and_verify" ? !(hold && verify) : !steps.some((s) => s.tool === "retrieve_scoped_evidence")));
  t("H-ACC-09", "Publisher's illustrative cases are covered by the procedure's steps", v.tests.length > 0 && uncovered.length === 0, uncovered.length ? `uncovered: ${uncovered.map((c) => c.id).join(", ")}` : `${v.tests.length} synthetic cases map to hold/verify or verified-evidence steps`);

  const passed = tests.filter((x) => x.ok).length;
  return { method: "deterministic structural checks against Harbor's own policy (no model call)", tests, passed, total: tests.length, ok: passed === tests.length, bindings, policyHash: policyHash(policy), payloadDigest: v.payloadDigest, ranAt: new Date().toISOString() };
}
