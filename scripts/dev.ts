import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(join(root, "fixtures", "northline.json"))) {
  await new Promise((r) => spawn(process.execPath, ["packages/simulator/generate.ts"], { cwd: root, stdio: "inherit" }).on("exit", r));
}

const services: [string, string, Record<string, string>][] = [
  ["northline", "apps/workspace/server.ts", { WORKSPACE: "northline", PORT: "7101" }],
  ["harbor", "apps/workspace/server.ts", { WORKSPACE: "harbor", PORT: "7102" }],
  ["relay", "apps/relay/server.ts", { PORT: "7103" }],
  ["console", "apps/console/server.ts", { PORT: "7100" }],
];

const children: ChildProcess[] = [];
for (const [name, file, env] of services) {
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", "--watch", file], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (chunk: Buffer) => chunk.toString().trimEnd().split("\n").forEach((l) => console.log(`${name.padEnd(9)}| ${l}`));
  child.stdout!.on("data", tag);
  child.stderr!.on("data", tag);
  children.push(child);
}

const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
