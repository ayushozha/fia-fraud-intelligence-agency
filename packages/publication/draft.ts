import type { Json } from "./package.ts";

export const PACKAGE_ID = "FIA-DEF-0001";
export const PACKAGE_VERSION = "1.0.0";

export const POLICY_BINDINGS = [
  { name: "reconcile_window_days", description: "Recipient-local window (days) within which related invoices from the same supplier are reconciled together. No value is shipped." },
  { name: "independent_verification_route", description: "Recipient-local, independently established contact route for the supplier (never the requesting thread). No contact data is shipped." },
];

export const SYNTHETIC_TESTS = [
  { id: "SYN-001", scenario: "Fictional supplier A emails from a lookalike domain asking that two open invoices be paid together to a new account because of a 'bank migration', urging same-day payment.", channel: "email", expected: "hold_and_verify", rationale: "Unverified payment-detail change with urgency and a sender-domain mismatch.", illustrative: true },
  { id: "SYN-002", scenario: "A forwarded phone-message transcript attributed to fictional supplier B says their bank details changed and asks that the next invoice go to the new account.", channel: "phone_transcript", expected: "hold_and_verify", rationale: "Transcribed channels are untrusted; the change must be verified through the established route.", illustrative: true },
  { id: "SYN-003", scenario: "Fictional supplier C's payment-detail change was already verified last month through the established contact and recorded as a verified fact; a routine invoice now references the verified account.", channel: "email", expected: "proceed_under_local_policy", rationale: "An already-verified legitimate change is distinguished from an unresolved request.", illustrative: true },
  { id: "SYN-004", scenario: "A reply in the same email thread from fictional supplier D 'confirms' the new account after the business asked by replying to that thread.", channel: "email", expected: "hold_and_verify", rationale: "Replying to the same, possibly compromised, thread is not independent verification.", illustrative: true },
];

export type DraftProcedure = {
  title: string;
  trigger: string;
  source: { kind: "memorable_extraction" | "manually_authored"; label: string };
  steps: { seq: number; tool: string; instruction: string; command: string | null; binds: string[] }[];
  preconditions: string[];
  postconditions: string[];
  applicability: string[];
  limitations: string[];
};

export type StageRecord = { id: string; status: string; detail: string; refs: { label: string; value: string }[]; updated_at: string | null };

export function draftPackage(o: { publisher: string; keyId: string; createdAt: string; recipients: string[]; procedure: DraftProcedure; evaluation: StageRecord }) {
  const p = o.procedure;
  const procedure: Json = {
    schema_version: "fia.procedure/1",
    package_id: PACKAGE_ID,
    version: PACKAGE_VERSION,
    title: p.title,
    trigger: p.trigger,
    source: p.source,
    steps: p.steps,
    preconditions: p.preconditions,
    postconditions: p.postconditions,
  };
  const report: Json = {
    schema_version: "fia.validation/1",
    package_id: PACKAGE_ID,
    version: PACKAGE_VERSION,
    evaluation: o.evaluation,
    limitations: ["Publisher validation only; each recipient must run its own acceptance tests.", "Illustrative synthetic tests are not the publisher's held-out suite."],
  };
  const manifest: Json = {
    schema_version: "fia.manifest/1",
    package_id: PACKAGE_ID,
    version: PACKAGE_VERSION,
    publisher: o.publisher,
    publisher_key_id: o.keyId,
    created_at: o.createdAt,
    review_after: new Date(Date.parse(o.createdAt) + 90 * 86400000).toISOString(),
    title: p.title,
    pattern_family: "supplier_payment_detail_change",
    description: "Generalized procedure for investigating requests to change where a supplier is paid: read the full thread, reconcile related invoices under local policy, hold, and verify through an independently established route.",
    parent_package_hash: null,
    contributors: [],
    applicability: p.applicability,
    limitations: p.limitations,
    required_tools: [...new Set(p.steps.map((s) => s.tool))].sort(),
    policy_bindings: POLICY_BINDINGS,
    distribution: { scope: "named_recipients", recipients: o.recipients.slice().sort() },
    validation_summary: { status: o.evaluation.status, detail: o.evaluation.detail.slice(0, 2000), source: "publisher evaluation stage (see validation-report.json)" },
    usage_terms: { retain_and_use: true, redistribution: "Named recipients may retain and use the installed artifact locally. Redistribution requires the publisher's approval." },
  };
  return { manifest, procedure, tests: SYNTHETIC_TESTS as Json[], report };
}
