export const TOOL_ALLOWLIST = [
  "read_thread",
  "fetch_local_policy",
  "retrieve_scoped_evidence",
  "list_related_invoices",
  "recall_active_procedure",
  "propose_verification",
  "draft_local_message",
  "propose_payment_hold",
  "record_investigation_observation",
] as const;

export const PAYLOAD_FILES = ["procedure.json", "synthetic-tests.jsonl", "validation-report.json"] as const;
export const PACKAGE_FILES = ["manifest.json", ...PAYLOAD_FILES, "review-attestation.json", "signature.ed25519"] as const;
export const MEDIA_TYPES: Record<string, string> = {
  "procedure.json": "application/json",
  "synthetic-tests.jsonl": "application/x-ndjson",
  "validation-report.json": "application/json",
};
export const STAGE_STATUSES = ["not_run", "running", "done", "blocked", "failed", "reduced"];

export type S =
  | { t: "str"; enum?: readonly string[]; pattern?: RegExp; max?: number; nullable?: boolean }
  | { t: "int"; min?: number }
  | { t: "bool" }
  | { t: "arr"; of: S; max?: number }
  | { t: "obj"; fields: Record<string, S> };

const str = (max = 2000, extra: Partial<{ enum: readonly string[]; pattern: RegExp; nullable: boolean }> = {}): S => ({ t: "str", max, ...extra });
const arr = (of: S, max = 50): S => ({ t: "arr", of, max });
const obj = (fields: Record<string, S>): S => ({ t: "obj", fields });
const HEX64 = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const PKG = /^FIA-DEF-\d{4}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const BINDING = /^[a-z][a-z0-9_]{1,63}$/;
const ref = obj({ label: str(120), value: str(500) });
const stageRecord = (id: string) => obj({ id: str(40, { enum: [id] }), status: str(20, { enum: STAGE_STATUSES }), detail: str(2000), refs: arr(ref, 40), updated_at: str(40, { nullable: true }) });

export const MANIFEST: S = obj({
  schema_version: str(40, { enum: ["fia.manifest/1"] }),
  package_id: str(40, { pattern: PKG }),
  version: str(20, { pattern: SEMVER }),
  publisher: str(40, { pattern: /^[a-z][a-z0-9-]{1,39}$/ }),
  publisher_key_id: str(80, { pattern: /^ed25519:[a-f0-9]{16}$/ }),
  created_at: str(40, { pattern: ISO }),
  review_after: str(40, { pattern: ISO }),
  title: str(200),
  pattern_family: str(80, { pattern: /^[a-z][a-z0-9_]{1,79}$/ }),
  description: str(1000),
  parent_package_hash: str(64, { pattern: HEX64, nullable: true }),
  contributors: arr(obj({ id: str(40), role: str(80) }), 20),
  applicability: arr(str(400), 20),
  limitations: arr(str(400), 20),
  required_tools: arr(str(60, { enum: TOOL_ALLOWLIST }), TOOL_ALLOWLIST.length),
  policy_bindings: arr(obj({ name: str(64, { pattern: BINDING }), description: str(400) }), 20),
  distribution: obj({ scope: str(40, { enum: ["named_recipients", "community", "public"] }), recipients: arr(str(40, { pattern: /^[a-z][a-z0-9-]{1,39}$/ }), 20) }),
  files: arr(obj({ path: str(60, { enum: PAYLOAD_FILES }), media_type: str(60), size: { t: "int", min: 0 }, sha256: str(64, { pattern: HEX64 }) }), PAYLOAD_FILES.length),
  validation_summary: obj({ status: str(20, { enum: STAGE_STATUSES }), detail: str(2000), source: str(200) }),
  usage_terms: obj({ retain_and_use: { t: "bool" }, redistribution: str(400) }),
});

export const PROCEDURE: S = obj({
  schema_version: str(40, { enum: ["fia.procedure/1"] }),
  package_id: str(40, { pattern: PKG }),
  version: str(20, { pattern: SEMVER }),
  title: str(200),
  trigger: str(400),
  source: obj({ kind: str(40, { enum: ["memorable_extraction", "manually_authored"] }), label: str(200) }),
  steps: arr(obj({ seq: { t: "int", min: 1 }, tool: str(60, { enum: TOOL_ALLOWLIST }), instruction: str(600), command: str(400, { nullable: true }), binds: arr(str(64, { pattern: BINDING }), 10) }), 30),
  preconditions: arr(str(400), 20),
  postconditions: arr(str(400), 20),
});

export const TEST_CASE: S = obj({
  id: str(40, { pattern: /^SYN-[A-Z0-9-]{1,30}$/ }),
  scenario: str(800),
  channel: str(40, { enum: ["email", "phone_transcript"] }),
  expected: str(40, { enum: ["hold_and_verify", "proceed_under_local_policy"] }),
  rationale: str(600),
  illustrative: { t: "bool" },
});

export const VALIDATION_REPORT: S = obj({
  schema_version: str(40, { enum: ["fia.validation/1"] }),
  package_id: str(40, { pattern: PKG }),
  version: str(20, { pattern: SEMVER }),
  evaluation: stageRecord("evaluation"),
  limitations: arr(str(400), 20),
});

export const ATTESTATION: S = obj({
  schema_version: str(40, { enum: ["fia.attestation/1"] }),
  package_id: str(40, { pattern: PKG }),
  version: str(20, { pattern: SEMVER }),
  payload_digest: str(64, { pattern: HEX64 }),
  review: stageRecord("review"),
  owner_approval: obj({ actor: str(20, { enum: ["owner"] }), workspace: str(40), approved_at: str(40, { pattern: ISO }), payload_digest: str(64, { pattern: HEX64 }), recipients: arr(str(40), 20) }),
});

export const SIGNATURE: S = obj({
  schema_version: str(40, { enum: ["fia.signature/1"] }),
  alg: str(20, { enum: ["ed25519"] }),
  key_id: str(80, { pattern: /^ed25519:[a-f0-9]{16}$/ }),
  payload_digest: str(64, { pattern: HEX64 }),
  attestation_sha256: str(64, { pattern: HEX64 }),
  signature: str(200, { pattern: /^[A-Za-z0-9+/]+={0,2}$/ }),
});

export function check(value: unknown, schema: S, path = "$", errors: string[] = []): string[] {
  if (schema.t === "str") {
    if (value === null && schema.nullable) return errors;
    if (typeof value !== "string") return errors.push(`${path}: expected string`), errors;
    if (schema.max && value.length > schema.max) errors.push(`${path}: longer than ${schema.max}`);
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: value not allowed`);
    if (schema.pattern && !schema.pattern.test(value)) errors.push(`${path}: bad format`);
    return errors;
  }
  if (schema.t === "int") {
    if (typeof value !== "number" || !Number.isInteger(value) || (schema.min !== undefined && value < schema.min)) errors.push(`${path}: expected integer`);
    return errors;
  }
  if (schema.t === "bool") {
    if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
    return errors;
  }
  if (schema.t === "arr") {
    if (!Array.isArray(value)) return errors.push(`${path}: expected array`), errors;
    if (schema.max !== undefined && value.length > schema.max) errors.push(`${path}: more than ${schema.max} items`);
    value.forEach((v, i) => check(v, schema.of, `${path}[${i}]`, errors));
    return errors;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push(`${path}: expected object`), errors;
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(k in schema.fields)) errors.push(`${path}.${k}: unknown field`);
  for (const [k, s] of Object.entries(schema.fields)) {
    if (!(k in o)) errors.push(`${path}.${k}: missing`);
    else check(o[k], s, `${path}.${k}`, errors);
  }
  return errors;
}
