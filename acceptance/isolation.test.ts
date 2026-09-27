// Acceptance test for spec ISO-01 against the running stack.
// Run: node --test acceptance/isolation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").trim();

const HARBOR = process.env.HARBOR_URL ?? "http://127.0.0.1:7102";
const NORTHLINE = process.env.NORTHLINE_URL ?? "http://127.0.0.1:7101";
const harborToken = read("data/harbor/owner.token");
const northlineToken = read("data/northline/owner.token");
const northline = JSON.parse(read("fixtures/northline.json")) as {
  canary: string;
  suppliers: { name: string }[];
};

async function get(base: string, path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.text() };
}

test("ISO-01: Northline token is refused by Harbor", async () => {
  const r = await get(HARBOR, "/api/workspace", northlineToken);
  assert.equal(r.status, 403);
});

test("ISO-01: Harbor token is refused by Northline", async () => {
  const r = await get(NORTHLINE, "/api/workspace", harborToken);
  assert.equal(r.status, 403);
});

test("ISO-01: no token is refused by both workspaces", async () => {
  assert.equal((await get(HARBOR, "/api/workspace")).status, 403);
  assert.equal((await get(NORTHLINE, "/api/workspace")).status, 403);
});

test("ISO-01: each workspace accepts its own token and returns its own id", async () => {
  const h = await get(HARBOR, "/api/workspace", harborToken);
  assert.equal(h.status, 200);
  assert.equal(JSON.parse(h.body).workspace, "harbor");
  const n = await get(NORTHLINE, "/api/workspace", northlineToken);
  assert.equal(n.status, 200);
  assert.equal(JSON.parse(n.body).workspace, "northline");
});

test("ISO-01: Harbor's Maya evidence never leaks Northline data", async () => {
  const r = await get(HARBOR, "/api/agents/maya/evidence?supplier=SUP-001", harborToken);
  assert.equal(r.status, 200);
  assert.ok(northline.canary, "fixture must define a canary");
  assert.ok(!r.body.includes(northline.canary), "Northline canary leaked into Harbor evidence");
  for (const s of northline.suppliers) {
    assert.ok(!r.body.includes(s.name), `Northline supplier "${s.name}" leaked into Harbor evidence`);
  }
});
