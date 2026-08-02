import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * A resolved Sites plugin bundle (the officially distributed Codex Sites
 * plugin with its init/package scripts).
 */
export interface SitesBundle {
  /** Absolute path to scripts/init-site.sh. */
  initScript: string;
  /** Absolute path to scripts/package-site.sh. */
  packageScript: string;
  /** Absolute path to the bundle root. */
  path: string;
  /** Bundle version, e.g. "0.1.33". "0.0.0-local" when undeterminable. */
  version: string;
}

const INIT_SCRIPT = "scripts/init-site.sh";
const PACKAGE_SCRIPT = "scripts/package-site.sh";

const VERSION_RE = /^\d+(\.\d+)+([-+][0-9A-Za-z.-]+)?$/;

/**
 * Locate the installed Sites plugin bundle.
 *
 * - `PI_SITES_BUNDLE` env var overrides discovery (must contain both
 *   scripts; version derived from the dirname, "0.0.0-local" otherwise).
 * - Otherwise scan the Sites bundle cache directory under
 *   $HOME/.codex/plugins/cache/openai-bundled/sites and pick the highest
 *   numeric version whose scripts exist.
 *
 * Never throws; returns null when no usable bundle is found.
 */
export function findSitesBundle(
  overridePath?: string | null
): SitesBundle | null {
  try {
    if (
      overridePath !== undefined &&
      overridePath !== null &&
      overridePath !== ""
    ) {
      return bundleAt(overridePath);
    }
    const override = process.env.PI_SITES_BUNDLE;
    if (override !== undefined && override !== "") {
      return bundleAt(override);
    }
    const sitesRoot = join(
      homedir(),
      ".codex",
      "plugins",
      "cache",
      "openai-bundled",
      "sites"
    );
    if (!existsSync(sitesRoot)) {
      return null;
    }
    const candidates = readdirSync(sitesRoot)
      .filter((entry) => isVersionDir(entry))
      .sort(compareVersions)
      .reverse();
    for (const candidate of candidates) {
      const bundle = bundleAt(join(sitesRoot, candidate));
      if (bundle !== null) {
        return bundle;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function bundleAt(root: string): SitesBundle | null {
  if (
    !(
      existsSync(join(root, INIT_SCRIPT)) &&
      existsSync(join(root, PACKAGE_SCRIPT))
    )
  ) {
    return null;
  }
  const dirname = basename(root);
  return {
    initScript: join(root, INIT_SCRIPT),
    packageScript: join(root, PACKAGE_SCRIPT),
    path: root,
    version: isVersionDir(dirname) ? dirname : "0.0.0-local",
  };
}

function isVersionDir(dirname: string): boolean {
  return VERSION_RE.test(dirname);
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map((part) => Number(part));
  const bParts = b.split(".").map((part) => Number(part));
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }
  return 0;
}
