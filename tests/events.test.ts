// ---------------------------------------------------------------------------
// pi-sites — promotion guidance unit tests (node:test + node:assert/strict)
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSitesGuidance } from "../src/events.ts";

const GUIDANCE_LIMIT = 900;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sites-events-"));
}

function writeHostingJson(dir: string): void {
  mkdirSync(join(dir, ".openai"), { recursive: true });
  writeFileSync(
    join(dir, ".openai", "hosting.json"),
    JSON.stringify({ d1: null, project_id: "proj_1", r2: null })
  );
}

test("buildSitesGuidance returns null when promotion is disabled", () => {
  const dir = tempDir();
  try {
    writeHostingJson(dir);
    assert.equal(buildSitesGuidance(dir, true, false), null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("buildSitesGuidance returns null when not a sites project", () => {
  const dir = tempDir();
  try {
    assert.equal(buildSitesGuidance(dir, true, true), null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("buildSitesGuidance returns null when the bundle is missing", () => {
  const dir = tempDir();
  try {
    writeHostingJson(dir);
    assert.equal(buildSitesGuidance(dir, false, true), null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("buildSitesGuidance returns bounded guidance mentioning sites_check", () => {
  const dir = tempDir();
  try {
    writeHostingJson(dir);
    const guidance = buildSitesGuidance(dir, true, true);
    assert.ok(guidance !== null);
    assert.ok(guidance.length <= GUIDANCE_LIMIT, `length ${guidance.length}`);
    assert.ok(guidance.includes("sites_check"));
    assert.ok(guidance.includes("sites_package"));
    assert.ok(guidance.includes("/sites"));
    assert.ok(guidance.includes("private-first"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
