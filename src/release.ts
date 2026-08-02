// ---------------------------------------------------------------------------
// pi-sites — release workflow (control plane & release desk)
//
// Pure release planning over git state, release log entries, connector prompt
// construction, and an opt-in `codex exec` connector runner. The connector is
// NEVER enabled by default and public release is NEVER automated. No secrets
// or credentials are ever placed in prompts, URLs, env, or output.
// ---------------------------------------------------------------------------

import { type ExecFileOptions, execFile } from "node:child_process";

// --- structural interfaces (typed to match integration inputs) -------------

export interface ReleaseGitState {
  branch: string | null;
  dirty: boolean;
  error: string | null;
  hasRepo: boolean;
  headSha: string | null;
}

export interface ReleaseConfig {
  bundle: { path: string | null };
  connector: { command: string[] | null };
  promotion: { enabled: boolean };
}

export type ReleaseStepStatus = "pending" | "done" | "blocked" | "skipped";

export interface ReleaseStep {
  detail: string;
  id: string;
  label: string;
  status: ReleaseStepStatus;
}

export interface ReleasePlan {
  dirtyRefused: boolean;
  sha: string | null;
  steps: ReleaseStep[];
}

export interface ReleaseLogEntry {
  archive: string;
  notes?: string;
  sha: string;
  status: "planned" | "saved" | "deployed-private" | "public" | "failed";
  timestamp: string;
}

export interface ConnectorResult {
  error: string | null;
  ok: boolean;
  output: string;
}

// --- release plan ----------------------------------------------------------

interface StepSpec {
  id: string;
  label: string;
  pendingDetail: string;
}

const RELEASE_STEPS: readonly StepSpec[] = [
  {
    id: "commit_sha",
    label: "Record the exact source commit",
    pendingDetail: "",
  },
  {
    id: "check_green",
    label: "Local validation green (sites_check)",
    pendingDetail: "run /sites check first",
  },
  {
    id: "archive",
    label: "Deployment archive produced (sites_package)",
    pendingDetail: "run /sites package first",
  },
  {
    id: "save_version",
    label: "Save a Site version from this commit (control plane)",
    pendingDetail:
      "ChatGPT web: chatgpt.com/sites → open the Site → Save version; or enable connector.command for codex exec automation",
  },
  {
    id: "deploy_private",
    label: "Deploy the saved version privately",
    pendingDetail:
      "Private-first default: deploy privately, verify, then decide on access",
  },
  {
    id: "access_env_domains",
    label: "Verify access level, environment values, data bindings",
    pendingDetail: "chatgpt.com/sites → More actions → Settings",
  },
  {
    id: "logs",
    label: "Check server/Worker logs on the key path",
    pendingDetail: "Sites settings or connector diagnosis",
  },
  {
    id: "public_release",
    label: "Promote to public only with an explicit decision",
    pendingDetail: "Deliberate policy change — never automated",
  },
];

function makeReleaseStep(
  spec: StepSpec,
  status: ReleaseStepStatus,
  detail: string
): ReleaseStep {
  return { detail, id: spec.id, label: spec.label, status };
}

export function planRelease(
  git: ReleaseGitState,
  opts?: { checkOk?: boolean; archivePath?: string | null }
): ReleasePlan {
  const refusalReasons: string[] = [];
  if (!git.hasRepo) {
    refusalReasons.push("no git repository detected");
  }
  if (git.dirty) {
    refusalReasons.push("working tree is dirty");
  }

  if (refusalReasons.length > 0) {
    const reason = refusalReasons.join("; ");
    return {
      dirtyRefused: true,
      sha: git.headSha,
      steps: RELEASE_STEPS.map((spec) =>
        makeReleaseStep(spec, "blocked", reason)
      ),
    };
  }

  const sha = git.headSha;
  return {
    dirtyRefused: false,
    sha,
    steps: RELEASE_STEPS.map((spec) => {
      switch (spec.id) {
        case "commit_sha": {
          if (sha === null) {
            return makeReleaseStep(
              spec,
              "blocked",
              "no commit to record (empty repository)"
            );
          }
          return makeReleaseStep(spec, "done", `${sha} (${sha.slice(0, 7)})`);
        }
        case "check_green": {
          if (opts?.checkOk === true) {
            return makeReleaseStep(spec, "done", "local validation passed");
          }
          return makeReleaseStep(spec, "pending", spec.pendingDetail);
        }
        case "archive": {
          if (opts?.archivePath) {
            return makeReleaseStep(spec, "done", opts.archivePath);
          }
          return makeReleaseStep(spec, "pending", spec.pendingDetail);
        }
        default: {
          return makeReleaseStep(spec, "pending", spec.pendingDetail);
        }
      }
    }),
  };
}

// --- release log -----------------------------------------------------------

export function buildReleaseLogEntry(input: {
  sha: string;
  archive: string;
  status: ReleaseLogEntry["status"];
  notes?: string;
}): ReleaseLogEntry {
  const sha = input.sha.trim();
  const archive = input.archive.trim();
  const notes = input.notes?.trim();
  const entry: ReleaseLogEntry = {
    archive,
    sha,
    status: input.status,
    timestamp: new Date().toISOString(),
  };
  if (notes !== undefined && notes !== "") {
    entry.notes = notes;
  }
  return entry;
}

