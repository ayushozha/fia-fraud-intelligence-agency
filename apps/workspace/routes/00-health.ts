import type { Ctx, Route } from "../context.ts";

export function register(ctx: Ctx): Route[] {
  return [{ method: "GET", path: "/api/health", handler: (_req, res) => ctx.send(res, 200, { workspace: ctx.workspace, ok: true }) }];
}
