import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { findSitesBundle } from "./core/bundle.ts";
import { loadSitesConfig } from "./core/config.ts";
import { getGitState } from "./core/git.ts";
import { readHostingConfig } from "./core/hosting.ts";
import { runSitesInit } from "./core/init.ts";
import { boundText, formatBytes } from "./core/output.ts";
import { runSitesPackage } from "./core/package.ts";
import { runSitesCheck } from "./core/validate.ts";
import { clearSitesFooter } from "./events.ts";
import {
  buildMenuStatus,
  openSitesMenu,
  renderMenuStatus,
  type SitesMenuActions,
} from "./menu.ts";
import {
  planRelease,
  type ReleasePlan,
  type ReleaseStep,
  runConnectorStep,
  summarizeReleasePlan,
} from "./release.ts";

export const RELEASE_ENTRY_TYPE = "sites-release";

const WHITESPACE_RE = /\s+/;

const SUBCOMMANDS = [
  "init",
  "check",
  "package",
  "diagnose",
  "release",
  "status",
  "menu",
  "help",
] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];

interface ReleaseEntry {
  archive: string;
  sha: string;
  status: string;
  timestamp: string;
}

interface SessionEntryLike {
  customType?: string;
  data?: unknown;
  type?: string;
}

/** Read release-log entries (custom entries with type sites-release) from the session. */
export function readReleaseEntries(ctx: {
  sessionManager: {
    getEntries: () => SessionEntryLike[];
  };
}): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== RELEASE_ENTRY_TYPE) {
      continue;
    }
    const data = entry.data as {
      archive?: string;
      sha?: string;
      status?: string;
      timestamp?: string;
    };
    if (
      typeof data.archive === "string" &&
      typeof data.sha === "string" &&
      typeof data.status === "string" &&
      typeof data.timestamp === "string"
    ) {
      entries.push({
        archive: data.archive,
        sha: data.sha,
        status: data.status,
        timestamp: data.timestamp,
      });
    }
  }
  return entries;
}

function bundleNotFoundMessage(): string {
  return (
    "Sites plugin bundle not found.\n" +
    "Install the Codex Sites plugin or set PI_SITES_BUNDLE to the bundle root\n" +
    "(e.g. $HOME/.codex/plugins/cache/openai-bundled/sites/<version>)."
  );
}

async function runInit(
  args: string,
  ctx: ExtensionCommandContext
): Promise<string> {
  const bundle = findSitesBundle();
  if (bundle === null) {
    return bundleNotFoundMessage();
  }
  const target = args.trim() === "" ? ctx.cwd : args.trim();
  const result = await runSitesInit(target, bundle);
  const lines = [
    result.ok ? "ok" : "failed",
    `target: ${result.target}`,
    result.message,
  ];
  if (result.layout !== null) {
    lines.push(`layout: ${result.layout.join(", ")}`);
  }
  return boundText(lines.filter((line) => line !== "").join("\n"));
}

async function runCheck(ctx: ExtensionCommandContext): Promise<string> {
  const result = await runSitesCheck(ctx.cwd);
  return boundText(
    [
      `${result.items.length} items: ${result.summary.pass} pass, ${result.summary.fail} fail, ${result.summary.manual} manual, ${result.summary.skip} skip`,
      ...result.items.map(
        (item) => `${item.status} ${item.id} — ${item.label} [${item.evidence}]`
      ),
    ].join("\n")
  );
}

async function runPackage(ctx: ExtensionCommandContext): Promise<string> {
  const bundle = findSitesBundle();
  if (bundle === null) {
    return bundleNotFoundMessage();
  }
  const archive = join(tmpdir(), `sites-package-${Date.now()}.tar.gz`);
  const result = await runSitesPackage(ctx.cwd, archive, bundle);
  const lines = [result.ok ? "ok" : "failed", `archive: ${result.archivePath}`];
  if (result.sizeBytes !== null) {
    lines.push(
      `size: ${formatBytes(result.sizeBytes)} (${result.sizeBytes} bytes)`
    );
  }
  lines.push(...result.errors);
  return boundText(lines.filter((line) => line !== "").join("\n"));
}

function hostingLine(
  projectId: string | undefined,
  d1: string | null | undefined,
  r2: string | null | undefined
): string {
  const parts: string[] = [];
  if (projectId === undefined) {
    parts.push("no project_id");
  } else {
    parts.push(`proj ${projectId.slice(0, 6)}…`);
  }
  if (d1) {
    parts.push(`d1=${d1}`);
  }
  if (r2) {
    parts.push(`r2=${r2}`);
  }
  return parts.join(" · ");
}

