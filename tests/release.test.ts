// ---------------------------------------------------------------------------
// pi-sites — release workflow unit tests (node:test + node:assert/strict)
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConnectorPrompt,
  buildReleaseLogEntry,
  parseProjectId,
  planRelease,
  type ReleaseConfig,
  type ReleaseGitState,
  runConnectorStep,
  summarizeReleasePlan,
} from "../src/release.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const SHORT_SHA = SHA.slice(0, 7);
const NO_CREDENTIALS_SUFFIX =
  "Never print credentials or secret values. Use only the connector functions documented by the Sites plugin skill.";
const CONNECTOR_COMMAND_PATTERN = /connector\.command/;
const SITES_CONFIG_PATTERN = /\.pi\/sites\.json/;
const NEVER_AUTOMATED_PATTERN = /never automated/;
const STEP_IDS = [
  "commit_sha",
  "check_green",
  "archive",
  "save_version",
  "deploy_private",
  "access_env_domains",
  "logs",
  "public_release",
] as const;

function cleanGit(): ReleaseGitState {
  return {
    branch: "main",
    dirty: false,
    error: null,
    hasRepo: true,
    headSha: SHA,
  };
}

function configWithCommand(command: string[] | null): ReleaseConfig {
  return {
    bundle: { path: null },
    connector: { command },
    promotion: { enabled: true },
  };
}

// --- planRelease -----------------------------------------------------------

test("planRelease refuses a dirty working tree", () => {
  const plan = planRelease({ ...cleanGit(), dirty: true });
  assert.equal(plan.dirtyRefused, true);
  assert.equal(plan.sha, SHA);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    [...STEP_IDS]
  );
  for (const step of plan.steps) {
    assert.equal(step.status, "blocked");
    assert.ok(step.detail.includes("dirty"), step.detail);
  }
});

test("planRelease refuses when there is no repository", () => {
  const plan = planRelease({
    branch: null,
    dirty: false,
    error: null,
    hasRepo: false,
    headSha: null,
  });
  assert.equal(plan.dirtyRefused, true);
  assert.equal(plan.sha, null);
  assert.ok(plan.steps.length >= STEP_IDS.length);
  for (const step of plan.steps) {
    assert.equal(step.status, "blocked");
    assert.ok(step.detail.includes("repository"), step.detail);
  }
});

test("planRelease marks local steps done and control-plane steps pending", () => {
  const plan = planRelease(cleanGit(), {
    archivePath: "dist/site.tar.gz",
    checkOk: true,
  });
  assert.equal(plan.dirtyRefused, false);
  assert.equal(plan.sha, SHA);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    [...STEP_IDS]
  );

  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  assert.equal(byId.get("commit_sha")?.status, "done");
  assert.equal(byId.get("commit_sha")?.detail, `${SHA} (${SHORT_SHA})`);
  assert.equal(byId.get("check_green")?.status, "done");
  assert.equal(byId.get("archive")?.status, "done");
  assert.equal(byId.get("archive")?.detail, "dist/site.tar.gz");

  for (const id of [
    "save_version",
    "deploy_private",
    "access_env_domains",
    "logs",
    "public_release",
  ]) {
    assert.equal(byId.get(id)?.status, "pending", id);
  }
});

test("planRelease keeps local steps pending without checkOk/archivePath", () => {
  const plan = planRelease(cleanGit());
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  assert.equal(byId.get("check_green")?.status, "pending");
  assert.equal(byId.get("check_green")?.detail, "run /sites check first");
  assert.equal(byId.get("archive")?.status, "pending");
  assert.equal(byId.get("archive")?.detail, "run /sites package first");
  assert.equal(byId.get("public_release")?.status, "pending");
});

// --- buildReleaseLogEntry --------------------------------------------------

test("buildReleaseLogEntry returns a trimmed ISO-timestamped entry", () => {
  const entry = buildReleaseLogEntry({
    archive: "  dist/site.tar.gz\t",
    notes: "  first private deploy  ",
    sha: `  ${SHA}  `,
    status: "saved",
  });
  assert.equal(entry.sha, SHA);
  assert.equal(entry.archive, "dist/site.tar.gz");
  assert.equal(entry.status, "saved");
  assert.equal(entry.notes, "first private deploy");
  assert.equal(entry.timestamp, new Date(entry.timestamp).toISOString());
  assert.ok(entry.timestamp.endsWith("Z"));
});

test("buildReleaseLogEntry omits empty notes", () => {
  const entry = buildReleaseLogEntry({
    archive: "a.tar.gz",
    notes: "   ",
    sha: SHA,
    status: "planned",
  });
  assert.equal(entry.notes, undefined);
  assert.equal(entry.archive, "a.tar.gz");
});

// --- buildConnectorPrompt --------------------------------------------------

test("buildConnectorPrompt save_version names dir, sha, and archive", () => {
  const prompt = buildConnectorPrompt("save_version", "/tmp/site", {
    archive: "a.tar.gz",
    sha: SHA,
  });
  assert.ok(prompt !== null);
  assert.ok(prompt.includes("/tmp/site"));
  assert.ok(prompt.includes(SHA));
  assert.ok(prompt.includes("a.tar.gz"));
  assert.ok(prompt.includes("Do not deploy."));
  assert.ok(prompt.endsWith(NO_CREDENTIALS_SUFFIX));
});

