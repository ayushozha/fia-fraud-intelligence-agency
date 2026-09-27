import { drawGlobe } from "./globe.js";
import { api, esc, iconFor, loadUsage, lock, marks, openDrawer, sponsorDrawer, sponsorIcons, sponsorNames, sponsorOrder, stateLabel, statusText, timeAgo, usageBlock, wireDrawer } from "./shared.js";

const state = { northline: null, harbor: null, sponsors: [], evidence: { northline: null, harbor: null }, flow: null, busy: {}, errors: {}, needsApproval: {}, openStage: null };

const lanes = {
  northline: ["incident_replay", "investigation", "confirmation", "extraction", "evaluation", "review", "publication"],
  harbor: ["import_quarantine", "acceptance", "harbor_investigation", "training", "offline_proof"],
};

const ui = {
  incident_replay: { short: "Incident", action: "Replay incident", inputs: [["Historical replay NR-INC-0001", "synthetic"], ["Northline invoices and supplier thread", "private"]], output: "Incident record in Northline's own database; observations written to its GBrain", approval: "None" },
  investigation: { short: "Investigate", action: "Investigate", inputs: [["Incident and supplier thread", "private"], ["GBrain supplier facts via Maya", "private"]], output: "Investigation case file from the UFO run", approval: "None — agents never release payments" },
  confirmation: { short: "Confirm", action: "Confirm fixture outcome", approve: true, inputs: [["Investigation findings", "private"]], output: "Owner-confirmed fraud outcome", approval: "Northline owner confirms" },
  extraction: { short: "Extract", action: "Extract procedure", inputs: [["Confirmed case, sanitized reconstruction", "synthetic"]], output: "Candidate procedure in Northline's Memorable store", approval: "None" },
  evaluation: { short: "Evaluate", action: "Run validation", inputs: [["Candidate procedure", "private"], ["Attack and legitimate test cases", "synthetic"]], output: "Measured validation report from QM agents", approval: "None" },
  review: { short: "Review", action: "Open review dossier", inputs: [["Procedure and validation report", "private"]], output: "Superset review dossier", approval: "Owner reviews dossier" },
  publication: { short: "Publish", action: "Approve publication", approve: true, inputs: [["Procedure, synthetic tests, measured report", "published"]], output: "Signed package on the restricted relay", approval: "Northline owner signs" },
  import_quarantine: { short: "Quarantine", action: "Test import", inputs: [["Signed package from relay", "published"]], output: "Package held in quarantine, signature verified", approval: "None" },
  acceptance: { short: "Accept", action: "Accept version", approve: true, inputs: [["Quarantined package", "published"], ["Harbor's own invoices for local tests", "private"]], output: "Procedure active in Harbor's own Memorable store", approval: "Harbor owner accepts" },
  harbor_investigation: { short: "New attack", action: "Run Harbor case", inputs: [["New bank-change attempt at Harbor", "synthetic"], ["Harbor GBrain", "private"], ["Recalled procedure", "published"]], output: "Harbor's defender (River inference) holds the payment", approval: "None" },
  training: { short: "Train", action: "Train candidate", inputs: [["Harbor-owned training cases", "private"]], output: "Harbor-owned adapter candidate from River", approval: "Owner promotes candidate" },
  offline_proof: { short: "Offline", action: "Run offline check", inputs: [["Harbor GBrain, active procedure, River defender", "private"]], output: "Offline check result with the network cut", approval: "None" },
};

const settled = (s) => s?.status === "done" || s?.status === "reduced";
const stageById = (id) => state.flow?.stages.find((s) => s.id === id);
const order = () => state.flow?.stages.map((s) => s.id) ?? [...lanes.northline, ...lanes.harbor];

function prereqsDone(id) {
  const all = order();
  return all.slice(0, all.indexOf(id)).every((x) => settled(stageById(x)));
}