function releaseLogLine(releases: ReleaseEntry[]): string {
  if (releases.length === 0) {
    return "release log: no entries";
  }
  const latest = releases.at(-1);
  const plural = releases.length === 1 ? "entry" : "entries";
  return `release log: ${releases.length} ${plural}, latest ${latest?.sha.slice(0, 8)} @ ${latest?.timestamp}`;
}

async function runDiagnose(ctx: ExtensionCommandContext): Promise<string> {
  const git = await getGitState(ctx.cwd);
  const gitLine = git.hasRepo
    ? `git: ${git.branch ?? "?"} @ ${git.headSha ?? "no commit"}${git.dirty ? " (dirty)" : ""}`
    : `git: ${git.error ?? "not a git repository"}`;
  const hosting = readHostingConfig(ctx.cwd);
  const hostingJsonLine =
    hosting === null
      ? "hosting.json: missing or unparseable (not a Sites project?)"
      : `hosting.json: ${hostingLine(hosting.projectId, hosting.d1, hosting.r2)}`;
  const distServer = join(ctx.cwd, "dist", "server", "index.js");
  const artifactLine = existsSync(distServer)
    ? "build artifact: dist/server/index.js present"
    : "build artifact: missing (run npm run build)";
  const bundle = findSitesBundle();
  const bundleLine =
    bundle === null
      ? "bundle: missing"
      : `bundle: ${bundle.version} at ${bundle.path}`;
  const config = loadSitesConfig(ctx.cwd);
  const connectorText =
    config.connector.command === null
      ? "disabled"
      : config.connector.command.join(" ");
  return boundText(
    [
      "pi-sites diagnosis",
      gitLine,
      hostingJsonLine,
      artifactLine,
      bundleLine,
      releaseLogLine(readReleaseEntries(ctx)),
      `config: promotion.enabled=${config.promotion.enabled}, connector.command=${connectorText}`,
    ].join("\n")
  );
}

const CONTROL_PLANE_STEP_IDS = [
  "save_version",
  "deploy_private",
  "access_env_domains",
  "logs",
] as const;

type ControlPlaneStepId = (typeof CONTROL_PLANE_STEP_IDS)[number];

function stepStatusMark(step: ReleaseStep): string {
  if (step.status === "done") {
    return "x";
  }
  return " ";
}

function connectorNote(stepId: string, connectorEnabled: boolean): string {
  if (stepId === "public_release") {
    return " (manual only — never automated)";
  }
  if (connectorEnabled) {
    return " (connector automation available)";
  }
  return " (manual — set connector.command in .pi/sites.json to enable codex exec automation)";
}

function appendReleaseEntry(
  pi: ExtensionAPI,
  entry: { archive: string; notes: string; sha: string; status: string }
): void {
  pi.appendEntry(RELEASE_ENTRY_TYPE, {
    ...entry,
    timestamp: new Date().toISOString(),
  });
}

async function runConnectorStepInteractive(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  stepId: ControlPlaneStepId,
  stepLabel: string,
  plan: ReleasePlan,
  config: ReturnType<typeof loadSitesConfig>,
  packageArchive: string | null,
  lines: string[]
): Promise<void> {
  const result = await runConnectorStep(stepId, ctx.cwd, config, {
    archive: packageArchive,
    sha: plan.sha,
  });
  if (!result.ok) {
    ctx.ui.notify(
      `Connector step failed: ${result.error ?? "unknown error"}`,
      "error"
    );
    lines.push(`connector ${stepId}: ${result.error ?? "failed"}`);
    if (result.output !== "") {
      lines.push(result.output);
    }
    return;
  }
  ctx.ui.notify(`Connector step done: ${stepLabel}`, "info");
  if (plan.sha === null || packageArchive === null) {
    return;
  }
  if (stepId === "save_version") {
    appendReleaseEntry(pi, {
      archive: packageArchive,
      notes: "version saved via connector",
      sha: plan.sha,
      status: "saved",
    });
  } else if (stepId === "deploy_private") {
    appendReleaseEntry(pi, {
      archive: packageArchive,
      notes: "private deployment via connector",
      sha: plan.sha,
      status: "deployed-private",
    });
  }
}

