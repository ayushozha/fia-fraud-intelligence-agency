import { api, esc, loadUsage, lock, marks, openDrawer, sponsorDrawer, sponsorIcons, sponsorOrder, sponsorPurpose, stateLabel, timeAgo, usageBlock, usageRow, wireDrawer } from "./shared.js";
import { drawGlobe } from "./globe.js";

const ws = location.pathname.split("/")[2];
const shortName = { northline: "Northline", harbor: "Harbor" };

function readMode() {
  const q = new URLSearchParams(location.search).get("mode");
  if (q === "live" || q === "showcase") return q;
  try {
    return localStorage.getItem("fia.mode") ?? "showcase";
  } catch {
    return "showcase";
  }
}

const state = { mode: readMode(), workspace: null, sponsors: [], relay: null, showcase: null, usage: null };

const statIcons = {
  businesses: '<svg viewBox="0 0 40 40" fill="#3a5fb0"><circle cx="20" cy="14" r="4.5"/><circle cx="11" cy="16" r="3.5"/><circle cx="29" cy="16" r="3.5"/><path d="M12 30c0-5 3.6-8 8-8s8 3 8 8H12Z"/><path d="M4 29c0-4 2.8-6.5 6.5-6.5 1.3 0 2.4.3 3.3.8-1.4 1.6-2.3 3.5-2.5 5.7H4ZM36 29c0-4-2.8-6.5-6.5-6.5-1.3 0-2.4.3-3.3.8 1.4 1.6 2.3 3.5 2.5 5.7H36Z"/></svg>',
  threatsDetected: '<svg viewBox="0 0 40 40" fill="none" stroke="#c0262d" stroke-width="2" stroke-linejoin="round"><path d="M20 7 35 32H5L20 7Z"/><path d="M20 16v8" stroke-linecap="round"/><circle cx="20" cy="28" r="1.2" fill="#c0262d"/></svg>',
  threatsBlocked: '<svg viewBox="0 0 40 40" fill="none" stroke="#1e7a3c" stroke-width="2" stroke-linejoin="round"><path d="M20 6 9 10v8c0 7 4.7 12.5 11 15 6.3-2.5 11-8 11-15v-8L20 6Z"/><path d="m15 19 4 4 7-8" stroke-linecap="round"/></svg>',
  sharedDefenses: '<svg viewBox="0 0 40 40" fill="none" stroke="#2b3f66" stroke-width="2"><circle cx="28" cy="11" r="4"/><circle cx="12" cy="20" r="4"/><circle cx="28" cy="29" r="4"/><path d="m15.5 18 9-5M15.5 22l9 5"/></svg>',
};
const statMeta = {
  businesses: { label: "Businesses in network", tone: "blue", color: "#6f95e0" },
  threatsDetected: { label: "Threats detected", tone: "red", color: "#e0787a" },
  threatsBlocked: { label: "Threats blocked", tone: "green", color: "#6cc08a" },
  sharedDefenses: { label: "Shared defenses", tone: "blue", color: "#6f95e0" },
};

