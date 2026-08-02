// ---------------------------------------------------------------------------
// pi-sites — menu status unit tests (node:test + node:assert/strict)
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildMenuStatus, renderMenuStatus } from "../src/menu.ts";

const PROJECT_ID = "0123456789abcdef";
const SHA = "abcdef0123456789abcdef0123456789abcdef01";

function fakeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sites-menu-"));
  mkdirSync(join(dir, ".openai"), { recursive: true });
  writeFileSync(
    join(dir, ".openai", "hosting.json"),
    JSON.stringify({ d1: "DB", project_id: PROJECT_ID, r2: null })
  );
  mkdirSync(join(dir, "dist", "server"), { recursive: true });
  writeFileSync(join(dir, "dist", "server", "index.js"), "export {};\n");
  return dir;
}

test("buildMenuStatus reports a fake project with a truncated hosting summary", async () => {
  const dir = fakeProjectDir();
  try {
    const entries = [
      {
        customType: "sites-release",
        data: {
          archive: "dist/site.tar.gz",
          sha: SHA,
          status: "saved",
          timestamp: "2026-08-02T12:00:00.000Z",
        },
      },
    ];
    const status = await buildMenuStatus(dir, entries);
    assert.equal(status.isSitesProject, true);
    assert.equal(status.buildArtifact, true);
    assert.ok(status.hostingSummary !== null);
    assert.ok(status.hostingSummary.includes("012345"));
    assert.ok(status.hostingSummary.includes("DB"));
    assert.ok(
      !status.hostingSummary.includes(PROJECT_ID),
      status.hostingSummary
    );
    assert.ok(status.lastRelease !== null);
    assert.equal(status.lastRelease.sha, SHA);
    assert.equal(status.lastRelease.status, "saved");
    assert.equal(status.lastRelease.archive, "dist/site.tar.gz");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("buildMenuStatus redacts secret-like binding values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-menu-"));
  try {
    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(
      join(dir, ".openai", "hosting.json"),
      JSON.stringify({ d1: "sk-secret", project_id: PROJECT_ID, r2: null })
    );
    const status = await buildMenuStatus(dir, []);
    assert.equal(status.isSitesProject, true);
    assert.ok(status.hostingSummary !== null);
    assert.ok(
      status.hostingSummary.includes("redacted"),
      status.hostingSummary
    );
    assert.ok(!status.hostingSummary.includes("sk-secret"));
    assert.ok(
      !status.hostingSummary.includes(PROJECT_ID),
      status.hostingSummary
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("buildMenuStatus on a non-project dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-menu-"));
  try {
    const status = await buildMenuStatus(dir, []);
    assert.equal(status.isSitesProject, false);
    assert.equal(status.buildArtifact, false);
    assert.equal(status.hostingSummary, null);
    assert.equal(status.lastRelease, null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("renderMenuStatus returns a multi-line summary containing bundle info", async () => {
  const dir = fakeProjectDir();
  try {
    const status = await buildMenuStatus(dir, []);
    const text = renderMenuStatus(status);
    assert.ok(text.split("\n").length >= 4, text);
    assert.ok(text.includes("bundle"), text);
    assert.ok(text.includes("Hosting:"));
    assert.ok(text.includes("012345"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
