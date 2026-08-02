// ---------------------------------------------------------------------------
// pi-sites — /sites menu (TUI select-loop) and status building
//
// buildMenuStatus/renderMenuStatus produce a secret-free, bounded status
// summary over local workspace facts and session release entries.
// openSitesMenu is a pi-seek style select loop: label → action mapping,
// live status in the footer while open, working status during actions
// cleared in finally, and errors notified and swallowed so the menu keeps
// running. Headless sessions degrade to a printed status summary.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findSitesBundle } from "./core/bundle.ts";
import { isSitesProject, readHostingConfig } from "./core/hosting.ts";
import { lastLines } from "./core/output.ts";

/** Actions offered by the Sites menu (each returns bounded text). */
export interface SitesMenuActions {
  check: () => Promise<string>;
  diagnose: () => Promise<string>;
  init: () => Promise<string>;
  package: () => Promise<string>;
  release: () => Promise<string>;
  status: () => Promise<string>;
}

/** Local workspace facts backing the menu status summary. */
export interface SitesMenuStatus {
  buildArtifact: boolean;
  bundleVersion: string | null;
  /** Reserved slot for the latest sites_check summary; null until wired. */
  checkSummary: string | null;
  hostingSummary: string | null;
  isSitesProject: boolean;
  lastRelease: {
    sha: string;
    archive: string;
    timestamp: string;
    status: string;
  } | null;
}

const RELEASE_ENTRY_TYPE = "sites-release";
const PROJECT_ID_PREFIX_CHARS = 6;

/**
 * Conservative secret markers for status rendering. hosting.json must never
 * hold such values, but the summary redacts them instead of echoing them.
 * Mirrors the markers used by src/core/hosting.ts (not exported there).
 */
const SECRET_MARKERS = [
  "-----BEGIN",
  "AKIA",
  "ghp_",
  "password=",
  "sk-",
  "token=",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksSecretLike(value: string): boolean {
  return SECRET_MARKERS.some((marker) => value.includes(marker));
}

function renderBinding(key: string, value: string | null): string {
  if (value === null) {
    return `${key}=null`;
  }
  return `${key}=${looksSecretLike(value) ? "<redacted>" : value}`;
}

/**
 * Render a secret-free hosting summary: `proj 012345… · d1=DB · r2=null`
 * (or "no project_id"). Only the first 6 characters of the project id are
 * ever shown; secret-like binding values are redacted.
 */
function renderHostingSummary(hosting: {
  d1?: string | null;
  projectId?: string;
  r2?: string | null;
}): string {
  const parts: string[] = [];
  const { projectId } = hosting;
  if (projectId === undefined || projectId === "") {
    parts.push("no project_id");
  } else if (looksSecretLike(projectId)) {
    parts.push("proj <redacted>");
  } else {
    parts.push(`proj ${projectId.slice(0, PROJECT_ID_PREFIX_CHARS)}…`);
  }
  for (const key of ["d1", "r2"] as const) {
    const value = hosting[key];
    if (value === undefined) {
      continue;
    }
    parts.push(renderBinding(key, value));
  }
  return parts.join(" · ");
}

/**
 * Lenient hosting.json read for status rendering. The strict core validator
 * rejects secret-like values (returning null); this fallback parses the
 * known keys defensively so the summary can redact them instead of dropping
 * them. Never throws; null when the file is missing or not a JSON object.
 */
function readHostingLenient(dir: string): {
  d1?: string | null;
  projectId?: string;
  r2?: string | null;
} | null {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(dir, ".openai", "hosting.json"), "utf8")
    );
    if (!isRecord(raw)) {
      return null;
    }
    const hosting: {
      d1?: string | null;
      projectId?: string;
      r2?: string | null;
    } = {};
    if (typeof raw.project_id === "string" && raw.project_id.trim() !== "") {
      hosting.projectId = raw.project_id;
    }
    for (const key of ["d1", "r2"] as const) {
      const value = raw[key];
      if (value === null) {
        hosting[key] = null;
      } else if (typeof value === "string") {
        hosting[key] = value;
      }
    }
    return hosting;
  } catch {
    return null;
  }
}

function hostingSummaryFor(dir: string): string | null {
  const strict = readHostingConfig(dir);
  if (strict !== null) {
    return renderHostingSummary(strict);
  }
  const lenient = readHostingLenient(dir);
  if (lenient === null) {
    return null;
  }
  return renderHostingSummary(lenient);
}

interface ReleaseEntryData {
  archive: string;
  sha: string;
  status: string;
  timestamp: string;
}

function parseReleaseData(value: unknown): ReleaseEntryData | null {
  if (!isRecord(value)) {
    return null;
  }
  const { archive, sha, status, timestamp } = value;
  if (
    typeof archive !== "string" ||
    typeof sha !== "string" ||
    typeof status !== "string" ||
    typeof timestamp !== "string"
  ) {
    return null;
  }
  return { archive, sha, status, timestamp };
}

/**
 * The newest `sites-release` entry: the one with the latest data timestamp,
 * falling back to array order when timestamps are missing or unparseable.
 */
