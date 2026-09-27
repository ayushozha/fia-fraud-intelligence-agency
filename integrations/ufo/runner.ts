import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

export type UfoEvent = Record<string, unknown> & { type: string };

export type UfoResult = {
  channel: string | null;
  turnIds: string[];
  text: string;
  ops: { opId: string; command: string; ok: boolean | null; error?: string }[];
  authorizations: { id: number; prompt: string; choice: "allow" | "deny" }[];
  exitCode: number | null;
  error: string | null;
};

const TOOL_COMMAND = /(?:^|[\s`"(])((?:sh\s+)?\.\/fia(?:\s+[a-z_]+)?(?:\s+'[^'\n]*')?)(?=$|[\s`")?.])/;

export function toolCommandAllowed(text: string) {
  const m = text.match(TOOL_COMMAND);
  if (!m) return false;
  const rest = text.replace(m[1], "");
  return !/[;|&$<>\\]|\.\.\//.test(rest) && !/[`$]/.test(m[1].replace(/'[^']*'/, ""));
}

export function execAllowed(command: string) {
  const cmd = command.replace(/^exec\s+/, "").trim();
  return /^(?:sh\s+)?\.\/fia(?:\s+[a-z_]+)?(?:\s+'[^'\n]*')?$/.test(cmd);
}

export function prepareWorkdir(dir: string, env: { url: string; tokenFile: string; run: string; cli: string }) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const script = `#!/bin/sh\nFIA_URL='${env.url}' FIA_RUN='${env.run}' FIA_TOKEN_FILE='${env.tokenFile}' exec '${process.execPath}' '${env.cli}' "$@"\n`;
  writeFileSync(join(dir, "fia"), script);
  chmodSync(join(dir, "fia"), 0o755);
}

export function runUfo(opts: { client: string; home?: string; workdir: string; prompt: string; timeoutMs: number; model?: string; onEvent?: (e: UfoEvent) => void }): Promise<UfoResult> {
  const result: UfoResult = { channel: null, turnIds: [], text: "", ops: [], authorizations: [], exitCode: null, error: null };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/KEY|TOKEN|SECRET|PASSWORD/i.test(k)) env[k] = v;
  if (opts.home) env.HOME = opts.home;
  const args = ["--json", ...(opts.model ? ["--model", opts.model] : []), opts.prompt];
  return new Promise((resolve) => {
    const child = spawn(opts.client, args, { cwd: opts.workdir, env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let finished = false;
    const write = (cmd: Record<string, unknown>) => {
      if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(cmd)}\n`);
    };
    const stop = (error: string | null) => {
      if (error && !result.error) result.error = error;
      write({ type: "shutdown" });
      setTimeout(() => child.kill("SIGTERM"), 5000).unref();
    };
    const timer = setTimeout(() => stop(`UFO run exceeded ${Math.round(opts.timeoutMs / 1000)}s`), opts.timeoutMs);
    child.stderr.on("data", (d) => (stderr = (stderr + String(d)).slice(-4000)));
    child.on("error", (err) => {
      result.error = `cannot start UFO client: ${err.message}`;
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      let e: UfoEvent;
      try {
        e = JSON.parse(line) as UfoEvent;
      } catch {
        return;
      }
      opts.onEvent?.(e);
      if (e.type === "session_start") {
        result.channel = String(e.channel);
        if (e.channel === "onboard") stop("UFO client is not signed in: the session opened the 'onboard' channel and asked for an email address (run `ufo login`)");
      } else if (e.type === "message_sent") result.turnIds.push(String(e.turn_id));
      else if (e.type === "message") result.text += `${e.text}\n`;
      else if (e.type === "op_start") {
        result.ops.push({ opId: String(e.op_id), command: String(e.command), ok: null });
        if (e.kind === "exec" && !execAllowed(String(e.command))) stop(`UFO attempted a non-allowlisted command: ${String(e.command).slice(0, 200)}`);
      } else if (e.type === "op_end") {
        const op = result.ops.find((o) => o.opId === String(e.op_id));
        if (op) {
          op.ok = Boolean(e.ok);
          if (e.error) op.error = String(e.error);
        }
      } else if (e.type === "authorization_request") {
        const prompt = String(e.prompt ?? "");
        const choice = toolCommandAllowed(prompt) ? "allow" : "deny";
        result.authorizations.push({ id: Number(e.id), prompt: prompt.slice(0, 400), choice });
        write({ type: "authorize", id: Number(e.id), choice });
      } else if (e.type === "input_request" || e.type === "secret_request") {
        stop(`UFO asked for input the investigation cannot give: ${String(e.prompt).slice(0, 200)}`);
      } else if (e.type === "error" && e.fatal) {
        result.error = String(e.message);
      } else if (e.type === "turn_end" && result.turnIds.length) {
        stop(null);
      } else if (e.type === "exit") result.exitCode = Number(e.code);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      if (result.exitCode === null) result.exitCode = code;
      if (!result.channel && !result.error) result.error = `UFO client exited (${code}) before a session started: ${stderr.trim().slice(-300)}`;
      resolve(result);
    });
  });
}
