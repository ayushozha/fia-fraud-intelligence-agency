import { TOOL_ALLOWLIST } from "../../packages/publication/schema.ts";
import { POLICY_BINDINGS, type DraftProcedure } from "../../packages/publication/draft.ts";
import type { Draft, Trace } from "./client.ts";

const BINDING_NAMES = POLICY_BINDINGS.map((b) => b.name);

export const DEFAULT_APPLICABILITY = [
  "Inbound requests to change where an existing supplier is paid, by email or a transcribed phone message.",
  "Payments to suppliers whose payee details and contact route are already verified in the recipient's own records.",
];

export const DEFAULT_LIMITATIONS = [
  "Does not detect a compromised established contact or a legitimate change that was never recorded locally.",
  "Ships no thresholds or windows: reconcile window and verification route are bound to each recipient's local policy.",
  "A signature proves who published these bytes, not that the procedure is safe; recipients run their own acceptance tests.",
];

export function syntheticReconstruction(sessionId: string): Trace {
  const call = (name: string, description: string, command: string) => ({ name, input: { description, command }, result: { exit_code: 0 } });
  return {
    session_id: sessionId,
    task_description: "Investigate a supplier payment-detail change request before paying related invoices",
    harness: "fia",
    skip_embedding: true,
    tool_calls: [
      call("read_thread", "Read the entire payment thread and any approved transcribed channels, not only the latest message.", "read_thread --thread SYNTH-THREAD-A --channels email,phone_transcript"),
      call("record_investigation_observation", "Record the payment-detail change claim as an unverified observation, noting the sender domain differs from the established one and the request is urgent.", "record_investigation_observation --claim payment_detail_change --trust unverified --signals sender_domain_mismatch,urgency"),
      call("retrieve_scoped_evidence", "Retrieve the verified payee account and established contact for this supplier from local records.", "retrieve_scoped_evidence --supplier SYNTH-SUPPLIER-A --facts verified_payee_account,established_contact"),
      call("fetch_local_policy", "Fetch the local payment policy parameters that bind this procedure.", "fetch_local_policy --bindings reconcile_window_days,independent_verification_route"),
      call("list_related_invoices", "Reconcile related invoices from the same supplier within the local policy window; compare the claimed timeline with local history.", "list_related_invoices --supplier SYNTH-SUPPLIER-A --window reconcile_window_days"),
      call("propose_payment_hold", "Hold every related payment while the change is unverified.", "propose_payment_hold --invoices related --until verified"),
      call("propose_verification", "Verify through the independently established contact route, never by replying to the requesting thread.", "propose_verification --route independent_verification_route --not-via requesting_thread"),
      call("draft_local_message", "Draft a message to the established contact asking them to confirm payment details; drafting is not verification.", "draft_local_message --to independent_verification_route --purpose confirm_payment_details"),
    ],
  };
}

export function validateTrace(t: unknown): string[] {
  const errs: string[] = [];
  if (!t || typeof t !== "object") return ["reconstruction must be an object"];
  const o = t as Record<string, unknown>;
  const allowedTop = ["session_id", "task_description", "harness", "skip_embedding", "tool_calls"];
  for (const k of Object.keys(o)) if (!allowedTop.includes(k)) errs.push(`unknown field ${k}`);
  if (typeof o.session_id !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(o.session_id)) errs.push("session_id must be a simple identifier");
  if (typeof o.task_description !== "string" || o.task_description.length > 200 || !o.task_description.trim()) errs.push("task_description must be 1-200 chars");
  if (o.skip_embedding !== true) errs.push("skip_embedding must be true");
  if (!Array.isArray(o.tool_calls) || o.tool_calls.length < 2 || o.tool_calls.length > 30) return [...errs, "tool_calls must have 2-30 entries"];
  o.tool_calls.forEach((c: unknown, i: number) => {
    const call = c as Record<string, unknown>;
    if (!call || typeof call !== "object") return errs.push(`tool_calls[${i}] must be an object`);
    for (const k of Object.keys(call)) if (!["name", "input", "result"].includes(k)) errs.push(`tool_calls[${i}].${k}: unknown field`);
    if (!(TOOL_ALLOWLIST as readonly string[]).includes(call.name as string)) errs.push(`tool_calls[${i}].name not on the FIA tool allowlist`);
    const input = (call.input ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(input)) if (!["description", "command"].includes(k) || typeof input[k] !== "string" || (input[k] as string).length > 600) errs.push(`tool_calls[${i}].input.${k} not allowed`);
    const result = (call.result ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(result)) if (!(k === "ok" && typeof result[k] === "boolean") && !(k === "exit_code" && Number.isInteger(result[k]))) errs.push(`tool_calls[${i}].result.${k} not allowed`);
  });
  return errs;
}

function bindsOf(text: string) {
  return BINDING_NAMES.filter((b) => text.includes(b));
}

export function procedureFromDraft(draft: Draft, trace: Trace): { procedure: DraftProcedure; errors: string[] } {
  const errors: string[] = [];
  const used = new Set<number>();
  const steps = draft.steps.map((s) => {
    if (!(TOOL_ALLOWLIST as readonly string[]).includes(s.action)) errors.push(`extracted step ${s.seq} uses non-allowlisted tool ${s.action}`);
    const idx = trace.tool_calls.findIndex((c, i) => !used.has(i) && c.name === s.action && (!s.command || c.input.command === s.command));
    if (idx >= 0) used.add(idx);
    const call = idx >= 0 ? trace.tool_calls[idx] : null;
    const instruction = call?.input.description ?? s.action.replace(/_/g, " ");
    const command = s.command ?? null;
    return { seq: s.seq, tool: s.action, instruction, command, binds: bindsOf(`${command ?? ""} ${instruction}`) };
  });
  return {
    errors,
    procedure: {
      title: draft.title,
      trigger: draft.trigger_signature?.summary_text || trace.task_description,
      source: { kind: "memorable_extraction", label: "Extracted by Memorable POST /v1/extract from an owner-approved synthetic reconstruction" },
      steps,
      preconditions: draft.preconditions ?? [],
      postconditions: draft.postconditions ?? [],
      applicability: DEFAULT_APPLICABILITY,
      limitations: DEFAULT_LIMITATIONS,
    },
  };
}

export function manualProcedure(): DraftProcedure {
  const trace = syntheticReconstruction("manual");
  return {
    title: "Verify supplier payment-detail change requests (manually authored — not Memorable)",
    trigger: trace.task_description,
    source: { kind: "manually_authored", label: "manually authored — not Memorable" },
    steps: trace.tool_calls.map((c, i) => ({ seq: i + 1, tool: c.name, instruction: c.input.description ?? c.name, command: null, binds: bindsOf(`${c.input.command ?? ""} ${c.input.description ?? ""}`) })),
    preconditions: [],
    postconditions: ["Related payments remain held until the change is verified through the independent route."],
    applicability: DEFAULT_APPLICABILITY,
    limitations: DEFAULT_LIMITATIONS,
  };
}
