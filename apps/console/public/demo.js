import { api, esc, fmtTokens, iconFor, lock, marks, openDrawer, sponsorDrawer, sponsorIcons, sponsorNames, sponsorOrder, stateLabel, statusText, wireDrawer } from "./shared.js";

const scenes = ["The network", "Suspicious payment", "Share the lesson", "Harbor receives", "A new attack", "Disconnected"];
const st = { i: 0, flow: null, payments: { northline: [], harbor: [] }, fx: null, ws: {}, sponsors: [], out: {}, err: {}, busy: {}, held: {}, candidate: null, evals: null, sent: false };

const money = (c) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const stage = (id) => st.flow?.stages.find((s) => s.id === id);
const settled = (id) => ["done", "reduced"].includes(stage(id)?.status);

async function call(path, body, method = "POST") {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, json };
    const reason = json.error || json.reason || json.detail || res.statusText;
    const label = res.status === 404 ? "Not available yet (404)" : res.status === 409 ? "Not ready (409)" : res.status === 503 ? "Service unavailable (503)" : `Error ${res.status}`;
    return { ok: false, status: res.status, error: `${label}: ${reason}`, json };
  } catch (err) {
    return { ok: false, error: `Request failed: ${err.message}` };
  }
}

async function loadFlow() {
  const [flow, np, hp] = await Promise.all([api("/workflow").catch(() => st.flow), call("/ws/northline/api/payments", null, "GET"), call("/ws/harbor/api/payments", null, "GET")]);
  st.flow = flow;
  st.payments = { northline: np.ok ? np.json.payments : [], harbor: hp.ok ? hp.json.payments : [] };
  for (const ws of ["northline", "harbor"]) {
    const held = st.payments[ws].find((p) => p.status === "held");
    if (held) st.held[ws] = { id: held.id, json: held };
    else delete st.held[ws];
  }
}

async function runStage(ws, id, body) {
  st.busy[id] = true;
  st.busyAt[id] = Date.now();
  delete st.err[id];
  render();
  ensurePoll();
  const r = await call(`/ws/${ws}/api/workflow/${id}/run`, body);
  if (r.ok) st.out[id] = r.json;
  else if (r.status === 409 && /approv/i.test(r.error) && !body?.approve) st.out[id] = r.json;
  else st.err[id] = r.error;
  delete st.busy[id];
  await loadFlow();
  if (id === "investigation" || id === "harbor_investigation") await loadInv(ws, id);
  await loadUsageAll();
  render();
  return r.ok;
}

function chips(list) {
  return `<span class="chips">${list.map((s) => `<span class="chip-s" title="${esc(sponsorNames[s] ?? s)}">${iconFor(s)}${esc(sponsorNames[s] ?? s)}</span>`).join("")}</span>`;
}

function errBox(id, retry) {
  return st.err[id] ? `<div class="err">${esc(st.err[id])}${retry ? ` <button class="btn small" data-retry="${retry}">Retry</button>` : ""}</div>` : "";
}

function refsOf(id, re) {
  return (stage(id)?.refs ?? []).filter((r) => !re || re.test(r.label));
}

function refChips(id, re) {
  const list = refsOf(id, re);
  return list.length ? `<div class="refs">${list.map((r) => `<span class="refc"><small>${esc(r.label)}</small><code>${esc(r.value)}</code></span>`).join("")}</div>` : "";
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o == null ? o : o[p]), obj);
    if (v != null && v !== "") return v;
  }
  return null;
}

function factIds(id) {
  const o = st.out[id] ?? {};
  const arr = pick(o, ["citations", "facts", "gbrainFacts", "evidence", "finding.citations", "result.citations"]);
  const ids = Array.isArray(arr) ? arr.map((x) => (typeof x === "object" ? x.id ?? x.factId ?? x.slug ?? JSON.stringify(x) : x)) : [];
  const refIds = refsOf(id, /fact id|citation/i).flatMap((r) => String(r.value).split(/\s*,\s*/));
  const norm = (x) => { const v = String(x).trim(); return /^\d+$/.test(v) ? `#${v}` : v; };
  return [...new Set([...ids, ...refIds].map(norm).filter(Boolean))];
}

function cleanDetail(d) {
  const t = String(d ?? "");
  const m = t.match(/^Reduced:.*?\)\.\s*(.*)$/s);
  return m ? m[1] : t;
}

function statusPill(id) {
  const s = stage(id);
  const cls = st.busy[id] ? "running" : s?.status ?? "not_run";
  return `<span class="st st-${cls}">${esc(st.busy[id] ? "Running" : statusText[cls] ?? cls)}</span>`;
}

function reducedNote(id) {
  const s = stage(id);
  return s?.status === "reduced" ? `<p class="reduced">Reduced mode — ${esc(s.detail)}</p>` : "";
}

function companyCard(ws, extra = "") {
  const d = st.ws[ws];
  if (!d) return `<article class="co"><p class="caps">${ws} unreachable</p></article>`;
  return `<article class="co" data-ws="${ws}">
    <div class="co-head"><span class="mark ${d.mark}">${marks[d.mark]}</span><div><h2>${esc(d.name)}</h2><p class="caps">${esc(d.tagline)}</p></div></div>
    <div class="co-agents">${d.agents.map((a) => `<span class="co-agent"><span class="avatar ${a.id}">${esc(a.name[0])}</span><b>${esc(a.name)}</b><small class="caps">${esc(a.role)}</small></span>`).join("")}</div>
    <div class="co-lock">${lock}<span>${d.records ? `${d.records.suppliers} suppliers · ${d.records.invoices} invoices · private GBrain` : "Messages · suppliers · payment records"} — stay here</span></div>
    ${extra}
  </article>`;
}

function bridge(label, card = "") {
  return `<div class="bridge"><p class="caps">${label}</p><div class="wire"></div><span class="shield big">${shieldSvg}</span>${card}</div>`;
}
const shieldSvg = '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function suspicious() {
  const r = st.fx?.northline;
  if (!r) return null;
  const msg = [...r.messages].reverse().find((m) => /bank|account/i.test(m.body)) ?? r.messages.at(-1);
  const total = r.invoices.reduce((n, i) => n + i.amountCents, 0);
  return { r, msg, total };
}

function paymentId(ws, stageId) {
  const o = st.out[stageId] ?? {};
  return pick(o, ["paymentId", "payment.id", "hold.paymentId", "result.paymentId"]) ?? refsOf(stageId, /payment/i)[0]?.value ?? null;
}

async function holdPayment(ws, stageId, fallbackIds) {
  const key = `hold-${ws}`;
  st.busy[key] = true;
  delete st.err[key];
  render();
  let id = paymentId(ws, stageId);
  if (!id) {
    const list = await call(`/ws/${ws}/api/payments`, null, "GET");
    const rows = list.ok ? list.json.payments ?? [] : [];
    id = rows.find((p) => /recommend|await|pending|approval/i.test(p.status))?.id ?? rows[0]?.id ?? null;
  }
  const r = id ? await call(`/ws/${ws}/api/payments/${encodeURIComponent(id)}/hold`, {}) : { ok: false, error: `No payment is queued yet — run the investigation first (${fallbackIds.join(", ")})` };
  if (r.ok) st.held[ws] = { id, json: r.json };
  else st.err[key] = r.error;
  delete st.busy[key];
  await loadFlow();
  render();
}


