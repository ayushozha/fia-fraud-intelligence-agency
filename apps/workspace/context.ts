import type { IncomingMessage, ServerResponse } from "node:http";
import type { Store } from "../../packages/simulator/store.ts";
import type { WorkspaceFixture, WorkspaceId } from "../../packages/contracts/types.ts";
import type { createMaya } from "./maya.ts";

export type Ctx = {
  workspace: WorkspaceId;
  fixture: WorkspaceFixture;
  store: Store;
  maya: ReturnType<typeof createMaya>;
  root: string;
  dataDir: string;
  send: (res: ServerResponse, status: number, body: unknown) => void;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
};

export type Route = {
  method: "GET" | "POST";
  path: string | RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, url: URL, match: RegExpMatchArray | string[]) => Promise<void> | void;
};
