import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PinnedKey = { participant: string; key_id: string; public_key_pem: string };

export function keyIdOf(publicKeyPem: string) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
}

const keyFile = (dataDir: string) => join(dataDir, "keys", "signing-ed25519.pem");

export function ensureKeyPair(dataDir: string) {
  const file = keyFile(dataDir);
  if (!existsSync(file)) {
    mkdirSync(join(dataDir, "keys"), { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return loadKeyPair(dataDir)!;
}

export function loadKeyPair(dataDir: string): { privateKey: KeyObject; publicKeyPem: string; keyId: string } | null {
  const file = keyFile(dataDir);
  if (!existsSync(file)) return null;
  const privateKey = createPrivateKey(readFileSync(file, "utf8"));
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return { privateKey, publicKeyPem, keyId: keyIdOf(publicKeyPem) };
}

export function pinnedKeys(root: string): Record<string, PinnedKey> {
  const file = join(root, "fixtures", "network-keys.json");
  if (!existsSync(file)) return {};
  const keys = (JSON.parse(readFileSync(file, "utf8")) as { keys: PinnedKey[] }).keys;
  return Object.fromEntries(keys.filter((k) => keyIdOf(k.public_key_pem) === k.key_id).map((k) => [k.key_id, k]));
}

export function ensureRelayToken(dataDir: string) {
  const file = join(dataDir, "relay.token");
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

export function relayToken(dataDir: string) {
  const file = join(dataDir, "relay.token");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}
