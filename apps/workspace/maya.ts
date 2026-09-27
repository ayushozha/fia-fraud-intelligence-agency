import { openKnowledgeStore, requestId, type Fact, type KnowledgeStore } from "../../integrations/gbrain/knowledge-store.ts";
import type { Store } from "../../packages/simulator/store.ts";
import type { Supplier, ThreadMessage, WorkspaceFixture } from "../../packages/contracts/types.ts";

type Policy = { reconcileWindowDays: number; verificationRule: string };

const policies: Record<string, Policy> = {
  northline: { reconcileWindowDays: 14, verificationRule: "Any change to supplier payment details must be verified by calling the established contact on file before any payment is released, regardless of amount." },
  harbor: { reconcileWindowDays: 10, verificationRule: "Payment-detail changes are held until confirmed through the supplier contact recorded in the vendor master, independent of the requesting message." },
};

export const entityFor = (s: Pick<Supplier, "name">) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export type MayaState =
  | { phase: "connecting" }
  | { phase: "unavailable"; error: string }
  | { phase: "seeding"; done: number; total: number; server: string }
  | { phase: "ready"; server: string };

export function createMaya(fixture: WorkspaceFixture, store: Store, brainHome: string) {
  let ks: KnowledgeStore | null = null;
  let state: MayaState = { phase: "connecting" };
  const policy = policies[fixture.workspace];

  function receipt(stage: string, externalRef: string) {
    store.addReceipt("gbrain", stage, externalRef);
  }

  async function seed() {
    if (!ks) return;
    const already = store.db.prepare("SELECT value FROM meta WHERE key = 'gbrain_seeded'").get() as { value: string } | undefined;
    const writes: { fact: string; entity: string; provenance: string }[] = [];
    for (const s of fixture.suppliers) {
      writes.push({ entity: entityFor(s), fact: `Verified payee account for ${s.name}: ${s.bankLabel}, account ending ${s.accountLast4}.`, provenance: `Supplier master file ${s.id} (synthetic fixture), owner-approved` });
      writes.push({ entity: entityFor(s), fact: `Established contact for ${s.name}: ${s.contactName}, ${s.contactPhone}; email domain ${s.emailDomain}.`, provenance: `Supplier master file ${s.id} (synthetic fixture), owner-approved` });
    }
    writes.push({ entity: "payment-policy", fact: policy.verificationRule, provenance: `${fixture.name} payment policy v1 (owner-approved)` });
    writes.push({ entity: "payment-policy", fact: `Related invoices from the same supplier within ${policy.reconcileWindowDays} days are reconciled together before payment.`, provenance: `${fixture.name} payment policy v1 (owner-approved)` });
    if (already) return;
    const ids: string[] = [];
    for (let i = 0; i < writes.length; i++) {
      state = { phase: "seeding", done: i, total: writes.length, server: ks.server };
      const w = writes[i];
      const r = await ks.remember({ ...w, kind: "fact", requestId: requestId(fixture.workspace, "seed", w.entity, w.fact) });
      ids.push(r.id);
    }
    store.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('gbrain_seeded', ?)").run(new Date().toISOString());
    receipt("verified_knowledge_seed", `gbrain facts #${ids[0]}–#${ids[ids.length - 1]} (${ids.length})`);
    store.audit("maya", "gbrain.seed", `${ids.length} verified facts written to private GBrain`);
  }

  async function start() {
    try {
      ks = await openKnowledgeStore(brainHome);
      await seed();
      state = { phase: "ready", server: ks.server };
    } catch (err) {
      ks = null;
      state = { phase: "unavailable", error: err instanceof Error ? err.message : String(err) };
      store.audit("maya", "gbrain.unavailable", state.error);
    }
  }

  async function recordObservations(messages: ThreadMessage[], suppliers: Supplier[]) {
    if (!ks) throw new Error("GBrain unavailable: observations not recorded");
    const ids: string[] = [];
    for (const m of messages) {
      const s = suppliers.find((x) => x.id === m.supplierId);
      const entity = s ? entityFor(s) : "unknown-supplier";
      const r = await ks.remember({
        entity,
        kind: "belief",
        fact: `UNVERIFIED observation from ${m.channel} ${m.id} (sender ${m.from}, ${m.sentAt}): "${m.subject}" — ${m.body}`,
        provenance: `${m.channel} message ${m.id} in thread ${m.threadId}; untrusted external content`,
        requestId: requestId(fixture.workspace, "observation", m.id),
      });
      ids.push(r.id);
      receipt("unverified_observation", `gbrain fact #${r.id} ← ${m.id}`);
      store.recordUsage("maya", "gbrain", "remember", Math.ceil((m.body.length + m.subject.length + 120) / 4), "tokens", `fact #${r.id}`);
    }
    store.audit("maya", "gbrain.observations", `${ids.length} unverified observation(s) recorded: #${ids.join(", #")}`);
    return ids;
  }

  async function evidence(supplierId: string, caller = "maya") {
    if (!ks) throw new Error("GBrain unavailable");
    const s = fixture.suppliers.find((x) => x.id === supplierId);
    if (!s) throw new Error("unknown supplier");
    const [sup, pol] = await Promise.all([ks.recall({ entity: entityFor(s), limit: 50 }), ks.recall({ entity: "payment-policy", limit: 20 })]);
    const shape = (f: Fact) => ({ id: f.fact_id, text: f.fact, kind: f.kind, provenance: f.provenance, recordedAt: f.valid_from });
    receipt("evidence_recall", `gbrain recall entity=${entityFor(s)} → ${sup.total} fact(s)`);
    const tokens = Math.ceil([...sup.facts, ...pol.facts].reduce((n, f) => n + f.fact.length + f.provenance.length, 0) / 4);
    store.recordUsage(caller, "gbrain", "recall", tokens, "tokens", `entity ${entityFor(s)} · ${sup.total + pol.total} facts`);
    return {
      supplier: { id: s.id, name: s.name, entity: entityFor(s) },
      verified: sup.facts.filter((f) => f.kind === "fact").map(shape),
      unverified: sup.facts.filter((f) => f.kind !== "fact").map(shape),
      policy: pol.facts.map(shape),
      server: ks.server,
    };
  }

  return {
    start,
    recordObservations,
    evidence,
    get state() {
      return state;
    },
    get connected() {
      return ks !== null;
    },
  };
}
