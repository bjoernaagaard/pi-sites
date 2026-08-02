import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runSitesCheck } from "../src/core/validate.ts";

const GIT_ENV = {
  GIT_AUTHOR_EMAIL: "sites-test@example.com",
  GIT_AUTHOR_NAME: "Sites Test",
  GIT_COMMITTER_EMAIL: "sites-test@example.com",
  GIT_COMMITTER_NAME: "Sites Test",
};

function runGit(dir: string, args: string[]): void {
  execFileSync("git", args, {
    cwd: dir,
    env: { ...process.env, ...GIT_ENV },
  });
}

function statusById(
  result: Awaited<ReturnType<typeof runSitesCheck>>
): Map<string, string> {
  return new Map(result.items.map((item) => [item.id, item.status]));
}

test("fake project A passes local checks with build disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-a-"));
  try {
    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(
      join(dir, ".openai", "hosting.json"),
      JSON.stringify({ d1: null, project_id: "proj_a", r2: null })
    );
    writeFileSync(
      join(dir, ".env.example"),
      "APP_TITLE=My Site\nAPI_BASE_URL=https://example.com\n"
    );
    writeFileSync(
      join(dir, ".env"),
      "APP_TITLE=Local\nAPI_BASE_URL=http://localhost:8787\n"
    );
    mkdirSync(join(dir, "worker"), { recursive: true });
    writeFileSync(
      join(dir, "worker", "index.ts"),
      'export default { fetch() { return new Response("ok"); } };\n'
    );
    mkdirSync(join(dir, "drizzle", "meta"), { recursive: true });
    writeFileSync(
      join(dir, "drizzle", "meta", "_journal.json"),
      JSON.stringify({ entries: [] })
    );
    writeFileSync(
      join(dir, "drizzle", "0000_initial.sql"),
      "CREATE TABLE items (id TEXT);\n"
    );

    const result = await runSitesCheck(dir, { runBuild: false });
    assert.equal(result.error, null);
    const statuses = statusById(result);
    assert.equal(statuses.get("build"), "skip");
    assert.equal(statuses.get("hosting_json"), "pass");
    assert.equal(statuses.get("env_example"), "pass");
    assert.equal(statuses.get("env_parity"), "pass");
    assert.equal(statuses.get("worker_entry"), "pass");
    assert.equal(statuses.get("release_6"), "pass");
    const release6 = result.items.find((item) => item.id === "release_6");
    assert.ok(release6?.evidence.includes("rollback plan is a manual step"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("project B with a committed secret fails secrets_scan", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-b-"));
  try {
    runGit(dir, ["init", "-b", "main"]);
    writeFileSync(
      join(dir, "config.ts"),
      'const key = "sk-abcdefghijklmnopqrstuvwxyz123";\n'
    );
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "add secret fixture"]);

    const result = await runSitesCheck(dir, { runBuild: false });
    const secretsScan = result.items.find((item) => item.id === "secrets_scan");
    assert.ok(secretsScan, "secrets_scan item present");
    assert.equal(secretsScan.status, "fail");
    assert.ok(secretsScan.evidence.includes("openai-api-key"));
    assert.ok(
      !secretsScan.evidence.includes("sk-abcdefghijklmnopqrstuvwxyz123")
    );
    assert.ok(secretsScan.evidence.includes("…"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("project B tracks a .env — secrets_scan fails with a trackedDotEnv hint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-c-"));
  try {
    runGit(dir, ["init", "-b", "main"]);
    writeFileSync(join(dir, ".env"), "APP_TITLE=Local\n");
    writeFileSync(join(dir, "app.ts"), "export const n = 1;\n");
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "tracked env fixture"]);

    const result = await runSitesCheck(dir, { runBuild: false });
    const secretsScan = result.items.find((item) => item.id === "secrets_scan");
    assert.ok(secretsScan, "secrets_scan item present");
    assert.equal(secretsScan.status, "fail");
    assert.ok(secretsScan.evidence.includes("tracked .env"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("missing hosting.json skips hosting_json; malformed hosting.json fails it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-d-"));
  try {
    const first = await runSitesCheck(dir, { runBuild: false });
    const missing = first.items.find((item) => item.id === "hosting_json");
    assert.ok(missing, "hosting_json item present");
    assert.equal(missing.status, "skip");
    assert.ok(missing.evidence.toLowerCase().includes("hosting.json"));

    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(join(dir, ".openai", "hosting.json"), "{not json");
    const second = await runSitesCheck(dir, { runBuild: false });
    const malformed = second.items.find((item) => item.id === "hosting_json");
    assert.ok(malformed, "hosting_json item present");
    assert.equal(malformed.status, "fail");
    assert.ok(malformed.evidence.includes("not valid JSON"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("invalid hosting.json content fails hosting_json with schema errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-e-"));
  try {
    mkdirSync(join(dir, ".openai"), { recursive: true });
    writeFileSync(
      join(dir, ".openai", "hosting.json"),
      JSON.stringify({ api_key: "sk-123", project_id: "proj" })
    );
    const result = await runSitesCheck(dir, { runBuild: false });
    const item = result.items.find(
      (candidate) => candidate.id === "hosting_json"
    );
    assert.equal(item?.status, "fail");
    assert.ok(item?.evidence.includes("api_key"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("env_parity fails when local .env names are not documented", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-f-"));
  try {
    writeFileSync(join(dir, ".env.example"), "APP_TITLE=My Site\n");
    writeFileSync(join(dir, ".env"), "APP_TITLE=Local\nSECRET_TOKEN=x\n");
    const result = await runSitesCheck(dir, { runBuild: false });
    const item = result.items.find(
      (candidate) => candidate.id === "env_parity"
    );
    assert.equal(item?.status, "fail");
    assert.ok(item?.evidence.includes("SECRET_TOKEN"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("drizzle without migrations fails release_6; no drizzle skips it", async () => {
  const withDrizzle = mkdtempSync(join(tmpdir(), "sites-check-g-"));
  try {
    mkdirSync(join(withDrizzle, "drizzle", "meta"), { recursive: true });
    writeFileSync(
      join(withDrizzle, "drizzle", "meta", "_journal.json"),
      JSON.stringify({ entries: [] })
    );
    const result = await runSitesCheck(withDrizzle, { runBuild: false });
    const item = result.items.find((candidate) => candidate.id === "release_6");
    assert.equal(item?.status, "fail");
  } finally {
    rmSync(withDrizzle, { force: true, recursive: true });
  }

  const withoutDrizzle = mkdtempSync(join(tmpdir(), "sites-check-h-"));
  try {
    const result = await runSitesCheck(withoutDrizzle, { runBuild: false });
    const item = result.items.find((candidate) => candidate.id === "release_6");
    assert.equal(item?.status, "skip");
  } finally {
    rmSync(withoutDrizzle, { force: true, recursive: true });
  }
});

test("release_8 records the commit SHA and dirty state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-i-"));
  try {
    runGit(dir, ["init", "-b", "main"]);
    writeFileSync(join(dir, "app.ts"), "export const n = 1;\n");
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "first commit"]);
    writeFileSync(join(dir, "app.ts"), "export const n = 2;\n");

    const result = await runSitesCheck(dir, { runBuild: false });
    const item = result.items.find((candidate) => candidate.id === "release_8");
    assert.equal(item?.status, "pass");
    assert.ok(item?.evidence.startsWith("source commit "));
    assert.ok(item?.evidence.includes("tree is dirty"));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("summary counts match item statuses and ok reflects failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-check-j-"));
  try {
    const result = await runSitesCheck(dir, { runBuild: false });
    const counts = { fail: 0, manual: 0, pass: 0, skip: 0 };
    for (const item of result.items) {
      counts[item.status as keyof typeof counts] += 1;
    }
    assert.deepEqual(result.summary, counts);
    assert.equal(result.ok, result.summary.fail === 0);
    assert.ok(result.durationMs >= 0);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