function wantsApproval(s) {
  return Boolean(ui[s.id].approve || state.needsApproval[s.id] || s.refs.some((r) => /approv/i.test(r.label) && /required|pending|needed|awaiting/i.test(r.value)));
}

function offersReduced(s) {
  return s.status === "blocked" && (/reduced/i.test(s.detail) || s.refs.some((r) => /reduced/i.test(`${r.label} ${r.value}`)));
}

function refValue(s, re) {
  return s?.refs.find((r) => re.test(r.label))?.value ?? null;
}

function renderLane(ws) {
  const ids = lanes[ws];
  const stages = ids.map(stageById).filter(Boolean);
  if (!state.flow) return `<p class="note lane-note">Loading workflow…</p>`;
  if (state.flow.unreachable[ws]) return `<p class="lane-err">Workspace unreachable — ${esc(state.flow.unreachable[ws])}</p>`;
  const next = stages.find((s) => !settled(s));
  const rows = stages.map((s, i) => {
    const ready = prereqsDone(s.id);
    const cls = state.busy[s.id] ? "running" : s.status;
    return `
      <li class="step st-${cls} ${s === next ? "is-next" : ""} ${!ready && !settled(s) ? "locked" : ""}">
        <button class="step-btn" data-stage="${s.id}">
          <span class="step-n">${settled(s) ? "✓" : i + 1}</span>
          <span class="step-text"><b>${esc(s.title)}</b>
            ${s.status === "blocked" || s.status === "failed" ? `<span class="step-why">${esc(s.detail || "No reason recorded")}</span>` : ""}
            ${s.status === "reduced" ? `<span class="step-why amber">Reduced mode — ${esc(s.detail || "clearly labeled fallback")}</span>` : ""}
            ${state.errors[s.id] ? `<span class="step-why">${esc(state.errors[s.id])}</span>` : ""}
          </span>
          <span class="step-sp">${s.sponsors.map((sp) => `<i title="${esc(sponsorNames[sp] ?? sp)}">${iconFor(sp)}</i>`).join("")}</span>
          <span class="st st-${cls}">${esc(state.busy[s.id] ? "Running" : statusText[s.status] ?? s.status)}</span>
        </button>
      </li>`;
  }).join("");
  let action = `<p class="lane-done">${lock}Lane complete. Every step recorded its own evidence.</p>`;
  if (next) {
    const ready = prereqsDone(next.id);
    const approve = wantsApproval(next);
    const waiting = !ready ? (ws === "harbor" && !settled(stageById("publication")) ? "Waiting for Northline to publish a signed defense" : "Waiting for the previous step") : "";
    action = `
      <div class="lane-action">
        <div class="lane-next"><span class="caps">Next</span><span>${esc(ui[next.id].action)}</span>${waiting ? `<small>${esc(waiting)}</small>` : ""}</div>
        <div class="lane-btns">
          ${offersReduced(next) ? `<button class="btn" data-run="${next.id}" data-mode="reduced" ${ready && !state.busy[next.id] ? "" : "disabled"}>Continue reduced</button>` : ""}
          <button class="btn primary ${approve ? "approve" : ""}" data-run="${next.id}" data-mode="${approve ? "approve" : "run"}" ${ready && !state.busy[next.id] ? "" : "disabled"}>${state.busy[next.id] ? "Running…" : approve ? `Approve · ${esc(ui[next.id].short)}` : "Run next step"}</button>
        </div>
      </div>`;
  }
  return `<ol class="steps">${rows}</ol>${action}`;
}