test("buildConnectorPrompt covers the other connector steps", () => {
  const expectations: Record<string, string> = {
    access_env_domains: "list_custom_domains",
    deploy_private: "deploy_private_site_version",
    logs: "get_site_worker_logs",
  };
  for (const [stepId, functionName] of Object.entries(expectations)) {
    const prompt = buildConnectorPrompt(stepId, "/tmp/site", {});
    assert.ok(prompt !== null, stepId);
    assert.ok(prompt.includes("/tmp/site"), stepId);
    assert.ok(prompt.includes(functionName), stepId);
    assert.ok(prompt.endsWith(NO_CREDENTIALS_SUFFIX), stepId);
  }
});

test("buildConnectorPrompt never automates public release or unknown steps", () => {
  assert.equal(buildConnectorPrompt("public_release", "/tmp/site", {}), null);
  assert.equal(buildConnectorPrompt("not-a-step", "/tmp/site", {}), null);
});

// --- runConnectorStep ------------------------------------------------------

test("runConnectorStep is disabled when connector.command is null", async () => {
  const result = await runConnectorStep(
    "save_version",
    "/tmp/site",
    configWithCommand(null),
    {}
  );
  assert.equal(result.ok, false);
  assert.equal(result.output, "");
  assert.match(result.error ?? "", CONNECTOR_COMMAND_PATTERN);
  assert.match(result.error ?? "", SITES_CONFIG_PATTERN);
});

test("runConnectorStep is disabled when connector.command is empty", async () => {
  const result = await runConnectorStep(
    "save_version",
    "/tmp/site",
    configWithCommand([]),
    {}
  );
  assert.equal(result.ok, false);
  assert.equal(result.output, "");
  assert.match(result.error ?? "", CONNECTOR_COMMAND_PATTERN);
});

test("runConnectorStep refuses public_release even when a command is set", async () => {
  const result = await runConnectorStep(
    "public_release",
    "/tmp/site",
    configWithCommand(["codex", "exec"]),
    {}
  );
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", NEVER_AUTOMATED_PATTERN);
});

test("runConnectorStep rejects unknown steps", async () => {
  const result = await runConnectorStep(
    "bogus",
    "/tmp/site",
    configWithCommand(["codex", "exec"]),
    {}
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "unknown connector step");
});

test("runConnectorStep spawns a harmless command and captures output", async () => {
  const result = await runConnectorStep(
    "save_version",
    process.cwd(),
    configWithCommand(["node", "-e", "process.stdout.write('hi')"]),
    { archive: "a.tar.gz", sha: SHA }
  );
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.ok(result.output.includes("hi"));
});

// --- summarizeReleasePlan --------------------------------------------------

test("summarizeReleasePlan prints a refusal line and step markers", () => {
  const refused = summarizeReleasePlan(
    planRelease({ ...cleanGit(), dirty: true })
  );
  assert.ok(refused.includes("release refused"));
  assert.ok(refused.includes("✗"));
  assert.ok(!refused.includes("✓"));

  const clean = summarizeReleasePlan(
    planRelease(cleanGit(), { archivePath: "a.tar.gz", checkOk: true })
  );
  assert.ok(clean.includes("✓"));
  assert.ok(clean.includes("○"));
  assert.ok(clean.includes(SHORT_SHA));
  assert.ok(!clean.includes("release refused"));
});

const OVERVIEW_LIST_SITES_RE = /list_sites/;
const OVERVIEW_GET_SITE_RE = /get_site/;
const OVERVIEW_LIST_VERSIONS_RE = /list_site_versions/;
const OVERVIEW_ENV_NAMES_RE = /environment variable names \(no values\)/;
const PROVISION_CREATE_SITE_RE = /create_site/;
const PROVISION_ID_LINE_RE = /PROJECT_ID=<the returned project id>/;

test("buildConnectorPrompt overview asks for managed state and env names only", () => {
  const prompt = buildConnectorPrompt("overview", "/proj", {
    archive: null,
    sha: null,
  });
  assert.ok(prompt !== null);
  assert.match(prompt, OVERVIEW_LIST_SITES_RE);
  assert.match(prompt, OVERVIEW_GET_SITE_RE);
  assert.match(prompt, OVERVIEW_LIST_VERSIONS_RE);
  assert.match(prompt, OVERVIEW_ENV_NAMES_RE);
  assert.ok(prompt.endsWith(NO_CREDENTIALS_SUFFIX));
});

test("buildConnectorPrompt provision asks for a single PROJECT_ID line", () => {
  const prompt = buildConnectorPrompt("provision", "/proj", {
    archive: null,
    sha: null,
  });
  assert.ok(prompt !== null);
  assert.match(prompt, PROVISION_CREATE_SITE_RE);
  assert.match(prompt, PROVISION_ID_LINE_RE);
  assert.ok(prompt.endsWith(NO_CREDENTIALS_SUFFIX));
});

test("parseProjectId extracts a UUID-shaped id from connector output", () => {
  assert.equal(
    parseProjectId(
      "some prose\nPROJECT_ID=01234567-89ab-cdef-0123-456789abcdef\nmore"
    ),
    "01234567-89ab-cdef-0123-456789abcdef"
  );
  assert.equal(
    parseProjectId("PROJECT_ID = abcdef0123456789"),
    "abcdef0123456789"
  );
});

test("parseProjectId rejects garbage and missing ids", () => {
  assert.equal(parseProjectId("no id here"), null);
  assert.equal(parseProjectId("PROJECT_ID="), null);
  assert.equal(parseProjectId("PROJECT_ID=short"), null);
  assert.equal(parseProjectId("PROJECT_ID=not a real id !!!"), null);
});
