// ---------------------------------------------------------------------------
// pi-sites — config/hosting edit unit tests (node:test + node:assert/strict)
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { applyConfigSet, parseConfigArgs } from "../src/commands.ts";

const PROMOTION_LINE_RE = /promotion\.enabled=true/;
const CONNECTOR_LINE_RE = /connector\.command=disabled/;
const BUNDLE_LINE_RE = /bundle\.path=auto/;

import {
  applyConfigPatch,
  describeConfig,
  editHostingBindings,
  editSitesConfig,
} from "../src/config-edit.ts";
import { defaultSitesConfig } from "../src/core/config.ts";

function tempDir(): string {
  const dir = join(
    "/tmp",
    `sites-config-test-${Date.now()}-${Math.floor(Math.random() * 100_000)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function withConfig(dir: string, raw: unknown): void {
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "sites.json"), `${JSON.stringify(raw)}\n`);
}

test("applyConfigPatch merges and coerces types", () => {
  const base = defaultSitesConfig();
  const next = applyConfigPatch(base, {
    connector: { command: ["codex", "exec"] },
    promotion: { enabled: false },
  });
  assert.deepEqual(next.connector.command, ["codex", "exec"]);
  assert.equal(next.promotion.enabled, false);
  // wrong types are dropped
  const dropped = applyConfigPatch(next, {
    promotion: { enabled: "yes" as unknown as boolean },
  });
  assert.equal(dropped.promotion.enabled, false);
});

test("applyConfigPatch null clears fields, empty command becomes null", () => {
  const base = defaultSitesConfig();
  const set = applyConfigPatch(base, {
    bundle: { path: "/x" },
    connector: { command: ["a"] },
  });
  const cleared = applyConfigPatch(set, {
    bundle: { path: null },
    connector: { command: [] },
  });
  assert.equal(cleared.bundle.path, null);
  assert.equal(cleared.connector.command, null);
});

test("editSitesConfig writes and round-trips through the real file", async () => {
  const dir = tempDir();
  try {
    const first = await editSitesConfig(dir, {
      bundle: { path: "/tmp/bundle-root" },
      connector: { command: ["codex", "exec", "--sandbox", "workspace-write"] },
      promotion: { enabled: false },
    });
    assert.ok(first.ok);
    assert.equal(first.config.promotion.enabled, false);
    const onDisk = JSON.parse(
      readFileSync(join(dir, ".pi", "sites.json"), "utf8")
    );
    assert.equal(onDisk.promotion.enabled, false);
    assert.deepEqual(onDisk.connector.command, [
      "codex",
      "exec",
      "--sandbox",
      "workspace-write",
    ]);
    assert.equal(onDisk.bundle.path, "/tmp/bundle-root");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("editSitesConfig preserves existing keys when patching one field", async () => {
  const dir = tempDir();
  try {
    withConfig(dir, {
      connector: { command: ["codex"] },
      promotion: { enabled: false },
    });
    const result = await editSitesConfig(dir, { promotion: { enabled: true } });
    assert.ok(result.ok);
    assert.equal(result.config.promotion.enabled, true);
    assert.deepEqual(result.config.connector.command, ["codex"]);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("editHostingBindings sets and clears d1/r2, preserving project_id", async () => {
  const dir = tempDir();
  try {
    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(
      join(dir, ".openai", "hosting.json"),
      JSON.stringify({
        d1: null,
        project_id: "0123456789abcdef0123456789abcdef",
        r2: null,
      })
    );
    const setResult = await editHostingBindings(dir, { d1: "DB" });
    assert.ok(setResult.ok);
    const afterSet = JSON.parse(
      readFileSync(join(dir, ".openai", "hosting.json"), "utf8")
    );
    assert.equal(afterSet.project_id, "0123456789abcdef0123456789abcdef");
    assert.equal(afterSet.d1, "DB");
    const clearResult = await editHostingBindings(dir, { d1: null });
    assert.ok(clearResult.ok);
    const afterClear = JSON.parse(
      readFileSync(join(dir, ".openai", "hosting.json"), "utf8")
    );
    assert.equal(afterClear.d1, null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("editHostingBindings rejects secret-like values without echoing them", async () => {
  const dir = tempDir();
  try {
    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(
      join(dir, ".openai", "hosting.json"),
      JSON.stringify({ d1: null, project_id: "abc", r2: null })
    );
    const result = await editHostingBindings(dir, {
      d1: "sk-abcdefghijklmnopqrstuvwxyz123",
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.join(" ").includes("d1"));
    // the secret value never appears in the error output
    assert.ok(!result.errors.join(" ").includes("abcdefghijklmnopqrstuvwxyz"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("describeConfig is secret-free and compact", () => {
  const config = defaultSitesConfig();
  const line = describeConfig(config);
  assert.match(line, PROMOTION_LINE_RE);
  assert.match(line, CONNECTOR_LINE_RE);
  assert.match(line, BUNDLE_LINE_RE);
});

test("parseConfigArgs parses get/set intents and rejects unknown keys", () => {
  assert.deepEqual(parseConfigArgs("get promotion.enabled"), {
    action: "get",
    key: "promotion.enabled",
    value: null,
  });
  assert.deepEqual(
    parseConfigArgs(
      "set connector.command codex exec --sandbox workspace-write"
    ),
    {
      action: "set",
      key: "connector.command",
      value: "codex exec --sandbox workspace-write",
    }
  );
  assert.equal(parseConfigArgs("get nope").action, "help");
  assert.equal(parseConfigArgs("").action, "help");
});

test("applyConfigSet edits the real config file", async () => {
  const dir = tempDir();
  try {
    const result = await applyConfigSet(dir, "promotion.enabled", "false");
    assert.equal(result.error, null);
    assert.equal(result.line, "promotion.enabled=false");
    const invalid = await applyConfigSet(dir, "promotion.enabled", "maybe");
    assert.ok(invalid.error !== null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