function spark(series, color) {
  const w = 90, h = 34;
  const max = Math.max(1, ...series);
  const pts = series.map((v, i) => [(i / (series.length - 1)) * w, h - 3 - (v / max) * (h - 8)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const id = `g${color.slice(1)}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

function liveView() {
  const d = state.workspace;
  const relay = state.relay;
  const flat = Array(14).fill(0);
  return {
    stats: {
      businesses: { value: relay?.participants.length ?? 0, pct: null, series: flat, source: "Participants pinned on the restricted relay" },
      threatsDetected: { value: d.stats.threatsDetected.value, pct: d.stats.threatsDetected.delta.pct, series: d.stats.threatsDetected.series, source: d.stats.threatsDetected.source },
      threatsBlocked: { value: d.stats.threatsBlocked.value, pct: d.stats.threatsBlocked.delta.pct, series: d.stats.threatsBlocked.series, source: d.stats.threatsBlocked.source },
      sharedDefenses: { value: relay?.published ?? 0, pct: null, series: flat, source: "Signed packages on the restricted relay" },
    },
    agents: d.agents,
    participants: relay?.participants ?? [],
    activity: [
      ...(relay?.events ?? []).map((e) => ({ who: nameOf(e.publisher), mark: markOf(e.publisher), text: `${e.kind} ${e.packageId} v${e.version}`, badge: "Network", tone: "blue", ago: timeAgo(e.at) })),
      ...d.activity.map((a) => ({ who: d.name, mark: d.mark, text: describe(a), badge: a.action.startsWith("incident") ? "Alert" : a.action.startsWith("gbrain") ? "GBrain" : "Private", tone: a.action.startsWith("incident") || a.action.endsWith("unavailable") || a.action.endsWith("failed") ? "red" : a.action.startsWith("gbrain") ? "blue" : "grey", ago: timeAgo(a.at) })),
    ],
  };
}

function showcaseView() {
  const s = state.showcase;
  return {
    stats: Object.fromEntries(Object.entries(s.stats).map(([k, v]) => [k, { ...v, source: "Illustrative showcase value — not measured" }])),
    agents: state.workspace.agents.map((a) => ({ ...a, status: { ...s.agentStatus[a.id], detail: "Illustrative showcase status." } })),
    participants: s.participants,
    activity: s.activity,
  };
}

function nameOf(id) {
  return state.relay?.participants.find((p) => p.id === id)?.name ?? id;
}
function markOf(id) {
  return state.relay?.participants.find((p) => p.id === id)?.mark ?? "people";
}
function describe(a) {
  if (a.action === "seed") return `loaded its synthetic ledger (${a.detail})`;
  if (a.action === "incident.replay_loaded") return `replayed historical incident ${a.detail}`;
  if (a.action === "gbrain.seed") return `Maya: ${a.detail}`;
  if (a.action === "gbrain.observations") return `Maya: ${a.detail} in GBrain`;
  if (a.action === "gbrain.unavailable" || a.action === "gbrain.observations_failed") return `Maya: GBrain unavailable — ${a.detail}`;
  return `${a.action} ${a.detail}`;
}

function fmtPct(pct) {
  if (pct === null || pct === undefined) return `<span class="delta none">no prior period</span>`;
  const up = pct >= 0;
  return `<span class="delta ${up ? "up" : "down"}">${up ? "↑" : "↓"} ${up ? "+" : ""}${pct}%</span><span class="delta-sub">vs last month</span>`;
}

function renderStats(v) {
  document.getElementById("stats").innerHTML = Object.entries(statMeta).map(([k, m]) => {
    const s = v.stats[k];
    return `
      <div class="stat" title="${esc(s.source)}">
        <span class="stat-icon ${m.tone}">${statIcons[k]}</span>
        <div class="stat-body"><p class="stat-label">${m.label}</p><p class="stat-value">${s.value.toLocaleString()}</p></div>
        ${spark(s.series, m.color)}
        <div class="stat-delta">${fmtPct(s.pct)}</div>
      </div>`;
  }).join("");
}

function renderPrivate(v) {
  const d = state.workspace;
  document.getElementById("private").innerHTML = `
    <div class="panel-head"><h2>Private workspace</h2><span class="chip green">Active</span></div>
    <button class="company" id="company">
      <span class="mark ${d.mark}">${marks[d.mark]}</span>
      <span class="company-text"><span class="company-name">${esc(d.name)}</span><span class="caps">${esc(d.tagline)}</span></span>
      <span class="chev">›</span>
    </button>
    <p class="agents-h">Employee agents</p>
    <ul class="agent-list">
      ${v.agents.map((a) => `
        <li><button data-agent="${a.id}">
          <span class="avatar ${a.id}">${esc(a.name[0])}</span>
          <span class="agent-id"><b>${esc(a.name)}</b><span class="caps">${esc(a.role)}</span>${state.usage ? usageRow(state.usage[a.id]) : ""}</span>
          <span class="agent-state ${a.status.tone}">${esc(a.status.label)}</span>
        </button></li>`).join("")}
    </ul>`;
  document.getElementById("company").addEventListener("click", () => companyDrawer());
  document.querySelectorAll("[data-agent]").forEach((b) => b.addEventListener("click", () => agentDrawer(v, b.dataset.agent)));
}

function renderGraph(v) {
  const W = 740, H = 380, cx = 370, cy = 150;
  const self = v.participants.find((p) => p.id === ws);
  const others = v.participants.filter((p) => p.id !== ws);
  const split = Math.floor(others.length / 2);
  const leftNodes = [self, ...others.slice(0, split)].filter(Boolean);
  const rightNodes = others.slice(split);
  const place = (list, x) => list.map((p, i) => ({ p, x, y: list.length === 1 ? cy - 30 : 70 + i * (180 / (list.length - 1)) }));
  const nodes = [...place(leftNodes, 40), ...place(rightNodes, W - 250)];
  const curves = nodes.map(({ x, y }) => {
    const left = x < cx;
    const ax = left ? x + 120 : x - 12;
    const hub = left ? cx - 100 : cx + 100;
    return `<path d="M${ax} ${y + 26} C ${(ax + hub) / 2} ${y + 26}, ${(ax + hub) / 2} ${cy}, ${hub} ${cy}" /><circle class="knot" cx="${ax}" cy="${y + 26}" r="5"/>`;
  }).join("");
  document.getElementById("graph").innerHTML = `
    <svg class="graph-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs><radialGradient id="ghalo"><stop offset="0" stop-color="#8fb1f2" stop-opacity=".55"/><stop offset="1" stop-color="#8fb1f2" stop-opacity="0"/></radialGradient></defs>
      <g class="globe-dots"></g>
      <line x1="${cx}" y1="10" x2="${cx}" y2="${H - 70}" class="axis"/>
      <g class="curves">${curves}</g>
      <line x1="${cx - 100}" y1="${cy}" x2="${cx + 100}" y2="${cy}" class="spine"/>
      <circle class="knot" cx="${cx - 100}" cy="${cy}" r="5"/><circle class="knot" cx="${cx + 100}" cy="${cy}" r="5"/>
      <circle cx="${cx}" cy="${cy}" r="62" fill="url(#ghalo)"/>
    </svg>
    <button class="shield graph-shield" id="g-shield" style="left:${(cx / W) * 100}%;top:${(cy / H) * 100}%" title="Package inspector">
      <svg viewBox="0 0 24 24"><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
    </button>
    ${nodes.map(({ p, x, y }) => `
      <div class="gnode ${x < cx ? "left" : "right"}" style="left:${(x / W) * 100}%;top:${(y / H) * 100}%">
        <span class="gmark ${p.mark}">${marks[p.mark] ?? ""}</span>
        <span class="gname">${esc(p.name)}</span>
        <span class="caps">${p.published ? "Shares defenses" : "Member"}</span>
      </div>`).join("")}
    <p class="graph-absent">No invoices. No supplier records.<br />No credentials.</p>
    <p class="graph-motto">Stronger businesses.<br />A safer tomorrow.</p>`;
  drawGlobe(document.querySelector(".globe-dots"), { cx, cy: H + 170, R: 340, rows: 7, clip: H });
  document.getElementById("g-shield").addEventListener("click", () => openDrawer(`
    <p class="caps">Controlled publication boundary</p>
    <h2>Package inspector</h2>
    <dl>
      <dt>On relay</dt><dd>${state.relay ? state.relay.published : "relay unreachable"} package(s)</dd>
      <dt>Never crosses</dt><dd>Raw invoices, supplier records, bank details, credentials, private memory, model adapters.</dd>
      <dt>May cross</dt><dd>Reviewed procedure, synthetic tests, measured validation report, review attestation, signature.</dd>
    </dl>`));
  const chip = document.getElementById("relay-chip");
  chip.className = `chip ${state.relay ? "green" : "grey"}`;
  chip.innerHTML = `${lock}${state.relay ? "Secure network" : "Relay offline"}`;
  chip.title = state.relay ? "Restricted relay reachable; packages must be signed and owner-approved." : "Restricted relay not reachable.";
}

function renderActivity(v) {
  const items = v.activity.slice(0, 3);
  document.getElementById("activity").innerHTML = `
    <div class="act-head"><span class="live-dot"></span><div><h2>Live network activity</h2><p class="caps">Real-time updates from the FIA network</p></div></div>
    <div class="act-items">
      ${items.length ? items.map((i) => `
        <div class="act-item">
          <span class="gmark small ${i.mark}">${marks[i.mark] ?? ""}</span>
          <div class="act-text"><b>${esc(i.who)}</b><span>${esc(i.text)}</span></div>
          <div class="act-meta"><span class="badge ${i.tone}">${esc(i.badge)}</span><span>${esc(i.ago)}</span></div>
        </div>`).join("") : `<p class="act-empty">No activity yet.</p>`}
    </div>
    <button class="act-all" id="act-all">View all activity →</button>`;
  document.getElementById("act-all").addEventListener("click", () => openDrawer(`
    <p class="caps">${state.mode === "live" ? "Live" : "Illustrative"} activity</p>
    <h2>Network activity</h2>
    <dl>${v.activity.map((i) => `<dt>${esc(i.ago)}</dt><dd><b>${esc(i.who)}</b> ${esc(i.text)} <span class="badge ${i.tone}">${esc(i.badge)}</span></dd>`).join("") || "<dt></dt><dd>No activity yet.</dd>"}</dl>`));
}

function renderPowered() {
  const row = document.getElementById("powered");
  row.innerHTML = sponsorOrder.map((id) => state.sponsors.find((s) => s.id === id)).filter(Boolean).map((s) => `
    <button class="pw" data-sponsor="${s.id}" title="${esc(stateLabel[s.state])}">
      <span class="sponsor-icon">${sponsorIcons[s.id]}<span class="sponsor-dot dot-${s.state}"></span></span>
      <span><b>${esc(s.name)}</b><small>${esc(sponsorPurpose[s.id])}</small></span>
    </button>`).join("");
  row.querySelectorAll(".pw").forEach((b) => b.addEventListener("click", () => sponsorDrawer(state.sponsors.find((s) => s.id === b.dataset.sponsor))));
}

function companyDrawer() {
  const d = state.workspace;
  openDrawer(`
    <p class="caps">Private workspace · live</p>
    <h2>${esc(d.name)}</h2>
    <span class="pill ${d.alert.level}">${esc(d.alert.label)}</span>
    <dl>
      <dt>Suppliers</dt><dd>${d.records.suppliers}</dd>
      <dt>Invoices</dt><dd>${d.records.invoices}</dd>
      <dt>Unverified msgs</dt><dd>${d.records.unverifiedMessages}</dd>
      <dt>Held payments</dt><dd>${d.records.heldPayments}</dd>
      <dt>Procedure</dt><dd>${esc(d.activeProcedure ?? "none active")}</dd>
      <dt>Model</dt><dd>${esc(d.activeModel ?? "none loaded")}</dd>
      <dt>Retrieval</dt><dd>${esc(d.retrieval)}</dd>
    </dl>
    <p class="note">These records are always live, in both modes.</p>`);
}

function factList(title, facts, tone) {
  if (!facts.length) return `<h3 class="ev-h">${title}</h3><p class="note">None recorded.</p>`;
  return `<h3 class="ev-h">${title}</h3><ul class="ev">${facts.map((f) => `
    <li class="ev-${tone}"><span class="ev-id">GBrain #${esc(f.id)}</span><p>${esc(f.text)}</p><small>${esc(f.provenance)}</small></li>`).join("")}</ul>`;
}

async function loadEvidence(supplierId) {
  const box = document.getElementById("maya-evidence");
  box.innerHTML = `<p class="note">Recalling from private GBrain…</p>`;
  try {
    const e = await api(`/ws/${ws}/api/agents/maya/evidence?supplier=${encodeURIComponent(supplierId)}`);
    box.innerHTML = `<p class="note">Live recall · ${esc(e.server)} · entity <code>${esc(e.supplier.entity)}</code></p>
      ${factList("Verified facts", e.verified, "ok")}
      ${factList("Unverified observations", e.unverified, "warn")}
      ${factList("Payment policy", e.policy, "ok")}`;
  } catch (err) {
    box.innerHTML = `<p class="note">Knowledge unavailable — ${esc(err.message)}. Payments stay held; nothing is substituted.</p>`;
  }
}

async function mayaDrawer(a, live) {
  const { focus, suppliers } = await api(`/ws/${ws}/api/suppliers`);
  openDrawer(`
    <p class="caps">${esc(state.workspace.name)} · employee agent · GBrain</p>
    <h2>${esc(a.name)} — ${esc(a.role)}</h2>
    <p class="note">${esc(a.duty)}</p>
    <p class="note">Live status: ${esc(live.status.label)} — ${esc(live.status.detail)}</p>
    <label class="ev-pick">Supplier <select id="maya-supplier">${suppliers.map((s) => `<option value="${s.id}" ${s.id === focus ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
    <div id="maya-evidence"></div>
    ${usageBlock(state.usage?.[a.id])}`);
  const sel = document.getElementById("maya-supplier");
  sel.addEventListener("change", () => loadEvidence(sel.value));
  loadEvidence(sel.value);
}

function agentDrawer(v, id) {
  const a = v.agents.find((x) => x.id === id);
  const live = state.workspace.agents.find((x) => x.id === id);
  if (id === "maya") return mayaDrawer(a, live);
  openDrawer(`
    <p class="caps">${esc(state.workspace.name)} · employee agent</p>
    <h2>${esc(a.name)} — ${esc(a.role)}</h2>
    <dl>
      <dt>Duty</dt><dd>${esc(a.duty)}</dd>
      <dt>Backed by</dt><dd>${esc(a.backedBy === "fia" ? "FIA local service" : a.backedBy)}</dd>
      <dt>Shown status</dt><dd>${esc(a.status.label)}${state.mode === "showcase" ? " (illustrative)" : ""}</dd>
      <dt>Live status</dt><dd>${esc(live.status.label)} — ${esc(live.status.detail)}</dd>
    </dl>
    ${usageBlock(state.usage?.[a.id])}`);
}

function render() {
  if (!state.workspace) {
    document.getElementById("stats").innerHTML = `<p class="caps">Workspace unreachable</p>`;
    return;
  }
  const showcase = state.mode === "showcase" && state.showcase;
  const v = showcase ? showcaseView() : liveView();
  document.body.classList.toggle("is-showcase", Boolean(showcase));
  document.getElementById("mode-banner").textContent = showcase ? "Illustrative showcase data · sponsor badges, agent usage and workspace records remain live" : "Live data";
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
  renderStats(v);
  renderPrivate(v);
  renderGraph(v);
  renderActivity(v);
  renderPowered();
}

async function refresh() {
  const [w, ev, relay, usage] = await Promise.allSettled([api(`/ws/${ws}/api/workspace`), api(`/ws/${ws}/api/integration-evidence`), api("/relay/status"), loadUsage(ws)]);
  state.usage = usage.status === "fulfilled" && usage.value ? usage.value : state.usage;
  state.workspace = w.status === "fulfilled" ? w.value : null;
  state.sponsors = ev.status === "fulfilled" ? ev.value : state.sponsors;
  state.relay = relay.status === "fulfilled" ? relay.value : null;
  render();
}

document.getElementById("title").textContent = `${shortName[ws]} workspace`;
document.title = `FIA — ${shortName[ws]} workspace`;
const sw = document.getElementById("switch");
sw.value = ws;
const switchMark = document.getElementById("switch-mark");
switchMark.innerHTML = marks[ws === "northline" ? "leaf" : "wave"];
switchMark.classList.add(ws === "northline" ? "leaf" : "wave");
sw.addEventListener("change", () => (location.href = `/workspace/${sw.value}`));
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
  state.mode = b.dataset.mode;
  try {
    localStorage.setItem("fia.mode", state.mode);
  } catch {}
  render();
}));
document.querySelectorAll("[data-lock]").forEach((el) => (el.innerHTML = lock));
wireDrawer();

state.showcase = await api("/showcase.json").catch(() => null);
await refresh();
setInterval(refresh, 5000);