function renderWorkspace(ws) {
  const el = document.getElementById(`ws-${ws}`);
  const d = state[ws];
  if (!d) {
    el.innerHTML = `<p class="caps">${ws} workspace unreachable</p>`;
    return;
  }
  el.innerHTML = `
    <div class="ws-head">
      <div class="mark ${d.mark}">${marks[d.mark]}</div>
      <div class="ws-title">
        <h2 class="ws-name"><a href="/workspace/${ws}">${esc(d.name)}</a></h2>
        <p class="caps ws-tag">${esc(d.tagline)}</p>
      </div>
      <span class="pill ${d.alert.level}" title="${esc(d.alert.reason)}">${esc(d.alert.label)}</span>
    </div>
    <div class="agents compact">
      ${d.agents.map((a) => `
        <button class="agent" data-agent="${a.id}" title="${esc(a.role)} · ${esc(a.status.label)} — ${esc(a.status.detail)}">
          <div class="avatar ${a.id}">${esc(a.name[0])}</div>
          <div class="agent-name">${esc(a.name)}</div>
        </button>`).join("")}
    </div>
    <div class="rule"></div>
    <p class="caps agents-label">${ws === "northline" ? "Learn from the fraud" : "Receive the defense, stop the next one"}</p>
    <div class="lane" id="lane-${ws}">${renderLane(ws)}</div>
    <div class="ownership">${lock}<div><p>Owns its agents, data and memory.</p><p class="caps">Procedure: ${esc(d.activeProcedure ?? "none active")} · Model: ${esc(d.activeModel ?? "none loaded")} · Retrieval: ${esc(d.retrieval ?? "unknown")}</p></div></div>`;
  el.querySelectorAll(".agent").forEach((b) => b.addEventListener("click", () => openAgent(ws, b.dataset.agent)));
  wireLane(el);
}

function wireLane(el) {
  el.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => stageDrawer(b.dataset.stage)));
  el.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => runStage(b.dataset.run, b.dataset.mode)));
}

function refreshLanes() {
  for (const ws of ["northline", "harbor"]) {
    const lane = document.getElementById(`lane-${ws}`);
    if (!lane) continue;
    lane.innerHTML = renderLane(ws);
    wireLane(lane);
  }
}

