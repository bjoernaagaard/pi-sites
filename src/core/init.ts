import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { SitesBundle } from "./bundle.ts";
import { lastLines } from "./output.ts";

/** Outcome of running the bundle's init-site.sh into a target directory. */
export interface InitResult {
  exitCode: number | null;
  /** Sorted top-level entries of the generated project (null on failure). */
  layout: string[] | null;
  message: string;
  ok: boolean;
  target: string;
}

const ALLOWED_EMPTY_ENTRIES = new Set([".git", ".DS_Store", "work", "outputs"]);
const DEFAULT_INIT_TIMEOUT_MS = 900_000;
const MAX_CAPTURE_BYTES = 80_000;
const MESSAGE_LINES = 5;

/**
 * Scaffold a new Sites project into `targetDir` via the bundle's
 * init-site.sh. Mirrors the script's emptiness guard (anything other than
 * .git/.DS_Store/work/outputs is refused with exit 2) without invoking it.
 * Never throws.
 */
export async function runSitesInit(
  targetDir: string,
  bundle: SitesBundle,
  opts?: { timeoutMs?: number }
): Promise<InitResult> {
  const target = resolve(targetDir);
  try {
    mkdirSync(target, { recursive: true });
    const entries = readdirSync(target);
    const unexpected = entries.filter(
      (entry) => !ALLOWED_EMPTY_ENTRIES.has(entry)
    );
    if (unexpected.length > 0) {
      return {
        exitCode: 2,
        layout: null,
        message: `Target is not empty: ${target} (mirrors init-site.sh exit 2)`,
        ok: false,
        target,
      };
    }
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    const outcome = await runBashScript(
      bundle.initScript,
      [target],
      target,
      timeoutMs
    );
    if (outcome.status === 0) {
      const layout = readdirSync(target)
        .sort()
        .map((entry) =>
          entry === "node_modules" ? "node_modules (npm ci)" : entry
        );
      const tail = lastLines(
        `${outcome.stdout}\n${outcome.stderr}`,
        MESSAGE_LINES
      );
      return {
        exitCode: 0,
        layout,
        message: tail === "" ? `Sites project initialized in ${target}` : tail,
        ok: true,
        target,
      };
    }
    const tail = lastLines(outcome.stderr || outcome.stdout, MESSAGE_LINES);
    return {
      exitCode: outcome.status,
      layout: null,
      message: initFailureMessage(outcome, timeoutMs, tail),
      ok: false,
      target,
    };
  } catch (err) {
    return {
      exitCode: null,
      layout: null,
      message: `sites init failed: ${messageOf(err)}`,
      ok: false,
      target,
    };
  }
}

function initFailureMessage(
  outcome: ScriptOutcome,
  timeoutMs: number,
  tail: string
): string {
  if (outcome.timedOut) {
    return `sites init timed out after ${timeoutMs}ms`;
  }
  if (outcome.spawnError !== null) {
    return `sites init failed: ${outcome.spawnError}`;
  }
  if (tail !== "") {
    return tail;
  }
  return `sites init failed (exit ${outcome.status ?? "signal"})`;
}

export interface ScriptOutcome {
  spawnError: string | null;
  status: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

/** Run `bash <script> <args>` with `cwd`, bounded capture, and a timeout. */
export function runBashScript(
  script: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<ScriptOutcome> {
  return new Promise((finish) => {
    const child = spawn("bash", [script, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      finish({
        spawnError: null,
        status: null,
        stderr,
        stdout,
        timedOut: true,
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-MAX_CAPTURE_BYTES);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_CAPTURE_BYTES);
    });
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      finish({
        spawnError: err.message,
        status: null,
        stderr,
        stdout,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      finish({
        spawnError: null,
        status: code,
        stderr,
        stdout,
        timedOut: false,
      });
    });
  });
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
