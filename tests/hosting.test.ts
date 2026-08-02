import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isSitesProject,
  readHostingConfig,
  validateHostingConfig,
} from "../src/core/hosting.ts";

test("validates a full hosting.json", () => {
  const result = validateHostingConfig({
    d1: "DB",
    project_id: "proj_abc",
    r2: null,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.projectId, "proj_abc");
    assert.equal(result.value.d1, "DB");
    assert.equal(result.value.r2, null);
  }
});

test("validates a config with only d1/r2 bindings", () => {
  const result = validateHostingConfig({ d1: "DB", r2: null });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.projectId, undefined);
    assert.equal(result.value.d1, "DB");
    assert.equal(result.value.r2, null);
  }
});

test("rejects an empty project_id", () => {
  const result = validateHostingConfig({ project_id: "   " });
  assert.equal(result.ok, false);
});

test("rejects unknown keys", () => {
  const result = validateHostingConfig({
    api_key: "sk-123",
    project_id: "proj",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes("api_key")));
  }
});

test("rejects secret-like values without echoing them", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz123";
  const result = validateHostingConfig({ d1: secret });
  assert.equal(result.ok, false);
  if (!result.ok) {
    const error = result.errors.join(" ");
    assert.ok(error.includes("d1"), "error names the key");
    assert.ok(!error.includes(secret), "error never echoes the value");
  }
});

test("rejects secret-like project_id", () => {
  const result = validateHostingConfig({
    project_id: "ghp_0123456789abcdefghijklmnop",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes("project_id")));
  }
});

test("rejects non-objects", () => {
  assert.equal(validateHostingConfig(null).ok, false);
  assert.equal(validateHostingConfig("nope").ok, false);
  assert.equal(validateHostingConfig([1, 2]).ok, false);
  assert.equal(validateHostingConfig(42).ok, false);
});

test("rejects wrong-typed d1/r2", () => {
  assert.equal(validateHostingConfig({ d1: 42 }).ok, false);
  assert.equal(validateHostingConfig({ r2: ["x"] }).ok, false);
});

test("isSitesProject detects hosting.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-hosting-"));
  try {
    assert.equal(isSitesProject(dir), false);
    mkdirSync(join(dir, ".openai"), { recursive: true });
    assert.equal(isSitesProject(dir), false);
    writeFileSync(join(dir, ".openai", "hosting.json"), "{}");
    assert.equal(isSitesProject(dir), true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("readHostingConfig parses a valid file", () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-hosting-"));
  try {
    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(
      join(dir, ".openai", "hosting.json"),
      JSON.stringify({ d1: null, project_id: "proj", r2: null })
    );
    const config = readHostingConfig(dir);
    assert.deepEqual(config, { d1: null, projectId: "proj", r2: null });
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("readHostingConfig returns null when missing or unparseable", () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-hosting-"));
  try {
    assert.equal(readHostingConfig(dir), null);
    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(join(dir, ".openai", "hosting.json"), "{not json");
    assert.equal(readHostingConfig(dir), null);
    writeFileSync(
      join(dir, ".openai", "hosting.json"),
      JSON.stringify({ bogus: 1 })
    );
    assert.equal(readHostingConfig(dir), null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
