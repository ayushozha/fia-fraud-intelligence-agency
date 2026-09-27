import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_MEMORABLE_URL = "https://memorable-extraction-api.memorable.workers.dev";

function dotenv(root: string): Record<string, string> {
  const file = join(root, ".env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function memorableConfig(root: string) {
  const env = dotenv(root);
  const apiKey = process.env.MEMORABLE_API_KEY || env.MEMORABLE_API_KEY || null;
  const baseUrl = process.env.MEMORABLE_API_URL || env.MEMORABLE_API_URL || DEFAULT_MEMORABLE_URL;
  return { apiKey, baseUrl };
}

export type ToolCall = { name: string; input: { description?: string; command?: string }; result: { ok?: boolean; exit_code?: number } };
export type Trace = { session_id: string; task_description: string; harness: string; skip_embedding: boolean; tool_calls: ToolCall[] };
export type DraftStep = { seq: number; action: string; activity_class?: string; command?: string; repeat_count?: number; outcome?: string };
export type Draft = { title: string; steps: DraftStep[]; preconditions: string[]; postconditions: string[]; trigger_signature?: { summary_text?: string }; schema_version?: string } & Record<string, unknown>;

export type ExtractResult =
  | { ok: true; requestId: string; draft: Draft; refused: string | null; judge: unknown; httpStatus: number }
  | { ok: false; httpStatus: number; error: string; requestId: string | null };

export async function extract(cfg: { apiKey: string; baseUrl: string }, trace: Trace): Promise<ExtractResult> {
  let res: Response;
  try {
    res = await fetch(new URL("/v1/extract", cfg.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(trace),
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    return { ok: false, httpStatus: 0, error: `Memorable unreachable: ${err instanceof Error ? err.message : String(err)}`, requestId: null };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const requestId = typeof data.request_id === "string" ? data.request_id : null;
  if (!res.ok) return { ok: false, httpStatus: res.status, error: `Memorable /v1/extract ${res.status}: ${String(data.error ?? data.message ?? "error").slice(0, 200)}`, requestId };
  if (!requestId || !data.draft) return { ok: false, httpStatus: res.status, error: "Memorable response missing draft or request_id", requestId };
  return { ok: true, requestId, draft: data.draft as Draft, refused: typeof data.refused === "string" ? data.refused : null, judge: data.judge ?? null, httpStatus: res.status };
}
