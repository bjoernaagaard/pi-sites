import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SitesBundle } from "./core/bundle.ts";
import { findSitesBundle } from "./core/bundle.ts";
import { loadSitesConfig } from "./core/config.ts";
import { runSitesInit } from "./core/init.ts";
import { boundText, formatBytes } from "./core/output.ts";
import { runSitesPackage } from "./core/package.ts";
import { runSitesCheck } from "./core/validate.ts";

const BUNDLE_NOT_FOUND =
  "Sites plugin bundle not found.\n" +
  "Install the Codex Sites plugin or set PI_SITES_BUNDLE to the bundle root\n" +
  "(e.g. $HOME/.codex/plugins/cache/openai-bundled/sites/<version>).";

const MAX_EVIDENCE_CHARS = 120;

function requireBundle(ctx: { cwd: string }): SitesBundle {
  const bundle = findSitesBundle(loadSitesConfig(ctx.cwd).bundle.path);
  if (bundle === null) {
    throw new Error(BUNDLE_NOT_FOUND);
  }
  return bundle;
}

function evidenceTail(evidence: string): string {
  const flattened = evidence.replace(/\s+/g, " ").trim();
  return flattened.length > MAX_EVIDENCE_CHARS
    ? `${flattened.slice(0, MAX_EVIDENCE_CHARS)}…`
    : flattened;
}

/**
 * Register the lifecycle tools: sites_init (scaffold), sites_check
 * (release-readiness checklist), and sites_package (deployment archive).
 * All tools are headless-safe (no ctx.ui) and return bounded text plus
 * machine-readable details.
 */
export function registerLifecycleTools(pi: ExtensionAPI): void {
  pi.registerTool({
    description:
      "Scaffold a new ChatGPT Sites project from the installed Sites plugin starter " +
      "(mirrors init-site.sh: refuses non-empty targets, runs npm ci). " +
      "Use sites_init when starting a new ChatGPT Sites project in an empty directory, " +
      "or when the user asks to scaffold a Site.",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const bundle = requireBundle(ctx);
      const result = await runSitesInit(params.target ?? ctx.cwd, bundle);
      const lines = [
        result.ok ? "ok" : "failed",
        `target: ${result.target}`,
        result.message,
        result.layout === null ? "" : `layout: ${result.layout.join(", ")}`,
      ].filter((line) => line !== "");
      return {
        content: [{ text: boundText(lines.join("\n")), type: "text" as const }],
        details: result,
      };
    },
    label: "Sites Init",
    name: "sites_init",
    parameters: Type.Object({
      target: Type.Optional(
        Type.String({
          description: "Target directory (default: current working directory)",
        })
      ),
    }),
    promptGuidelines: [
      "Use sites_init when scaffolding a new ChatGPT Sites project in an empty directory.",
    ],
  });

  pi.registerTool({
    description:
      "Run the release-readiness checklist for a ChatGPT Sites project: clean build, " +
      "hosting.json schema, .env.example documentation, env parity, secrets scan, worker " +
      "entry, dist artifact, and the README release checklist. " +
      "Use sites_check before saving a Site version or deploying, and after any source change.",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await runSitesCheck(params.path ?? ctx.cwd);
      const lines = [
        `${result.items.length} items: ${result.summary.pass} pass, ${result.summary.fail} fail, ${result.summary.manual} manual, ${result.summary.skip} skip`,
        ...result.items.map(
          (item) =>
            `${item.status} ${item.id} — ${item.label} [${evidenceTail(item.evidence)}]`
        ),
      ];
      return {
        content: [{ text: boundText(lines.join("\n")), type: "text" as const }],
        details: result,
      };
    },
    label: "Sites Check",
    name: "sites_check",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
    }),
    promptGuidelines: [
      "Use sites_check before saving a Site version or deploying, and after any source change.",
    ],
  });

  pi.registerTool({
    description:
      "Produce the deployment archive (tar.gz) for a validated ChatGPT Sites project via the " +
      "bundle's package-site.sh, verifying the required dist/server/index.js and " +
      "dist/.openai/hosting.json entries. " +
      "Use sites_package to produce the deployment archive for a validated Sites project " +
      "before saving a version.",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const bundle = requireBundle(ctx);
      const archive =
        params.archive ?? join(tmpdir(), `sites-package-${Date.now()}.tar.gz`);
      const result = await runSitesPackage(
        params.path ?? ctx.cwd,
        archive,
        bundle
      );
      const lines = [
        result.ok ? "ok" : "failed",
        `archive: ${result.archivePath}`,
        result.sizeBytes === null
          ? ""
          : `size: ${formatBytes(result.sizeBytes)} (${result.sizeBytes} bytes)`,
        result.entries === null ? "" : `entries: ${result.entries.length}`,
        ...result.errors,
      ].filter((line) => line !== "");
      return {
        content: [{ text: boundText(lines.join("\n")), type: "text" as const }],
        details: result,
      };
    },
    label: "Sites Package",
    name: "sites_package",
    parameters: Type.Object({
      archive: Type.Optional(
        Type.String({
          description:
            "Archive path (default: <os tmpdir>/sites-package-<timestamp>.tar.gz)",
        })
      ),
      path: Type.Optional(Type.String()),
    }),
    promptGuidelines: [
      "Use sites_package to produce the deployment archive for a validated Sites project before saving a version.",
    ],
  });
}