function findLastRelease(
  entries: ReadonlyArray<{ customType?: string; data?: unknown }>
): ReleaseEntryData | null {
  let latest: ReleaseEntryData | null = null;
  for (const entry of entries) {
    if (entry.customType !== RELEASE_ENTRY_TYPE) {
      continue;
    }
    const data = parseReleaseData(entry.data);
    if (data === null) {
      continue;
    }
    if (latest === null) {
      latest = data;
      continue;
    }
    const dataTime = Date.parse(data.timestamp);
    const latestTime = Date.parse(latest.timestamp);
    if (Number.isNaN(dataTime) && Number.isNaN(latestTime)) {
      latest = data;
      continue;
    }
    if (Number.isNaN(latestTime) || dataTime >= latestTime) {
      latest = data;
    }
  }
  return latest;
}

/**
 * Build the menu status for `dir` from local workspace facts and the session
 * release entries (the newest `sites-release` entry wins).
 */
// biome-ignore lint/suspicious/useAwait: async per the WS4 contract; all work is synchronous today.
export async function buildMenuStatus(
  dir: string,
  releaseEntries: ReadonlyArray<{ customType?: string; data?: unknown }>
): Promise<SitesMenuStatus> {
  const bundle = findSitesBundle();
  return {
    buildArtifact: existsSync(join(dir, "dist", "server", "index.js")),
    bundleVersion: bundle === null ? null : bundle.version,
    checkSummary: null,
    hostingSummary: hostingSummaryFor(dir),
    isSitesProject: isSitesProject(dir),
    lastRelease: findLastRelease(releaseEntries),
  };
}

/** Multi-line human-readable status summary (print/notify friendly). */
export function renderMenuStatus(s: SitesMenuStatus): string {
  const lines = [
    `Sites project: ${s.isSitesProject ? "yes" : "no"}`,
    `bundle: ${s.bundleVersion ?? "missing"}`,
    `Hosting: ${s.hostingSummary ?? "none"}`,
    `Build artifact: ${s.buildArtifact ? "present" : "missing"} (dist/server/index.js)`,
  ];
  const { lastRelease } = s;
  if (lastRelease === null) {
    lines.push("Last release: none");
  } else {
    lines.push(
      `Last release: ${lastRelease.sha.slice(0, 7)} ${lastRelease.status} ${lastRelease.timestamp} [${lastRelease.archive}]`
    );
  }
  if (s.checkSummary !== null) {
    lines.push(`Check: ${s.checkSummary}`);
  }
  return lines.join("\n");
}

/** UI surface used by the Sites menu (structural subset of ExtensionContext). */
interface SitesMenuContext {
  cwd: string;
  hasUI: boolean;
  ui: {
    notify: (message: string, level: "info" | "warning" | "error") => void;
    select: (title: string, options: string[]) => Promise<string | undefined>;
    setStatus: (key: string, text: string | undefined) => void;
  };
}

const MENU_OPTIONS = [
  "Status",
  "Init",
  "Check",
  "Package",
  "Diagnose",
  "Release desk",
  "Close",
] as const;

const FOOTER_KEY = "sites";
const MAX_STATUS_CHARS = 2000;
const MAX_NOTIFY_CHARS = 500;
const NOTIFY_TAIL_LINES = 5;

function capText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notifyTail(text: string): string {
  return capText(lastLines(text, NOTIFY_TAIL_LINES), MAX_NOTIFY_CHARS);
}

function menuAction(
  actions: SitesMenuActions,
  label: string
): (() => Promise<string>) | null {
  switch (label) {
    case "Status":
      return () => actions.status();
    case "Init":
      return () => actions.init();
    case "Check":
      return () => actions.check();
    case "Package":
      return () => actions.package();
    case "Diagnose":
      return () => actions.diagnose();
    case "Release desk":
      return () => actions.release();
    default:
      return null;
  }
}

/** One menu loop iteration; returns "close" when the menu should exit. */
async function runMenuStep(
  ctx: SitesMenuContext,
  actions: SitesMenuActions
): Promise<"close" | "continue"> {
  const status = await actions.status();
  ctx.ui.setStatus(FOOTER_KEY, capText(status, MAX_STATUS_CHARS));
  let choice: string | undefined;
  try {
    choice = await ctx.ui.select("Sites menu", [...MENU_OPTIONS]);
  } catch (error) {
    ctx.ui.notify(`Sites menu error: ${errorMessage(error)}`, "error");
    return "close";
  }
  if (choice === undefined || choice === "Close") {
    return "close";
  }
  const run = menuAction(actions, choice);
  if (run === null) {
    return "continue";
  }
  ctx.ui.setStatus(FOOTER_KEY, `sites: running ${choice.toLowerCase()}…`);
  try {
    const result = await run();
    ctx.ui.notify(notifyTail(result), "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error), "error");
  } finally {
    ctx.ui.setStatus(FOOTER_KEY, undefined);
  }
  return "continue";
}

/**
 * Open the Sites menu.
 *
 * Headless (no UI): degraded to the status action text, bounded to
 * MAX_STATUS_CHARS. With UI: a select loop over the menu options; the live
 * status is shown in the footer, each action runs with a working footer
 * status, its result tail is notified, and errors are notified and swallowed
 * so the menu keeps running. Returns null when the menu is closed.
 */
export async function openSitesMenu(
  ctx: SitesMenuContext,
  actions: SitesMenuActions
): Promise<string | null> {
  if (!ctx.hasUI) {
    return capText(await actions.status(), MAX_STATUS_CHARS);
  }
  let step: "close" | "continue" = "continue";
  while (step !== "close") {
    // biome-ignore lint/performance/noAwaitInLoops: menu steps run in user-selected order
    step = await runMenuStep(ctx, actions);
  }
  ctx.ui.setStatus(FOOTER_KEY, undefined);
  return null;
}