// --- connector prompts -----------------------------------------------------

interface PromptContext {
  archive?: string | null;
  sha?: string | null;
}

type PromptBuilder = (dir: string, ctx: PromptContext) => string;

const CONNECTOR_PROMPT_SUFFIX =
  "\n\nNever print credentials or secret values. Use only the connector functions documented by the Sites plugin skill.";

// public_release is intentionally absent: never automated.
const CONNECTOR_PROMPTS: ReadonlyMap<string, PromptBuilder> = new Map([
  [
    "save_version",
    (dir, ctx) =>
      `Using the installed Sites plugin in this Codex session, save a version of the Sites project at ${dir} from source commit ${ctx.sha ?? "unknown"} with the packaged archive at ${ctx.archive ?? "unknown"}. Do not deploy. Report the saved version id and commit sha.`,
  ],
  [
    "deploy_private",
    (dir) =>
      `Using the installed Sites plugin, deploy the saved version of the project at ${dir} privately (deploy_private_site_version). Poll deployment status until it settles. Report the deployed URL or final status.`,
  ],
  [
    "access_env_domains",
    (dir) =>
      `Using the installed Sites plugin, report the current access level, environment variable names, and custom domains for the Site linked at ${dir} (get_site / get_environment_variables / list_custom_domains). Do not print values of secrets — names only.`,
  ],
  [
    "logs",
    (dir) =>
      `Using the installed Sites plugin, fetch recent production Worker logs for the Site at ${dir} (get_site_worker_logs) and summarize errors on the key path.`,
  ],
]);

export function buildConnectorPrompt(
  stepId: string,
  dir: string,
  ctx: PromptContext
): string | null {
  const builder = CONNECTOR_PROMPTS.get(stepId);
  if (builder === undefined) {
    return null;
  }
  return `${builder(dir, ctx)}${CONNECTOR_PROMPT_SUFFIX}`;
}

// --- connector runner ------------------------------------------------------

const CONNECTOR_DISABLED_ERROR =
  'connector automation disabled: set connector.command in .pi/sites.json (e.g. ["codex","exec","--sandbox","workspace-write"]) to enable';
const PUBLIC_RELEASE_NEVER_ERROR =
  "public release is never automated; perform it deliberately in ChatGPT web/desktop";
const UNKNOWN_STEP_ERROR = "unknown connector step";

interface ExecOutcome {
  error: Error | null;
  stderr: string;
  stdout: string;
}

function asText(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

// Resolves with an outcome instead of rejecting, so spawn failures and sync
// throws are reported uniformly through `error`.
function execFileCapture(
  file: string,
  args: string[],
  options: ExecFileOptions
): Promise<ExecOutcome> {
  return new Promise<ExecOutcome>((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({
        error,
        stderr: asText(stderr),
        stdout: asText(stdout),
      });
    });
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return { error: new Error(message), stderr: "", stdout: "" };
  });
}

function boundedTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(text.length - maxChars);
}

export async function runConnectorStep(
  stepId: string,
  dir: string,
  config: ReleaseConfig,
  ctx: PromptContext,
  opts?: { timeoutMs?: number; maxOutputChars?: number }
): Promise<ConnectorResult> {
  const { command } = config.connector;
  if (command === null || command.length === 0) {
    return { error: CONNECTOR_DISABLED_ERROR, ok: false, output: "" };
  }
  if (stepId === "public_release") {
    return { error: PUBLIC_RELEASE_NEVER_ERROR, ok: false, output: "" };
  }
  const prompt = buildConnectorPrompt(stepId, dir, ctx);
  if (prompt === null) {
    return { error: UNKNOWN_STEP_ERROR, ok: false, output: "" };
  }

  const outcome = await execFileCapture(
    command[0],
    [...command.slice(1), prompt],
    {
      cwd: dir,
      env: { ...process.env },
      maxBuffer: 1_000_000,
      timeout: opts?.timeoutMs ?? 900_000,
      windowsHide: true,
    }
  );

  const parts: string[] = [];
  if (outcome.stdout !== "") {
    parts.push(outcome.stdout);
  }
  if (outcome.stderr !== "") {
    parts.push(outcome.stderr);
  }
  const output = boundedTail(parts.join("\n"), opts?.maxOutputChars ?? 4000);

  if (outcome.error !== null) {
    return { error: outcome.error.message, ok: false, output };
  }
  return { error: null, ok: true, output };
}

// --- summary ---------------------------------------------------------------

const STEP_MARKERS: Record<ReleaseStepStatus, string> = {
  blocked: "✗",
  done: "✓",
  pending: "○",
  skipped: "–",
};

export function summarizeReleasePlan(plan: ReleasePlan): string {
  const lines: string[] = [];
  if (plan.dirtyRefused) {
    lines.push(
      "release refused: uncommitted changes or missing repository — resolve before releasing"
    );
  }
  for (const step of plan.steps) {
    lines.push(`${STEP_MARKERS[step.status]} ${step.label}: ${step.detail}`);
  }
  return lines.join("\n");
}