async function runStage(id, mode) {
  const s = stageById(id);
  if (!s) return;
  state.busy[id] = true;
  delete state.errors[id];
  refreshLanes();
  try {
    if (id === "incident_replay") {
      await api(`/ws/${s.workspace}/api/incidents`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ fixture: "historical_replay" }) });
    } else {
      const body = mode === "approve" ? { approve: true } : mode === "reduced" ? { reduced: true } : {};
      const res = await fetch(`/ws/${s.workspace}/api/workflow/${id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = out.error || out.reason || out.detail || `${res.status}`;
        if (res.status === 409 && /approv/i.test(reason)) state.needsApproval[id] = true;
        const label = res.status === 404 ? "Not built yet — no stage endpoint" : res.status === 409 ? "Not ready" : res.status === 503 ? "Service unavailable" : `Error ${res.status}`;
        state.errors[id] = `${label}: ${reason}`;
      }
    }
  } catch (err) {
    state.errors[id] = `Request failed: ${err.message}`;
  }
  delete state.busy[id];
  await refresh();
  if (state.openStage === id) stageDrawer(id);
}

function tag(kind) {
  return `<span class="dtag ${kind}">${kind}</span>`;
}

function splitRefs(refs) {
  const ids = [], evidence = [], output = [];
  for (const r of refs) {
    if (/gbrain|memory|evidence|fact|recall|observation/i.test(r.label)) evidence.push(r);
    else if (/run|request|job|trace|session|receipt|page|task|id$|^id|hash|digest|key/i.test(r.label)) ids.push(r);
    else output.push(r);
  }
  return { ids, evidence, output };
}

const refList = (list) => list.map((r) => `<span class="ref"><span>${esc(r.label)}</span><code>${esc(r.value)}</code></span>`).join("");

function elapsedOf(s) {
  const e = refValue(s, /elapsed|duration/i);
  if (e) return e;
  if (s.status === "running" && s.updatedAt) return `running since ${timeAgo(s.updatedAt)}`;
  return s.updatedAt ? `not recorded · updated ${timeAgo(s.updatedAt)}` : "not_run";
}

function stageDrawer(id) {
  const s = stageById(id);
  if (!s) return;
  state.openStage = id;
  const u = ui[id];
  const idx = order().indexOf(id) + 1;
  const wsName = state[s.workspace]?.name ?? s.workspace;
  const { ids, evidence, output } = splitRefs(s.refs);
  const ready = prereqsDone(id);
  const receipts = (state.evidence[s.workspace] ?? []).flatMap((sp) => sp.receipts.filter((r) => r.stage === id).map((r) => ({ ...r, sponsor: sp.id })));
  openDrawer(`
    <p class="caps">${esc(wsName)} · private workspace · step ${idx} of ${order().length}</p>
    <h2>${esc(s.title)}</h2>
    <span class="st st-${s.status}">${esc(statusText[s.status] ?? s.status)}</span>
    ${s.status === "reduced" ? `<p class="note amber">Reduced mode: an honest fallback chosen by the owner. The full sponsor claim for this step is not made.</p>` : ""}
    <dl>
      <dt>Status</dt><dd>${s.status === "not_run" ? `not_run — no score, no receipt, nothing invented.${ready ? "" : " Prerequisites not done."}` : esc(s.detail || statusText[s.status])}</dd>
      <dt>Inputs</dt><dd>${u.inputs.map(([t, k]) => `<div class="din">${esc(t)} ${tag(k)}</div>`).join("")}</dd>
      <dt>Sponsors</dt><dd class="dsp">${s.sponsors.map((sp) => `<span class="dsp-i">${iconFor(sp)}${esc(sponsorNames[sp] ?? sp)}</span>`).join("")}</dd>
      <dt>Run / request IDs</dt><dd>${ids.length || receipts.length ? `${refList(ids)}${receipts.map((r) => `<span class="ref"><span>${esc(sponsorNames[r.sponsor] ?? r.sponsor)} receipt</span><code>${esc(r.externalRef)}</code></span>`).join("")}` : "none recorded — not_run"}</dd>
      <dt>Evidence / memory</dt><dd>${evidence.length ? refList(evidence) : "none recorded"} <small class="owner-only">Owner view · ${esc(wsName)} only</small></dd>
      <dt>Output</dt><dd>${esc(u.output)}${output.length ? `<div>${refList(output)}</div>` : settled(s) ? "" : " <small>(not produced yet)</small>"}</dd>
      <dt>Elapsed</dt><dd>${esc(elapsedOf(s))}</dd>
      <dt>Approval</dt><dd>${esc(u.approval)}${wantsApproval(s) && !settled(s) ? " — required before this step completes" : ""}</dd>
      <dt>Errors</dt><dd>${state.errors[id] ? esc(state.errors[id]) : s.status === "blocked" || s.status === "failed" ? esc(s.detail) : "none"}</dd>
    </dl>
    <p class="note">Sponsor receipts are written only by a real run. Actions are enforced server-side; this screen cannot skip a prerequisite.</p>`);
}

function renderSponsors() {
  const row = document.getElementById("sponsors");
  const ordered = sponsorOrder.map((id) => state.sponsors.find((s) => s.id === id)).filter(Boolean);
  row.innerHTML = ordered.map((s) => `
    <button class="sponsor" data-sponsor="${s.id}" title="${esc(stateLabel[s.state])}">
      <span class="sponsor-icon">${sponsorIcons[s.id]}<span class="sponsor-dot dot-${s.state}"></span></span>
      <span><span class="sponsor-name">${esc(s.name)}</span><br /><span class="caps sponsor-role">${esc(s.role)}</span></span>
    </button>`).join("");
  row.querySelectorAll(".sponsor").forEach((b) => b.addEventListener("click", () => sponsorDrawer(state.sponsors.find((s) => s.id === b.dataset.sponsor))));
}

function mergeEvidence() {
  const n = state.evidence.northline ?? [];
  const h = state.evidence.harbor ?? [];
  if (!n.length) return h;
  return n.map((s) => {
    const other = h.find((x) => x.id === s.id);
    const receipts = [...s.receipts, ...(other?.receipts ?? [])];
    return { ...s, receipts, state: receipts.length ? "verified" : s.state };
  });
}

function pkg() {
  const list = state.flow?.relay?.packages ?? [];
  return list[list.length - 1] ?? null;
}

function renderBoundary() {
  const pub = stageById("publication");
  const imp = stageById("import_quarantine");
  const p = pkg();
  const phase = settled(imp) ? "crossed" : settled(pub) ? "published" : "idle";
  const b = document.querySelector(".boundary");
  b.dataset.phase = phase;
  document.getElementById("packet-a").setAttribute("path", phase === "crossed" ? document.getElementById("route-full").getAttribute("d") : document.getElementById("route-half").getAttribute("d"));
  const el = document.getElementById("package-state");
  if (!state.flow?.relay) {
    el.innerHTML = `Relay unreachable${state.flow?.relayError ? ` — ${esc(state.flow.relayError)}` : ""}`;
  } else if (!p) {
    el.innerHTML = settled(pub) ? `Publication recorded · package not on relay yet` : `No defense package published yet`;
  } else {
    const version = p.version ?? refValue(pub, /version/i);
    const recipients = p.recipients?.length ? p.recipients.join(", ") : refValue(pub, /recipient/i) ?? "Harbor Print";
    el.innerHTML = `
      <b>${esc(p.id)}${version ? ` v${esc(version)}` : ""}</b>
      <span>${p.bytes != null ? `${Number(p.bytes).toLocaleString()} bytes` : "size not reported"} · <span class="${p.signed ? "sig-ok" : "sig-bad"}">${p.signed ? "signed" : "unsigned"}</span></span>
      <span>→ ${esc(recipients)} · ${phase === "crossed" ? "in Harbor quarantine" : "on relay"}</span>`;
  }
}

function renderStrength() {
  const relay = state.flow?.relay;
  const shared = relay?.published ?? 0;
  const protectedCount = [settled(stageById("publication")), settled(stageById("acceptance"))].filter(Boolean).length;
  const held = (state.northline?.records.heldPayments ?? 0) + (state.harbor?.records.heldPayments ?? 0);
  const stopped = settled(stageById("harbor_investigation"));
  const items = [
    ["Defenses shared", shared, "Signed packages on the restricted relay", "blue"],
    ["Businesses protected", protectedCount, "Workspaces with a published or accepted defense", "green"],
    ["Attacks held", held, "Payments held across both private ledgers", "red"],
  ];
  document.getElementById("strength").innerHTML = `
    <div class="strength-head"><span class="live-dot"></span><div><p class="caps">Network strength · live</p><p class="strength-line">${stopped ? "Northline's loss just stopped an attack at Harbor." : settled(stageById("publication")) ? "One fraud became a shared defense." : "Every confirmed fraud makes the network stronger."}</p></div></div>
    ${items.map(([label, value, source, tone]) => `<div class="strength-item ${tone}" title="${esc(source)}"><span class="strength-value">${value}</span><span class="caps">${label}</span></div>`).join("")}`;
}

async function openAgent(ws, agentId) {
  const d = state[ws];
  const a = d?.agents.find((x) => x.id === agentId);
  if (!a) return;
  const body = (usage) => `
    <p class="caps">${esc(d.name)} · private workspace</p>
    <h2>${esc(a.name)} — ${esc(a.role)}</h2>
    <dl>
      <dt>Duty</dt><dd>${esc(a.duty)}</dd>
      <dt>Backed by</dt><dd>${esc(a.backedBy === "fia" ? "FIA local service" : a.backedBy)}</dd>
      <dt>Status</dt><dd>${esc(a.status.label)} — ${esc(a.status.detail)}</dd>
      <dt>Procedure</dt><dd>${esc(d.activeProcedure ?? "none active")}</dd>
      <dt>Model</dt><dd>${esc(d.activeModel ?? "none loaded")}</dd>
    </dl>
    ${usage === undefined ? `<p class="note">Loading sponsor usage…</p>` : usage === null ? `<p class="note">Usage unavailable — workspace unreachable.</p>` : usageBlock(usage[a.id])}`;
  openDrawer(body(undefined));
  state.openStage = null;
  openDrawer(body(await loadUsage(ws)));
}

async function refreshEvidence() {
  const [n, h] = await Promise.allSettled([api("/ws/northline/api/integration-evidence"), api("/ws/harbor/api/integration-evidence")]);
  if (n.status === "fulfilled") state.evidence.northline = n.value;
  if (h.status === "fulfilled") state.evidence.harbor = h.value;
  state.sponsors = mergeEvidence();
  renderSponsors();
}

let lastKey = "";
async function refresh() {
  const [n, h, flow] = await Promise.allSettled([api("/ws/northline/api/workspace"), api("/ws/harbor/api/workspace"), api("/workflow")]);
  state.northline = n.status === "fulfilled" ? n.value : null;
  state.harbor = h.status === "fulfilled" ? h.value : null;
  state.flow = flow.status === "fulfilled" ? flow.value : state.flow;
  const key = JSON.stringify([state.northline, state.harbor, state.flow?.stages, state.flow?.relay, state.busy, state.errors]);
  if (key === lastKey) return;
  lastKey = key;
  renderWorkspace("northline");
  renderWorkspace("harbor");
  renderBoundary();
  renderStrength();
  if (state.openStage && document.getElementById("drawer").classList.contains("open")) stageDrawer(state.openStage);
}

wireDrawer();
document.getElementById("drawer-close").addEventListener("click", () => (state.openStage = null));
document.getElementById("package-btn").addEventListener("click", () => {
  state.openStage = null;
  const p = pkg();
  const pub = stageById("publication");
  openDrawer(`
    <p class="caps">Controlled publication boundary</p>
    <h2>Package inspector</h2>
    <dl>
      <dt>Package</dt><dd>${p ? `${esc(p.id)}${p.version ? ` v${esc(p.version)}` : ""}` : "none published — not_run"}</dd>
      <dt>Byte count</dt><dd>${p?.bytes != null ? `${Number(p.bytes).toLocaleString()} bytes` : "—"}</dd>
      <dt>Signature</dt><dd>${p ? (p.signed ? `signed${p.publisherKeyId ? ` · key <code>${esc(p.publisherKeyId)}</code>` : ""}` : "unsigned — would be rejected") : "—"}</dd>
      <dt>Payload digest</dt><dd>${p?.payloadDigest ? `<code>${esc(p.payloadDigest)}</code>` : refValue(pub, /digest|hash/i) ? `<code>${esc(refValue(pub, /digest|hash/i))}</code>` : "—"}</dd>
      <dt>Recipients</dt><dd>${p?.recipients?.length ? esc(p.recipients.join(", ")) : p ? esc(p.distribution ?? "named recipients") : "—"}</dd>
      <dt>Files</dt><dd>${p?.files?.length ? p.files.map((f) => `<code>${esc(f)}</code>`).join("<br />") : "—"}</dd>
      <dt>May cross</dt><dd>Reviewed procedure, synthetic tests, measured validation report, review attestation, signature.</dd>
      <dt>Never crosses</dt><dd class="absent-list"><span>✕ Raw invoices</span><span>✕ Private supplier records</span><span>✕ Bank details and credentials</span><span>✕ Private memory</span><span>✕ Model adapters</span></dd>
    </dl>
    <p class="note">Harbor learns only from this package. It never reads Northline's database, brain, or memory.</p>`);
});

drawGlobe(document.getElementById("globe"), { cx: 450, cy: 330, R: 300, rows: 9, clip: 330 });
refresh();
refreshEvidence();
setInterval(refresh, 3000);
setInterval(refreshEvidence, 15000);
