import { readFileSync } from "node:fs";
import { TOOLS, toolCatalog, validateArgs } from "./tools.ts";

const [name, raw] = process.argv.slice(2);
if (!name || name === "help" || name === "--help") {
  console.log(`FIA investigation tools (the only commands available):\n${toolCatalog("./fia ")}`);
  process.exit(0);
}
let args: unknown = {};
try {
  args = raw ? JSON.parse(raw) : {};
} catch {
  console.log(JSON.stringify({ ok: false, error: "second argument must be a single-quoted JSON object" }));
  process.exit(2);
}
const invalid = validateArgs(name, args);
if (invalid) {
  console.log(JSON.stringify({ ok: false, error: invalid, tools: Object.keys(TOOLS) }));
  process.exit(2);
}
const url = process.env.FIA_URL ?? "";
const run = process.env.FIA_RUN ?? "";
const token = readFileSync(process.env.FIA_TOKEN_FILE ?? "", "utf8").trim();
const res = await fetch(`${url}/api/tools/${name}`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "x-fia-run": run, "content-type": "application/json" },
  body: JSON.stringify(args),
});
const body = await res.text();
console.log(body);
process.exit(res.ok ? 0 : 1);
