import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { SitesBundle } from "./bundle.ts";
import type { ScriptOutcome } from "./init.ts";
import { runBashScript } from "./init.ts";
import { lastLines } from "./output.ts";

const execFileAsync = promisify(execFile);

/** Outcome of packaging a project into a deployment archive via package-site.sh. */
export interface PackageResult {
  archivePath: string;
  /** Archive entries (full list capped at 200) when the archive was listed. */
  entries: string[] | null;
  errors: string[];
  exitCode: number | null;
  ok: boolean;
  sizeBytes: number | null;
}

const DEFAULT_PACKAGE_TIMEOUT_MS = 300_000;
const MAX_ARCHIVE_ENTRIES = 200;
const MAX_TAR_BUFFER = 64 * 1024 * 1024;
const ERROR_LINES = 5;

/**
 * Produce the deployment archive at `archivePath` via the bundle's
 * package-site.sh, then verify the required entries (`dist/server/index.js`,
 * `dist/.openai/hosting.json`, and `dist/.openai/drizzle/**` when the project
 * has a drizzle/ directory). Never throws.
 */
export async function runSitesPackage(
  projectDir: string,
  archivePath: string,
  bundle: SitesBundle,
  opts?: { timeoutMs?: number }
): Promise<PackageResult> {
  const project = resolve(projectDir);
  const archive = resolve(archivePath);
  try {
    mkdirSync(dirname(archive), { recursive: true });
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_PACKAGE_TIMEOUT_MS;
    const outcome = await runBashScript(
      bundle.packageScript,
      [project, archive],
      project,
      timeoutMs
    );
    if (outcome.status !== 0) {
      const tail = lastLines(outcome.stderr || outcome.stdout, ERROR_LINES);
      const message = packageFailureMessage(outcome, timeoutMs, tail);
      return {
        archivePath: archive,
        entries: null,
        errors: [message],
        exitCode: outcome.status,
        ok: false,
        sizeBytes: null,
      };
    }

    const { entries, errors } = await verifyArchive(project, archive);
    let sizeBytes: number | null = null;
    try {
      sizeBytes = statSync(archive).size;
    } catch {
      sizeBytes = null;
    }
    return {
      archivePath: archive,
      entries: entries.slice(0, MAX_ARCHIVE_ENTRIES),
      errors,
      exitCode: 0,
      ok: errors.length === 0,
      sizeBytes,
    };
  } catch (err) {
    return {
      archivePath: archive,
      entries: null,
      errors: [messageOf(err)],
      exitCode: null,
      ok: false,
      sizeBytes: null,
    };
  }
}

function packageFailureMessage(
  outcome: ScriptOutcome,
  timeoutMs: number,
  tail: string
): string {
  if (outcome.timedOut) {
    return `package-site.sh timed out after ${timeoutMs}ms`;
  }
  if (outcome.spawnError !== null) {
    return `package-site.sh failed to start: ${outcome.spawnError}`;
  }
  if (tail !== "") {
    return tail;
  }
  return `package-site.sh exited ${outcome.status ?? "with a signal"}`;
}

interface ArchiveVerification {
  entries: string[];
  errors: string[];
}

/** List the archive and check the required entries. */
async function verifyArchive(
  project: string,
  archive: string
): Promise<ArchiveVerification> {
  const errors: string[] = [];
  let entries: string[] = [];
  try {
    const { stdout } = await awaitExecTar(archive);
    entries = stdout
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  } catch (err) {
    errors.push(`cannot list archive contents: ${messageOf(err)}`);
  }
  if (entries.length === 0 && errors.length === 0) {
    errors.push("archive contains no entries");
  }
  if (!entries.includes("dist/server/index.js")) {
    errors.push("archive is missing dist/server/index.js");
  }
  if (!entries.includes("dist/.openai/hosting.json")) {
    errors.push("archive is missing dist/.openai/hosting.json");
  }
  if (
    existsSync(join(project, "drizzle")) &&
    !entries.some((entry) => entry.startsWith("dist/.openai/drizzle/"))
  ) {
    errors.push(
      "archive is missing dist/.openai/drizzle/** (project has a drizzle/ directory)"
    );
  }
  return { entries, errors };
}

function awaitExecTar(archive: string): Promise<{ stdout: string }> {
  return execFileAsync("tar", ["-tzf", archive], { maxBuffer: MAX_TAR_BUFFER });
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
