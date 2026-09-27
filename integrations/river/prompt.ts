import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Decision = "proceed" | "hold_pending_verification" | "release_after_verification" | "reject_change";
export type TrainingCase = {
  id: string;
  family: string;
  split: "train" | "validation";
  label: "suspicious" | "legitimate";
  supplier: string;
  request: { channel: string; from: string; sentAt: string; text: string }[];
  evidence: { tool: string; result: string }[];
  expected: { decision: Decision; verify_via: string; checks: string[]; reason: string };
};
export type Variant = "checklist" | "checklist_procedure" | "checklist_procedure_adapter";
export type ProcedureContext = { source: string; packageId: string | null; packageHash: string | null; steps: string[] };

export const DECISIONS: Decision[] = ["proceed", "hold_pending_verification", "release_after_verification", "reject_change"];

export function fixturesDir(root: string) {
  return join(root, "fixtures", "training");
}

export function loadCases(root: string, split: "train" | "validation"): TrainingCase[] {
  return readFileSync(join(fixturesDir(root), `trajectories.${split}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function loadChecklist(root: string): string[] {
  return (JSON.parse(readFileSync(join(fixturesDir(root), "checklist.json"), "utf8")) as { steps: string[] }).steps;
}

export function systemPrompt(checklist: string[], procedure: ProcedureContext | null) {
  const lines = [
    "You are the accounts-payable defender for a small business. You review a payment-related request together with the evidence your tools returned and propose exactly one action.",
    "You never release payments yourself; the owner approves every release. A proposal that cannot be justified from the evidence must pause the payment for human review.",
    "",
    "Existing checklist:",
    ...checklist.map((s, i) => `${i + 1}. ${s}`),
  ];
  if (procedure) lines.push("", "Installed defense procedure (approved by the owner):", ...procedure.steps.map((s, i) => `${i + 1}. ${s}`));
  lines.push(
    "",
    "Respond with a single JSON object and nothing else:",
    '{"decision": "proceed" | "hold_pending_verification" | "release_after_verification" | "reject_change", "verify_via": "established_contact_on_file" | "none", "checks": [zero or more of "full_thread_review", "related_invoice_reconciliation", "timeline_vs_history", "independent_contact_verification", "verification_status_check"], "reason": "<one or two sentences>"}',
  );
  return lines.join("\n");
}

export function userPrompt(c: TrainingCase) {
  const req = c.request.map((m, i) => `Message ${i + 1} (${m.channel}, from ${m.from}, ${m.sentAt}):\n${m.text}`).join("\n\n");
  const ev = c.evidence.map((e) => `[${e.tool}] ${e.result}`).join("\n");
  return `Request concerning supplier ${c.supplier}:\n\n${req}\n\nTool results:\n${ev}`;
}

export function targetJson(c: TrainingCase) {
  return JSON.stringify({ decision: c.expected.decision, verify_via: c.expected.verify_via, checks: c.expected.checks, reason: c.expected.reason });
}

export function messagesFor(c: TrainingCase, checklist: string[], procedure: ProcedureContext | null, withTarget: boolean) {
  const msgs = [
    { role: "system", content: systemPrompt(checklist, procedure) },
    { role: "user", content: userPrompt(c) },
  ];
  if (withTarget) msgs.push({ role: "assistant", content: targetJson(c) });
  return msgs;
}

export function parseAction(text: string): { decision: Decision; verify_via: string; checks: string[] } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    if (!DECISIONS.includes(o.decision as Decision)) return null;
    return { decision: o.decision as Decision, verify_via: String(o.verify_via ?? ""), checks: Array.isArray(o.checks) ? o.checks.map(String) : [] };
  } catch {
    return null;
  }
}
