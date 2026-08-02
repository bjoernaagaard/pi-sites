import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The managed control-plane link recorded in `.openai/hosting.json`.
 * Contains only the managed project id and logical D1/R2 bindings — never
 * secrets, env values, or customer data.
 */
export interface HostingConfig {
  d1?: string | null;
  projectId?: string;
  r2?: string | null;
}

const ALLOWED_KEYS = ["project_id", "d1", "r2"] as const;

/** Conservative secret markers; hosting.json must never contain values like these. */
const SECRET_MARKERS = [
  "sk-",
  "AKIA",
  "-----BEGIN",
  "ghp_",
  "password=",
  "token=",
];

/** True when `<dir>/.openai/hosting.json` exists. */
export function isSitesProject(dir: string): boolean {
  return existsSync(join(dir, ".openai", "hosting.json"));
}

/**
 * Read and validate `<dir>/.openai/hosting.json`. Returns null when the file
 * is missing, unparseable, or fails schema validation.
 */
export function readHostingConfig(dir: string): HostingConfig | null {
  try {
    const text = readFileSync(join(dir, ".openai", "hosting.json"), "utf8");
    const raw: unknown = JSON.parse(text);
    const result = validateHostingConfig(raw);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * Validate a parsed hosting.json value.
 *
 * - must be a JSON object;
 * - allowed keys are exactly `project_id`, `d1`, `r2`;
 * - `project_id` is a non-empty string when present; `d1`/`r2` are strings or
 *   null when present;
 * - secret-like values are rejected with an error naming the key but never
 *   echoing the value.
 */
export function validateHostingConfig(
  raw: unknown
): { ok: true; value: HostingConfig } | { ok: false; errors: string[] } {
  if (!isRecord(raw)) {
    return { errors: ["hosting.json must be a JSON object"], ok: false };
  }
  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key as (typeof ALLOWED_KEYS)[number])) {
      errors.push(
        `unknown key "${key}" in hosting.json (allowed keys: project_id, d1, r2)`
      );
    }
  }
  const value: HostingConfig = {};
  applyProjectId(raw, errors, value);
  applyNullableBinding(raw, errors, value, "d1");
  applyNullableBinding(raw, errors, value, "r2");
  if (errors.length > 0) {
    return { errors, ok: false };
  }
  return { ok: true, value };
}

function applyProjectId(
  raw: Record<string, unknown>,
  errors: string[],
  value: HostingConfig
): void {
  if (!("project_id" in raw)) {
    return;
  }
  const rawValue = raw.project_id;
  if (
    rawValue === null ||
    typeof rawValue !== "string" ||
    rawValue.trim() === ""
  ) {
    errors.push("project_id must be a non-empty string when present");
    return;
  }
  if (hasSecretMarker(rawValue)) {
    errors.push(
      "project_id must not contain secret-like values (hosting.json holds logical bindings only, never secrets)"
    );
    return;
  }
  value.projectId = rawValue;
}

function applyNullableBinding(
  raw: Record<string, unknown>,
  errors: string[],
  value: HostingConfig,
  key: "d1" | "r2"
): void {
  if (!(key in raw)) {
    return;
  }
  const rawValue = raw[key];
  if (rawValue === null) {
    if (key === "d1") {
      value.d1 = null;
    } else {
      value.r2 = null;
    }
    return;
  }
  if (typeof rawValue !== "string") {
    errors.push(`${key} must be a string or null when present`);
    return;
  }
  if (hasSecretMarker(rawValue)) {
    errors.push(
      `${key} must not contain secret-like values (hosting.json holds logical bindings only, never secrets)`
    );
    return;
  }
  if (key === "d1") {
    value.d1 = rawValue;
  } else {
    value.r2 = rawValue;
  }
}

function hasSecretMarker(value: string): boolean {
  return SECRET_MARKERS.some((marker) => value.includes(marker));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
