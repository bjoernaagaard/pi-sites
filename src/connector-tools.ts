// ---------------------------------------------------------------------------
// pi-sites — connector tools (v0.3 pi-native pass)
//
// These tools wrap the Sites connector through `codex exec` (the officially
// documented automation path, see docs/design.md §2). They are registered
// ALWAYS so pi knows them, but kept OUT of the active tool set unless
// `.pi/sites.json` sets `connector.command` — the pi dynamic-tools pattern.
// Everything degrades to a clear message when the connector is disabled or
// the bundle/credentials are missing; no undocumented endpoint is ever used.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadSitesConfig } from "./core/config.ts";
import { isSitesProject, readHostingConfig } from "./core/hosting.ts";
import { boundText } from "./core/output.ts";
import { parseProjectId, runConnectorStep } from "./release.ts";

/** Connector-backed tools: registered always, activated only with the flag. */
export const CONNECTOR_TOOL_NAMES = [
  "sites_overview",
  "sites_provision",
] as const;

/**
 * Pure activation decision for the connector tool set: given the current
 * active tools and whether the connector is enabled, return the next active
 * set (connector tools added when enabled, removed when disabled).
 */
export function connectorToolSet(
  active: readonly string[],
  connectorEnabled: boolean
): string[] {
  const without = active.filter(
    (name) => !(CONNECTOR_TOOL_NAMES as readonly string[]).includes(name)
  );
  if (!connectorEnabled) {
    return without;
  }
  return [...new Set([...without, ...CONNECTOR_TOOL_NAMES])];
}

/**
 * Apply the dynamic-tool activation at session start: hide connector tools
 * by default, expose them only when connector.command is configured.
 */
export function applyConnectorToolActivation(
  pi: {
    getActiveTools: () => string[];
    setActiveTools: (names: string[]) => void;
  },
  config: { connector: { command: string[] | null } }
): void {
  pi.setActiveTools(
    connectorToolSet(pi.getActiveTools(), config.connector.command !== null)
  );
}

/** Register the connector-backed tools (always registered, conditionally active). */
export function registerConnectorTools(pi: ExtensionAPI): void {
  pi.registerTool({
    description:
      "Show the managed-side state of a ChatGPT Sites project: site title, " +
      "project id, access level, deployment status, environment variable names " +
      "(never values), custom domains, and recent saved versions. Runs through " +
      "codex exec with the installed Sites plugin; requires connector.command " +
      "in .pi/sites.json. " +
      "Use sites_overview when the user asks what Sites exist, what is " +
      "deployed, or wants the managed state of the current project.",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const config = loadSitesConfig(ctx.cwd);
      const dir = params.path ?? ctx.cwd;
      const result = await runConnectorStep("overview", dir, config, {});
      const lines = [result.ok ? "ok" : "failed", result.output];
      if (result.error !== null) {
        lines.push(result.error);
      }
      return {
        content: [
          {
            text: boundText(lines.filter((l) => l !== "").join("\n")),
            type: "text" as const,
          },
        ],
        details: result,
      };
    },
    label: "Sites Overview",
    name: "sites_overview",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
    }),
    promptGuidelines: [
      "Use sites_overview when the user asks what Sites exist or about the managed state of a Site.",
    ],
  });

  pi.registerTool({
    description:
      "Create the managed Site for a local ChatGPT Sites project via " +
      "create_site (codex exec + the installed Sites plugin) and persist the " +
      "returned project_id into .openai/hosting.json. Refuses when the project " +
      "already has a project_id. Requires connector.command in .pi/sites.json. " +
      "Use sites_provision when the project has no project_id yet and the user " +
      "wants to connect it to a managed Site before saving a version.",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const dir = params.path ?? ctx.cwd;
      if (!isSitesProject(dir)) {
        return {
          content: [
            {
              text: "not a Sites project: .openai/hosting.json is missing.",
              type: "text" as const,
            },
          ],
          details: { ok: false },
        };
      }
      const existing = readHostingConfig(dir);
      if (existing?.projectId !== undefined) {
        return {
          content: [
            {
              text: `already provisioned (proj ${existing.projectId.slice(0, 6)}…) — nothing to do.`,
              type: "text" as const,
            },
          ],
          details: { ok: false, projectId: existing.projectId },
        };
      }
      const config = loadSitesConfig(ctx.cwd);
      const result = await runConnectorStep("provision", dir, config, {});
      if (!result.ok) {
        return {
          content: [
            {
              text: boundText(
                [
                  "provision failed",
                  result.error ?? "connector error",
                  result.output,
                ]
                  .filter((l) => l !== "")
                  .join("\n")
              ),
              type: "text" as const,
            },
          ],
          details: result,
        };
      }
      const projectId = parseProjectId(result.output);
      if (projectId === null) {
        return {
          content: [
            {
              text: boundText(
                [
                  "connector ran but no project_id was found in its output — " +
                    "inspect the output and retry.",
                  result.output,
                ].join("\n")
              ),
              type: "text" as const,
            },
          ],
          details: { ok: false, output: result.output },
        };
      }
      const hostingPath = join(dir, ".openai", "hosting.json");
      await withFileMutationQueue(hostingPath, async () => {
        const raw: unknown = JSON.parse(await readFile(hostingPath, "utf8"));
        const next = {
          ...(typeof raw === "object" && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {}),
          project_id: projectId,
        };
        await writeFile(
          hostingPath,
          `${JSON.stringify(next, null, 2)}\n`,
          "utf8"
        );
      });
      return {
        content: [
          {
            text: `provisioned: project_id ${projectId.slice(0, 6)}… written to .openai/hosting.json (d1/r2 bindings preserved).`,
            type: "text" as const,
          },
        ],
        details: { ok: true, projectId },
      };
    },
    label: "Sites Provision",
    name: "sites_provision",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
    }),
    promptGuidelines: [
      "Use sites_provision when the project has no project_id yet and the user wants to connect it to a managed Site.",
    ],
  });
}

/** True when the connector tool set should be visible (config check). */
export function connectorEnabledFor(dir: string): boolean {
  return loadSitesConfig(dir).connector.command !== null;
}
