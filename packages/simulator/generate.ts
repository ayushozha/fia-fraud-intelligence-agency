import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent, IncidentReplay, Invoice, Supplier, ThreadMessage, WorkspaceFixture } from "../contracts/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

const firstNames = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Harper", "Indira", "Jules", "Kai", "Logan", "Marin", "Noor", "Oren", "Parker", "Quinn", "Reese", "Sage", "Tatum", "Uma"];
const lastNames = ["Alder", "Brook", "Carver", "Dale", "Ellison", "Fenn", "Garland", "Hollis", "Ives", "Jarrow", "Keene", "Lyle", "Marsh", "Nash", "Orwell", "Pryor", "Quill", "Rowan", "Stroud", "Tamsin"];
const banks = ["Fictional Harbor Bank", "Example Mutual", "Sample Credit Union", "Demo National"];

const agents: Agent[] = [
  { id: "maya", name: "Maya", role: "AP agent", duty: "Retrieves verified supplier facts and payment policy from this workspace's private GBrain.", backedBy: "gbrain" },
  { id: "jordan", name: "Jordan", role: "Investigator", duty: "Runs the UFO investigation, recalling installed Memorable procedures.", backedBy: "ufo" },
  { id: "lena", name: "Lena", role: "Ops agent", duty: "Proposes and maintains simulated payment holds; never releases without the owner.", backedBy: "fia" },
  { id: "chris", name: "Chris", role: "Finance agent", duty: "Reconciles related invoices against the local ledger and policy window.", backedBy: "fia" },
];

function suppliersFor(seed: number, names: [string, string][]): Supplier[] {
  const r = rng(seed);
  return names.map(([name, category], i) => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "");
    return {
      id: `SUP-${String(i + 1).padStart(3, "0")}`,
      name,
      category,
      contactName: `${firstNames[Math.floor(r() * firstNames.length)]} ${lastNames[Math.floor(r() * lastNames.length)]}`,
      contactPhone: `+1-555-01${String(Math.floor(r() * 90) + 10)}`,
      emailDomain: `${slug}.example`,
      bankLabel: banks[Math.floor(r() * banks.length)],
      accountLast4: String(1000 + Math.floor(r() * 9000)),
    };
  });
}

function invoicesFor(seed: number, prefix: string, suppliers: Supplier[], skip: Set<string>): Invoice[] {
  const r = rng(seed);
  const out: Invoice[] = [];
  let n = 1;
  for (let month = 3; month <= 8; month++) {
    for (const s of suppliers) {
      if (skip.has(s.id) && month === 8) continue;
      const count = 1 + Math.floor(r() * 2);
      for (let k = 0; k < count; k++) {
        const day = 1 + Math.floor(r() * 26);
        const issued = new Date(Date.UTC(2026, month - 1, day, 15, 0, 0));
        const paid = new Date(issued.getTime() + (7 + Math.floor(r() * 14)) * 86400000);
        out.push({
          id: `${prefix}-${String(n++).padStart(4, "0")}`,
          supplierId: s.id,
          issuedAt: issued.toISOString(),
          amountCents: (40 + Math.floor(r() * 460)) * 1000 + Math.floor(r() * 100) * 10,
          status: "paid",
          paidAt: paid.toISOString(),
          paidToLast4: s.accountLast4,
        });
      }
    }
  }
  return out.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
}

const northlineSuppliers = suppliersFor(11, [
  ["Cascade Bean Importers", "Green coffee"],
  ["Ridgeway Roast Supply", "Roasting equipment"],
  ["Morning Pack Co", "Packaging"],
  ["Sunfield Dairy Partners", "Dairy"],
  ["Copperline Logistics", "Freight"],
  ["Evergreen Burlap Works", "Sacks and bags"],
  ["Highvale Farms Collective", "Green coffee"],
  ["Tidewater Glassworks", "Retail jars"],
  ["Northgate Utilities", "Utilities"],
  ["Pinecrest Print Shop", "Labels"],
  ["Silverleaf Tea Traders", "Tea"],
  ["Maple Hollow Syrups", "Syrups"],
  ["Granite Peak Cleaning", "Facilities"],
  ["Bluebird Cafe Fixtures", "Fixtures"],
  ["Lantern Payroll Services", "Payroll"],
  ["Orchard Lane Bakery", "Wholesale pastry"],
  ["Riverbend Water Filters", "Water systems"],
  ["Summit Grinder Repair", "Maintenance"],
  ["Coastal Cold Chain", "Refrigerated freight"],
  ["Willow Creek Insurance", "Insurance"],
  ["Harvest Moon Cocoa", "Cocoa"],
  ["Starling Web Studio", "Web services"],
  ["Beacon Office Supply", "Office supplies"],
  ["Foxglove Florals", "Store decor"],
  ["Ironwood Pallet Co", "Pallets"],
  ["Meadowbrook Oat Milk", "Plant milk"],
  ["Clearwater Accounting", "Bookkeeping"],
  ["Driftwood Signage", "Signage"],
  ["Kestrel Security Systems", "Security"],
  ["Juniper Compostables", "Compostable cups"],
]);

