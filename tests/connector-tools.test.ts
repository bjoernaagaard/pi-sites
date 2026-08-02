// ---------------------------------------------------------------------------
// pi-sites — connector-tools unit tests (node:test + node:assert/strict)
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderReleaseLog } from "../src/commands.ts";
import { connectorToolSet } from "../src/connector-tools.ts";

const TS = "2026-08-02T12:00:00.000Z";

test("connectorToolSet removes connector tools when disabled", () => {
  const active = [
    "read",
    "bash",
    "sites_overview",
    "sites_provision",
    "sites_check",
  ];
  assert.deepEqual(connectorToolSet(active, false), [
    "read",
    "bash",
    "sites_check",
  ]);
});

test("connectorToolSet adds connector tools once when enabled", () => {
  const active = ["read", "bash", "sites_check"];
  const next = connectorToolSet(active, true);
  assert.deepEqual(next, [
    "read",
    "bash",
    "sites_check",
    "sites_overview",
    "sites_provision",
  ]);
  // idempotent when already active
  assert.deepEqual(connectorToolSet(next, true), next);
});

test("connectorToolSet keeps unknown tools untouched", () => {
  assert.deepEqual(
    connectorToolSet(["other_ext_tool", "sites_overview"], false),
    ["other_ext_tool"]
  );
});

test("renderReleaseLog formats entries newest-last and handles empty", () => {
  assert.equal(renderReleaseLog([]), "release log: no entries");
  const text = renderReleaseLog([
    {
      archive: "/tmp/a.tar.gz",
      sha: "0123456789abcdef",
      status: "planned",
      timestamp: TS,
    },
  ]);
  assert.match(
    text,
    /1\. planned 0123456 @ 2026-08-02T12:00:00\.000Z \[\S+a\.tar\.gz\]/
  );
});

test("renderReleaseLog is pure and ordered", () => {
  const entries = [
    { archive: "/a", sha: "1111111111", status: "planned", timestamp: TS },
    {
      archive: "/b",
      sha: "2222222222",
      status: "deployed-private",
      timestamp: TS,
    },
  ];
  const text = renderReleaseLog(entries);
  assert.ok(
    text.indexOf("1. planned 1111111") <
      text.indexOf("2. deployed-private 2222222")
  );
});
