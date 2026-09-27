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
    <div class="co-lock">${lock}<span>Messages · suppliers · payment records stay here</span></div>
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

function scene1() {
  return {
    body: `<div class="net">${companyCard("northline")}${bridge("Approved intelligence only")}${companyCard("harbor")}</div>
      <p class="say">Two independent businesses. Each has its own employee agents and its own private records. Only approved defenses travel between them.</p>`,
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
  const facts = factIds("investigation");
  const held = st.held.northline;
  const conf = stage("confirmation");
  return {
    body: `<div class="two">
      <div class="col">
        <article class="pay ${held ? "is-held" : ""}">
          <p class="caps">Northline Roasters · payment</p>
          <p class="amount">${s ? money(s.total) : "$9,400"}</p>
          <span class="pay-state">${held ? "Held" : "Awaiting approval"}</span>
          <p class="pay-to">${s ? `${esc(s.r.supplier)} · ${s.r.invoices.map((i) => esc(i.id)).join(", ")}` : ""}</p>
        </article>
        ${s ? `<article class="msg"><p class="caps">Supplier message · synthetic</p><p class="msg-from">${esc(s.msg.from)}</p><p class="msg-subj">${esc(s.msg.subject)}</p><p class="msg-body">${esc(s.msg.body)}</p></article>` : ""}
      </div>
      <div class="col">
        <article class="finding">
          <div class="finding-head"><span class="avatar jordan">J</span><div><b>Jordan · Investigator</b>${chips(["ufo", "gbrain"])}</div>${statusPill("investigation")}</div>
          ${finding ? `<p class="finding-text">${esc(finding)}</p>` : st.busy.investigation ? `<p class="note">Investigating with Northline's private GBrain…</p>` : `<p class="note">Not run yet.</p>`}
          ${facts.length ? `<p class="caps">Cited GBrain facts</p><div class="refs">${facts.map((f) => `<code class="fact">${esc(f)}</code>`).join("")}</div>` : ""}
          ${refChips("investigation", /run|request|task|session|trace/i)}
          ${reducedNote("investigation")}
          ${errBox("investigation", "investigation")}
          ${!settled("investigation") && !st.busy.investigation ? `<button class="btn" data-retry="investigation">${inv?.status === "not_run" && !st.err.investigation ? "Investigate" : "Retry investigation"}</button>` : ""}
        </article>
        ${held ? `<article class="confirm">
          <p class="caps">Simulated supplier verification</p>
          ${settled("confirmation") ? `<p class="confirm-text">Fraud confirmed</p><p class="note">${esc(conf.detail)}</p>` : `<button class="btn" id="confirm-btn" ${st.busy.confirmation ? "disabled" : ""}>${st.busy.confirmation ? "Confirming…" : "Record simulated verification: fraud confirmed"}</button>`}
          ${errBox("confirmation")}
        </article>` : ""}
      </div>
    </div>`,
    action: held ? null : { label: st.busy["hold-northline"] ? "Holding…" : "Hold payment", disabled: st.busy["hold-northline"], run: () => holdPayment("northline", "investigation", s?.r.invoices.map((i) => i.id) ?? []) },
    extra: errBox("hold-northline"),
    enter: () => {
      if (stage("investigation")?.status === "not_run" && !st.err.investigation && !st.busy.investigation) runStage("northline", "investigation", { reduced: true });
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

function scene3() {
  const done = settled("publication");
  return {
    body: `<div class="share ${done || st.sent ? "sent" : ""}">
      <div class="share-left">
        <div class="vault">${lock}<span>Messages</span><span>Suppliers</span><span>Payment records</span><small class="caps">Stay at Northline</small></div>
      </div>
      <article class="defense">
        <p class="caps">Defense · from Northline</p>
        <h2>${esc(candidateTitle())}</h2>
        <p class="lbl shared">Shared: Procedure and test evidence.</p>
        <p class="lbl private">Private: Messages, suppliers, payment records.</p>
      </article>
      <div class="share-right"><span class="shield big">${shieldSvg}</span><p class="caps">To the network</p></div>
    </div>
    <ol class="steps-row">${shareSteps.map(([id, , sp, label]) => `<li class="sr ${stage(id)?.status ?? "not_run"} ${st.busy[id] ? "running" : ""}" data-stage="${id}">
      <span class="sr-icon">${iconFor(sp)}</span><b>${esc(label)}</b>${statusPill(id)}${refChips(id, /run|request|id|page|hash|digest|version|job|receipt/i)}${reducedNote(id)}${errBox(id)}
      ${stage(id)?.status === "blocked" || stage(id)?.status === "failed" ? `<small class="why">${esc(stage(id).detail)}</small>` : ""}</li>`).join("")}</ol>
    ${evalsView()}`,
    action: done ? null : { label: st.sharing ? "Sharing…" : "Share defense", disabled: Boolean(st.sharing), run: shareDefense },
    enter: async () => {
      if (!st.candidate) {
        st.candidate = await call("/ws/northline/api/procedures/candidate", null, "GET");
        render();
      }
      if (settled("publication") && !st.evals) {
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

function scene4() {
  const acc = stage("acceptance");
  const active = acc?.status === "done" || acc?.status === "reduced";
  return {
    body: `<div class="arrive">
      <article class="defense arrived">
        <p class="from">From Northline</p>
        <h2>${esc(candidateTitle())}</h2>
        <div class="q-row"><span>Quarantine</span>${statusPill("import_quarantine")}</div>${refChips("import_quarantine", /package|version|signature|hash|digest|bytes/i)}${errBox("import_quarantine", "import_quarantine")}
        <div class="q-row"><span>Harbor's own tests</span>${statusPill("acceptance")}</div>${refChips("acceptance")}${errBox("acceptance", "acceptance")}
        ${checksPassed() && !active ? `<p class="ready">Tested against Harbor's policies. Ready for your review.</p>` : ""}
        ${active ? `<p class="ready ok">Accepted. Active in Harbor's own Memorable store.</p>` : ""}
        ${acc?.detail && !checksPassed() && !active ? `<p class="note">${esc(acc.detail)}</p>` : ""}
        ${chips(["memorable"])}
      </article>
      ${companyCard("harbor")}
    </div>`,
    action: active ? null : { label: st.busy.acceptance ? "Accepting…" : "Accept defense", disabled: !checksPassed() || st.busy.acceptance, run: () => runStage("harbor", "acceptance", { approve: true }) },
    enter: async () => {
      if (!settled("import_quarantine") && !st.busy.import_quarantine && !st.err.import_quarantine) await runStage("harbor", "import_quarantine", {});
      if (settled("import_quarantine") && stage("acceptance")?.status === "not_run" && !st.err.acceptance) await runStage("harbor", "acceptance", {});
    },
  };
}

function scene5() {
  const c = st.fx?.harbor?.[0];
  const o = st.out.harbor_investigation ?? {};
  const sup = pick(o, ["supplier.name", "supplierName", "supplier"]) ?? c?.supplier;
  const msg = c ? ([...c.messages].reverse().find((m) => /bank|account/i.test(m.body)) ?? c.messages.at(-1)) : null;
  const done = settled("harbor_investigation");
  const headline = pick(o, ["finding", "headline", "result.finding"]) ?? refsOf("harbor_investigation", /^finding$/i)[0]?.value ?? null;
  const detail = done && !headline && stage("harbor_investigation").status !== "reduced" ? cleanDetail(stage("harbor_investigation").detail) : null;
  const held = st.held.harbor;
  return {
    body: `<div class="two">
      <div class="col">
        <article class="pay ${held ? "is-held" : ""}"><p class="caps">Harbor Print · payment</p><p class="amount">${c ? money(c.invoices.reduce((n, i) => n + i.amountCents, 0)) : ""}</p><span class="pay-state">${held ? "Payment held · Verification draft ready" : "Awaiting approval"}</span><p class="pay-to">${esc(sup ?? "")}</p></article>
        ${msg ? `<article class="msg"><p class="caps">New supplier · different wording · synthetic</p><p class="msg-from">${esc(msg.from)}</p><p class="msg-body">${esc(msg.body)}</p></article>` : ""}
      </div>
      <div class="col">
        <article class="finding">
          <div class="finding-head"><span class="avatar jordan">J</span><div><b>Harbor's investigator</b>${chips(["ufo", "gbrain", "memorable", "river"])}</div>${statusPill("harbor_investigation")}</div>
          ${done ? `<p class="finding-text">${esc(headline ?? "This needs verification. I applied Northline's procedure using Harbor's records.")}</p>` : st.busy.harbor_investigation ? `<p class="note">Recalling Northline's procedure and Harbor's own records…</p>` : `<p class="note">Not run yet.</p>`}
          ${detail ? `<p class="note">${esc(detail)}</p>` : ""}
          ${factIds("harbor_investigation").length ? `<div class="refs">${factIds("harbor_investigation").map((f) => `<code class="fact">${esc(f)}</code>`).join("")}</div>` : ""}
          ${refChips("harbor_investigation", /run|request|task|model|procedure/i)}${reducedNote("harbor_investigation")}
          ${errBox("harbor_investigation", "harbor_investigation")}
          ${!done && !st.busy.harbor_investigation ? `<button class="btn" data-retry="harbor_investigation">Run investigation</button>` : ""}
        </article>
      </div>
    </div>`,
    action: held ? null : { label: st.busy["hold-harbor"] ? "Holding…" : "Hold payment", disabled: !done || st.busy["hold-harbor"], run: () => holdPayment("harbor", "harbor_investigation", c?.invoices.map((i) => i.id) ?? []) },
    extra: errBox("hold-harbor"),
    enter: () => {
      if (stage("harbor_investigation")?.status === "not_run" && !st.err.harbor_investigation && !st.busy.harbor_investigation) runStage("harbor", "harbor_investigation", { reduced: true });
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
      <article class="result">
        <div class="finding-head"><b>Harbor, network cut</b>${statusPill("offline_proof")}</div>
        ${chips(["gbrain", "memorable", "river"])}
        ${ran ? `<ul class="checks">${checks.map(([l, v]) => `<li class="${v === false ? "no" : v == null ? "unk" : "yes"}">${esc(l)}<span>${v == null ? "not reported" : esc(typeof v === "object" ? JSON.stringify(v) : v)}</span></li>`).join("")}</ul><p class="note">${esc(s.detail)}</p>` : `<p class="note">Not run yet. This launches a real check — it does not just change a color.</p>`}
        ${s?.status === "reduced" ? `<p class="reduced">Reduced: ${esc(s.detail)}</p>` : ""}
        ${refChips("offline_proof")}${errBox("offline_proof")}
      </article>
      <div class="closing">
        <div class="cl-co"><span class="mark leaf">${marks.leaf}</span><b>Northline</b><span class="cl-lock">${lock}</span></div>
        <div class="cl-link"><span class="defense mini">One approved defense</span></div>
        <div class="cl-co"><span class="mark wave">${marks.wave}</span><b>Harbor</b><span class="cl-lock">${lock}</span></div>
      </div>
      <p class="closing-line">Share the lesson. Keep the ledger.</p>
    </div>`,
    action: { label: st.busy.offline_proof ? "Checking…" : ran ? "Run offline check again" : "Check offline", disabled: st.busy.offline_proof, run: () => runStage("harbor", "offline_proof", {}) },
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
  return `<details class="wh" ${st.whatOpen ? "open" : ""}><summary><span class="caps">What's happening · and why</span><span class="wh-toggle caps">${st.whatOpen ? "Hide" : "Show"}</span></summary><div class="wh-body">${whatBuilders[st.i]()}</div></details>`;
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
