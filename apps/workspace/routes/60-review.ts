import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { Ctx, Route } from "../context.ts";
import type { StageRef } from "../../../packages/contracts/workflow.ts";

type Review = {
  pageId: string | null;
  slug: string | null;
  url: string | null;
  version: number | null;
  versions: { version: number; label: string; dossierSha256: string; publishedAt: string }[];
  dossierSha256: string | null;
  packageDigest: string | null;
  comments: { threadId: string; body: string; author: string | null; resolved: boolean; at: string | null }[];
  disposition: { kind: "revised" | "reasoned_acceptance"; reason: string; threadIds: string[]; version: number; at: string } | null;
  pinnedVersion: number | null;
  startedAt: string;
};

const BIN = process.env.SUPERSET_BIN ?? join(homedir(), ".superset", "bin", "superset");

function cli(args: string[], timeoutMs = 120000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(BIN, args, { timeout: timeoutMs, env: { ...process.env, CI: "1" }, maxBuffer: 8 << 20 }, (e, stdout, stderr) => {
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: String(stdout), err: String(stderr) });
    });
  });
}

function parseJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/[\[{][\s\S]*[\]}]/);
    try {
      return m ? JSON.parse(m[0]) : null;
    } catch {
      return null;
    }
  }
}

function dig(o: any, keys: string[]): any {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && typeof o[k] !== "object") return o[k];
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") {
      const r = dig(v, keys);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function register(ctx: Ctx): Route[] {
  if (ctx.workspace !== "northline") return [];
  const dir = join(ctx.dataDir, "review");
  mkdirSync(dir, { recursive: true });
  const stateFile = join(dir, "review.json");
  const load = (): Review | null => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null);
  const save = (r: Review) => writeFileSync(stateFile, JSON.stringify(r, null, 2) + "\n");
  const port = Number(process.env.PORT ?? 7101);
  const token = () => readFileSync(join(ctx.dataDir, "owner.token"), "utf8").trim();

  async function get(path: string) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(5000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  const privateTerms = () => {
    const terms: string[] = [ctx.fixture.canary];
    for (const s of ctx.fixture.suppliers) terms.push(s.name, s.id, s.contactName, s.contactPhone, s.emailDomain, s.bankLabel);
    for (const m of ctx.fixture.replay?.messages ?? []) terms.push(m.from, m.from.split("@")[1] ?? "");
    for (const i of [...ctx.fixture.invoices, ...(ctx.fixture.replay?.invoices ?? [])]) terms.push(i.id);
    return [...new Set(terms.filter((t) => t && t.length >= 4))].sort((a, b) => b.length - a.length);
  };
  const digits = () => [...new Set([...ctx.fixture.suppliers.map((s) => s.accountLast4), ...(ctx.fixture.replay?.events ?? []).map((e) => e.toLast4)].filter(Boolean))];

  function sanitize(text: string) {
    let t = text;
    for (const term of privateTerms()) t = t.split(term).join("[redacted]");
    for (const d of digits()) t = t.replace(new RegExp(`(?<![0-9a-fA-F])${d}(?![0-9a-fA-F])`, "g"), "••••");
    return t;
  }

  function leaks(html: string) {
    const found: string[] = [];
    for (const term of privateTerms()) if (html.includes(term)) found.push("private term");
    for (const d of digits()) if (new RegExp(`(?<![0-9a-fA-F])${d}(?![0-9a-fA-F])`).test(html)) found.push("account digits");
    if (/CANARY-/i.test(html)) found.push("canary");
    return [...new Set(found)];
  }

  function findSteps(v: any, depth = 0): string[] | null {
    if (depth > 6 || !v || typeof v !== "object") return null;
    if (Array.isArray(v)) {
      if (v.length >= 2 && v.every((x) => typeof x === "string" && x.length > 12)) return v;
      if (v.length >= 2 && v.every((x) => x && typeof x === "object" && typeof (x.text ?? x.step ?? x.instruction) === "string")) return v.map((x) => x.text ?? x.step ?? x.instruction);
      for (const x of v) {
        const r = findSteps(x, depth + 1);
        if (r) return r;
      }
      return null;
    }
    for (const k of ["steps", "procedure", "instructions", "candidate", "draft", "content"]) {
      if (k in v) {
        const r = findSteps(v[k], depth + 1);
        if (r) return r;
        if (typeof v[k] === "string") {
          const lines = v[k].split("\n").filter((l: string) => /^\s*(\d+[.)]|[-*•])\s+/.test(l));
          if (lines.length >= 2) return lines.map((l: string) => l.replace(/^\s*(\d+[.)]|[-*•])\s+/, "").trim());
        }
      }
    }
    for (const x of Object.values(v)) {
      const r = findSteps(x, depth + 1);
      if (r) return r;
    }
    return null;
  }

  async function gather() {
    let procedure: { source: string; steps: string[]; ref: string | null } | null = null;
    for (const p of ["/api/procedure-candidate", "/api/extraction/latest", "/api/procedures/candidate", "/api/procedures/latest", "/api/procedures/active", "/api/memorable/procedure", "/api/procedures"]) {
      const j = await get(p);
      const steps = j && findSteps(j);
      if (steps) {
        procedure = { source: p, steps, ref: String(dig(j, ["extractionId", "requestId", "request_id", "procedureId", "id"]) ?? "") || null };
        break;
      }
    }
    const extraction = ctx.store.stages().find((s) => s.id === "extraction");
    const evaluation = ctx.store.stages().find((s) => s.id === "evaluation");
    const evalJson = await get("/api/evaluations/latest");
    let packageDigest: string | null = null;
    for (const p of ["/api/workflow/publication/preview", "/api/publication/preview", "/api/publication/latest", "/api/packages/preview", "/api/packages/latest"]) {
      const j = await get(p);
      const d = j && dig(j, ["payloadDigest", "payload_digest", "packageDigest", "packageHash", "package_hash", "digest", "sha256"]);
      if (d) {
        packageDigest = String(d);
        break;
      }
    }
    const checklist = (JSON.parse(readFileSync(join(ctx.root, "fixtures", "training", "checklist.json"), "utf8")) as { steps: string[] }).steps;
    return { procedure, extraction, evaluation, evalJson, packageDigest, checklist };
  }

  function evalTables(e: any) {
    if (!e) return `<p class="muted">No measured report is exposed at <code>GET /api/evaluations/latest</code>. Nothing is claimed.</p>`;
    const metrics: string[] = [];
    const cases: any[] = [];
    const walk = (o: any, prefix: string, depth: number) => {
      if (!o || typeof o !== "object" || depth > 4) return;
      if (Array.isArray(o)) {
        if (o.length && typeof o[0] === "object" && !cases.length) cases.push(...o.slice(0, 40));
        return;
      }
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 90)) metrics.push(`<tr><td>${esc(prefix + k)}</td><td>${esc(v)}</td></tr>`);
        else walk(v, `${prefix}${k}.`, depth + 1);
      }
    };
    walk(e, "", 0);
    const cols = cases.length ? Object.keys(cases[0]).filter((k) => ["string", "number", "boolean"].includes(typeof cases[0][k])).slice(0, 6) : [];
    return `<table><tbody>${metrics.slice(0, 40).join("")}</tbody></table>` + (cases.length ? `<h3>Synthetic test cases (${cases.length} shown)</h3><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${cases.map((c) => `<tr>${cols.map((k) => `<td>${esc(c[k])}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "");
  }

  function render(g: Awaited<ReturnType<typeof gather>>, r: Review | null, version: number) {
    const cand = g.procedure?.steps ?? [];
    const diff = [...g.checklist.map((s) => `<li class="del">− ${esc(s)}</li>`), ...cand.map((s) => `<li class="add">+ ${esc(s)}</li>`)].join("");
    const history = (r?.comments ?? []).map((c) => `<li><b>Reviewer comment</b> (${esc(c.at ?? "")}): ${esc(c.body)} — ${c.resolved ? "resolved" : "open"}</li>`).join("") + (r?.disposition ? `<li><b>Owner disposition</b> (${esc(r.disposition.at)}): ${esc(r.disposition.kind)} — ${esc(r.disposition.reason)}</li>` : "");
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FIA review dossier</title><style>
:root{--bg:#fbfcfd;--ink:#0f1b33;--ink-2:#2b3650;--muted:#6c7689;--line:#e6e9ef;--card:#fff;--red-bg:#fdecec;--red:#b3261e;--green-bg:#e8f5ec;--green:#1e7a3c;--amber-bg:#fdf3e2;--amber:#9a5b00;--serif:"Iowan Old Style","Palatino","Book Antiqua",Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Helvetica Neue","Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
main{max-width:980px;margin:0 auto;padding:40px 20px 80px}.caps{text-transform:uppercase;letter-spacing:.22em;font-size:10.5px;color:var(--muted);margin:0}
h1{font-family:var(--serif);font-weight:500;font-size:clamp(30px,4vw,46px);margin:10px 0 6px}h2{font-family:var(--serif);font-weight:500;font-size:26px;margin:0 0 12px}h3{font-family:var(--serif);font-weight:500;font-size:19px}
.lede{color:var(--muted);font-size:17px;margin:0 0 26px}.card{background:var(--card);border:1px solid #edf0f4;border-radius:18px;padding:26px 28px;margin:18px 0;box-shadow:0 1px 2px rgba(15,27,51,.04),0 18px 48px -18px rgba(40,70,120,.16)}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top;word-break:break-word}th{font-weight:500;color:var(--ink-2)}
ul.diff{list-style:none;padding:0;margin:0;font-size:15px}ul.diff li{padding:7px 12px;border-radius:10px;margin:4px 0}.add{background:var(--green-bg);color:var(--green)}.del{background:var(--red-bg);color:var(--red)}
.muted{color:var(--muted)}code{font-size:12.5px;background:#eef1f6;border-radius:6px;padding:1px 6px;word-break:break-all}.pill{display:inline-block;padding:5px 12px;border-radius:999px;font-size:13px;background:var(--amber-bg);color:var(--amber)}
</style></head><body><main>
<p class="caps">FIA · Northline · Sanitized review dossier · Version ${version}</p>
<h1>Payment-change verification defense</h1>
<p class="lede">Candidate procedure learned from a confirmed supplier bank-change fraud, prepared by Chris for human review before the owner signs. All material is synthetic and sanitized: no supplier records, invoices, account digits, credentials or canaries.</p>
<div class="card"><p class="caps">Status</p><p><span class="pill">${r?.disposition ? `Disposition: ${esc(r.disposition.kind)}` : "Awaiting review"}</span></p><table><tbody>
<tr><td>Extraction stage</td><td>${esc(g.extraction?.status ?? "not_run")} — ${esc(sanitize(g.extraction?.detail ?? ""))}</td></tr>
<tr><td>Evaluation stage</td><td>${esc(g.evaluation?.status ?? "not_run")} — ${esc(sanitize(g.evaluation?.detail ?? ""))}</td></tr>
<tr><td>Package payload digest</td><td>${g.packageDigest ? `<code>${esc(g.packageDigest)}</code>` : `<span class="muted">Not yet exposed by publication; bound at owner signing.</span>`}</td></tr>
<tr><td>Generated</td><td>${esc(new Date().toISOString())}</td></tr></tbody></table></div>
<div class="card"><p class="caps">1 · Procedure diff</p><h2>Incumbent checklist → candidate procedure</h2>${cand.length ? `<ul class="diff">${diff}</ul><p class="muted">Candidate source: ${esc(g.procedure?.source)}${g.procedure?.ref ? ` · ref <code>${esc(g.procedure.ref)}</code>` : ""}. Local policy values (policy window, thresholds) stay bound in each recipient's workspace and are not exported.</p>` : `<p class="muted">The extracted procedure text is not exposed by this workspace yet; only the stage record above is shown. No procedure text is invented.</p>`}</div>
<div class="card"><p class="caps">2 · Synthetic tests and measured report</p><h2>What was actually measured</h2>${evalTables(g.evalJson ? JSON.parse(sanitize(JSON.stringify(g.evalJson))) : null)}</div>
<div class="card"><p class="caps">3 · Limitations</p><h2>What this does not show</h2><ul>
<li>All cases are synthetic and limited to the payment-change workflow; small samples support a scoped demo, not production loss-reduction claims.</li>
<li>The procedure recommends holds and independent verification; it never releases payments. The owner approves every release and publication in FIA.</li>
<li>Recipients must test the package on their own data before activation; no universal time window or dollar threshold is included.</li>
<li>A disconnected defender cannot receive new bulletins or complete an external verification call.</li></ul></div>
<div class="card"><p class="caps">4 · Review history</p><h2>Comments and dispositions</h2>${history ? `<ul>${history}</ul>` : `<p class="muted">No review comments yet. Comment on this page to request a change.</p>`}</div>
</main></body></html>`;
    return sanitize(body);
  }

  async function publish(html: string, r: Review | null, label: string) {
    const v = (r?.version ?? 0) + 1;
    const vdir = join(dir, `v${v}`);
    mkdirSync(vdir, { recursive: true });
    writeFileSync(join(vdir, "index.html"), html);
    const args = ["pages", "publish", vdir, "--title", "FIA review dossier — payment-change defense", "--label", label, "--json"];
    if (r?.pageId) args.push("--page", r.pageId);
    else args.push("--visibility", "just_me", "--description", "Sanitized candidate defense dossier for owner review");
    const out = await cli(args);
    const j = parseJson(out.out);
    if (out.code !== 0 || !j) throw new Error(`superset pages publish failed: ${(out.err || out.out).slice(0, 300)}`);
    const pageId = String(dig(j, ["pageId", "page_id", "id"]) ?? r?.pageId ?? "");
    const version = Number(dig(j, ["version", "versionNumber", "version_number"]) ?? v);
    const url = String(dig(j, ["url", "pageUrl", "publicUrl", "shareUrl"]) ?? r?.url ?? "") || null;
    const slug = String(dig(j, ["slug"]) ?? r?.slug ?? "") || null;
    return { pageId, version, url, slug, raw: j };
  }

  async function pollComments(r: Review) {
    if (!r.pageId) return r;
    const out = await cli(["pages", "comments", "list", "--page", r.pageId, "--json"], 30000);
    const j = parseJson(out.out);
    const list: any[] = Array.isArray(j) ? j : (j?.threads ?? j?.comments ?? j?.data ?? []);
    r.comments = list.map((t: any) => {
      const first = Array.isArray(t.comments) ? t.comments[0] : Array.isArray(t.messages) ? t.messages[0] : t;
      return { threadId: String(t.threadId ?? t.id ?? t.thread_id ?? ""), body: String(first?.body ?? first?.text ?? first?.content ?? t.body ?? ""), author: first?.author?.name ?? first?.authorName ?? first?.author ?? null, resolved: Boolean(t.resolved ?? t.resolvedAt ?? t.status === "resolved"), at: first?.createdAt ?? t.createdAt ?? null };
    }).filter((c) => c.threadId);
    return r;
  }

  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const refs = (r: Review): StageRef[] => [
    ...(r.pageId ? [{ label: "Superset page id", value: r.pageId }] : []),
    ...(r.version ? [{ label: "Page version", value: String(r.version) }] : []),
    ...(r.url ? [{ label: "Page URL", value: r.url }] : []),
    ...(r.dossierSha256 ? [{ label: "Dossier hash", value: `sha256:${r.dossierSha256}` }] : []),
    ...(r.packageDigest ? [{ label: "Package digest", value: r.packageDigest }] : []),
  ];

  function attestation(r: Review | null) {
    if (!r) return { status: "not_started" };
    const status = r.disposition ? "reviewed" : r.pageId ? "awaiting_review" : "not_published";
    return { status, pageId: r.pageId, url: r.url, version: r.version, pinnedVersion: r.pinnedVersion, dossierSha256: r.dossierSha256, packageDigest: r.packageDigest, versions: r.versions, comments: r.comments, disposition: r.disposition, attestation: r.disposition ? { pageId: r.pageId, version: r.pinnedVersion, dossierSha256: r.dossierSha256, packageDigest: r.packageDigest, disposition: r.disposition.kind, threadIds: r.disposition.threadIds, at: r.disposition.at } : null };
  }

  return [
    { method: "GET", path: "/api/reviews/latest", handler: (_req, res) => ctx.send(res, 200, attestation(load())) },
    {
      method: "GET",
      path: "/api/reviews/dossier/preview",
      handler: async (_req, res) => {
        const html = render(await gather(), load(), (load()?.version ?? 0) + 1);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
      },
    },
    {
      method: "POST",
      path: "/api/workflow/review/run",
      handler: async (req, res) => {
        const body = await ctx.readJson(req);
        const ev = ctx.store.stages().find((s) => s.id === "evaluation");
        if (!ev || !["done", "reduced"].includes(ev.status)) return ctx.send(res, 409, { error: "evaluation must be done (or reduced) before review" });
        const who = await cli(["auth", "whoami", "--json"], 20000);
        if (who.code !== 0) {
          ctx.store.setStage("review", "blocked", "Superset CLI not logged in — run: superset auth login. (reduced path: local review dossier without a Page receipt)", []);
          return ctx.send(res, 503, { error: "run: superset auth login" });
        }
        let r = load() ?? { pageId: null, slug: null, url: null, version: null, versions: [], dossierSha256: null, packageDigest: null, comments: [], disposition: null, pinnedVersion: null, startedAt: new Date().toISOString() };
        try {
          const g = await gather();
          r.packageDigest = g.packageDigest ?? r.packageDigest;
          if (r.pageId) await pollComments(r);
          const open = r.comments.filter((c) => !c.resolved);
          const wantRevision = body.revise === true || (body.approve === true && open.length > 0 && typeof body.reason !== "string");
          if (!r.pageId || wantRevision) {
            if (wantRevision && body.approve === true) r.disposition = { kind: "revised", reason: String(body.reason ?? `Revised dossier addresses ${open.length} review thread(s): ${open.map((c) => c.body).join(" | ").slice(0, 300)}`), threadIds: open.map((c) => c.threadId), version: (r.version ?? 0) + 1, at: new Date().toISOString() };
            const html = render(g, r, (r.version ?? 0) + 1);
            const bad = leaks(html);
            if (bad.length) {
              ctx.store.setStage("review", "failed", `Sanitization check refused publication (${bad.join(", ")}).`, refs(r));
              return ctx.send(res, 422, { error: `sanitization check failed: ${bad.join(", ")}` });
            }
            const isRevision = Boolean(r.pageId);
            const p = await publish(html, r, isRevision ? `v${(r.version ?? 0) + 1}: revision addressing review` : "v1: candidate for review");
            r = { ...r, pageId: p.pageId, version: p.version, url: p.url, slug: p.slug, dossierSha256: sha(html) };
            r.versions.push({ version: p.version, label: isRevision ? "revision" : "candidate", dossierSha256: sha(html), publishedAt: new Date().toISOString() });
            ctx.store.addReceipt("superset", "review", `page:${p.pageId}@v${p.version}`, sha(html));
            ctx.store.recordUsage("chris", "superset", "pages.publish", 1, "version", `${p.pageId}@v${p.version}`);
            ctx.store.audit("chris", "review.published", `page ${p.pageId} v${p.version} sha256:${sha(html)}`);
            if (r.disposition?.kind === "revised") {
              for (const t of r.disposition.threadIds) {
                await cli(["pages", "comments", "reply", `Addressed in dossier v${p.version}. ${r.disposition.reason}`.slice(0, 900), "--thread", t, "--json"], 30000);
                await cli(["pages", "comments", "resolve", "--thread", t, "--json"], 30000);
              }
              r.pinnedVersion = p.version;
              r.disposition.version = p.version;
              await pollComments(r);
            }
          }
          if (body.approve === true && !r.disposition) {
            const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : open.length ? `Owner reviewed ${open.length} comment(s) and accepts dossier v${r.version} without change.` : `No reviewer comment was received on page ${r.pageId}; owner explicitly accepts dossier v${r.version} as reviewed (reasoned acceptance, not a reviewer sign-off).`;
            r.disposition = { kind: "reasoned_acceptance", reason, threadIds: open.map((c) => c.threadId), version: r.version!, at: new Date().toISOString() };
            r.pinnedVersion = r.version;
            for (const t of open) {
              await cli(["pages", "comments", "reply", `Owner disposition: ${reason}`.slice(0, 900), "--thread", t, "--json"], 30000);
              await cli(["pages", "comments", "resolve", "--thread", t, "--json"], 30000);
            }
            ctx.store.audit("owner", "review.disposition", `${r.disposition.kind} v${r.pinnedVersion}: ${reason}`);
          }
          save(r);
          if (r.disposition) {
            ctx.store.setStage("review", "done", `Superset page ${r.pageId} v${r.pinnedVersion} pinned for signing. ${r.disposition.kind === "revised" ? "Reviewer comment resolved by a revised dossier version." : r.comments.length ? "Owner recorded a reasoned acceptance of the reviewer comment(s)." : "No reviewer comment arrived; owner recorded an explicit reasoned acceptance."} ${r.disposition.reason}`, refs(r));
            return ctx.send(res, 200, attestation(r));
          }
          ctx.store.setStage("review", "running", `Dossier v${r.version} published to Superset Pages (just_me). ${open.length ? `${open.length} open review comment(s).` : "Waiting for a review comment."} Owner approval records the disposition.`, refs(r));
          return ctx.send(res, 409, { error: `Owner approval required: ${open.length ? `resolve ${open.length} review comment(s) (approve with {"revise": true} to publish a revision, or with a "reason" to accept)` : `accept dossier v${r.version} on Superset page ${r.pageId}`}`, ...attestation(r) });
        } catch (err) {
          save(r);
          const msg = err instanceof Error ? err.message : String(err);
          ctx.store.setStage("review", "failed", `${msg}. (reduced path: local review dossier without a Page receipt)`, refs(r));
          return ctx.send(res, 502, { error: msg });
        }
      },
    },
  ];
}
