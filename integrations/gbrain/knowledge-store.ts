import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type Fact = {
  fact_id: string;
  fact: string;
  kind: string;
  entity_slug: string | null;
  provenance: string;
  valid_from: string;
  superseded_by: string | null;
  expired_at: string | null;
};

export type KnowledgeStore = Awaited<ReturnType<typeof openKnowledgeStore>>;

export function gbrainBin() {
  const candidates = [process.env.GBRAIN_BIN, join(homedir(), ".bun", "bin", "gbrain")].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function requestId(...parts: string[]) {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function openKnowledgeStore(brainHome: string) {
  const bin = gbrainBin();
  if (!bin) throw new Error("gbrain CLI not installed");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["DATABASE_URL", "GBRAIN_DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY"].includes(k)) env[k] = v;
  }
  env.GBRAIN_HOME = brainHome;
  env.PATH = `${join(homedir(), ".bun", "bin")}:${env.PATH ?? ""}`;
  const transport = new StdioClientTransport({ command: bin, args: ["serve", "--surface", "verbs"], env, stderr: "ignore" });
  const client = new Client({ name: "fia-workspace", version: "0.1.0" });
  await client.connect(transport);
  const version = client.getServerVersion();

  async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
    if (res.isError) throw new Error(`gbrain ${name}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  return {
    server: `${version?.name ?? "gbrain"} ${version?.version ?? ""}`.trim(),
    remember: (a: { fact: string; provenance: string; entity: string; kind: "fact" | "belief" | "event"; requestId: string }) =>
      call<{ id: string; status: string; entity_slug: string }>("remember", { fact: a.fact, provenance: a.provenance, entity: a.entity, kind: a.kind, visibility: "world", request_id: a.requestId }),
    recall: (a: { entity?: string; query?: string; limit?: number }) => call<{ facts: Fact[]; total: number; search_degraded?: boolean }>("recall", a),
    close: () => client.close(),
  };
}
