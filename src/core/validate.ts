import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { getGitState } from "./git.ts";
import { validateHostingConfig } from "./hosting.ts";
import { lastLines } from "./output.ts";
import { scanTrackedFiles } from "./secrets.ts";

export type CheckStatus = "pass" | "fail" | "skip" | "manual";

/** One release-readiness checklist item. */
export interface CheckItem {
  evidence: string;
  id: string;
  label: string;
  status: CheckStatus;
}

/** The full result of a Sites release-readiness check. */
export interface CheckResult {
  durationMs: number;
  error: string | null;
  items: CheckItem[];
  ok: boolean;
  summary: { pass: number; fail: number; skip: number; manual: number };
}

export interface SitesCheckOptions {
  buildTimeoutMs?: number;
  runBuild?: boolean;
}

const DEFAULT_BUILD_TIMEOUT_MS = 600_000;
const MAX_BUILD_OUTPUT_LINES = 20;
const MAX_SECRET_EVIDENCE_LINES = 10;
const MAX_EVIDENCE_FILES = 10;

const LINE_SPLIT_RE = /\r?\n/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

interface BuildInfo {
  evidence: string;
  status: CheckStatus;
}

/**
 * Run the full Sites release-readiness checklist against `dir`. Never throws:
 * per-item failures are captured in items, and only a whole-check crash sets
 * `error`.
 */
export async function runSitesCheck(
  dir: string,
  opts?: SitesCheckOptions
): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    const runBuild = opts?.runBuild !== false;
    const buildTimeoutMs = opts?.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
    const gitState = await getGitState(dir);

    const buildInfo = runBuild
      ? await runBuildCheck(dir, buildTimeoutMs)
      : { evidence: "build disabled by caller", status: "skip" as const };

    const buildItem: CheckItem = {
      evidence: buildInfo.evidence,
      id: "build",
      label: "npm run build succeeds from the current source",
      status: buildInfo.status,
    };
    const hostingJsonItem = checkHostingJson(dir);
    const envExampleItem = checkEnvExample(dir);
    const envParityItem = checkEnvParity(dir);
    const secretsScanItem = await checkSecretsScan(dir);
    const workerEntryItem = checkWorkerEntry(dir);
    const distServerItem = checkDistServer(dir, buildInfo);
    const release1Item = checkRelease1(buildInfo);
    const release4Item = checkRelease4(envExampleItem);
    const release5Item = checkRelease5(secretsScanItem);
    const release6Item = checkRelease6(dir);
    const release8Item = checkRelease8(gitState);

    const items: CheckItem[] = [
      buildItem,
      hostingJsonItem,
      envExampleItem,
      envParityItem,
      secretsScanItem,
      workerEntryItem,
      distServerItem,
      release1Item,
      manualItem(
        "release_2",
        "A user without your local browser state can use the critical path",
        "manual — verify the critical path in a fresh browser session with no local state"
      ),
      manualItem(
        "release_3",
        "Empty, loading, error, and permission-denied states are understandable",
        "manual — exercise empty, loading, error, and permission-denied states"
      ),
      release4Item,
      release5Item,
      release6Item,
      manualItem(
        "release_7",
        "The Worker enforces authorization for protected data/actions",
        "manual — review Worker authorization for protected data and actions"
      ),
      release8Item,
    ];

    const summary = { fail: 0, manual: 0, pass: 0, skip: 0 };
    for (const item of items) {
      summary[item.status] += 1;
    }
    return {
      durationMs: Math.round(performance.now() - startedAt),
      error: null,
      items,
      ok: summary.fail === 0,
      summary,
    };
  } catch (err) {
    return {
      durationMs: Math.round(performance.now() - startedAt),
      error: messageOf(err),
      items: [],
      ok: false,
      summary: { fail: 0, manual: 0, pass: 0, skip: 0 },
    };
  }
}

function manualItem(id: string, label: string, evidence: string): CheckItem {
  return { evidence, id, label, status: "manual" };
}