const evCache = {};
const invCache = {};

async function loadEvidence(ws, supplierName) {
  if (!supplierName || evCache[ws]?.name === supplierName) return;
  const list = await call(`/ws/${ws}/api/suppliers`, null, "GET");
  const id = list.ok ? list.json.suppliers.find((x) => x.name === supplierName)?.id : null;
  if (!id) return;
  const r = await call(`/ws/${ws}/api/agents/maya/evidence?supplier=${encodeURIComponent(id)}`, null, "GET");
  if (r.ok) evCache[ws] = { name: supplierName, ...r.json };
}

async function loadInvestigation(ws, stageId) {
  const r = await call(`/ws/${ws}/api/investigations/${stageId}`, null, "GET");
  invCache[stageId] = r.ok ? r.json.report ?? r.json : null;
}

function highlight(text) {
  return esc(text)
    .replace(/(account ending \d{4})/gi, '<mark class="hl">$1</mark>')
    .replace(/(Sample Credit Union|Tidewater Commerce Bank)/g, '<mark class="hl">$1</mark>')
    .replace(/(\+1-555-\d{4})/g, '<mark class="hl">$1</mark>')
    .replace(/(today|immediately|urgent|avoid a shipping hold|do not use it)/gi, '<mark class="hl soft">$1</mark>');
}

function claimCompare(ws, msgs) {
  const e = evCache[ws];
  const all = msgs.map((m) => `${m.from} ${m.body}`).join(" ");
  const claimAcct = all.match(/account ending (\d{4})/i)?.[1];
  const claimBank = all.match(/(Sample Credit Union|Tidewater Commerce Bank)/)?.[1];
  const suspect = msgs.find((m) => /bank|account/i.test(m.body)) ?? msgs.at(-1);
  const sender = suspect?.from.match(/caller ID (\+[\d-]+)/)?.[1] ?? suspect?.from.match(/@([\w.-]+)/)?.[1] ?? suspect?.from ?? "";
  const acctFact = e?.verified.find((f) => /payee account/i.test(f.text));
  const contactFact = e?.verified.find((f) => /Established contact/i.test(f.text));
  const vAcct = acctFact?.text.match(/account ending (\d{4})/)?.[1];
  const vBank = acctFact?.text.match(/: ([^,]+), account/)?.[1];
  const vName = contactFact?.text.match(/: ([^,]+), (\+[\d-]+); email domain ([\w.-]+)/);
  const vContact = vName ? (sender.startsWith("+") ? vName[2] : vName[3]) : null;
  const rows = [
    ["Pay to", claimBank && claimAcct ? `${claimBank} · ending ${claimAcct}` : "—", vBank && vAcct ? `${vBank} · ending ${vAcct}` : "—", acctFact?.id, claimAcct && vAcct && claimAcct !== vAcct],
    ["Who is asking", sender || "—", vContact ? `${vContact}${vName ? ` (${vName[1]})` : ""}` : "—", contactFact?.id, vContact && sender && !sender.includes(vContact)],
  ];
  return `<table class="cmp"><thead><tr><th></th><th>The message claims</th><th>${ws === "northline" ? "Northline's" : "Harbor's"} verified records</th></tr></thead><tbody>${rows.map(([k, c, v, id, bad]) => `<tr><th>${k}</th><td class="${bad ? "bad" : ""}">${esc(c)}${bad ? '<span class="x">≠</span>' : ""}</td><td class="good">${esc(v)}${id ? `<code class="fact">GBrain #${esc(id)}</code>` : ""}</td></tr>`).join("")}</tbody></table>
    ${e ? `<p class="cmp-note">${e.policy[0] ? `Policy (GBrain #${esc(e.policy[0].id)}): ${esc(short(e.policy[0].text, 140))}` : ""}</p>` : `<p class="cmp-note">Loading ${ws === "northline" ? "Northline's" : "Harbor's"} private GBrain…</p>`}`;
}

const agentMeta = { maya: ["Maya", "Recalled verified facts from private GBrain"], chris: ["Chris", "Reconciled the related invoices"], jordan: ["Jordan", "Read the thread, recorded findings, proposed verification"], lena: ["Lena", "Recommended a hold, drafted an unsent message"] };

function agentChain(stageId) {
  const rep = invCache[stageId];
  const steps = rep?.steps ?? [];
  if (!steps.length) return "";
  const by = {};
  for (const x of steps) (by[x.agent] ??= []).push(x);
  if (steps.some((x) => x.tool === "retrieve_evidence")) by.maya = by.maya ?? [{ tool: "retrieve_evidence", ok: true }];
  const order = ["maya", "chris", "jordan", "lena"].filter((a) => by[a]);
  return `<ol class="chain">${order.map((a) => `<li><span class="avatar ${a}">${agentMeta[a][0][0]}</span><div><b>${agentMeta[a][0]}</b><small>${agentMeta[a][1]}</small></div><span class="n">${by[a].length} ${by[a].length === 1 ? "step" : "steps"}</span></li>`).join("")}</ol>`;
}

const procToolMap = ["read_thread", "record_observation", "retrieve_evidence", "fetch_policy", "list_related_invoices", "hold_payment", "propose_verification", "draft_message"];

function procedureApplied(stageId) {
  const rep = invCache[stageId];
  const done = new Set((rep?.steps ?? []).filter((x) => x.ok).map((x) => x.tool));
  const steps = procedureSteps();
  if (!steps.length) return "";
  return `<ol class="applied">${steps.map((t, i) => {
    const tool = procToolMap[i];
    const ok = rep ? done.has(tool) : null;
    return `<li class="${ok ? "ok" : ""}">${tick(ok)}<span>${esc(short(t, 88))}</span></li>`;
  }).join("")}</ol>`;
}

function scene1() {
  return {
    body: `<div class="net">${companyCard("northline")}${bridge("Approved intelligence only")}${companyCard("harbor")}</div>
      <p class="say">Two independent businesses. Each has its own employee agents and its own private records. Only approved defenses travel between them.</p>
      <section class="netrun how">
        <div><span class="nr-n">1 · LEARN</span><b>A business is hit by fraud</b><small>its agents investigate with its own private memory</small></div>
        <span class="nr-arrow">→</span>
        <div><span class="nr-n">2 · SHARE</span><b>The lesson becomes a signed defense</b><small>procedure + tests, never records</small></div>
        <span class="nr-arrow">→</span>
        <div><span class="nr-n">3 · PROTECT</span><b>Other businesses test and adopt it</b><small>on their own data, by their own choice</small></div>
      </section>`,
    action: { label: "Open suspicious request", run: async () => {
      if (!settled("incident_replay")) {
        const r = await call("/ws/northline/api/incidents", { fixture: "historical_replay" });
        if (!r.ok) {
          st.err.incident_replay = r.error;
          return render();
        }
        await loadFlow();
      }
      go(1);
    } },
    extra: errBox("incident_replay"),
  };
}

