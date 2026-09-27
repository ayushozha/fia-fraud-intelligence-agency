import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SEED = 20260927;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Decision = "proceed" | "hold_pending_verification" | "release_after_verification" | "reject_change";
type Check = "full_thread_review" | "related_invoice_reconciliation" | "timeline_vs_history" | "independent_contact_verification" | "verification_status_check";

type Evidence = { tool: string; result: string };
type Case = {
  id: string;
  family: string;
  split: "train" | "validation";
  label: "suspicious" | "legitimate";
  supplier: string;
  request: { channel: "email" | "phone_transcript"; from: string; sentAt: string; text: string }[];
  evidence: Evidence[];
  expected: { decision: Decision; verify_via: "established_contact_on_file" | "none"; checks: Check[]; reason: string };
};

const prefixes = ["Tidewater", "Lanternfish", "Quarry", "Juniper", "Marigold", "Osprey", "Pewter", "Saltmarsh", "Cobalt", "Driftwood", "Fernhill", "Granite", "Hollowell", "Kestrel", "Larkspur", "Millrace", "Northwind", "Oakum", "Pinecrest", "Riverbend"];
const suffixes = ["Components", "Packaging", "Fasteners", "Supply House", "Materials", "Office Goods", "Industrial", "Print Stock", "Couriers", "Adhesives"];
const people = ["R. Vance", "T. Okafor", "L. Moreau", "S. Lindqvist", "P. Adeyemi", "J. Castell", "M. Ferreira", "K. Hanley", "D. Novak", "A. Whitcombe"];

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

type Ctx = { r: () => number; supplier: string; domain: string; oldLast4: string; newLast4: string; inv: [string, number][]; day: string; person: string };

function mkCtx(r: () => number, n: number): Ctx {
  const supplier = `${pick(r, prefixes)} ${pick(r, suffixes)}`;
  const domain = `${supplier.toLowerCase().replace(/[^a-z]+/g, "")}.example`;
  const oldLast4 = String(1000 + Math.floor(r() * 9000));
  let newLast4 = String(1000 + Math.floor(r() * 9000));
  if (newLast4 === oldLast4) newLast4 = String((Number(oldLast4) % 9000) + 1001);
  const invCount = 1 + Math.floor(r() * 3);
  const inv: [string, number][] = Array.from({ length: invCount }, (_, i) => [`TR-INV-${String(n).padStart(3, "0")}${String.fromCharCode(65 + i)}`, (180000 + Math.floor(r() * 820000))]);
  const d = new Date(Date.UTC(2026, 5 + Math.floor(r() * 3), 1 + Math.floor(r() * 27), 14, Math.floor(r() * 60)));
  return { r, supplier, domain, oldLast4, newLast4, inv, day: d.toISOString(), person: pick(r, people) };
}

function invList(c: Ctx) {
  return c.inv.map(([id, cents]) => `${id} (${money(cents)})`).join(", ");
}

function ledger(c: Ctx, lastPaidDaysAgo: number) {
  return `Supplier on file: ${c.supplier}; payee account on file ends ${c.oldLast4}; last payment to ...${c.oldLast4} ${lastPaidDaysAgo} days before this request; open invoices: ${invList(c)}.`;
}

function contactOnFile(c: Ctx) {
  return `Established contact on file for ${c.supplier}: ${c.person}, phone number recorded at onboarding (independently sourced, not taken from this request).`;
}

const ALL: Check[] = ["full_thread_review", "related_invoice_reconciliation", "timeline_vs_history", "independent_contact_verification"];

type Family = { id: string; label: Case["label"]; split: Case["split"]; count: number; build: (c: Ctx) => Pick<Case, "request" | "evidence" | "expected"> };