function runBuildCheck(dir: string, timeoutMs: number): Promise<BuildInfo> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "build"], { cwd: dir });
    let stdoutLines: string[] = [];
    let stderrLines: string[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      resolve({
        evidence: `timed out after ${timeoutMs}ms`,
        status: "fail",
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutLines = pushBounded(
        stdoutLines,
        chunk.toString("utf8"),
        MAX_BUILD_OUTPUT_LINES
      );
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrLines = pushBounded(
        stderrLines,
        chunk.toString("utf8"),
        MAX_BUILD_OUTPUT_LINES
      );
    });
    child.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        evidence: `failed to start npm run build: ${err.message}`,
        status: "fail",
      });
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - startedAt);
      const tail = lastLines([...stdoutLines, ...stderrLines].join("\n"), 1);
      if (code === 0) {
        resolve({
          evidence: `exit 0 · ${durationMs}ms${tail === "" ? "" : ` · last line: ${tail}`}`,
          status: "pass",
        });
        return;
      }
      const how =
        code === null ? `signal ${signal ?? "unknown"}` : `exit ${code}`;
      resolve({
        evidence: `${how} · ${durationMs}ms${tail === "" ? "" : ` · last line: ${tail}`}`,
        status: "fail",
      });
    });
  });
}

function pushBounded(lines: string[], chunk: string, max: number): string[] {
  return [...lines, ...chunk.split(LINE_SPLIT_RE)].slice(-max);
}

function checkHostingJson(dir: string): CheckItem {
  const base = {
    id: "hosting_json",
    label: "hosting.json exists and matches the Sites schema",
  };
  const hostingPath = join(dir, ".openai", "hosting.json");
  if (!existsSync(hostingPath)) {
    return {
      ...base,
      evidence:
        "no .openai/hosting.json — add one (run sites_init or copy from a Sites project)",
      status: "skip",
    };
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(hostingPath, "utf8"));
    const result = validateHostingConfig(raw);
    if (!result.ok) {
      return {
        ...base,
        evidence: `hosting.json does not match the Sites schema: ${result.errors.join("; ")}`,
        status: "fail",
      };
    }
    const present: string[] = [];
    if (result.value.projectId !== undefined) {
      present.push("project_id");
    }
    if (result.value.d1 !== undefined) {
      present.push("d1");
    }
    if (result.value.r2 !== undefined) {
      present.push("r2");
    }
    return {
      ...base,
      evidence: `matches the Sites schema (${present.length === 0 ? "empty config" : present.join(", ")})`,
      status: "pass",
    };
  } catch (err) {
    return {
      ...base,
      evidence: `hosting.json is not valid JSON: ${messageOf(err)}`,
      status: "fail",
    };
  }
}

