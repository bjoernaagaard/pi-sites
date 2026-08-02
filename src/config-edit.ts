// ---------------------------------------------------------------------------
// pi-sites — editable state (config + hosting bindings + release-log notes)
//
// Pure merge/validate helpers plus file writes through pi's mutation queue.
// Everything the TUI menu can "change or edit" goes through this module, so
// headless editing (e.g. /sites config set ...) and the TUI share one path.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { loadSitesConfig, type SitesConfig } from "./core/config.ts";
import { validateHostingConfig } from "./core/hosting.ts";

const HOSTING_REL = join(".openai", "hosting.json");

/** Partial config patch accepted by the edit path (coerced, never trusted). */
export interface ConfigPatch {
  bundle?: { path?: string | null };
  connector?: { command?: string[] | null };
  promotion?: { enabled?: boolean };
}

export interface EditConfigResult {
  config: SitesConfig;
  error: string | null;
  ok: boolean;
}

function coerceString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Merge a patch into a config with type coercion: wrong types are dropped
 * (kept as the existing value), `null` explicitly clears a field.
 */
export function applyConfigPatch(
  config: SitesConfig,
  patch: ConfigPatch
): SitesConfig {
  const next: SitesConfig = {
    bundle: { ...config.bundle },
    connector: { ...config.connector },
    promotion: { ...config.promotion },
  };
  const promotionEnabled = patch.promotion?.enabled;
  if (typeof promotionEnabled === "boolean") {
    next.promotion.enabled = promotionEnabled;
  }
  const command = patch.connector?.command;
  if (command === null) {
    next.connector.command = null;
  } else if (Array.isArray(command)) {
    next.connector.command = command.filter(
      (part): part is string => typeof part === "string" && part !== ""
    );
    if (next.connector.command.length === 0) {
      next.connector.command = null;
    }
  }
  const bundlePath = coerceString(patch.bundle?.path);
  if (bundlePath !== undefined) {
    next.bundle.path = bundlePath === "" ? null : bundlePath;
  }
  return next;
}

/** Parse the raw config file (or null when missing/unreadable). */
async function readConfigRaw(dir: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, ".pi", "sites.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Edit `.pi/sites.json` (creating it when absent) with a validated patch.
 * All writes go through withFileMutationQueue so they participate in pi's
 * per-file mutation queue.
 */
export async function editSitesConfig(
  dir: string,
  patch: ConfigPatch
): Promise<EditConfigResult> {
  const configPath = join(dir, ".pi", "sites.json");
  const result: EditConfigResult = {
    config: loadSitesConfig(dir),
    error: null,
    ok: true,
  };
  try {
    const raw = await readConfigRaw(dir);
    const rawRecord = asRecord(raw);
    const bundleRecord = asRecord(rawRecord.bundle);
    const connectorRecord = asRecord(rawRecord.connector);
    const promotionRecord = asRecord(rawRecord.promotion);
    const rawCommand = connectorRecord.command;
    const base: SitesConfig = {
      bundle: {
        path: typeof bundleRecord.path === "string" ? bundleRecord.path : null,
      },
      connector: {
        command: Array.isArray(rawCommand)
          ? rawCommand.filter(
              (part: unknown): part is string =>
                typeof part === "string" && part !== ""
            )
          : null,
      },
      promotion: {
        enabled:
          typeof promotionRecord.enabled === "boolean"
            ? promotionRecord.enabled
            : true,
      },
    };
    const next = applyConfigPatch(base, patch);
    await withFileMutationQueue(configPath, async () => {
      await mkdir(join(dir, ".pi"), { recursive: true });
      await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    });
    result.config = next;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.ok = false;
    return result;
  }
}

export interface HostingBindingsPatch {
  d1?: string | null;
  r2?: string | null;
}

export interface EditBindingsResult {
  errors: string[];
  ok: boolean;
}

/**
 * Edit the logical d1/r2 bindings in `.openai/hosting.json`, preserving
 * project_id and validating through the strict hosting schema (unknown keys
 * and secret-like values are rejected — the value is never echoed).
 */
export async function editHostingBindings(
  dir: string,
  patch: HostingBindingsPatch
): Promise<EditBindingsResult> {
  const hostingPath = join(dir, HOSTING_REL);
  try {
    const raw: unknown = JSON.parse(await readFile(hostingPath, "utf8"));
    const validated = validateHostingConfig(raw);
    if (!validated.ok) {
      return { errors: validated.errors, ok: false };
    }
    const next = {
      ...(validated.value.projectId === undefined
        ? {}
        : { project_id: validated.value.projectId }),
      d1: patch.d1 === undefined ? (validated.value.d1 ?? null) : patch.d1,
      r2: patch.r2 === undefined ? (validated.value.r2 ?? null) : patch.r2,
    };
    const revalidated = validateHostingConfig(next);
    if (!revalidated.ok) {
      return { errors: revalidated.errors, ok: false };
    }
    await withFileMutationQueue(hostingPath, async () => {
      await writeFile(
        hostingPath,
        `${JSON.stringify(next, null, 2)}\n`,
        "utf8"
      );
    });
    return { errors: [], ok: true };
  } catch (error) {
    return {
      errors: [
        `cannot edit hosting.json: ${error instanceof Error ? error.message : String(error)}`,
      ],
      ok: false,
    };
  }
}

/** One-line config summary for the menu status pane (secret-free). */
export function describeConfig(config: SitesConfig): string {
  const command =
    config.connector.command === null
      ? "disabled"
      : config.connector.command.join(" ");
  return [
    `promotion.enabled=${config.promotion.enabled}`,
    `connector.command=${command}`,
    `bundle.path=${config.bundle.path ?? "auto"}`,
  ].join(" · ");
}
