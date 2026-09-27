import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { ATTESTATION, MANIFEST, MEDIA_TYPES, PACKAGE_FILES, PAYLOAD_FILES, PROCEDURE, SIGNATURE, TEST_CASE, VALIDATION_REPORT, check } from "./schema.ts";
import type { PinnedKey } from "./keys.ts";

export type Files = Record<string, Buffer>;
export type Json = Record<string, unknown>;

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Json;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const sigMessage = (payloadDigest: string, attestationSha: string) => Buffer.from(`FIA-SIG-v1\n${payloadDigest}\n${attestationSha}`);

export function buildPayload(input: { manifest: Json; procedure: Json; tests: Json[]; report: Json }) {
  const files: Files = {
    "procedure.json": Buffer.from(canonical(input.procedure)),
    "synthetic-tests.jsonl": Buffer.from(input.tests.map(canonical).join("\n") + "\n"),
    "validation-report.json": Buffer.from(canonical(input.report)),
  };
  const manifest = { ...input.manifest, files: PAYLOAD_FILES.map((p) => ({ path: p, media_type: MEDIA_TYPES[p], size: files[p].length, sha256: sha256(files[p]) })) };
  files["manifest.json"] = Buffer.from(canonical(manifest));
  return { files, manifest, payloadDigest: sha256(files["manifest.json"]) };
}

export function signPackage(files: Files, attestation: Json, key: { privateKey: KeyObject; keyId: string }) {
  const payloadDigest = sha256(files["manifest.json"]);
  const attBytes = Buffer.from(canonical(attestation));
  const attestationSha = sha256(attBytes);
  const signature = sign(null, sigMessage(payloadDigest, attestationSha), key.privateKey).toString("base64");
  const sigFile = { schema_version: "fia.signature/1", alg: "ed25519", key_id: key.keyId, payload_digest: payloadDigest, attestation_sha256: attestationSha, signature };
  return { ...files, "review-attestation.json": attBytes, "signature.ed25519": Buffer.from(canonical(sigFile)) };
}

export type Verification = {
  ok: boolean;
  errors: string[];
  checks: { name: string; ok: boolean; detail: string }[];
  payloadDigest: string | null;
  manifest: Json | null;
  procedure: Json | null;
  tests: Json[];
  attestation: Json | null;
  keyId: string | null;
  publisher: string | null;
};

