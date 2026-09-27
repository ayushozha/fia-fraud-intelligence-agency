import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedKeys } from "../../packages/publication/keys.ts";
import { decodeFiles, encodeFiles, verifyPackage, type Files } from "../../packages/publication/package.ts";
import { PACKAGE_FILES } from "../../packages/publication/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.PORT ?? 7103);
const relayDir = join(root, "data", "relay");
const packagesDir = join(relayDir, "packages");
const eventsFile = join(relayDir, "events.jsonl");
const tokensFile = join(relayDir, "tokens.json");
mkdirSync(packagesDir, { recursive: true });

type Participant = { id: string; name: string; mark: string };
type RelayMeta = { packageId: string; version: string; publisher: string; publisherKeyId: string; recipients: string[]; distribution: string; payloadDigest: string; publishedAt: string; bytes: number; files: { path: string; bytes: number; sha256: string }[] };
const participants = (JSON.parse(readFileSync(join(root, "fixtures", "network.json"), "utf8")) as { participants: Participant[] }).participants;

function events(): { at: string; publisher: string; kind: string; packageId: string; version: string }[] {
  if (!existsSync(eventsFile)) return [];
  return readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function appendEvent(e: Record<string, string>) {
  appendFileSync(eventsFile, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function caller(req: IncomingMessage): string | null {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!token || !existsSync(tokensFile)) return null;
  const presented = Buffer.from(createHash("sha256").update(token).digest("hex"));
  const tokens = (JSON.parse(readFileSync(tokensFile, "utf8")) as { tokens: { participant: string; sha256: string }[] }).tokens;
  const hit = tokens.find((t) => t.sha256.length === presented.length && timingSafeEqual(Buffer.from(t.sha256), presented));
  return hit?.participant ?? null;
}

async function body(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) return null;
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

const dirOf = (id: string, version: string) => join(packagesDir, `${id}@${version}`);

function stored(): RelayMeta[] {
  return readdirSync(packagesDir)
    .filter((d) => existsSync(join(packagesDir, d, "_relay.json")))
    .map((d) => JSON.parse(readFileSync(join(packagesDir, d, "_relay.json"), "utf8")) as RelayMeta)
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

function readPackage(meta: RelayMeta): Files {
  const dir = dirOf(meta.packageId, meta.version);
  return Object.fromEntries(PACKAGE_FILES.map((f) => [f, readFileSync(join(dir, f))]));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/relay/status") {
      const log = events();
      const packages = stored().map((m) => ({ id: m.packageId, version: m.version, bytes: m.bytes, files: m.files.map((f) => f.path), signed: true, publisherKeyId: m.publisherKeyId, recipients: m.recipients, distribution: m.distribution, payloadDigest: m.payloadDigest, publisher: m.publisher, publishedAt: m.publishedAt }));
      return send(res, 200, {
        packages,
        published: packages.length,
        participants: participants.map((p) => ({ ...p, published: log.filter((e) => e.publisher === p.id && e.kind === "published").length })),
        events: log.slice(-20).reverse(),
      });
    }
    if (!url.pathname.startsWith("/api/relay/")) return send(res, 404, { error: "not found" });
    const who = caller(req);
    if (!who) return send(res, 401, { error: "relay token required" });

    if (req.method === "POST" && url.pathname === "/api/relay/packages") {
      const b = await body(req);
      if (!b || !b.files || typeof b.files !== "object") return send(res, 422, { error: "body must be {files: {name: base64}}" });
      const files = decodeFiles(b.files as Record<string, unknown>);
      const v = verifyPackage(files, { pinned: pinnedKeys(root), recipient: null });
      if (!v.ok) return send(res, 422, { error: "package rejected by relay", errors: v.errors });
      if (v.publisher !== who) return send(res, 403, { error: `token belongs to ${who}; package publisher is ${v.publisher}` });
      const m = v.manifest!;
      const id = m.package_id as string;
      const version = m.version as string;
      const dir = dirOf(id, version);
      if (existsSync(dir)) {
        const prior = JSON.parse(readFileSync(join(dir, "_relay.json"), "utf8")) as RelayMeta;
        if (prior.payloadDigest === v.payloadDigest && readPackage(prior)["signature.ed25519"].equals(files["signature.ed25519"])) return send(res, 200, { ...prior, idempotent: true });
        return send(res, 409, { error: `${id}@${version} already published; packages are immutable` });
      }
      const dist = m.distribution as { scope: string; recipients: string[] };
      const tmp = `${dir}.tmp-${process.pid}`;
      mkdirSync(tmp, { recursive: true });
      for (const f of PACKAGE_FILES) writeFileSync(join(tmp, f), files[f], { mode: 0o444 });
      const meta: RelayMeta = {
        packageId: id,
        version,
        publisher: who,
        publisherKeyId: v.keyId!,
        recipients: dist.recipients,
        distribution: dist.scope,
        payloadDigest: v.payloadDigest!,
        publishedAt: new Date().toISOString(),
        bytes: PACKAGE_FILES.reduce((n, f) => n + files[f].length, 0),
        files: PACKAGE_FILES.map((f) => ({ path: f, bytes: files[f].length, sha256: createHash("sha256").update(files[f]).digest("hex") })),
      };
      writeFileSync(join(tmp, "_relay.json"), JSON.stringify(meta, null, 2), { mode: 0o444 });
      renameSync(tmp, dir);
      appendEvent({ publisher: who, kind: "published", packageId: id, version, payloadDigest: meta.payloadDigest, recipients: meta.recipients.join(",") });
      return send(res, 201, meta);
    }

    if (req.method === "GET" && url.pathname === "/api/relay/inbox") {
      return send(res, 200, { participant: who, packages: stored().filter((m) => m.distribution === "public" || m.recipients.includes(who) || m.publisher === who) });
    }

    const dl = url.pathname.match(/^\/api\/relay\/packages\/(FIA-DEF-\d{4})\/(\d+\.\d+\.\d+)$/);
    if (req.method === "GET" && dl) {
      const dir = dirOf(dl[1], dl[2]);
      if (!existsSync(join(dir, "_relay.json"))) return send(res, 404, { error: "no such package" });
      const meta = JSON.parse(readFileSync(join(dir, "_relay.json"), "utf8")) as RelayMeta;
      if (!(meta.distribution === "public" || meta.recipients.includes(who) || meta.publisher === who)) {
        appendEvent({ publisher: meta.publisher, kind: "download_denied", packageId: meta.packageId, version: meta.version, by: who });
        return send(res, 403, { error: `${who} is not a named recipient of ${meta.packageId}@${meta.version}` });
      }
      appendEvent({ publisher: meta.publisher, kind: "downloaded", packageId: meta.packageId, version: meta.version, by: who });
      return send(res, 200, { meta, files: encodeFiles(readPackage(meta)) });
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(port, "127.0.0.1", () => console.log(`[relay] package relay on http://127.0.0.1:${port}`));