const families: Family[] = [
  {
    id: "lookalike_domain_bank_change", label: "suspicious", split: "train", count: 9,
    build: (c) => {
      const fake = c.domain.replace(".example", "-billing.example");
      const text = pick(c.r, [
        `Hello, our bank has changed. Please send payment for ${invList(c)} to the new account ending ${c.newLast4} going forward. Kindly process today.`,
        `Please note our updated remittance details: account ending ${c.newLast4}. The old account is closed; route ${invList(c)} there this week.`,
        `Accounts team here — due to an audit we moved banks. Use account ending ${c.newLast4} for ${invList(c)}. Urgent, please confirm once sent.`,
      ]);
      return {
        request: [{ channel: "email", from: `accounts@${fake}`, sentAt: c.day, text }],
        evidence: [
          { tool: "thread_lookup", result: `Sender domain ${fake} has never appeared in this supplier's history; prior invoices came from ${c.domain}.` },
          { tool: "ledger_lookup", result: ledger(c, 18 + Math.floor(c.r() * 20)) },
          { tool: "contact_lookup", result: contactOnFile(c) },
          { tool: "verification_log", result: "No verification recorded for this change request." },
        ],
        expected: { decision: "hold_pending_verification", verify_via: "established_contact_on_file", checks: ALL, reason: "Bank-change request from an unrecognized lookalike domain with no independent verification; pause the related invoices and call the established contact on file." },
      };
    },
  },
  {
    id: "phone_pressure_new_number", label: "suspicious", split: "train", count: 8,
    build: (c) => {
      const text = pick(c.r, [
        `Caller said they are the new controller and asked that ${invList(c)} be paid to account ending ${c.newLast4} today; gave a callback number of their own.`,
        `Inbound call: person claiming to be from ${c.supplier} finance insisted the account ending ${c.newLast4} replace the old one before end of day and offered their mobile for questions.`,
      ]);
      return {
        request: [{ channel: "phone_transcript", from: "unrecognized number", sentAt: c.day, text }],
        evidence: [
          { tool: "thread_lookup", result: "No written request exists; the only record is this call transcript." },
          { tool: "ledger_lookup", result: ledger(c, 10 + Math.floor(c.r() * 25)) },
          { tool: "contact_lookup", result: `${contactOnFile(c)} The caller's number does not match it.` },
          { tool: "verification_log", result: "No verification recorded for this change request." },
        ],
        expected: { decision: "hold_pending_verification", verify_via: "established_contact_on_file", checks: ALL, reason: "Pressured phone request from a number not on file; a callback number supplied by the requester is not independent. Hold and verify through the established contact." },
      };
    },
  },
  {
    id: "invoice_reissue_to_new_account", label: "suspicious", split: "train", count: 9,
    build: (c) => {
      const text = pick(c.r, [
        `Attached are reissued copies of ${invList(c)} with our corrected bank details (account ending ${c.newLast4}). Please disregard the originals.`,
        `We reissued ${invList(c)} because of a banking migration — the new copies show account ending ${c.newLast4}. Pay these instead.`,
      ]);
      return {
        request: [{ channel: "email", from: `billing@${c.domain}`, sentAt: c.day, text }],
        evidence: [
          { tool: "thread_lookup", result: `Message arrived on the usual domain, but the reply-to header points to an external mailbox and the thread's earlier messages never mentioned a banking migration.` },
          { tool: "ledger_lookup", result: ledger(c, 5 + Math.floor(c.r() * 20)) },
          { tool: "contact_lookup", result: contactOnFile(c) },
          { tool: "verification_log", result: "No verification recorded for this change request." },
        ],
        expected: { decision: "hold_pending_verification", verify_via: "established_contact_on_file", checks: ALL, reason: "Reissued invoices silently redirect payment to a new account; reconcile the related invoices, pause them, and verify through the established contact." },
      };
    },
  },
  {
    id: "callback_denied_change", label: "suspicious", split: "train", count: 8,
    build: (c) => ({
      request: [{ channel: "email", from: `ap@${c.domain.replace(".example", "s.example")}`, sentAt: c.day, text: `Please update our payee account to the one ending ${c.newLast4} before paying ${invList(c)}.` }],
      evidence: [
        { tool: "thread_lookup", result: "Earlier in this thread the supplier's invoices were sent from the usual domain; the change request came from a different domain." },
        { tool: "ledger_lookup", result: ledger(c, 12 + Math.floor(c.r() * 15)) },
        { tool: "contact_lookup", result: contactOnFile(c) },
        { tool: "verification_log", result: `Owner called ${c.person} on the number on file: the supplier did NOT request any bank change and their account ending ${c.oldLast4} is unchanged.` },
      ],
      expected: { decision: "reject_change", verify_via: "established_contact_on_file", checks: [...ALL, "verification_status_check"], reason: "The established contact denied the change; reject the new account, keep paying the account on file only after the owner releases." },
    }),
  },
  {
    id: "callback_confirmed_change", label: "legitimate", split: "train", count: 9,
    build: (c) => ({
      request: [{ channel: "email", from: `billing@${c.domain}`, sentAt: c.day, text: `We are moving our operating account. From next cycle please pay to the account ending ${c.newLast4}. Our controller ${c.person} can confirm by phone.` }],
      evidence: [
        { tool: "thread_lookup", result: "Request came from the supplier's established domain, consistent with prior correspondence; no reply-to anomalies." },
        { tool: "ledger_lookup", result: ledger(c, 25 + Math.floor(c.r() * 10)) },
        { tool: "contact_lookup", result: contactOnFile(c) },
        { tool: "verification_log", result: `Owner called ${c.person} on the number on file (not the one in the email); the supplier confirmed the new account ending ${c.newLast4}. Owner recorded the verification.` },
      ],
      expected: { decision: "release_after_verification", verify_via: "established_contact_on_file", checks: [...ALL, "verification_status_check"], reason: "The change was independently verified with the established contact and recorded by the owner; recommend release to the verified account for owner approval." },
    }),
  },
  {
    id: "routine_invoice_matching_account", label: "legitimate", split: "train", count: 9,
    build: (c) => ({
      request: [{ channel: "email", from: `billing@${c.domain}`, sentAt: c.day, text: pick(c.r, [`Please find attached ${invList(c)} for this month's deliveries. Payment terms as usual.`, `Monthly statement: ${invList(c)}. Thank you for your business.`]) }],
      evidence: [
        { tool: "thread_lookup", result: "Routine invoice on the established domain; no payment-detail change mentioned anywhere in the thread." },
        { tool: "ledger_lookup", result: ledger(c, 28 + Math.floor(c.r() * 5)) },
        { tool: "verification_log", result: "No change request exists; payee account matches the account on file." },
      ],
      expected: { decision: "proceed", verify_via: "none", checks: ["full_thread_review", "related_invoice_reconciliation"], reason: "No payment-detail change; invoices match the account on file and the usual approval flow applies." },
    }),
  },
  {
    id: "non_bank_detail_update", label: "legitimate", split: "train", count: 8,
    build: (c) => ({
      request: [{ channel: "email", from: `office@${c.domain}`, sentAt: c.day, text: pick(c.r, [`Our warehouse moved; please ship future orders to the new dock address. Invoices ${invList(c)} are unchanged.`, `New AP contact for invoice questions is ${c.person}. Remittance details are unchanged.`]) }],
      evidence: [
        { tool: "thread_lookup", result: "Established domain; the update concerns a shipping address or contact name, not payment details." },
        { tool: "ledger_lookup", result: ledger(c, 20 + Math.floor(c.r() * 10)) },
        { tool: "verification_log", result: "Payee account in the invoices matches the account on file." },
      ],
      expected: { decision: "proceed", verify_via: "none", checks: ["full_thread_review", "related_invoice_reconciliation"], reason: "The change does not touch payment details; the payee account still matches the one on file." },
    }),
  },
  {
    id: "thread_hijack_same_domain", label: "suspicious", split: "validation", count: 6,
    build: (c) => ({
      request: [
        { channel: "email", from: `billing@${c.domain}`, sentAt: c.day, text: `Invoices ${invList(c)} attached as discussed.` },
        { channel: "email", from: `billing@${c.domain}`, sentAt: new Date(Date.parse(c.day) + 3600000).toISOString(), text: `Correction: please remit to our new account ending ${c.newLast4}; the previous one is under review. Reply here once done.` },
      ],
      evidence: [
        { tool: "thread_lookup", result: "Both messages use the established domain, but the second arrived from a different sending server and its reply-to is an external free-mail address." },
        { tool: "ledger_lookup", result: ledger(c, 14 + Math.floor(c.r() * 10)) },
        { tool: "contact_lookup", result: contactOnFile(c) },
        { tool: "verification_log", result: "No verification recorded for this change request." },
      ],
      expected: { decision: "hold_pending_verification", verify_via: "established_contact_on_file", checks: ALL, reason: "A follow-up inside a legitimate-looking thread redirects payment with header anomalies and no verification; pause and verify through the established contact." },
    }),
  },
  {
    id: "timeline_inconsistency", label: "suspicious", split: "validation", count: 6,
    build: (c) => ({
      request: [{ channel: "email", from: `finance@${c.domain}`, sentAt: c.day, text: `As we told you back in the spring, our account changed to the one ending ${c.newLast4}. The payments for ${invList(c)} are overdue — please send them there immediately.` }],
      evidence: [
        { tool: "thread_lookup", result: "No earlier message in any thread mentions an account change." },
        { tool: "ledger_lookup", result: `${ledger(c, 6 + Math.floor(c.r() * 6))} The supplier accepted that recent payment without complaint.` },
        { tool: "contact_lookup", result: contactOnFile(c) },
        { tool: "verification_log", result: "No verification recorded for this change request." },
      ],
      expected: { decision: "hold_pending_verification", verify_via: "established_contact_on_file", checks: ALL, reason: "The claimed timeline contradicts local history (recent payments to the old account were accepted); treat the inconsistency as a reason to pause and verify." },
    }),
  },
  {
    id: "previously_verified_change_on_file", label: "legitimate", split: "validation", count: 7,
    build: (c) => ({
      request: [{ channel: "email", from: `billing@${c.domain}`, sentAt: c.day, text: `Invoices ${invList(c)} attached; payment to our account ending ${c.newLast4} as updated last quarter.` }],
      evidence: [
        { tool: "thread_lookup", result: "Established domain; the account change was requested last quarter in a separate thread." },
        { tool: "ledger_lookup", result: `Supplier on file: ${c.supplier}; payee account on file ends ${c.newLast4} (updated last quarter); two payments since then to ...${c.newLast4} completed normally; open invoices: ${invList(c)}.` },
        { tool: "verification_log", result: `The change to the account ending ${c.newLast4} was verified last quarter by callback to ${c.person} on the number on file and recorded by the owner.` },
      ],
      expected: { decision: "proceed", verify_via: "none", checks: ["full_thread_review", "related_invoice_reconciliation", "verification_status_check"], reason: "The account in the invoices is the already-verified account on file; no new change is pending." },
    }),
  },
  {
    id: "callback_denied_after_transcript", label: "suspicious", split: "validation", count: 6,
    build: (c) => ({
      request: [{ channel: "phone_transcript", from: "unrecognized number", sentAt: c.day, text: `Caller asked to redirect ${invList(c)} to the account ending ${c.newLast4} and said an email would follow.` }],
      evidence: [
        { tool: "thread_lookup", result: "No confirming email arrived from the established domain." },
        { tool: "ledger_lookup", result: ledger(c, 9 + Math.floor(c.r() * 9)) },
        { tool: "contact_lookup", result: contactOnFile(c) },
        { tool: "verification_log", result: `Owner reached ${c.person} on the number on file: nobody at the supplier made that call; no bank change exists.` },
      ],
      expected: { decision: "reject_change", verify_via: "established_contact_on_file", checks: [...ALL, "verification_status_check"], reason: "Independent verification contradicts the request; reject the new account." },
    }),
  },
  {
    id: "confirmed_via_established_portal", label: "legitimate", split: "validation", count: 7,
    build: (c) => ({
      request: [{ channel: "email", from: `treasury@${c.domain}`, sentAt: c.day, text: `Notice of new remittance account ending ${c.newLast4}, effective for ${invList(c)}. The same notice is posted in our supplier portal.` }],
      evidence: [
        { tool: "thread_lookup", result: "Established domain; the notice matches the supplier's normal letterhead and signature." },
        { tool: "ledger_lookup", result: ledger(c, 30 + Math.floor(c.r() * 10)) },
        { tool: "contact_lookup", result: contactOnFile(c) },
        { tool: "verification_log", result: `Owner confirmed the account ending ${c.newLast4} by calling ${c.person} on the number on file and also saw it in the supplier portal reached from the bookmarked address; verification recorded.` },
      ],
      expected: { decision: "release_after_verification", verify_via: "established_contact_on_file", checks: [...ALL, "verification_status_check"], reason: "The new account was independently verified through the established contact and recorded; recommend release to the verified account for owner approval." },
    }),
  },
];

