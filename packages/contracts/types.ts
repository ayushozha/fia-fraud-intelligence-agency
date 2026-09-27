export type WorkspaceId = "northline" | "harbor";

export type TrustState = "verified" | "unverified" | "rejected" | "superseded";

export type Supplier = {
  id: string;
  name: string;
  category: string;
  contactName: string;
  contactPhone: string;
  emailDomain: string;
  bankLabel: string;
  accountLast4: string;
};

export type Invoice = {
  id: string;
  supplierId: string;
  issuedAt: string;
  amountCents: number;
  status: "paid" | "open";
  paidAt: string | null;
  paidToLast4: string | null;
};

export type ThreadMessage = {
  id: string;
  threadId: string;
  supplierId: string;
  channel: "email" | "phone_transcript";
  from: string;
  sentAt: string;
  subject: string;
  body: string;
};

export type ReplayEvent = {
  id: string;
  kind: "payment_approved" | "fraud_confirmed";
  at: string;
  actor: string;
  detail: string;
  invoiceIds: string[];
  amountCents: number;
  toLast4: string;
};

export type IncidentReplay = {
  id: string;
  title: string;
  supplierId: string;
  invoices: Invoice[];
  messages: ThreadMessage[];
  events: ReplayEvent[];
};

export type Agent = { id: string; name: string; role: string; duty: string; backedBy: SponsorId | "fia" };

export type WorkspaceFixture = {
  workspace: WorkspaceId;
  name: string;
  tagline: string;
  mark: "leaf" | "wave";
  agents: Agent[];
  suppliers: Supplier[];
  invoices: Invoice[];
  messages: ThreadMessage[];
  replay: IncidentReplay | null;
  canary: string;
};

export type SponsorId = "gbrain" | "memorable" | "qm" | "river" | "ufo" | "superset";

export type SponsorState = "verified" | "ready" | "needs_auth" | "not_installed" | "unreachable";

export type SponsorStatus = {
  id: SponsorId;
  name: string;
  role: string;
  state: SponsorState;
  detail: string;
  receipts: Receipt[];
};

export type Receipt = {
  id: string;
  sponsor: SponsorId;
  stage: string;
  externalRef: string;
  artifactHash: string | null;
  recordedAt: string;
};
