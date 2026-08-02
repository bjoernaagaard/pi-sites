// ---------------------------------------------------------------------------
// pi-sites — ChatGPT Sites tooling for Pi
//
// Assists building, validating, and releasing ChatGPT Sites projects
// (Worker-compatible Vite/Vinext apps with .openai/hosting.json, saved
// versions, private-first deploys, D1/R2, custom domains, managed env
// values). The Sites plugin bundle is proprietary: this extension invokes
// its scripts and cites its guidance but never copies its code. When the
// bundle is absent every feature degrades gracefully.
//
// Standalone: pi -ne -e ./src/index.ts
// ---------------------------------------------------------------------------

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readReleaseEntries, registerSitesCommands } from "./commands.ts";
import { findSitesBundle } from "./core/bundle.ts";
import { loadSitesConfig } from "./core/config.ts";
import { getGitState } from "./core/git.ts";
import { readHostingConfig } from "./core/hosting.ts";
import { boundText } from "./core/output.ts";
import { registerSitesEvents } from "./events.ts";
import { registerLifecycleTools } from "./tools-lifecycle.ts";

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

async function diagnoseText(ctx: ExtensionContext): Promise<string> {
  const git = await getGitState(ctx.cwd);
  const gitLine = git.hasRepo
    ? `git: ${git.branch ?? "?"} @ ${git.headSha ?? "no commit"}${git.dirty ? " (dirty)" : ""}`
    : `git: ${git.error ?? "not a git repository"}`;
  const hosting = readHostingConfig(ctx.cwd);
  const hostingLineText =
    hosting === null
      ? "hosting.json: missing or unparseable (not a Sites project?)"
      : `hosting.json: ${hostingLine(hosting.projectId, hosting.d1, hosting.r2)}`;
  const bundle = findSitesBundle(loadSitesConfig(ctx.cwd).bundle.path);
  const bundleText =
    bundle === null
      ? "bundle: missing"
      : `bundle: ${bundle.version} at ${bundle.path}`;
  const releases = readReleaseEntries(ctx);
  const releaseText =
    releases.length === 0
      ? "release log: no entries"
      : `release log: ${releases.length} entr${releases.length === 1 ? "y" : "ies"}, latest ${releases.at(-1)?.sha.slice(0, 8)} @ ${releases.at(-1)?.timestamp}`;
  return boundText(
    [
      "pi-sites diagnosis",
      gitLine,
      hostingLineText,
      bundleText,
      releaseText,
    ].join("\n")
  );
}

export default function piSites(pi: ExtensionAPI): void {
  // WS2 — local lifecycle tools (init / check / package).
  registerLifecycleTools(pi);

  // WS3 — diagnosis tool (local facts for pairing with Worker-log inspection).
  pi.registerTool({
    description:
      "Gather local diagnosis facts for a ChatGPT Sites project: git state, " +
      "hosting.json summary, bundle version, and the persisted release log. " +
      "Pair the output with Worker-log inspection in the Sites control plane. " +
      "Use sites_diagnose when investigating a broken or failing Site " +
      "deployment, or before contacting support.",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const text = await diagnoseText(ctx);
      const bundle = findSitesBundle(loadSitesConfig(ctx.cwd).bundle.path);
      return {
        content: [{ text, type: "text" as const }],
        details: {
          bundleVersion: bundle === null ? null : bundle.version,
        },
      };
    },
    label: "Sites Diagnose",
    name: "sites_diagnose",
    parameters: Type.Object({}),
    promptGuidelines: [
      "Use sites_diagnose when investigating a broken or failing Site deployment.",
    ],
  });

  // WS3 — release desk + WS4 — menu/status commands.
  registerSitesCommands(pi);

  // WS4 — runtime trigger (before_agent_start) + footer status.
  registerSitesEvents(pi);
}