const r = rng(SEED);
let n = 1;
const cases: Case[] = [];
for (const f of families) {
  for (let i = 0; i < f.count; i++) {
    const c = mkCtx(r, n);
    cases.push({ id: `TR-${String(n).padStart(3, "0")}`, family: f.id, split: f.split, label: f.label, supplier: c.supplier, ...f.build(c) });
    n++;
  }
}

const out = (name: string, body: string) => {
  writeFileSync(join(here, name), body);
  return createHash("sha256").update(body).digest("hex");
};

mkdirSync(here, { recursive: true });
const hashes: Record<string, string> = {};
for (const split of ["train", "validation"] as const) {
  const rows = cases.filter((c) => c.split === split);
  hashes[`trajectories.${split}.jsonl`] = out(`trajectories.${split}.jsonl`, rows.map((c) => JSON.stringify(c)).join("\n") + "\n");
}

const trainFamilies = new Set(families.filter((f) => f.split === "train").map((f) => f.id));
const valFamilies = new Set(families.filter((f) => f.split === "validation").map((f) => f.id));
const overlap = [...trainFamilies].filter((f) => valFamilies.has(f));
if (overlap.length) throw new Error(`family leak across splits: ${overlap.join(", ")}`);

const count = (split: string, label?: string) => cases.filter((c) => c.split === split && (!label || c.label === label)).length;
const manifest = {
  dataset: "harbor-payment-change-trajectories",
  version: 1,
  generator: "fixtures/training/generate.ts",
  seed: SEED,
  generatedAt: "2026-09-27T00:00:00.000Z",
  provenance: "Fully synthetic. Supplier names, domains, invoices and account suffixes are generated here; no Northline trace and no Harbor private record is read or included.",
  correction: "Targets are the rule-derived correct action for each scenario family (verified/corrected sequences), not raw model outputs. Ambiguous scenarios are excluded.",
  splitPolicy: "Split by scenario family before generation expansion; no family appears in more than one split. The final test set is not generated here and never enters training.",
  splits: {
    train: { cases: count("train"), suspicious: count("train", "suspicious"), legitimate: count("train", "legitimate"), families: [...trainFamilies], file: "trajectories.train.jsonl", sha256: hashes["trajectories.train.jsonl"] },
    validation: { cases: count("validation"), suspicious: count("validation", "suspicious"), legitimate: count("validation", "legitimate"), families: [...valFamilies], file: "trajectories.validation.jsonl", sha256: hashes["trajectories.validation.jsonl"] },
  },
  familyOverlap: overlap,
};
out("split-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest.splits));
