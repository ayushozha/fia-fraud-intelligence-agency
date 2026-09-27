# FIA parallel build brief (shared by all build agents)

Project root: `/Users/ayush/Desktop/03 Events & Hackathons/Hackathons/Own Your Own Intelligence Hackathon`. Read `spec.md` (authoritative), `docs/sponsor-integrations.md` (researched sponsor APIs), `docs/sponsor-map.md`.

## The one workflow to demo
Northline suffers a supplier bank-change fraud → its agents investigate with private GBrain evidence → the lesson becomes a Memorable procedure → QM agents stress-test it → Superset review → owner signs → package crosses the relay (procedure + synthetic tests + measured report only; never invoices, supplier records, credentials) → Harbor quarantines, tests on its own data, activates into its own Memorable store → a NEW attack at Harbor is stopped by Harbor's defender model served through River (user decision: River API inference, no local download; Python SDK `river_client`, base model `Qwen/Qwen3.5-9B`, via the local shim `integrations/river/` exposes at http://127.0.0.1:7110) using Harbor's own GBrain + recalled procedure → River trains Harbor's own adapter → offline proof. Every fraud makes the network stronger.

## Hard rules
- Real sponsor integrations only. Never re-implement what a sponsor tool does. If a credential is missing, the stage status is `blocked` with the exact missing item; never fake a receipt, request ID, score, or sponsor output. A clearly labeled `reduced` path is allowed only where spec §15 allows it and only when the owner explicitly chooses it.
- Isolation: Northline and Harbor never read each other's data dirs/DBs/brains. Harbor learns ONLY via the relay package.
- Agents (models) never approve, publish, or release payments; owner actions are separate POSTs with `{"approve": true}`.
- Money is integer cents. Timestamps ISO UTC.
- Code style: TypeScript run directly by Node 26 (type stripping — no enums, no parameter properties), node: built-ins, no new frameworks. Match surrounding code; no comments. Python only where a sponsor SDK is Python-only (use `uv`).
- Do NOT commit to git. Do NOT restart/kill the dev stack or processes you didn't start. Do NOT touch `~/.superset/worktrees/...` (someone else's build). Don't print or log secrets.

## Running stack (already up, with `node --watch`, auto-reloads on save)
- console :7100 (presenter UI, proxies `/ws/<ws>/api/*` with owner tokens, `/relay/status`)
- northline workspace :7101, harbor workspace :7102 (each: own SQLite `data/<ws>/workspace.db`, own GBrain at `data/<ws>/gbrain` via Maya)
- relay :7103; QM core :8081 (mock model currently), QM portal :8129
- Call a workspace directly: `curl -H "authorization: Bearer $(cat data/<ws>/owner.token)" http://127.0.0.1:7101/api/...`
- A save that breaks a workspace file crash-loops both workspaces until fixed — keep files valid; check `/api/health`.
- Keys come from `.env` in the project root (user is adding MEMORABLE_API_KEY, RIVER_API_KEY; Superset via `superset auth login`). Read them from `process.env`.

## Extension points (use these; don't edit others' files)
- Add a route module: `apps/workspace/routes/NN-name.ts` exporting `register(ctx: Ctx): Route[]` (see `apps/workspace/context.ts`, example `00-health.ts`). Auto-loaded by both workspaces; branch on `ctx.workspace`.
- Workflow contract (`packages/contracts/workflow.ts`): each stage has an owner module that implements `POST /api/workflow/<stageId>/run` on the owning workspace (body may include `{"approve": true}` or options). Gate on prerequisites server-side (`ctx.store.stages()`); return 409 with a reason if not ready; 503 if a required service is down. Record progress with `ctx.store.setStage(id, status, detail, refs)`, sponsor receipts with `ctx.store.addReceipt(sponsor, stage, externalRef, artifactHash)`, per-agent sponsor usage with `ctx.store.recordUsage(agent, sponsor, op, units, unit, ref)` (agents: maya, jordan, lena, chris). `GET /api/workflow` and `/api/usage` already exist.
- GBrain via Maya: `ctx.maya.evidence(supplierId, callerAgent)`, `ctx.maya.recordObservations(messages, suppliers)`; `ctx.maya.connected`.
- `ctx.store.getMeta/setMeta` for small durable state; add your own tables with `CREATE TABLE IF NOT EXISTS` in your module.
- Shared files (`packages/simulator/store.ts`, `packages/contracts/*`, `apps/workspace/server.ts`, `maya.ts`): only minimal additive edits if unavoidable; say so in your report.

## Stage ownership
| Stage | Workspace | Owner agent |
|---|---|---|
| investigation, confirmation, harbor_investigation, offline_proof | northline / harbor | UFO agent |
| extraction, publication, import_quarantine, acceptance | northline / harbor | Memorable+publication agent |
| evaluation | northline | QM agent |
| review, training | northline / harbor | Superset+River agent |
| UI for all stages | console | UI agent |

## Report back (≤300 words)
What is real and verified (with actual IDs), what is blocked and exactly why, files you created/changed, the exact endpoints + request bodies for your stages, and anything another agent must know.