const EXECUTABLE_MAGIC = [Buffer.from("#!"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from("MZ"), Buffer.from("PK\x03\x04"), Buffer.from([0x1f, 0x8b]), Buffer.from([0xcf, 0xfa, 0xed, 0xfe])];

export function verifyPackage(files: Files, opts: { pinned: Record<string, PinnedKey>; recipient: string | null }): Verification {
  const checks: Verification["checks"] = [];
  const add = (name: string, errs: string[], okDetail: string) => checks.push({ name, ok: errs.length === 0, detail: errs.length ? errs.slice(0, 8).join("; ") : okDetail });
  const out: Verification = { ok: false, errors: [], checks, payloadDigest: null, manifest: null, procedure: null, tests: [], attestation: null, keyId: null, publisher: null };
  const finish = () => {
    out.errors = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
    out.ok = out.errors.length === 0;
    return out;
  };

  const names = Object.keys(files);
  const layoutErrs: string[] = [];
  for (const n of names) if (!(PACKAGE_FILES as readonly string[]).includes(n)) layoutErrs.push(`unexpected file ${JSON.stringify(n).slice(0, 80)}`);
  for (const n of PACKAGE_FILES) if (!files[n]) layoutErrs.push(`missing ${n}${n === "signature.ed25519" ? " (unsigned)" : ""}`);
  for (const n of names) if (EXECUTABLE_MAGIC.some((m) => files[n].subarray(0, m.length).equals(m))) layoutErrs.push(`${n} looks executable or archived`);
  add("layout", layoutErrs, `exactly ${PACKAGE_FILES.length} allowlisted files, no paths, no executables`);
  if (layoutErrs.length) return finish();

  const parse = (n: string) => {
    try {
      return JSON.parse(files[n].toString("utf8")) as Json;
    } catch {
      return null;
    }
  };
  const manifest = parse("manifest.json");
  const procedure = parse("procedure.json");
  const report = parse("validation-report.json");
  const attestation = parse("review-attestation.json");
  const signature = parse("signature.ed25519");
  const tests = files["synthetic-tests.jsonl"].toString("utf8").split("\n").filter(Boolean).map((l) => {
    try {
      return JSON.parse(l) as Json;
    } catch {
      return null;
    }
  });
  const schemaErrs: string[] = [];
  const sch = (label: string, v: unknown, s: Parameters<typeof check>[1]) => (v === null ? schemaErrs.push(`${label}: not JSON`) : schemaErrs.push(...check(v, s, label)));
  sch("manifest", manifest, MANIFEST);
  sch("procedure", procedure, PROCEDURE);
  sch("validation-report", report, VALIDATION_REPORT);
  sch("review-attestation", attestation, ATTESTATION);
  sch("signature", signature, SIGNATURE);
  if (!tests.length) schemaErrs.push("synthetic-tests: empty");
  tests.forEach((t, i) => sch(`synthetic-tests[${i}]`, t, TEST_CASE));
  if (!schemaErrs.length) {
    for (const [n, v] of [["manifest.json", manifest], ["procedure.json", procedure], ["validation-report.json", report], ["review-attestation.json", attestation], ["signature.ed25519", signature]] as const) {
      if (canonical(v) !== files[n].toString("utf8")) schemaErrs.push(`${n}: not canonical JSON`);
    }
  }
  add("schema", schemaErrs, "all files match the strict outbound schema (unknown fields rejected)");
  if (schemaErrs.length) return finish();
  const m = manifest as Json;
  out.manifest = m;
  out.procedure = procedure;
  out.tests = tests as Json[];
  out.attestation = attestation;
  out.publisher = m.publisher as string;

  const integrityErrs: string[] = [];
  const listed = m.files as { path: string; size: number; sha256: string }[];
  if (listed.map((f) => f.path).sort().join() !== [...PAYLOAD_FILES].sort().join()) integrityErrs.push("manifest.files must list exactly the payload files");
  for (const f of listed) {
    if (files[f.path]?.length !== f.size) integrityErrs.push(`${f.path}: size mismatch`);
    if (files[f.path] && sha256(files[f.path]) !== f.sha256) integrityErrs.push(`${f.path}: sha256 mismatch`);
  }
  const payloadDigest = sha256(files["manifest.json"]);
  out.payloadDigest = payloadDigest;
  const s = signature as Json;
  const a = attestation as Json;
  if (s.payload_digest !== payloadDigest) integrityErrs.push("signature payload_digest does not match manifest");
  if (a.payload_digest !== payloadDigest || (a.owner_approval as Json).payload_digest !== payloadDigest) integrityErrs.push("review attestation / owner approval bound to a different payload");
  if (s.attestation_sha256 !== sha256(files["review-attestation.json"])) integrityErrs.push("review attestation bytes changed");
  for (const [label, v] of [["procedure", procedure], ["validation-report", report], ["review-attestation", attestation]] as const) {
    if ((v as Json).package_id !== m.package_id || (v as Json).version !== m.version) integrityErrs.push(`${label}: package identity mismatch`);
  }
  add("integrity", integrityErrs, `payload digest ${payloadDigest.slice(0, 16)}… recomputed; every listed file hash matches`);

  const trustErrs: string[] = [];
  const keyId = s.key_id as string;
  out.keyId = keyId;
  const pin = opts.pinned[keyId];
  if (!pin) trustErrs.push(`publisher key ${keyId} is not pinned`);
  else {
    if (pin.participant !== m.publisher) trustErrs.push(`key ${keyId} is pinned to ${pin.participant}, not ${m.publisher}`);
    if (m.publisher_key_id !== keyId) trustErrs.push("manifest publisher_key_id differs from signing key");
    let valid = false;
    try {
      valid = verify(null, sigMessage(payloadDigest, s.attestation_sha256 as string), createPublicKey(pin.public_key_pem), Buffer.from(s.signature as string, "base64"));
    } catch {
      valid = false;
    }
    if (!valid) trustErrs.push("Ed25519 signature invalid");
  }
  add("signature", trustErrs, `Ed25519 signature valid for pinned ${m.publisher} key ${keyId}`);

  const scopeErrs: string[] = [];
  const dist = m.distribution as { scope: string; recipients: string[] };
  const approved = ((a.owner_approval as Json).recipients as string[]).slice().sort().join();
  if (approved !== dist.recipients.slice().sort().join()) scopeErrs.push("owner-approved recipients differ from manifest distribution");
  if (opts.recipient && dist.scope === "named_recipients" && !dist.recipients.includes(opts.recipient)) scopeErrs.push(`${opts.recipient} is not a named recipient`);
  add("recipient_scope", scopeErrs, `distribution ${dist.scope}: ${dist.recipients.join(", ")}`);

  const toolErrs: string[] = [];
  const required = m.required_tools as string[];
  const bindings = (m.policy_bindings as { name: string }[]).map((b) => b.name);
  for (const step of (procedure as Json).steps as { seq: number; tool: string; binds: string[] }[]) {
    if (!required.includes(step.tool)) toolErrs.push(`step ${step.seq} uses ${step.tool}, not in required_tools`);
    for (const b of step.binds) if (!bindings.includes(b)) toolErrs.push(`step ${step.seq} binds undeclared parameter ${b}`);
  }
  add("tool_allowlist", toolErrs, `${required.length} tools, all on the model-visible allowlist; no permission grants`);
  return finish();
}

export function scanFiles(files: Files, needles: { kind: string; value: string }[]) {
  const hits: { file: string; kind: string }[] = [];
  for (const [name, buf] of Object.entries(files)) {
    if (name === "signature.ed25519") continue;
    const text = buf.toString("utf8").toLowerCase();
    for (const n of needles) {
      const v = n.value.toLowerCase();
      const found = /^\d+$/.test(v) ? new RegExp(`(^|[^a-z0-9])${v}([^a-z0-9]|$)`).test(text) : text.includes(v);
      if (found && !hits.some((h) => h.file === name && h.kind === n.kind)) hits.push({ file: name, kind: n.kind });
    }
  }
  return hits;
}

export function privateNeedles(fixture: { canary: string; suppliers: Record<string, string>[]; invoices: { id: string }[]; replay: null | { id: string; invoices: { id: string; paidToLast4: string | null }[]; messages: { id: string; threadId: string; from: string }[]; events: { id: string; toLast4: string }[] } }) {
  const n: { kind: string; value: string }[] = [{ kind: "canary", value: fixture.canary }];
  for (const s of fixture.suppliers) {
    n.push({ kind: "supplier_name", value: s.name }, { kind: "supplier_id", value: s.id }, { kind: "contact_name", value: s.contactName }, { kind: "contact_phone", value: s.contactPhone }, { kind: "email_domain", value: s.emailDomain }, { kind: "account_digits", value: s.accountLast4 });
  }
  for (const i of fixture.invoices) n.push({ kind: "invoice_id", value: i.id });
  const r = fixture.replay;
  if (r) {
    n.push({ kind: "incident_id", value: r.id });
    for (const i of r.invoices) {
      n.push({ kind: "invoice_id", value: i.id });
      if (i.paidToLast4) n.push({ kind: "account_digits", value: i.paidToLast4 });
    }
    for (const msg of r.messages) n.push({ kind: "message_id", value: msg.id }, { kind: "thread_id", value: msg.threadId }, { kind: "sender", value: msg.from }, { kind: "email_domain", value: msg.from.split("@")[1] ?? msg.from });
    for (const e of r.events) n.push({ kind: "event_id", value: e.id }, { kind: "account_digits", value: e.toLast4 });
  }
  return n.filter((x) => x.value && x.value.length >= 4);
}

export const encodeFiles = (files: Files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString("base64")]));
export const decodeFiles = (enc: Record<string, unknown>): Files => Object.fromEntries(Object.entries(enc).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, Buffer.from(v as string, "base64")]));