/** Parse `NAME=` lines (optionally `export NAME=`) into environment names. */
function parseEnvNames(text: string): string[] {
  const names: string[] = [];
  for (const rawLine of text.split(LINE_SPLIT_RE)) {
    const line = rawLine.trim();
    const body = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;
    const match = ENV_NAME_RE.exec(body);
    if (match !== null) {
      const name = match[0].slice(0, -1);
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

function checkEnvExample(dir: string): CheckItem {
  const base = {
    id: "env_example",
    label: ".env.example exists and documents required environment names",
  };
  const examplePath = join(dir, ".env.example");
  if (!existsSync(examplePath)) {
    return {
      ...base,
      evidence:
        "no .env.example — document required environment names as NAME= lines",
      status: "fail",
    };
  }
  const names = parseEnvNames(readFileSync(examplePath, "utf8"));
  if (names.length === 0) {
    return {
      ...base,
      evidence:
        ".env.example documents no environment names (expected NAME= lines)",
      status: "fail",
    };
  }
  return {
    ...base,
    evidence: `documents ${names.length} name${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    status: "pass",
  };
}

function checkEnvParity(dir: string): CheckItem {
  const base = {
    id: "env_parity",
    label: "local .env names are documented in .env.example",
  };
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) {
    return {
      ...base,
      evidence: "no local .env file",
      status: "skip",
    };
  }
  const envNames = parseEnvNames(readFileSync(envPath, "utf8"));
  const examplePath = join(dir, ".env.example");
  const exampleNames = existsSync(examplePath)
    ? parseEnvNames(readFileSync(examplePath, "utf8"))
    : [];
  const missing = envNames.filter((name) => !exampleNames.includes(name));
  if (missing.length > 0) {
    return {
      ...base,
      evidence: `local .env names not documented in .env.example: ${missing.join(", ")}`,
      status: "fail",
    };
  }
  return {
    ...base,
    evidence:
      envNames.length === 0
        ? ".env contains no names to compare"
        : `all ${envNames.length} local .env name${envNames.length === 1 ? "" : "s"} documented in .env.example`,
    status: "pass",
  };
}

async function checkSecretsScan(dir: string): Promise<CheckItem> {
  const base = {
    id: "secrets_scan",
    label: "no staged secrets, tokens, or private URLs",
  };
  const scan = await scanTrackedFiles(dir);
  if (scan.error !== null) {
    if (scan.error === "not a git repository") {
      return {
        ...base,
        evidence: "not a git repository — nothing to scan",
        status: "skip",
      };
    }
    return {
      ...base,
      evidence: `secrets scan failed: ${scan.error}`,
      status: "fail",
    };
  }
  const lines: string[] = [];
  if (scan.trackedDotEnv) {
    lines.push(
      "tracked .env file(s) — move secrets to managed env values (keep .env untracked)"
    );
  }
  for (const hit of scan.hits.slice(0, MAX_SECRET_EVIDENCE_LINES)) {
    lines.push(`${hit.file}:${hit.line} ${hit.pattern} ${hit.snippet}`);
  }
  if (scan.hits.length > MAX_SECRET_EVIDENCE_LINES) {
    lines.push(
      `… and ${scan.hits.length - MAX_SECRET_EVIDENCE_LINES} more hit(s)`
    );
  }
  if (lines.length > 0) {
    return {
      ...base,
      evidence: lines.join("\n"),
      status: "fail",
    };
  }
  return {
    ...base,
    evidence: "no secrets found in tracked files",
    status: "pass",
  };
}

function checkWorkerEntry(dir: string): CheckItem {
  const base = { id: "worker_entry", label: "worker/ entry point present" };
  const workerDir = join(dir, "worker");
  if (!existsSync(workerDir)) {
    return {
      ...base,
      evidence: "no worker/ directory — add the Worker-compatible entry point",
      status: "fail",
    };
  }
  let files: string[];
  try {
    const entries = readdirSync(workerDir, { recursive: true });
    files = entries.filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.endsWith(".ts")
    );
  } catch (err) {
    return {
      ...base,
      evidence: `cannot list worker/: ${messageOf(err)}`,
      status: "fail",
    };
  }
  if (files.length === 0) {
    return {
      ...base,
      evidence: "worker/ contains no TypeScript entry files",
      status: "fail",
    };
  }
  return {
    ...base,
    evidence: `worker/ present with ${files.length} TypeScript file${files.length === 1 ? "" : "s"}: ${files.slice(0, MAX_EVIDENCE_FILES).join(", ")}`,
    status: "pass",
  };
}

function checkDistServer(dir: string, buildInfo: BuildInfo): CheckItem {
  const base = {
    id: "dist_server",
    label: "dist/server/index.js is buildable",
  };
  const exists = existsSync(join(dir, "dist", "server", "index.js"));
  if (buildInfo.status === "pass") {
    return {
      ...base,
      evidence: exists
        ? "dist/server/index.js exists after a successful build"
        : "build passed but dist/server/index.js was not produced",
      status: exists ? "pass" : "fail",
    };
  }
  if (buildInfo.status === "fail") {
    return {
      ...base,
      evidence: "npm run build failed — no build artifact to verify",
      status: "fail",
    };
  }
  if (exists) {
    return {
      ...base,
      evidence:
        "dist/server/index.js present (build was not run by this check)",
      status: "pass",
    };
  }
  return {
    ...base,
    evidence: "dist/server/index.js absent — run npm run build first",
    status: "skip",
  };
}

function checkRelease1(buildInfo: BuildInfo): CheckItem {
  const base = {
    id: "release_1",
    label: "npm run build passes from a clean install",
  };
  if (buildInfo.status === "pass") {
    return {
      ...base,
      evidence: "npm run build passed (see build item)",
      status: "pass",
    };
  }
  if (buildInfo.status === "skip") {
    return {
      ...base,
      evidence:
        "npm run build was not run (build disabled by caller) — cannot confirm a clean build",
      status: "fail",
    };
  }
  return {
    ...base,
    evidence: "npm run build failed (see build item)",
    status: "fail",
  };
}

function checkRelease4(envExampleItem: CheckItem): CheckItem {
  const base = {
    id: "release_4",
    label: "Required environment names are documented in .env.example",
  };
  return {
    ...base,
    evidence:
      envExampleItem.status === "pass"
        ? "matches env_example check"
        : "fails with env_example check",
    status: envExampleItem.status === "pass" ? "pass" : "fail",
  };
}

function checkRelease5(secretsScanItem: CheckItem): CheckItem {
  const base = {
    id: "release_5",
    label: "No secret, token, database export, or private URL is staged",
  };
  return {
    ...base,
    evidence:
      secretsScanItem.status === "pass"
        ? "matches secrets_scan check"
        : `fails with secrets_scan check (${secretsScanItem.status})`,
    status: secretsScanItem.status === "pass" ? "pass" : "fail",
  };
}

function checkRelease6(dir: string): CheckItem {
  const base = {
    id: "release_6",
    label: "Any database migration is included with a rollback/recovery plan",
  };
  const drizzleDir = join(dir, "drizzle");
  if (!existsSync(drizzleDir)) {
    return {
      ...base,
      evidence: "no D1 schema/migrations in repo",
      status: "skip",
    };
  }
  let files: string[];
  try {
    files = listMigrations(drizzleDir);
  } catch (err) {
    return {
      ...base,
      evidence: `cannot list drizzle/: ${messageOf(err)}`,
      status: "fail",
    };
  }
  if (files.length === 0) {
    return {
      ...base,
      evidence:
        "drizzle/ present but no migration files (files under drizzle/, excluding drizzle/meta/)",
      status: "fail",
    };
  }
  return {
    ...base,
    evidence: `migration files present: ${files.slice(0, MAX_EVIDENCE_FILES).join(", ")} — rollback plan is a manual step`,
    status: "pass",
  };
}

/** List files under `drizzle/`, excluding the `meta/` journal directory. */
function listMigrations(drizzleDir: string): string[] {
  const files: string[] = [];
  const walk = (relative: string): void => {
    const entries = readdirSync(join(drizzleDir, relative), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const childRelative =
        relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "meta") {
          walk(childRelative);
        }
      } else if (entry.isFile()) {
        files.push(childRelative);
      }
    }
  };
  walk("");
  return files.sort((a, b) => a.localeCompare(b));
}

function checkRelease8(
  gitState: Awaited<ReturnType<typeof getGitState>>
): CheckItem {
  const base = { id: "release_8", label: "The source commit SHA is known" };
  if (!gitState.hasRepo) {
    return {
      ...base,
      evidence: "not a git repository",
      status: "skip",
    };
  }
  if (gitState.headSha === null) {
    return {
      ...base,
      evidence: "no commit HEAD — nothing to record yet",
      status: "skip",
    };
  }
  return {
    ...base,
    evidence: `source commit ${gitState.headSha}${gitState.dirty ? " — tree is dirty — release desk will refuse" : ""}`,
    status: "pass",
  };
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