function scene2() {
  const s = suspicious();
  const inv = stage("investigation");
  const o = st.out.investigation ?? {};
  const finding = pick(o, ["finding", "headline", "result.finding"]) ?? refsOf("investigation", /^finding$/i)[0]?.value ?? (settled("investigation") ? cleanDetail(inv.detail) : null);
  const held = st.held.northline;
  const conf = stage("confirmation");
  return {
    body: `<div class="x3 story">
      <section class="x3-col">
        <p class="caps x3-label">1 · A payment request arrives</p>
        <article class="pay ${held ? "is-held" : ""}">
          <p class="caps">Northline Roasters · payment</p>
          <p class="amount">${s ? money(s.total) : "$9,400"}</p>
          <span class="pay-state">${held ? "Held" : "Awaiting approval"}</span>
          <p class="pay-to">${s ? `${esc(s.r.supplier)} · ${s.r.invoices.length} invoices` : ""}</p>
        </article>
        ${s ? `<article class="msg"><p class="caps">Supplier message · synthetic</p><p class="msg-from">${highlight(s.msg.from)}</p><p class="msg-subj">${esc(s.msg.subject)}</p><p class="msg-body">${highlight(s.msg.body)}</p></article>` : ""}
      </section>
      <section class="x3-col">
        <p class="caps x3-label">2 · Checked against Northline's private memory</p>
        ${s ? claimCompare("northline", s.r.messages) : ""}
        <p class="private-tag">${lock}These records never leave Northline.</p>
      </section>
      <section class="x3-col">
        <p class="caps x3-label">3 · Northline's agents act</p>
        <article class="finding">
          <div class="finding-head"><span class="avatar jordan">J</span><div><b>Jordan · Investigator</b>${chips(["ufo", "gbrain", "river"])}</div>${statusPill("investigation")}</div>
          ${finding ? `<p class="finding-text">${esc(finding)}</p>` : st.busy.investigation ? `<p class="note">Investigating with Northline's private GBrain…</p>` : `<p class="note">Not run yet.</p>`}
          ${agentChain("investigation")}
          ${errBox("investigation", "investigation")}
          ${!settled("investigation") && !st.busy.investigation ? `<button class="btn" data-retry="investigation">${inv?.status === "not_run" && !st.err.investigation ? "Investigate" : "Retry investigation"}</button>` : ""}
        </article>
        ${held ? `<article class="confirm">
          <p class="caps">Simulated supplier verification</p>
          ${settled("confirmation") ? `<p class="confirm-text">Fraud confirmed</p><p class="note">A callback to the established contact on file confirmed the supplier never changed banks.</p>` : `<button class="btn" id="confirm-btn" ${st.busy.confirmation ? "disabled" : ""}>${st.busy.confirmation ? "Confirming…" : "Record simulated verification: fraud confirmed"}</button>`}
          ${errBox("confirmation")}
        </article>` : ""}
      </section>
    </div>
    ${inv?.status === "reduced" ? `<p class="honest">Reduced: UFO wasn't signed in, so a River-hosted model ran Jordan's same bounded tools. Details in the panel below.</p>` : ""}`,
    action: held ? null : { label: st.busy["hold-northline"] ? "Holding…" : "Hold payment", disabled: st.busy["hold-northline"] || !settled("investigation"), run: () => holdPayment("northline", "investigation", s?.r.invoices.map((i) => i.id) ?? []) },
    extra: errBox("hold-northline"),
    enter: async () => {
      if (stage("investigation")?.status === "not_run" && !st.err.investigation && !st.busy.investigation) runStage("northline", "investigation", { reduced: true });
      await Promise.all([loadEvidence("northline", st.fx?.northline?.supplier), loadInvestigation("northline", "investigation")]);
      render();
    },
    wire: () => document.getElementById("confirm-btn")?.addEventListener("click", () => runStage("northline", "confirmation", { approve: true })),
  };
}

const shareSteps = [
  ["extraction", { approve: true }, "memorable", "Memorable · procedure extracted"],
  ["evaluation", {}, "qm", "QM · agents stress-test it"],
  ["review", { approve: true }, "superset", "Superset · human review"],
  ["publication", { approve: true }, "fia", "Signed and published"],
];

async function shareDefense() {
  st.sharing = true;
  try {
    await shareSteps_();
  } finally {
    st.sharing = false;
    render();
  }
}

async function shareSteps_() {
  for (const [id, body] of shareSteps) {
    if (settled(id)) continue;
    const ok = await runStage("northline", id, body);
    if (!ok || !settled(id)) return;
  }
  st.evals = await call("/ws/northline/api/evaluations/latest", null, "GET");
  st.sent = true;
  render();
}

function evalsView() {
  if (!st.evals) return "";
  if (!st.evals.ok) return `<div class="err">${esc(st.evals.error)}</div>`;
  const e = st.evals.json;
  const m = e.metrics ?? e.summary ?? e.results ?? e;
  const rows = Object.entries(m).filter(([, v]) => typeof v === "number" || typeof v === "string").slice(0, 8);
  return `<article class="evals"><p class="caps">Measured test results${e.runId ? ` · run <code>${esc(e.runId)}</code>` : ""}</p><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></article>`;
}

function candidateTitle() {
  const c = st.candidate?.ok ? st.candidate.json : null;
  return pick(c ?? {}, ["title", "procedure.title", "name", "candidate.title"]) ?? "Check payment changes across the whole conversation—not just the invoice.";
}

const fileMeaning = {
  "procedure.json": ["The procedure", "8 investigation steps, no names or numbers"],
  "synthetic-tests.jsonl": ["Synthetic tests", "Invented cases Harbor can re-run"],
  "validation-report.json": ["Measured results", "What the tests actually showed"],
  "review-attestation.json": ["Reviewer sign-off", "Which reviewed version was approved"],
  "manifest.json": ["Manifest", "Scope, policy slots, recipients, file hashes"],
  "signature.ed25519": ["Signature", "Proves it came from Northline, unaltered"],
};

function kb(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

function short(v, n = 10) {
  const t = String(v ?? "");
  return t.length > n + 2 ? `${t.slice(0, n)}…` : t;
}

function refVal(id, re) {
  return refsOf(id, re)[0]?.value ?? null;
}

function procedureSteps() {
  const c = st.candidate?.ok ? st.candidate.json : null;
  const p = c?.candidate?.procedure ?? c?.procedure ?? c ?? {};
  return (p.steps ?? []).map((x) => x.instruction ?? x.action ?? "").filter(Boolean);
}

function evalLine() {
  const m = st.evals?.ok ? st.evals.json.metrics : null;
  if (m?.candidate && m?.baseline) {
    const c = m.candidate, b = m.baseline;
    return `${c.correct_verification_handling.denominator} synthetic cases · ${c.correct_verification_handling.numerator}/${c.correct_verification_handling.denominator} handled correctly · ${c.unsafe_recommendations.numerator} unsafe · checklist alone: ${b.correct_verification_handling.numerator}/${b.correct_verification_handling.denominator} (no gain claimed)`;
  }
  const d = stage("evaluation")?.detail ?? "";
  const hit = d.match(/correct handling (\d+\/\d+) with procedure vs (\d+\/\d+)/);
  return hit ? `Correct handling ${hit[1]} with the procedure vs ${hit[2]} checklist-only · no gain claimed` : "Not run yet";
}

function pipeStep(n, id, sponsor, title, line, link) {
  const status = st.busy[id] ? "running" : stage(id)?.status ?? "not_run";
  return `<li class="ps ps-${status}" data-stage="${id}">
    <span class="ps-n">${n}</span>
    <span class="ps-icon">${iconFor(sponsor)}</span>
    <div class="ps-text"><p class="ps-who caps">${esc(sponsor === "fia" ? "FIA · Ed25519" : sponsorNames[sponsor] ?? sponsor)}</p><b>${esc(title)}</b><p>${line}</p>${link ?? ""}</div>
    ${statusPill(id)}
  </li>`;
}

function scene3() {
  const done = settled("publication");
  const pkg = st.flow?.relay?.packages?.[0] ?? null;
  const d = st.ws.northline?.records;
  const steps = procedureSteps();
  const pageUrl = refVal("review", /page url/i);
  const scanOk = /privacy scan clean/i.test(stage("extraction")?.detail ?? "");
  const sizes = pkg?.fileSizes ?? {};
  const files = pkg?.files ?? Object.keys(fileMeaning);
  return {
    body: `<div class="x3">
      <section class="x3-col vault3">
        <header><span class="mark leaf">${marks.leaf}</span><div><p class="caps">Northline Roasters</p><h3>Stays private</h3></div></header>
        <ul class="locked">
          <li>${lock}<span><b>Supplier messages</b><small>${d ? `${d.unverifiedMessages} in the fraud thread` : "the fraud thread"}</small></span></li>
          <li>${lock}<span><b>Supplier records &amp; bank details</b><small>${d ? `${d.suppliers} suppliers` : ""}</small></span></li>
          <li>${lock}<span><b>Invoices &amp; payments</b><small>${d ? `${d.invoices} invoices` : ""}</small></span></li>
          <li>${lock}<span><b>Private GBrain memory</b><small>verified facts &amp; observations</small></span></li>
          <li>${lock}<span><b>Credentials &amp; keys</b><small>never packaged</small></span></li>
        </ul>
        <p class="x3-foot caps">Never leaves Northline</p>
      </section>

      <section class="x3-col pipe3">
        <p class="caps x3-label">How the lesson becomes a defense</p>
        <ol class="pipe">
          ${pipeStep(1, "extraction", "memorable", "Turn the incident into a procedure", `${steps.length || 8} generic steps${scanOk ? " · privacy scan: no private data" : ""}`)}
          ${pipeStep(2, "evaluation", "qm", "Test it on synthetic cases", esc(evalLine()))}
          ${pipeStep(3, "review", "superset", "A human reviews the sanitized dossier", `Version ${esc(refVal("review", /page version/i) ?? "—")} approved`, pageUrl ? `<a class="ps-link" href="${esc(pageUrl)}" target="_blank" rel="noopener">Open review page ↗</a>` : "")}
          ${pipeStep(4, "publication", "fia", "Sign and publish", pkg ? `Signed ${esc(short(pkg.publisherKeyId, 18))} · digest <code>${esc(short(pkg.payloadDigest, 12))}</code>` : "Not published yet")}
        </ol>
      </section>

      <section class="x3-col pkg3 ${done ? "sent" : ""}">
        <p class="caps x3-label">What actually travels</p>
        <article class="envelope">
          <header><span class="shield">${shieldSvg}</span><div><b>${esc(pkg ? `${pkg.id} · v${pkg.version}` : "Defense package")}</b><small>${pkg ? `${kb(pkg.bytes)} · ${files.length} files · signed` : "not published yet"}</small></div></header>
          <ul class="files">${files.map((f) => {
            const [label, what] = fileMeaning[f] ?? [f, ""];
            return `<li><span class="f-name"><b>${esc(label)}</b><small>${esc(what)}</small></span><span class="f-size">${sizes[f] ? kb(sizes[f]) : ""}</span></li>`;
          }).join("")}</ul>
        </article>
        <div class="route"><span class="route-line"></span><span class="route-dot"></span></div>
        <div class="to-harbor"><span class="mark wave">${marks.wave}</span><div><b>Harbor Print</b><small>${pkg ? `only named recipient · via restricted relay` : "waiting"}</small></div></div>
      </section>
    </div>

    ${steps.length ? `<section class="inside"><p class="caps x3-label">Inside procedure.json — the knowledge Harbor receives</p><h3>${esc(candidateTitle())}</h3><ol class="inside-steps">${steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol><p class="inside-note">Company-specific values (policy window, contacts, accounts) are left as slots. Harbor fills them from its own records.</p></section>` : ""}

    <section class="netrun">
      <div><span class="nr-n">1</span><b>Publisher signs</b><small>Northline's owner approves the exact bytes</small></div>
      <span class="nr-arrow">→</span>
      <div><span class="nr-n">2</span><b>Relay delivers</b><small>stores the package; only named recipients can download</small></div>
      <span class="nr-arrow">→</span>
      <div><span class="nr-n">3</span><b>Recipient decides</b><small>verifies the signature, tests on its own data, owner accepts</small></div>
    </section>
    ${stage("evaluation")?.status === "reduced" ? `<p class="honest">QM swarm unavailable for this run, so FIA's fixed scorer ran the tests. It showed no improvement over the checklist, and none is claimed.</p>` : ""}`,
    action: done ? null : { label: st.sharing ? "Sharing…" : "Share defense", disabled: Boolean(st.sharing), run: shareDefense },
    enter: async () => {
      if (!st.candidate) {
        st.candidate = await call("/ws/northline/api/procedures/candidate", null, "GET");
        render();
      }
      if (!st.evals) {
        st.evals = await call("/ws/northline/api/evaluations/latest", null, "GET");
        render();
      }
    },
  };
}

function checksPassed() {
  const s = stage("acceptance");
  if (!s) return false;
  const o = st.out.acceptance ?? {};
  if (o.checksPassed === true || o.passed === true || o.checks?.passed === true) return true;
  const refPass = s.refs.some((r) => /check|test/i.test(r.label) && /pass/i.test(r.value) && !/fail/i.test(r.value));
  return refPass || (/pass/i.test(s.detail) && !/fail|not pass/i.test(s.detail));
}

const quarantinePlain = {
  signature: "Signed by Northline's pinned key",
  integrity: "Not altered in transit (hashes match)",
  recipient_scope: "Addressed to Harbor",
  layout: "Only the 6 expected files, nothing executable",
  schema: "Strict format, unknown fields rejected",
  tool_allowlist: "Uses only safe, allowlisted tools",
};

const acceptancePlain = {
  "H-ACC-01": "Re-verified from the quarantined bytes",
  "H-ACC-02": "Blanks filled from Harbor's own policy",
  "H-ACC-03": "No release, publish or network steps",
  "H-ACC-04": "No hard-coded amounts or thresholds",
  "H-ACC-05": "Unverified change → payments stay on hold",
  "H-ACC-06": "Verify via the known contact, never the requesting thread",
  "H-ACC-07": "Covers forwarded voicemail transcripts",
  "H-ACC-08": "Invoices reconciled with Harbor's own window",
  "H-ACC-09": "Covers Northline's published test cases",
};

async function loadImport() {
  const r = await call("/ws/harbor/api/imports", null, "GET");
  st.imp = r.ok ? r.json : null;
}

function tick(ok) {
  return `<span class="tk ${ok === true ? "ok" : ok === false ? "no" : "wait"}">${ok === true ? "✓" : ok === false ? "✕" : "·"}</span>`;
}

function scene4() {
  const acc = stage("acceptance");
  const q = stage("import_quarantine");
  const active = acc?.status === "done" || acc?.status === "reduced";
  const imp = st.imp;
  const qChecks = imp?.verification?.checks ?? [];
  const tests = imp?.acceptance?.tests ?? [];
  const pkg = st.flow?.relay?.packages?.[0] ?? null;
  const policy = tests.find((t) => t.id === "H-ACC-02");
  const window = policy?.detail?.match(/reconcile_window_days = (\d+)/)?.[1];
  const h = st.ws.harbor?.records;
  const slug = imp?.memorable?.slug;
  const sim = imp?.memorable?.recall?.similarity ?? imp?.memorable?.recall?.score;
  const qOrder = ["signature", "integrity", "recipient_scope", "layout", "schema", "tool_allowlist"];
  return {
    body: `<div class="x4">
      <section class="x3-col in4">
        <p class="caps x3-label">1 · Arrives from Northline</p>
        <article class="envelope ${active ? "" : "quarantined"}">
          <header><span class="shield">${shieldSvg}</span><div><b>${esc(pkg ? `${pkg.id} · v${pkg.version}` : "FIA-DEF-0001")}</b><small>${pkg ? `${kb(pkg.bytes)} · from Northline · signed` : "from Northline"}</small></div></header>
          <h4>${esc(candidateTitle())}</h4>
          <ul class="mini-files">${(pkg?.files ?? Object.keys(fileMeaning)).map((f) => `<li>${esc((fileMeaning[f] ?? [f])[0])}</li>`).join("")}</ul>
          <p class="q-state ${active ? "released" : ""}">${active ? "Released from quarantine" : settled("import_quarantine") ? "In quarantine · nothing runs yet" : st.busy.import_quarantine ? "Downloading into quarantine…" : "Waiting to download"}</p>
        </article>
        <div class="not-got">
          <p class="caps">Harbor never receives</p>
          <p>Northline's invoices · supplier names · bank details · policy values · access to Northline's systems</p>
        </div>
      </section>

      <section class="x3-col check4">
        <p class="caps x3-label">2 · Harbor checks it before trusting it</p>
        <h4 class="grp">Is it authentic? ${statusPill("import_quarantine")}</h4>
        <ul class="ticks">${(qChecks.length ? qOrder.map((n) => qChecks.find((c) => c.name === n)).filter(Boolean) : qOrder.map((name) => ({ name, ok: null }))).map((c) => `<li>${tick(c.ok)}<span>${esc(quarantinePlain[c.name] ?? c.name)}</span></li>`).join("")}</ul>
        <h4 class="grp">Does it fit Harbor? ${statusPill("acceptance")}</h4>
        <ul class="ticks two-col">${(tests.length ? tests : Object.keys(acceptancePlain).map((id) => ({ id, ok: null }))).map((t) => `<li>${tick(t.ok)}<span>${esc(acceptancePlain[t.id] ?? t.name)}</span></li>`).join("")}</ul>
        ${window ? `<p class="slots">Harbor's own values fill the blanks: <b>${esc(window)}-day</b> invoice window and its <b>vendor-master contact</b> for verification ${(policy.evidence ?? []).map((e) => `<code class="fact">${esc(e.replace("gbrain fact ", "GBrain "))}</code>`).join(" ")}</p>` : ""}
        ${checksPassed() && !active ? `<p class="ready">Tested against Harbor's policies. Ready for your review.</p>` : ""}
        ${errBox("import_quarantine", "import_quarantine")}${errBox("acceptance", "acceptance")}
      </section>

      <section class="x3-col vault4 ${active ? "installed" : ""}">
        <p class="caps x3-label">3 · Installed in Harbor's own memory</p>
        <header><span class="mark wave">${marks.wave}</span><div><b>Harbor Print</b><small>private workspace</small></div></header>
        <ul class="locked">
          <li>${lock}<span><b>Harbor's suppliers &amp; records</b><small>${h ? `${h.suppliers} suppliers · ${h.invoices} invoices` : ""}</small></span></li>
          <li>${lock}<span><b>Harbor's private GBrain</b><small>its own policy &amp; verified facts</small></span></li>
        </ul>
        <div class="slot ${active ? "filled" : ""}">
          ${active ? `<span class="slot-icon">${iconFor("memorable")}</span><div><b>Defense active · FIA-DEF-0001 v1.0.0</b><small>Stored in Harbor's Memorable${sim != null ? ` · recalled offline (similarity ${esc(sim)})` : ""}</small>${slug ? `<code>${esc(short(slug, 34))}</code>` : ""}</div>` : `<div><b>Waiting for Harbor's owner</b><small>Nothing is installed until the owner accepts this exact version.</small></div>`}
        </div>
        ${active ? `<p class="ready ok">Accepted. Northline's lesson is now Harbor's own capability.</p>` : ""}
      </section>
    </div>`,
    action: active ? null : { label: st.busy.acceptance ? "Accepting…" : "Accept defense", disabled: !checksPassed() || st.busy.acceptance, run: async () => {
      await runStage("harbor", "acceptance", { approve: true });
      await loadImport();
      render();
    } },
    enter: async () => {
      if (!st.candidate) st.candidate = await call("/ws/northline/api/procedures/candidate", null, "GET");
      await loadImport();
      render();
      if (!settled("import_quarantine") && !st.busy.import_quarantine && !st.err.import_quarantine) await runStage("harbor", "import_quarantine", {});
      if (settled("import_quarantine") && stage("acceptance")?.status === "not_run" && !st.err.acceptance) await runStage("harbor", "acceptance", {});
      await loadImport();
      render();
    },
  };
}

function gate(text, sceneIndex, label) {
  return `<div class="gate"><p><b>Waiting on an earlier step.</b> ${esc(text)}</p><button class="btn" data-go="${sceneIndex}">${esc(label)}</button></div>`;
}

function scene5() {
  const accepted = settled("acceptance");
  const c = st.fx?.harbor?.[0];
  const o = st.out.harbor_investigation ?? {};
  const msg = c ? ([...c.messages].reverse().find((m) => /bank|account/i.test(m.body)) ?? c.messages.at(-1)) : null;
  const done = settled("harbor_investigation");
  const headline = pick(o, ["finding", "headline", "result.finding"]) ?? refsOf("harbor_investigation", /^finding$/i)[0]?.value ?? null;
  const held = st.held.harbor;
  const draft = (invCache.harbor_investigation?.drafts ?? [])[0];
  return {
    body: `${accepted ? "" : gate("Harbor hasn't installed Northline's defense yet, so its investigator has no procedure to apply. Go back to Scene 4 and click Accept defense.", 3, "← Scene 4: Accept defense")}
    <div class="x3 story">
      <section class="x3-col">
        <p class="caps x3-label">1 · A different request reaches Harbor</p>
        <article class="pay ${held ? "is-held" : ""}"><p class="caps">Harbor Print · payment</p><p class="amount">${c ? money(c.invoices.reduce((n, i) => n + i.amountCents, 0)) : ""}</p><span class="pay-state">${held ? "Payment held · Verification draft ready" : "Awaiting approval"}</span><p class="pay-to">${esc(c?.supplier ?? "")} · new supplier, different wording</p></article>
        ${msg ? `<article class="msg"><p class="caps">Forwarded voicemail · synthetic</p><p class="msg-from">${highlight(msg.from)}</p><p class="msg-body">${highlight(msg.body)}</p></article>` : ""}
      </section>
      <section class="x3-col">
        <p class="caps x3-label">2 · Checked against Harbor's own records</p>
        ${c ? claimCompare("harbor", c.messages) : ""}
        <p class="private-tag">${lock}Harbor never saw Northline's records — only Northline's method.</p>
      </section>
      <section class="x3-col">
        <p class="caps x3-label">3 · Northline's procedure, run by Harbor's agents</p>
        ${procedureApplied("harbor_investigation")}
        <article class="finding compact">
          <div class="finding-head"><span class="avatar jordan">J</span><div><b>Harbor's investigator</b>${chips(["ufo", "gbrain", "memorable", "river"])}</div>${statusPill("harbor_investigation")}</div>
          ${done ? `<p class="finding-text">${esc(headline ?? "This needs verification. I applied Northline's procedure using Harbor's records.")}</p>` : st.busy.harbor_investigation ? `<p class="note">Recalling Northline's procedure and Harbor's own records…</p>` : `<p class="note">Not run yet.</p>`}
          ${held && draft ? `<p class="draft">Unsent draft to ${esc(draft.recipient)}</p>` : ""}
          ${errBox("harbor_investigation", "harbor_investigation")}
          ${accepted && !done && !st.busy.harbor_investigation ? `<button class="btn" data-retry="harbor_investigation">Run investigation</button>` : ""}
        </article>
      </section>
    </div>
    ${stage("harbor_investigation")?.status === "reduced" ? `<p class="honest">Reduced: a River-hosted model ran Harbor's bounded tools (UFO local-provider path unavailable).</p>` : ""}`,
    action: held ? null : { label: st.busy["hold-harbor"] ? "Holding…" : "Hold payment", disabled: !done || st.busy["hold-harbor"], run: () => holdPayment("harbor", "harbor_investigation", c?.invoices.map((i) => i.id) ?? []) },
    extra: errBox("hold-harbor"),
    enter: async () => {
      if (settled("acceptance") && stage("harbor_investigation")?.status === "not_run" && !st.err.harbor_investigation && !st.busy.harbor_investigation) runStage("harbor", "harbor_investigation", { reduced: true });
      if (!st.candidate) st.candidate = await call("/ws/northline/api/procedures/candidate", null, "GET");
      await Promise.all([loadEvidence("harbor", c?.supplier), loadInvestigation("harbor", "harbor_investigation")]);
      render();
    },
  };
}

function scene6() {
  const s = stage("offline_proof");
  const o = st.out.offline_proof ?? {};
  const rep = o.report ?? st.offlineReport ?? {};
  const stepOk = (tool) => {
    const hit = (rep.steps ?? []).filter((x) => x.tool === tool);
    return hit.length ? hit.every((x) => x.ok) : null;
  };
  const decision = o.final?.decision ?? (rep.holds?.length ? "hold_pending_verification" : null);
  const draft = (rep.drafts ?? [])[0];
  const probe = o.probe ?? null;
  const checks = [
    ["External network blocked", probe ? (probe.reachable === false ? `yes — ${probe.target} failed (${probe.error})` : false) : (refsOf("offline_proof", /external probe/i)[0]?.value ?? null)],
    ["Procedure retrieved", stepOk("recall_procedure") === null ? null : stepOk("recall_procedure") ? "yes — installed defense recalled locally" : false],
    ["Records checked", stepOk("retrieve_evidence") === null ? null : stepOk("retrieve_evidence") ? "yes — Harbor's own GBrain facts" : false],
    ["Hold recommended", decision ? (decision === "hold_pending_verification" ? `yes — ${o.persisted ? `${o.persisted.id} ${o.persisted.status}` : refsOf("offline_proof", /persisted queue/i)[0]?.value ?? "payment held for verification"}` : false) : null],
    ["Draft unsent", draft ? `yes — ${draft.id} to ${draft.recipient}` : null],
  ];
  const ran = s && s.status !== "not_run";
  return {
    body: `<div class="offline">
      <div class="cut">
        <div class="cut-node"><span class="mark wave">${marks.wave}</span><b>Harbor</b><small>own GBrain · own Memorable · own queue</small></div>
        <div class="cut-link"><span class="cut-x">✕</span><small>${ran ? esc(checks[0][1] && checks[0][1] !== false ? "external network blocked" : "not verified") : "network will be cut"}</small></div>
        <div class="cut-node far"><span class="cloud">☁</span><b>Internet</b><small>relay · other companies · new bulletins</small></div>
      </div>
      <article class="result">
        <div class="finding-head"><b>Harbor, network cut</b>${statusPill("offline_proof")}</div>
        ${chips(["gbrain", "memorable", "river"])}
        ${ran ? `<ul class="checks">${checks.map(([l, v]) => `<li class="${v === false ? "no" : v == null ? "unk" : "yes"}">${esc(l)}<span>${v == null ? "not reported" : esc(typeof v === "object" ? JSON.stringify(v) : v)}</span></li>`).join("")}</ul>` : `<p class="note">Not run yet. This cuts Harbor's external network, restarts its defender and injects a fresh case — a real check, not a color change.</p>`}
        ${s?.status === "reduced" ? `<p class="reduced">Reduced: ${esc(s.detail.replace(/^\s*reduced:\s*/i, ""))}</p>` : ""}
        ${errBox("offline_proof")}
      </article>
      <div class="closing">
        <div class="cl-co"><span class="mark leaf">${marks.leaf}</span><b>Northline</b><span class="cl-lock">${lock}</span></div>
        <div class="cl-link"><span class="defense mini">One approved defense</span></div>
        <div class="cl-co"><span class="mark wave">${marks.wave}</span><b>Harbor</b><span class="cl-lock">${lock}</span></div>
      </div>
      <p class="closing-line">Share the lesson. Keep the ledger.</p>
    </div>`,
    action: { label: st.busy.offline_proof ? "Checking…" : ran ? "Run offline check again" : "Check offline", disabled: st.busy.offline_proof || !settled("harbor_investigation"), run: () => runStage("harbor", "offline_proof", {}) },
    extra: settled("harbor_investigation") ? "" : gate("The offline check re-runs Harbor's defender on a fresh case, so Harbor must first have stopped the new attack in Scene 5.", 4, "← Scene 5: A new attack"),
    enter: async () => {
      if (ran && !st.out.offline_proof && !st.offlineReport) {
        const r = await call("/ws/harbor/api/investigations/offline_proof", null, "GET");
        if (r.ok) {
          st.offlineReport = r.json.report ?? r.json;
          render();
        }
      }
    },
  };
}

// ---------- "What's happening" panel (all content from real endpoints) ----------
const toolText = {
  read_thread: ["Read the whole supplier thread", "A bank change hides in the conversation, not the invoice — so the agent reads every message, treating it as untrusted."],
  retrieve_evidence: ["Recalled verified facts from private GBrain", "Compares the request against owner-approved facts (payee account, contact) that never leave this company."],
  fetch_policy: ["Fetched this company's payment policy", "The company's own rule decides what verification is required."],
  list_related_invoices: ["Reconciled related invoices", "Finds every open invoice the redirected payment would cover, so the full exposure is known."],
  recall_procedure: ["Recalled the installed defense (Memorable)", "Checks whether an approved procedure — possibly learned from another business — applies here."],
  record_observation: ["Recorded a finding", "Each finding is logged as known (cited) or inferred, so a human can audit the reasoning."],
  propose_verification: ["Proposed independent verification", "Suggests calling the established contact on file — never the number in the suspicious email."],
  draft_message: ["Drafted an unsent message to the contact on file", "A human decides whether to send it; agents never send on their own."],
  hold_payment: ["Recommended a hold", "Money stays put until verification — the agent recommends, the owner holds."],
};
const agentNames = { jordan: "Jordan", chris: "Chris", lena: "Lena", maya: "Maya" };
const plan = ["reading thread", "recalling GBrain", "fetching policy", "reconciling invoices", "recalling procedure", "recording findings", "proposing verification", "drafting message"];
st.inv = {};
st.usage = {};
st.whatOpen = true;
st.busyAt = {};

async function loadInv(ws, id) {
  const r = await call(`/ws/${ws}/api/investigations/${id}`, null, "GET");
  st.inv[id] = r.ok ? r.json : { missing: true };
}
async function loadUsageAll() {
  const [n, h] = await Promise.all(["northline", "harbor"].map((ws) => call(`/usage/${ws}`, null, "GET")));
  st.usage = { northline: n.ok ? n.json.agents : null, harbor: h.ok ? h.json.agents : null };
}
const invFor = { 1: ["northline", "investigation"], 4: ["harbor", "harbor_investigation"] };
async function refreshWhat() {
  const t = invFor[st.i];
  await Promise.all([t ? loadInv(...t) : null, loadUsageAll()]);
  render();
}
let pollTimer = null;
function ensurePoll() {
  const t = invFor[st.i];
  if (!t || !st.busy[t[1]]) return;
  if (!st.busyAt[t[1]]) st.busyAt[t[1]] = Date.now();
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const tt = invFor[st.i];
    if (!tt || !st.busy[tt[1]]) { clearInterval(pollTimer); pollTimer = null; return; }
    await loadInv(...tt);
    render();
  }, 1500);
}

function why(text) {
  return `<small class="wh-why">${esc(text)}</small>`;
}
function whRefs(refs) {
  return refs.length ? `<div class="wh-refs">${refs.map((r) => `<span><small>${esc(r.label)}</small>${/^https?:\/\//.test(r.value) ? `<a href="${esc(r.value)}" target="_blank" rel="noopener">${esc(r.value)}</a>` : `<code title="${esc(r.value)}">${esc(r.value)}</code>`}</span>`).join("")}</div>` : "";
}
function whStage(id, whyText, re) {
  const s = stage(id);
  const ran = s && s.status !== "not_run";
  return `<li class="wh-stage">
    <div class="wh-row">${s ? s.sponsors.map((x) => `<span class="wh-ic" title="${esc(sponsorNames[x] ?? x)}">${iconFor(x)}</span>`).join("") : ""}<b>${esc(s?.title ?? id)}</b>${statusPill(id)}</div>
    ${why(whyText)}
    ${ran ? `<p class="wh-detail">${esc(s.detail)}</p>${whRefs(refsOf(id, re))}` : `<p class="wh-detail muted">${st.busy[id] ? "Running now…" : "Not run yet."}</p>`}
  </li>`;
}

function usageStrip(ws) {
  const u = st.usage[ws];
  if (!u) return `<div class="wh-usage"><span class="caps">${ws} usage</span><small class="muted">not run yet</small></div>`;
  const rows = Object.entries(u);
  if (!rows.length) return `<div class="wh-usage"><span class="caps">${ws} usage</span><small class="muted">not run yet</small></div>`;
  return `<div class="wh-usage"><span class="caps">${ws} usage</span>${rows.map(([id, a]) => {
    const ops = Object.values(a.ops ?? {}).reduce((n, v) => n + v, 0);
    return `<span class="wh-u" title="GBrain tokens ≈ chars/4 · model tokens · tool/sponsor operations"><span class="avatar ${esc(id)}">${esc((agentNames[id] ?? id)[0].toUpperCase())}</span><b>${esc(agentNames[id] ?? id)}</b><span>${iconFor("gbrain")}≈${fmtTokens(a.gbrainTokens ?? 0)}</span><span>${iconFor("model")}${fmtTokens(a.modelTokens ?? 0)}</span><span>${ops} ops</span></span>`;
  }).join("")}</div>`;
}

function whatInvestigation(ws, id) {
  const d = st.inv[id];
  const busy = st.busy[id];
  const since = st.busyAt[id];
  const live = d && !d.missing && d.run && (d.run.status !== "done" || (since && Date.parse(d.run.started_at) >= since - 2000));
  const steps = !d || d.missing ? [] : busy && !live ? [] : d.steps ?? [];
  const riverRef = refsOf(id, /river request/i)[0];
  const run = d?.run;
  const findings = d && !d.missing ? [...(d.findings?.known ?? []), ...(d.findings?.inferred ?? [])] : [];
  const progress = busy && !steps.length ? `<div class="wh-progress"><span class="avatar jordan">J</span><span><b>Jordan is working:</b> ${plan.map((p) => esc(p)).join(" → ")}</span><span class="wh-dots"><i></i><i></i><i></i></span></div>` : "";
  return `<div class="wh-grid inv">
    <div>
      <p class="caps wh-h">Agent timeline ${run ? `<span class="wh-meta">${esc(run.engine ?? "")}${riverRef ? ` · River <code>${esc(riverRef.value.slice(0, 13))}…</code>` : ""}${run.id ? ` · <code>${esc(run.id)}</code>` : ""}</span>` : ""}</p>
      ${progress}
      ${steps.length ? `<ol class="wh-tl">${steps.map((s) => {
        const [t, w] = toolText[s.tool] ?? [s.tool, "Bounded tool call."];
        return `<li class="${s.ok ? "ok" : "bad"}"><span class="avatar ${esc(s.agent)}">${esc((agentNames[s.agent] ?? s.agent)[0].toUpperCase())}</span><div><b>${esc(t)}</b> <small class="wh-agent">${esc(agentNames[s.agent] ?? s.agent)} · <code>${esc(s.tool)}</code></small>${why(w)}</div><span class="wh-ok">${s.ok ? "ok" : "failed"}</span></li>`;
      }).join("")}</ol>` : progress ? "" : `<p class="wh-detail muted">${d?.missing ? "Not run yet." : "Not run yet."}</p>`}
    </div>
    <div>
      <p class="caps wh-h">Findings · known vs inferred</p>
      ${findings.length && !(busy && !live) ? `<ul class="wh-find">${findings.map((f) => `<li><span class="wh-basis ${esc(f.basis)}">${esc(f.basis)}</span>${esc(f.text)}${f.source_ids?.length ? `<span class="wh-src">${f.source_ids.map((x) => `<code>${esc(/^\d+$/.test(x) ? `#${x}` : x)}</code>`).join("")}</span>` : ""}</li>`).join("")}</ul>` : `<p class="wh-detail muted">${busy ? "Waiting for findings…" : "Not run yet."}</p>`}
      ${usageStrip(ws)}
    </div>
  </div>`;
}

const whatBuilders = [
  () => `<p class="wh-lead">Two separate businesses, each with its own agents, private GBrain memory and payment records. Nothing is shared until a human approves a sanitized defense.</p>${usageStrip("northline")}${usageStrip("harbor")}`,
  () => whatInvestigation("northline", "investigation"),
  () => `<div class="wh-s3">
      <ol class="wh-stages four">
        ${whStage("extraction", "Turns the private incident into a generic procedure.", /memorable|candidate|procedure hash/i)}
        ${whStage("evaluation", "Tests the procedure on synthetic cases before anyone relies on it.", /report id|river/i)}
        ${whStage("review", "A human reviews the sanitized dossier.", /superset|page|dossier/i)}
        ${whStage("publication", "Signed so Harbor can verify it came from Northline and wasn't altered.", /package|digest|signing|recipients|bytes/i)}
      </ol>
      <div class="wh-cross">
        <div class="never"><p class="caps">Never crosses</p><ul><li>Invoices</li><li>Supplier records</li><li>Bank details</li><li>Credentials</li><li>Private memory</li></ul></div>
        <div class="crosses"><p class="caps">Crosses</p><ul><li>Procedure</li><li>Synthetic tests</li><li>Measured report</li><li>Review attestation</li><li>Signature</li></ul></div>
      </div>
    </div>${usageStrip("northline")}`,
  () => `<ol class="wh-stages two-up">
      ${whStage("import_quarantine", "Harbor verifies the signature and digest and holds the package in quarantine — nothing runs yet.", null)}
      ${whStage("acceptance", "Harbor re-tests the procedure against its own policies; only then can an owner activate it.", null)}
    </ol>${usageStrip("harbor")}`,
  () => whatInvestigation("harbor", "harbor_investigation"),
  () => `<ol class="wh-stages">${whStage("offline_proof", "Proves the defense works with the network cut: local memory, local procedure, local model.", null)}</ol>${usageStrip("harbor")}`,
];

function whatPanel() {
  const open = st.whatBy?.[st.i] ?? (st.i >= 2 ? false : st.whatOpen);
  return `<details class="wh" ${open ? "open" : ""}><summary><span class="caps">${st.i === 2 || st.i === 3 || st.i === 5 ? "Receipts · every ID behind this scene" : "What's happening · and why"}</span><span class="wh-toggle caps">${open ? "Hide" : "Show"}</span></summary><div class="wh-body">${whatBuilders[st.i]()}</div></details>`;
}

const builders = [scene1, scene2, scene3, scene4, scene5, scene6];
const retryMap = { investigation: ["northline", { reduced: true }], import_quarantine: ["harbor", {}], acceptance: ["harbor", {}], harbor_investigation: ["harbor", { reduced: true }] };
let current = null;

function render() {
  const sc = builders[st.i]();
  current = sc;
  document.getElementById("progress").innerHTML = scenes.map((n, i) => `<button class="pg ${i === st.i ? "on" : ""} ${i < st.i ? "past" : ""}" data-go="${i}"><span>${i + 1}</span>${esc(n)}</button>`).join("");
  document.getElementById("scene").innerHTML = `<div class="scene-body">${sc.body}</div>
    ${sc.action ? `<div class="primary"><button class="btn primary big" id="primary" ${sc.action.disabled ? "disabled" : ""}>${esc(sc.action.label)}</button></div>` : ""}
    ${sc.extra ?? ""}
    ${whatPanel()}`;
  document.getElementById("partners").hidden = st.i !== 0;
  document.getElementById("prev").disabled = st.i === 0;
  document.getElementById("next").disabled = st.i === scenes.length - 1;
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(Number(b.dataset.go))));
  document.getElementById("primary")?.addEventListener("click", () => sc.action.run());
  document.querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => {
    const [ws, body] = retryMap[b.dataset.retry] ?? ["northline", {}];
    delete st.err[b.dataset.retry];
    runStage(ws, b.dataset.retry, body);
  }));
  document.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const s = stage(b.dataset.stage);
    if (s) openDrawer(`<p class="caps">${esc(s.workspace)} · workflow step</p><h2>${esc(s.title)}</h2><span class="st st-${s.status}">${esc(statusText[s.status])}</span><dl><dt>Detail</dt><dd>${esc(s.detail || "not_run")}</dd><dt>Sponsors</dt><dd>${s.sponsors.map((x) => esc(sponsorNames[x] ?? x)).join(", ")}</dd>${s.refs.map((r) => `<dt>${esc(r.label)}</dt><dd><code>${esc(r.value)}</code></dd>`).join("")}<dt>Error</dt><dd>${esc(st.err[s.id] ?? "none")}</dd></dl>`);
  }));
  document.querySelector("details.wh")?.addEventListener("toggle", (e) => {
    st.whatOpen = e.target.open;
    st.whatBy = { ...(st.whatBy ?? {}), [st.i]: e.target.open };
    const t = e.target.querySelector(".wh-toggle");
    if (t) t.textContent = st.whatOpen ? "Hide" : "Show";
  });
  sc.wire?.();
}

function go(i) {
  st.i = Math.max(0, Math.min(scenes.length - 1, i));
  history.replaceState(null, "", `#${st.i + 1}`);
  render();
  current.enter?.();
  refreshWhat();
  ensurePoll();
}

function renderSponsors() {
  const row = document.getElementById("sponsors");
  row.innerHTML = sponsorOrder.map((id) => st.sponsors.find((s) => s.id === id)).filter(Boolean).map((s) => `
    <button class="sponsor" data-sponsor="${s.id}" title="${esc(stateLabel[s.state])}">
      <span class="sponsor-icon">${sponsorIcons[s.id]}<span class="sponsor-dot dot-${s.state}"></span></span>
      <span><span class="sponsor-name">${esc(s.name)}</span><br /><span class="caps sponsor-role">${esc(s.role)}</span></span>
    </button>`).join("");
  row.querySelectorAll(".sponsor").forEach((b) => b.addEventListener("click", () => sponsorDrawer(st.sponsors.find((s) => s.id === b.dataset.sponsor))));
}

wireDrawer();
window.addEventListener("hashchange", () => {
  const n = Math.max(0, Number(location.hash.slice(1)) - 1 || 0);
  if (n !== st.i) go(n);
});
document.getElementById("prev").addEventListener("click", () => go(st.i - 1));
document.getElementById("next").addEventListener("click", () => go(st.i + 1));
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea")) return;
  if (e.key === "ArrowRight") go(st.i + 1);
  if (e.key === "ArrowLeft") go(st.i - 1);
});

const [fx, n, h, ev] = await Promise.allSettled([api("/demo/fixtures"), api("/ws/northline/api/workspace"), api("/ws/harbor/api/workspace"), api("/ws/northline/api/integration-evidence")]);
st.fx = fx.status === "fulfilled" ? fx.value : null;
st.ws.northline = n.status === "fulfilled" ? n.value : null;
st.ws.harbor = h.status === "fulfilled" ? h.value : null;
st.sponsors = ev.status === "fulfilled" ? ev.value : [];
await loadFlow();
renderSponsors();
go(Math.max(0, Number(location.hash.slice(1)) - 1 || 0));
setInterval(async () => {
  if (Object.keys(st.busy).length) return;
  const before = JSON.stringify(st.flow?.stages);
  await loadFlow();
  if (JSON.stringify(st.flow?.stages) !== before) render();
}, 4000);