const harborSuppliers = suppliersFor(29, [
  ["Brightmill Paper Co", "Paper stock"],
  ["Inkwell Pigments", "Inks"],
  ["Stonebridge Plate Makers", "Printing plates"],
  ["Gullwing Freight", "Freight"],
  ["Anchor Bindery", "Binding"],
  ["Seabright Toner Supply", "Toner"],
  ["Lighthouse Electric", "Utilities"],
  ["Marina Press Repair", "Maintenance"],
  ["Pier Nine Packaging", "Packaging"],
  ["Tallship Laminates", "Lamination"],
  ["Heron Point Software", "Prepress software"],
  ["Saltmarsh Cleaning", "Facilities"],
  ["Keel & Co Payroll", "Payroll"],
  ["Driftline Courier", "Courier"],
  ["Northstar Envelopes", "Envelopes"],
  ["Coral Reef Foils", "Foil stamping"],
  ["Tidepool Adhesives", "Adhesives"],
  ["Breakwater Insurance", "Insurance"],
  ["Whitecap Cardstock", "Cardstock"],
  ["Mariner Ink Recycling", "Recycling"],
  ["Estuary Office Supply", "Office supplies"],
  ["Sandbar Signworks", "Wide-format"],
  ["Bayside Accounting", "Bookkeeping"],
  ["Crosswind Die Cutting", "Die cutting"],
  ["Shoreline Pallets", "Pallets"],
  ["Beaconhill Web Hosting", "Hosting"],
  ["Riptide Security", "Security"],
  ["Kelp Forest Recycled Fibers", "Recycled paper"],
  ["Oyster Bay Coatings", "Coatings"],
  ["Windlass Equipment Leasing", "Equipment lease"],
]);

function northlineReplay(suppliers: Supplier[]): IncidentReplay {
  const s = suppliers[0];
  const invoices: Invoice[] = [
    { id: "NR-INV-2408-A", supplierId: s.id, issuedAt: "2026-08-03T16:10:00.000Z", amountCents: 520000, status: "paid", paidAt: "2026-08-14T18:02:00.000Z", paidToLast4: "7310" },
    { id: "NR-INV-2408-B", supplierId: s.id, issuedAt: "2026-08-05T16:40:00.000Z", amountCents: 420000, status: "paid", paidAt: "2026-08-14T18:02:00.000Z", paidToLast4: "7310" },
  ];
  const messages: ThreadMessage[] = [
    { id: "NR-MSG-1", threadId: "NR-THR-CASCADE-AUG", supplierId: s.id, channel: "email", from: `billing@${s.emailDomain}`, sentAt: "2026-08-03T16:12:00.000Z", subject: "August green coffee invoice A", body: "Please find invoice NR-INV-2408-A attached. Payment terms net 14 to the account on file." },
    { id: "NR-MSG-2", threadId: "NR-THR-CASCADE-AUG", supplierId: s.id, channel: "email", from: `billing@${s.emailDomain}`, sentAt: "2026-08-05T16:41:00.000Z", subject: "August green coffee invoice B", body: "Second shipment invoice NR-INV-2408-B attached. Same terms." },
    { id: "NR-MSG-3", threadId: "NR-THR-CASCADE-AUG", supplierId: s.id, channel: "email", from: `accounts@cascade-bean-importers.example`, sentAt: "2026-08-12T09:03:00.000Z", subject: "RE: August green coffee invoice B", body: "Hi, following our bank migration please send both August invoices together to our new account ending 7310 at Sample Credit Union. The old account will be closed this week, so please do not use it. Kindly process today to avoid a shipping hold." },
  ];
  return {
    id: "NR-INC-0001",
    title: "Supplier payment-change loss (synthetic historical replay)",
    supplierId: s.id,
    invoices,
    messages,
    events: [
      { id: "NR-EVT-1", kind: "payment_approved", at: "2026-08-14T18:02:00.000Z", actor: "Northline AP clerk (fixture)", detail: "Both August invoices paid together to the account named in the follow-up email.", invoiceIds: invoices.map((i) => i.id), amountCents: 940000, toLast4: "7310" },
      { id: "NR-EVT-2", kind: "fraud_confirmed", at: "2026-08-23T17:30:00.000Z", actor: "Northline owner (fixture)", detail: `Callback to the established contact ${s.contactName} at ${s.contactPhone} confirmed the supplier never changed banks. The follow-up came from a lookalike domain.`, invoiceIds: invoices.map((i) => i.id), amountCents: 940000, toLast4: "7310" },
    ],
  };
}

function build(): WorkspaceFixture[] {
  const nInvoices = invoicesFor(101, "NR-INV", northlineSuppliers, new Set([northlineSuppliers[0].id]));
  const hInvoices = invoicesFor(202, "HP-INV", harborSuppliers, new Set());
  return [
    { workspace: "northline", name: "Northline Roasters", tagline: "Coffee for a brighter tomorrow", mark: "leaf", agents, suppliers: northlineSuppliers, invoices: nInvoices, messages: [], replay: northlineReplay(northlineSuppliers), canary: "CANARY-NORTHLINE-8f3a1c" },
    { workspace: "harbor", name: "Harbor Print", tagline: "Ideas make a brighter tomorrow", mark: "wave", agents, suppliers: harborSuppliers, invoices: hInvoices, messages: [], replay: null, canary: "CANARY-HARBOR-2d7e94" },
  ];
}

for (const f of build()) {
  const file = join(root, "fixtures", `${f.workspace}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(f, null, 2) + "\n");
  console.log(`${f.workspace}: ${f.suppliers.length} suppliers, ${f.invoices.length} invoices -> ${file}`);
}
