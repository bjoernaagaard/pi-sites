// ---------------------------------------------------------------------------
// pi-sites — runtime promotion events (before_agent_start guidance + footer)
//
// The promotion trigger injects a short, bounded guidance message when the
// workspace is a Sites project and the plugin bundle is installed. The
// footer status line mirrors the same facts in a compact, secret-free form.
// Every handler degrades silently: a promotion failure must never break an
// agent turn.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findSitesBundle } from "./core/bundle.ts";
import { loadSitesConfig } from "./core/config.ts";
import { isSitesProject, readHostingConfig } from "./core/hosting.ts";

/** Custom message type used for the before_agent_start Sites guidance. */
export const SITES_CONTEXT_TYPE = "sites-context";

const FOOTER_KEY = "sites";
const PROJECT_ID_PREFIX_CHARS = 6;

/**
 * Build the bounded promotion guidance for a Sites workspace.
 *
 * PURE: performs no I/O beyond the caller-provided facts. Returns null when
 * the promotion is disabled, the directory is not a Sites project, or the
 * plugin bundle is missing — the trigger must no-op without the bundle. The
 * returned text is short (≤ 900 chars) and never mentions secrets or
 * credentials.
 */
export function buildSitesGuidance(
  dir: string,
  bundleFound: boolean,
  enabled: boolean
): string | null {
  if (!(enabled && bundleFound && isSitesProject(dir))) {
    return null;
  }
  const lines = [
    "This workspace is a ChatGPT Sites project (.openai/hosting.json present).",
    "- Use sites_check before saving a version or deploying.",
    "- Use sites_package to produce the deployment archive.",
    "- Use the /sites release desk for the private-first release flow.",
  ];
  return lines.join("\n");
}

/**
 * Clear the Sites footer status line.
 *
 * Exported for the session_shutdown handler and for any caller that must
 * remove the footer (e.g. when promotion is disabled).
 */
export function clearSitesFooter(ctx: {
  ui: { setStatus: (key: string, text: string | undefined) => void };
}): void {
  ctx.ui.setStatus(FOOTER_KEY, undefined);
}

/** Refresh the compact Sites footer for a workspace. Never throws. */
function refreshFooter(ctx: {
  cwd: string;
  ui: { setStatus: (key: string, text: string | undefined) => void };
}): void {
  try {
    const config = loadSitesConfig(ctx.cwd);
    if (!config.promotion.enabled) {
      clearSitesFooter(ctx);
      return;
    }
    if (!isSitesProject(ctx.cwd)) {
      clearSitesFooter(ctx);
      return;
    }
    const bundle = findSitesBundle(loadSitesConfig(ctx.cwd).bundle.path);
    const hosting = readHostingConfig(ctx.cwd);
    const text =
      `sites ${bundle === null ? "bundle missing" : `bundle ${bundle.version}`}` +
      (hosting?.projectId === undefined
        ? " · no project_id"
        : ` · proj ${hosting.projectId.slice(0, PROJECT_ID_PREFIX_CHARS)}…`);
    ctx.ui.setStatus(FOOTER_KEY, text);
  } catch {
    clearSitesFooter(ctx);
  }
}

/**
 * Register the Sites runtime promotion events:
 *
 * - `before_agent_start`: inject bounded guidance when the workspace is a
 *   Sites project with the bundle installed and promotion enabled.
 * - `session_start`: refresh the footer status line.
 * - `session_shutdown`: clear the footer status line.
 *
 * Handlers never throw: any failure degrades to `undefined` or a cleared
 * footer so an agent turn is never broken by promotion logic.
 */
export function registerSitesEvents(pi: ExtensionAPI): void {
  // biome-ignore lint/suspicious/useAwait: handler is async per the WS4 contract; all work is synchronous today.
  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      const config = loadSitesConfig(ctx.cwd);
      const bundle = findSitesBundle(config.bundle.path);
      const guidance = buildSitesGuidance(
        ctx.cwd,
        bundle !== null,
        config.promotion.enabled
      );
      if (guidance === null) {
        return;
      }
      return {
        message: {
          content: guidance,
          customType: SITES_CONTEXT_TYPE,
          details: {
            bundleVersion: bundle === null ? null : bundle.version,
          },
          display: true,
        },
      };
    } catch {
      // Guidance is best-effort: never break the agent turn.
    }
  });

  pi.on("session_start", (_event, ctx) => {
    refreshFooter(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearSitesFooter(ctx);
  });
}
