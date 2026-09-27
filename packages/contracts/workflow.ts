import type { SponsorId, WorkspaceId } from "./types.ts";

export type StageId =
  | "incident_replay"
  | "investigation"
  | "confirmation"
  | "extraction"
  | "evaluation"
  | "review"
  | "publication"
  | "import_quarantine"
  | "acceptance"
  | "harbor_investigation"
  | "training"
  | "offline_proof";

export type StageStatus = "not_run" | "running" | "done" | "blocked" | "failed" | "reduced";

export type StageRef = { label: string; value: string };

export type Stage = {
  id: StageId;
  workspace: WorkspaceId;
  title: string;
  sponsors: (SponsorId | "fia")[];
  status: StageStatus;
  detail: string;
  refs: StageRef[];
  updatedAt: string | null;
};

export const STAGES: Omit<Stage, "status" | "detail" | "refs" | "updatedAt">[] = [
  { id: "incident_replay", workspace: "northline", title: "Fraud incident replayed", sponsors: ["gbrain"] },
  { id: "investigation", workspace: "northline", title: "Jordan investigates", sponsors: ["ufo", "gbrain"] },
  { id: "confirmation", workspace: "northline", title: "Owner confirms fraud", sponsors: ["fia"] },
  { id: "extraction", workspace: "northline", title: "Lesson becomes a procedure", sponsors: ["memorable"] },
  { id: "evaluation", workspace: "northline", title: "Agents stress-test the defense", sponsors: ["qm"] },
  { id: "review", workspace: "northline", title: "Human review dossier", sponsors: ["superset"] },
  { id: "publication", workspace: "northline", title: "Signed defense published", sponsors: ["fia"] },
  { id: "import_quarantine", workspace: "harbor", title: "Package quarantined", sponsors: ["fia"] },
  { id: "acceptance", workspace: "harbor", title: "Harbor tests and activates", sponsors: ["memorable", "fia"] },
  { id: "harbor_investigation", workspace: "harbor", title: "Harbor's defender stops a new attack", sponsors: ["ufo", "gbrain", "memorable", "river"] },
  { id: "training", workspace: "harbor", title: "Harbor trains its own defender", sponsors: ["river"] },
  { id: "offline_proof", workspace: "harbor", title: "Works with the network cut", sponsors: ["gbrain", "memorable", "river"] },
];

export type Usage = { agent: string; sponsor: string; op: string; units: number; unit: string; ref: string; at: string };
