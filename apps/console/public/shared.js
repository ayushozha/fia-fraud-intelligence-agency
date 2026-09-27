export const marks = {
  leaf: '<svg viewBox="0 0 40 40"><path d="M19 33c-1-7-5-12-12-14 1 8 5 13 12 14Z" fill="#2f6b3f"/><path d="M21 33c1-9 5-16 13-19-1 10-5 17-13 19Z" fill="#1f5230"/></svg>',
  wave: '<svg viewBox="0 0 40 40"><path d="M5 24c5-8 13-12 21-9-6 0-10 3-11 7 4-4 11-5 17-1-6-1-10 1-12 5-4-3-10-4-15-2Z" fill="#3a63b8"/></svg>',
  mountain: '<svg viewBox="0 0 40 40"><path d="M4 29 15 14l6 8 4-5 11 12H4Z" fill="#2b3f66"/><path d="m15 14 3 4-3 1-3-1 3-4Z" fill="#fff" opacity=".8"/></svg>',
  cube: '<svg viewBox="0 0 40 40"><path d="m20 6 12 7v14l-12 7-12-7V13l12-7Z" fill="#2b3650"/><path d="m8 13 12 7 12-7M20 20v14" stroke="#fff" stroke-width="1.2" fill="none" opacity=".55"/></svg>',
  people: '<svg viewBox="0 0 40 40" fill="#3a5fb0"><circle cx="20" cy="14" r="4.5"/><circle cx="11" cy="16" r="3.5"/><circle cx="29" cy="16" r="3.5"/><path d="M12 30c0-5 3.6-8 8-8s8 3 8 8H12Z"/><path d="M4 29c0-4 2.8-6.5 6.5-6.5 1.3 0 2.4.3 3.3.8-1.4 1.6-2.3 3.5-2.5 5.7H4ZM36 29c0-4-2.8-6.5-6.5-6.5-1.3 0-2.4.3-3.3.8 1.4 1.6 2.3 3.5 2.5 5.7H36Z"/></svg>',
};

export const lock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/></svg>';

export const sponsorIcons = {
  gbrain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M9.5 4.5a2.5 2.5 0 0 0-4.6 1.4A3 3 0 0 0 3.5 11a3 3 0 0 0 1.6 4.8A2.8 2.8 0 0 0 9.5 19.5V4.5Z"/><path d="M14.5 4.5a2.5 2.5 0 0 1 4.6 1.4A3 3 0 0 1 20.5 11a3 3 0 0 1-1.6 4.8 2.8 2.8 0 0 1-4.4 3.7V4.5Z"/><path d="M9.5 9H7.5M9.5 14H7M14.5 9h2M14.5 14H17"/></svg>',
  memorable: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M7 3.5h10v17l-5-3.5-5 3.5v-17Z"/><path d="M10 8.5h4M10 11.5h4"/></svg>',
  qm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
  river: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 9c3-2.5 6 2.5 9 0s6-2.5 9 0M3 15c3-2.5 6 2.5 9 0s6-2.5 9 0"/></svg>',
  ufo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/></svg>',
  superset: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="13" width="3.2" height="7" rx=".8"/><rect x="10.4" y="9" width="3.2" height="11" rx=".8"/><rect x="15.8" y="5" width="3.2" height="15" rx=".8"/></svg>',
};

export const sponsorPurpose = {
  gbrain: "Private workspace memory",
  ufo: "Workflow execution",
  qm: "Scenario evaluation",
  memorable: "Procedural memory",
  river: "Local adapter training",
  superset: "Human review",
};

export const sponsorOrder = ["gbrain", "ufo", "qm", "memorable", "river", "superset"];