async function runInteractiveStep(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  plan: ReleasePlan,
  config: ReturnType<typeof loadSitesConfig>,
  checkOk: boolean,
  packageOk: boolean,
  packageArchive: string | null,
  lines: string[],
  index: number
): Promise<void> {
  const stepId = CONTROL_PLANE_STEP_IDS[index];
  if (stepId === undefined) {
    return;
  }
  const step = plan.steps.find((s) => s.id === stepId);
  if (step === undefined || step.status === "done") {
    await runInteractiveStep(
      pi,
      ctx,
      plan,
      config,
      checkOk,
      packageOk,
      packageArchive,
      lines,
      index + 1
    );
    return;
  }
  if (!(checkOk && packageOk)) {
    return;
  }
  const connectorEnabled = config.connector.command !== null;
  const choices: string[] = [];
  if (connectorEnabled) {
    choices.push("Run via connector (codex exec)");
  }
  choices.push("I'll do this in ChatGPT web/desktop", "Skip");
  const choice = await ctx.ui.select(step.label, choices);
  if (choice === undefined || choice === "Skip") {
    await runInteractiveStep(
      pi,
      ctx,
      plan,
      config,
      checkOk,
      packageOk,
      packageArchive,
      lines,
      index + 1
    );
    return;
  }
  if (choice === "I'll do this in ChatGPT web/desktop") {
    ctx.ui.notify(`Marked done in web/desktop: ${step.label}`, "info");
    await runInteractiveStep(
      pi,
      ctx,
      plan,
      config,
      checkOk,
      packageOk,
      packageArchive,
      lines,
      index + 1
    );
    return;
  }
  if (connectorEnabled && choice === "Run via connector (codex exec)") {
    await runConnectorStepInteractive(
      pi,
      ctx,
      stepId,
      step.label,
      plan,
      config,
      packageArchive,
      lines
    );
  }
  await runInteractiveStep(
    pi,
    ctx,
    plan,
    config,
    checkOk,
    packageOk,
    packageArchive,
    lines,
    index + 1
  );
}

async function runInteractiveControlPlaneSteps(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  plan: ReleasePlan,
  config: ReturnType<typeof loadSitesConfig>,
  checkOk: boolean,
  packageOk: boolean,
  packageArchive: string | null,
  lines: string[]
): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }
  await runInteractiveStep(
    pi,
    ctx,
    plan,
    config,
    checkOk,
    packageOk,
    packageArchive,
    lines,
    0
  );
}

/**
 * Run the /sites release desk: exact commit SHA, dirty-tree refusal, local
 * gates (check + package), guided private-first control-plane steps, and a
 * persisted release log entry via appendEntry.
 */
async function runRelease(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): Promise<string> {
  const lines: string[] = [];
  const git = await getGitState(ctx.cwd);
  const check = await runSitesCheck(ctx.cwd);
  const bundle = findSitesBundle();
  const archive = join(tmpdir(), `sites-package-${Date.now()}.tar.gz`);
  const packageResult =
    bundle === null
      ? { archivePath: archive, errors: [bundleNotFoundMessage()], ok: false }
      : await runSitesPackage(ctx.cwd, archive, bundle);
  const plan = await planRelease(git, {
    archivePath: packageResult.ok ? packageResult.archivePath : null,
    checkOk: check.ok,
  });

  lines.push(summarizeReleasePlan(plan));

  if (plan.dirtyRefused) {
    lines.push(
      "Release refused: the working tree is dirty (or not a git repo). " +
        "Commit or stash first; releases must come from an exact source commit."
    );
    return boundText(lines.join("\n"));
  }

  if (plan.sha !== null && packageResult.ok) {
    appendReleaseEntry(pi, {
      archive: packageResult.archivePath,
      notes: "planned via /sites release",
      sha: plan.sha,
      status: "planned",
    });
    lines.push(`release log: entry appended (sha ${plan.sha.slice(0, 12)})`);
  }

  if (!check.ok) {
    lines.push(
      `sites_check is not green (${check.summary.fail} fail) — resolve the failing items above before control-plane steps.`
    );
  }
  if (!packageResult.ok) {
    lines.push(
      "sites_package did not produce an archive — fix before saving a version."
    );
  }

  const config = loadSitesConfig(ctx.cwd);
  const connectorEnabled = config.connector.command !== null;
  lines.push("");
  lines.push("Control-plane steps (private-first):");
  for (const stepId of [...CONTROL_PLANE_STEP_IDS, "public_release"] as const) {
    const step = plan.steps.find((s) => s.id === stepId);
    if (step === undefined) {
      continue;
    }
    lines.push(
      `- [${stepStatusMark(step)}] ${step.label}${connectorNote(stepId, connectorEnabled)}`
    );
    lines.push(`    ${step.detail}`);
  }

  await runInteractiveControlPlaneSteps(
    pi,
    ctx,
    plan,
    config,
    check.ok,
    packageResult.ok,
    packageResult.ok ? packageResult.archivePath : null,
    lines
  );

  lines.push("");
  lines.push(
    "Public release is a deliberate policy change — perform it manually in ChatGPT web/desktop."
  );
  return boundText(lines.join("\n"));
}

