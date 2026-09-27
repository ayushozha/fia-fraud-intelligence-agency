import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureKeyPair } from "./keys.ts";
import { buildPayload, signPackage, verifyPackage, type Files } from "./package.ts";
import { draftPackage } from "./draft.ts";

function fixturePackage() {
  const dir = mkdtempSync(join(tmpdir(), "fia-pub-"));
  const key = ensureKeyPair(dir);
  const other = ensureKeyPair(mkdtempSync(join(tmpdir(), "fia-pub-")));
  const input = draftPackage({
    publisher: "northline",
    keyId: key.keyId,
    createdAt: "2026-09-27T00:00:00.000Z",
    recipients: ["harbor"],
    procedure: {
      title: "Verify supplier payment-detail change requests",
      trigger: "A message asks to change where a supplier is paid",
      source: { kind: "manually_authored", label: "manually authored — not Memorable" },
      steps: [
        { seq: 1, tool: "read_thread", instruction: "Read the whole thread.", command: null, binds: [] },
        { seq: 2, tool: "propose_payment_hold", instruction: "Hold related payments.", command: null, binds: [] },
        { seq: 3, tool: "propose_verification", instruction: "Verify via the established contact.", command: null, binds: ["independent_verification_route"] },
      ],
      preconditions: [],
      postconditions: [],
      applicability: ["test"],
      limitations: ["test"],
    },
    evaluation: { id: "evaluation", status: "done", detail: "test", refs: [], updated_at: null },
  });
  const { files, payloadDigest } = buildPayload(input);
  const attestation = { schema_version: "fia.attestation/1", package_id: "FIA-DEF-0001", version: "1.0.0", payload_digest: payloadDigest, review: { id: "review", status: "done", detail: "test", refs: [], updated_at: null }, owner_approval: { actor: "owner", workspace: "northline", approved_at: "2026-09-27T00:00:00.000Z", payload_digest: payloadDigest, recipients: ["harbor"] } };
  const signed = signPackage(files, attestation, key);
  const pinned = { [key.keyId]: { participant: "northline", key_id: key.keyId, public_key_pem: key.publicKeyPem } };
  return { signed, pinned, key, other };
}

const clone = (f: Files): Files => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Buffer.from(v)]));

test("a correctly signed package verifies for its named recipient", () => {
  const { signed, pinned } = fixturePackage();
  const v = verifyPackage(signed, { pinned, recipient: "harbor" });
  assert.equal(v.ok, true, v.errors.join("\n"));
});

test("flipping one byte in a payload file is rejected", () => {
  const { signed, pinned } = fixturePackage();
  const tampered = clone(signed);
  const buf = tampered["procedure.json"];
  const i = buf.indexOf("Hold related");
  buf[i] = "F".charCodeAt(0);
  const v = verifyPackage(tampered, { pinned, recipient: "harbor" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("integrity") && e.includes("procedure.json: sha256 mismatch")), v.errors.join("\n"));
});

test("flipping one byte in the manifest breaks the signature", () => {
  const { signed, pinned } = fixturePackage();
  const tampered = clone(signed);
  const buf = tampered["manifest.json"];
  const i = buf.indexOf("harbor");
  buf[i] = "x".charCodeAt(0);
  const v = verifyPackage(tampered, { pinned, recipient: "harbor" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("signature") || e.startsWith("integrity")), v.errors.join("\n"));
});

test("an unsigned package is rejected", () => {
  const { signed, pinned } = fixturePackage();
  const unsigned = clone(signed);
  delete unsigned["signature.ed25519"];
  const v = verifyPackage(unsigned, { pinned, recipient: "harbor" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("unsigned")));
});

test("a package signed by an unpinned key is rejected", () => {
  const { signed, other, pinned } = fixturePackage();
  const att = JSON.parse(signed["review-attestation.json"].toString());
  const resigned = signPackage(clone(signed), att, other);
  const v = verifyPackage(resigned, { pinned, recipient: "harbor" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.startsWith("signature") && e.includes("not pinned")));
});

test("a non-recipient, extra files, and path traversal are rejected", () => {
  const { signed, pinned } = fixturePackage();
  assert.equal(verifyPackage(signed, { pinned, recipient: "mallory" }).ok, false);
  const extra = { ...clone(signed), "../evil.sh": Buffer.from("#!/bin/sh\n") };
  assert.equal(verifyPackage(extra, { pinned, recipient: "harbor" }).ok, false);
});