export const stateLabel = { verified: "Receipt recorded", ready: "Ready — no receipt yet", needs_auth: "Needs sign-in / credential", not_installed: "Not installed", unreachable: "Unreachable" };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function api(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status}`);
  return body;
}

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function openDrawer(html) {
  document.getElementById("drawer-body").innerHTML = html;
  const d = document.getElementById("drawer");
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
}

export function wireDrawer() {
  document.getElementById("drawer-close").addEventListener("click", () => {
    const d = document.getElementById("drawer");
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
  });
}

export function sponsorDrawer(s) {
  openDrawer(`
    <p class="caps">Integration evidence</p>
    <h2>${esc(s.name)}</h2>
    <span class="state state-${s.state}">${esc(stateLabel[s.state])}</span>
    <dl>
      <dt>Used for</dt><dd>${esc(sponsorPurpose[s.id])}</dd>
      <dt>Status</dt><dd>${esc(s.detail)}</dd>
      <dt>Receipts</dt><dd>${s.receipts.length ? s.receipts.map((r) => `${esc(r.stage)} · <code>${esc(r.externalRef)}</code> · ${esc(r.recordedAt)}`).join("<br />") : "not_run"}</dd>
    </dl>
    <p class="note">A badge turns green only after a real run from this sponsor writes a receipt. No receipt means the stage has not run.</p>`);
}

export function sponsorById(sponsors, id) {
  return sponsors.find((s) => s.id === id);
}

export const extraIcons = {
  fia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z"/></svg>',
  model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="2.5"/><path d="M8 10h8M8 14h5"/></svg>',
};

export const sponsorNames = { gbrain: "GBrain", ufo: "UFO", qm: "QM", memorable: "Memorable", river: "River", superset: "Superset", fia: "FIA local", model: "Model" };

export function iconFor(id) {
  return sponsorIcons[id] ?? extraIcons[id] ?? "";
}

export const statusText = { not_run: "Not run", running: "Running", done: "Done", blocked: "Blocked", failed: "Failed", reduced: "Reduced mode" };

const usageSponsors = ["qm", "ufo", "memorable", "river", "superset"];

export function fmtTokens(n) {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString();
}

export function usageRow(u) {
  const a = u ?? { gbrainTokens: 0, modelTokens: 0, ops: {} };
  return `<span class="usage-row" title="GBrain tokens ≈ chars/4 · model tokens · sponsor operations for this agent">
    <span class="u ${a.gbrainTokens ? "on" : ""}">${sponsorIcons.gbrain}≈${fmtTokens(a.gbrainTokens)}</span>
    <span class="u ${a.modelTokens ? "on" : ""}">${extraIcons.model}${fmtTokens(a.modelTokens)}</span>
    ${usageSponsors.map((s) => `<span class="u ${a.ops[s] ? "on" : ""}" title="${sponsorNames[s]} ops">${sponsorIcons[s]}${a.ops[s] ?? 0}</span>`).join("")}
  </span>`;
}

export function usageBlock(u) {
  const a = u ?? { gbrainTokens: 0, modelTokens: 0, ops: {}, entries: [] };
  return `<h3 class="ev-h">Sponsor usage by this agent</h3>
    <dl class="usage-dl">
      <dt>GBrain tokens</dt><dd>≈ ${fmtTokens(a.gbrainTokens)} <small>(chars / 4)</small></dd>
      <dt>Model tokens</dt><dd>${fmtTokens(a.modelTokens)}</dd>
      ${usageSponsors.map((s) => `<dt>${sponsorNames[s]} ops</dt><dd>${a.ops[s] ?? 0}</dd>`).join("")}
    </dl>
    ${a.entries.length ? `<ul class="ev">${a.entries.map((e) => `<li><span class="ev-id">${esc(sponsorNames[e.sponsor] ?? e.sponsor)} · ${esc(e.op)}</span><p>${esc(e.units)} ${esc(e.unit)}</p><small>${esc(e.ref)} · ${esc(timeAgo(e.at))}</small></li>`).join("")}</ul>` : `<p class="note">No sponsor usage recorded yet — not_run.</p>`}`;
}

export async function loadUsage(ws) {
  try {
    return (await api(`/usage/${ws}`)).agents;
  } catch {
    return null;
  }
}
