import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/**
 * Project-scoped extension configuration, read from `<cwd>/.pi/sites.json`.
 * Unknown keys are tolerated; malformed files fall back to defaults.
 */
export interface SitesConfig {
  bundle: { path: string | null };
  connector: { command: string[] | null };
  promotion: { enabled: boolean };
}

/** The default configuration: promotion trigger on, no connector, no bundle override. */
export function defaultSitesConfig(): SitesConfig {
  return {
    bundle: { path: null },
    connector: { command: null },
    promotion: { enabled: true },
  };
}

/**
 * Load and coerce `.pi/sites.json` for `cwd`. A missing or malformed file
 * yields the defaults; values with unexpected types are coerced back to the
 * defaults rather than crashing.
 */
export function loadSitesConfig(cwd: string): SitesConfig {
  const config = defaultSitesConfig();
  try {
    const configPath = join(cwd, CONFIG_DIR_NAME, "sites.json");
    if (!existsSync(configPath)) {
      return config;
    }
    const raw: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!isRecord(raw)) {
      return config;
    }
    const { promotion } = raw;
    if (isRecord(promotion) && typeof promotion.enabled === "boolean") {
      config.promotion.enabled = promotion.enabled;
    }
    const { connector } = raw;
    if (isRecord(connector)) {
      const { command } = connector;
      if (command === null) {
        config.connector.command = null;
      } else if (
        Array.isArray(command) &&
        command.every((value): value is string => typeof value === "string")
      ) {
        config.connector.command = command;
      }
    }
    const { bundle } = raw;
    if (isRecord(bundle)) {
      const { path: bundlePath } = bundle;
      if (bundlePath === null || typeof bundlePath === "string") {
        config.bundle.path = bundlePath;
      }
    }
    return config;
  } catch {
    return defaultSitesConfig();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
