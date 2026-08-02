import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSitesConfig, loadSitesConfig } from "../src/core/config.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "sites-config-"));
}

function writeConfig(dir: string, value: unknown): void {
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "sites.json"), JSON.stringify(value));
}

test("missing config file returns defaults", () => {
  const dir = tempDir();
  try {
    assert.deepEqual(loadSitesConfig(dir), defaultSitesConfig());
    assert.equal(loadSitesConfig(dir).promotion.enabled, true);
    assert.equal(loadSitesConfig(dir).connector.command, null);
    assert.equal(loadSitesConfig(dir).bundle.path, null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("malformed JSON returns defaults", () => {
  const dir = tempDir();
  try {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    writeFileSync(join(dir, ".pi", "sites.json"), "{oops not json");
    assert.deepEqual(loadSitesConfig(dir), defaultSitesConfig());
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("valid overrides are merged onto defaults", () => {
  const dir = tempDir();
  try {
    writeConfig(dir, {
      bundle: { path: "/tmp/bundle-root" },
      connector: { command: ["codex", "exec", "--sandbox", "workspace-write"] },
      promotion: { enabled: false },
    });
    const config = loadSitesConfig(dir);
    assert.equal(config.promotion.enabled, false);
    assert.deepEqual(config.connector.command, [
      "codex",
      "exec",
      "--sandbox",
      "workspace-write",
    ]);
    assert.equal(config.bundle.path, "/tmp/bundle-root");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("wrong types are coerced to defaults", () => {
  const dir = tempDir();
  try {
    writeConfig(dir, {
      bundle: { path: 42 },
      connector: { command: "codex" },
      promotion: { enabled: "yes" },
    });
    const config = loadSitesConfig(dir);
    assert.deepEqual(config, defaultSitesConfig());
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("non-string array command is coerced to null", () => {
  const dir = tempDir();
  try {
    writeConfig(dir, { connector: { command: ["codex", 7] } });
    assert.equal(loadSitesConfig(dir).connector.command, null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("unknown keys are tolerated", () => {
  const dir = tempDir();
  try {
    writeConfig(dir, {
      mystery: { deep: true },
      promotion: { enabled: false },
    });
    const config = loadSitesConfig(dir);
    assert.equal(config.promotion.enabled, false);
    assert.equal(config.connector.command, null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("config in a subdirectory is not read from the parent", () => {
  const dir = tempDir();
  try {
    writeConfig(dir, { promotion: { enabled: false } });
    const sub = join(dir, "nested");
    mkdirSync(sub, { recursive: true });
    assert.equal(loadSitesConfig(sub).promotion.enabled, true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
