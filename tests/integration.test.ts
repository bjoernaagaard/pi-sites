import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findSitesBundle } from "../src/core/bundle.ts";
import { runSitesInit } from "../src/core/init.ts";
import { runSitesPackage } from "../src/core/package.ts";
import { runSitesCheck } from "../src/core/validate.ts";

const bundle = findSitesBundle();

test("sites init → check → package against the real bundle", {
  skip:
    bundle === null
      ? "Sites plugin bundle not found — skipping integration test (install the Codex Sites plugin or set PI_SITES_BUNDLE)"
      : false,
}, async () => {
  assert.ok(bundle !== null);
  const root = mkdtempSync(join(tmpdir(), "sites-integration-"));
  try {
    // Scaffold from the bundle starter (runs npm ci — allow time).
    const init = await runSitesInit(root, bundle);
    assert.equal(init.ok, true, init.message);
    assert.equal(init.exitCode, 0);
    assert.equal(existsSync(join(root, ".openai", "hosting.json")), true);
    assert.equal(existsSync(join(root, "package.json")), true);
    assert.ok(init.layout !== null);
    assert.ok(
      init.layout.includes("node_modules (npm ci)"),
      init.layout.join(", ")
    );

    // Release-readiness check with a real build.
    const check = await runSitesCheck(root);
    const build = check.items.find((item) => item.id === "build");
    assert.ok(build, "build item present");
    assert.equal(build.status, "pass", build.evidence);

    // Package into a deployment archive and verify the required entries.
    const archive = join(tmpdir(), `sites-integration-${Date.now()}.tar.gz`);
    const packaged = await runSitesPackage(root, archive, bundle);
    assert.equal(packaged.ok, true, packaged.errors.join("; "));
    assert.equal(packaged.exitCode, 0);
    assert.ok(packaged.entries !== null);
    assert.ok(packaged.entries.includes("dist/server/index.js"));
    assert.ok(packaged.entries.includes("dist/.openai/hosting.json"));
    assert.ok((packaged.sizeBytes ?? 0) > 0);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