async function runStatus(ctx: ExtensionCommandContext): Promise<string> {
  const releases = readReleaseEntries(ctx);
  const status = await buildMenuStatus(
    ctx.cwd,
    releases.map((data) => ({ customType: RELEASE_ENTRY_TYPE, data }))
  );
  return renderMenuStatus(status);
}

function printHelp(): string {
  return [
    "pi-sites — ChatGPT Sites workflow",
    "",
    "Usage: /sites <subcommand>",
    "  init      scaffold a new Sites project (target dir as argument)",
    "  check     run the release-readiness checklist",
    "  package   produce the deployment archive",
    "  diagnose  gather local diagnosis facts",
    "  release   open the release desk (exact commit, private-first)",
    "  status    show the current project status",
    "  menu      open the interactive Sites menu (TUI)",
    "  help      this help",
    "",
    "Config: .pi/sites.json (promotion.enabled, connector.command, bundle.path)",
  ].join("\n");
}

function parseSubcommand(args: string): Subcommand | null {
  const token = args.trim().split(WHITESPACE_RE)[0] ?? "";
  if (token === "") {
    return null;
  }
  return (SUBCOMMANDS as readonly string[]).includes(token)
    ? (token as Subcommand)
    : null;
}

type CommandRunner = (
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rest: string
) => Promise<string>;

async function dispatchSitesCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  sub: Subcommand | null,
  args: string,
  runners: Record<string, CommandRunner>
): Promise<void> {
  if (sub === null) {
    if (ctx.hasUI) {
      await openSitesMenu(ctx, makeActionsFor(pi, ctx));
      return;
    }
    emitHeadless(printHelp());
    return;
  }
  if (sub === "help") {
    emitHeadless(printHelp());
    return;
  }
  const runner = runners[sub];
  if (runner === undefined) {
    emitHeadless(printHelp());
    return;
  }
  const rest = args.trim().split(WHITESPACE_RE).slice(1).join(" ");
  const output = await runner(pi, ctx, rest);
  if (output === "") {
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(capOutput(output), "info");
  } else {
    emitHeadless(output);
  }
}

/** Bound notify payloads so a toast never floods the UI. */
function capOutput(text: string): string {
  const MAX_NOTIFY_CHARS = 1200;
  return text.length <= MAX_NOTIFY_CHARS
    ? text
    : `${text.slice(0, MAX_NOTIFY_CHARS)}…`;
}

/** Register the /sites command family and the interactive menu. */
export function registerSitesCommands(pi: ExtensionAPI): void {
  const runners: Record<string, CommandRunner> = {
    check: (_pi, ctx) => runCheck(ctx),
    diagnose: (_pi, ctx) => runDiagnose(ctx),
    init: (_pi, ctx, rest) => runInit(rest, ctx),
    menu: async (_pi, ctx) => {
      if (ctx.hasUI) {
        await openSitesMenu(ctx, makeActionsFor(pi, ctx));
        return "";
      }
      return runStatus(ctx);
    },
    package: (_pi, ctx) => runPackage(ctx),
    release: (piArg, ctx) => runRelease(piArg, ctx),
    status: (_pi, ctx) => runStatus(ctx),
  };

  pi.registerCommand("sites", {
    description:
      "ChatGPT Sites workflow: init, check, package, diagnose, release desk, status, menu",
    getArgumentCompletions(prefix: string) {
      const items = SUBCOMMANDS.map((value) => ({ label: value, value }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    async handler(args, ctx) {
      const sub = parseSubcommand(args);
      try {
        await dispatchSitesCommand(pi, ctx, sub, args, runners);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`/sites ${sub ?? ""} failed: ${message}`, "error");
        emitHeadless(`/sites ${sub ?? ""} failed: ${message}`);
      } finally {
        try {
          clearSitesFooter(ctx);
        } catch {
          // footer cleanup must never break the command
        }
      }
    },
  });
}

function makeActionsFor(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext
): SitesMenuActions {
  return {
    check: () => runCheck(ctx),
    diagnose: () => runDiagnose(ctx),
    init: () => runInit("", ctx),
    package: () => runPackage(ctx),
    release: () => runRelease(pi, ctx),
    status: () => runStatus(ctx),
  };
}

/** Headless degradation: print-mode output goes to stdout. */
function emitHeadless(text: string): void {
  process.stdout.write(`${text}\n`);
}
