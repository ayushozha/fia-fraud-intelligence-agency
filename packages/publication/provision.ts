import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureKeyPair, ensureRelayToken } from "./keys.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const participants = ["northline", "harbor"];

const keys = participants.map((p) => {
  const k = ensureKeyPair(join(root, "data", p));
  return { participant: p, key_id: k.keyId, public_key_pem: k.publicKeyPem };
});
writeFileSync(join(root, "fixtures", "network-keys.json"), JSON.stringify({ note: "Out-of-band pinned Ed25519 publisher keys (MVP trust pinning, spec 8.2). Public keys only.", keys }, null, 2) + "\n");

const tokens = participants.map((p) => ({ participant: p, sha256: createHash("sha256").update(ensureRelayToken(join(root, "data", p))).digest("hex") }));
mkdirSync(join(root, "data", "relay"), { recursive: true });
writeFileSync(join(root, "data", "relay", "tokens.json"), JSON.stringify({ tokens }, null, 2) + "\n", { mode: 0o600 });

for (const k of keys) console.log(`${k.participant}: pinned ${k.key_id}; relay token registered`);
