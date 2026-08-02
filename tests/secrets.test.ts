import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  maskSecret,
  SECRET_PATTERNS,
  scanText,
  scanTrackedFiles,
} from "../src/core/secrets.ts";

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

test("SECRET_PATTERNS cover the required formats", () => {
  const names = SECRET_PATTERNS.map((pattern) => pattern.name);
  for (const expected of [
    "aws-access-key-id",
    "github-personal-access-token",
    "github-fine-grained-token",
    "openai-api-key",
    "slack-token",
    "pem-private-key",
    "url-userinfo",
  ]) {
    assert.ok(names.includes(expected), `missing pattern ${expected}`);
  }
});

test("scanText catches fake tokens with masked snippets", () => {
  const text = [
    "export OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz123",
    "GH_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz123456",
    "AWS_ACCESS_KEY=AKIA0123456789ABCDEF",
    "https://user:pass@example.com/path",
    "SLACK_TOKEN=xoxb-1234567890-abcdef",
    "-----BEGIN RSA PRIVATE KEY-----",
    "github_pat_abcdefghijklmnopqrstuvwxyz_1234567890abcdef",
  ].join("\n");
  const hits = scanText(text, "fixture.env");
  const patterns = new Set(hits.map((hit) => hit.pattern));
  for (const expected of [
    "openai-api-key",
    "github-personal-access-token",
    "aws-access-key-id",
    "url-userinfo",
    "slack-token",
    "pem-private-key",
    "github-fine-grained-token",
  ]) {
    assert.ok(patterns.has(expected), `missing hit for ${expected}`);
  }
  for (const hit of hits) {
    assert.ok(hit.file === "fixture.env");
    assert.ok(
      !hit.snippet.includes("0123456789"),
      `unmasked snippet: ${hit.snippet}`
    );
    assert.ok(
      !hit.snippet.includes("abcdefghijklmnop"),
      `unmasked snippet: ${hit.snippet}`
    );
  }
});

test("scanText deduplicates per file+pattern+line", () => {
  const text =
    "a=sk-abcdefghijklmnopqrstuvwxyz123 b=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ456\n";
  const hits = scanText(text, "f");
  const openaiHits = hits.filter((hit) => hit.pattern === "openai-api-key");
  assert.equal(openaiHits.length, 1);
  assert.equal(openaiHits[0]?.line, 1);
});

test("scanText records line numbers", () => {
  const hits = scanText("clean\nKEY=sk-abcdefghijklmnopqrstuvwxyz123\n", "f");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.line, 2);
});

test("maskSecret hides the middle and keeps the edges", () => {
  assert.equal(maskSecret("sk-abcdefghijklmnopqrstuvwxyz"), "sk-a…yz");
  assert.equal(maskSecret("abcdef"), "abcd…ef");
  assert.equal(maskSecret("abc"), "…");
  assert.equal(maskSecret(""), "…");
});

test("scanTrackedFiles finds committed secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-secrets-"));
  try {
    runGit(dir, ["init", "-b", "main"]);
    writeFileSync(
      join(dir, ".env"),
      "OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz123\n"
    );
    writeFileSync(join(dir, ".env.example"), "OPENAI_KEY=\n");
    writeFileSync(
      join(dir, "app.ts"),
      'const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyz123456";\n'
    );
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "fixture with fake secrets"]);

    const result = await scanTrackedFiles(dir);
    assert.equal(result.error, null);
    assert.equal(result.trackedDotEnv, true);
    const patterns = new Set(result.hits.map((hit) => hit.pattern));
    assert.ok(patterns.has("openai-api-key"));
    assert.ok(patterns.has("github-personal-access-token"));
    const envHit = result.hits.find((hit) => hit.pattern === "openai-api-key");
    assert.equal(envHit?.file, ".env");
    const appHit = result.hits.find(
      (hit) => hit.pattern === "github-personal-access-token"
    );
    assert.equal(appHit?.file, "app.ts");
    for (const hit of result.hits) {
      assert.ok(
        !hit.snippet.includes("0123456789"),
        `unmasked snippet: ${hit.snippet}`
      );
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("scanTrackedFiles flags a tracked .env but not .env.example", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-secrets-"));
  try {
    runGit(dir, ["init", "-b", "main"]);
    writeFileSync(join(dir, ".env"), "FOO=bar\n");
    writeFileSync(join(dir, ".env.example"), "FOO=\n");
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "fixture env files"]);

    const result = await scanTrackedFiles(dir);
    assert.equal(result.error, null);
    assert.equal(result.trackedDotEnv, true);
    assert.deepEqual(result.hits, []);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("scanTrackedFiles skips binary files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-secrets-"));
  try {
    runGit(dir, ["init", "-b", "main"]);
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    runGit(dir, ["add", "."]);
    runGit(dir, ["commit", "-m", "binary fixture"]);

    const result = await scanTrackedFiles(dir);
    assert.equal(result.error, null);
    assert.deepEqual(result.hits, []);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("scanTrackedFiles reports not a git repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-secrets-"));
  try {
    const result = await scanTrackedFiles(dir);
    assert.equal(result.error, "not a git repository");
    assert.deepEqual(result.hits, []);
    assert.equal(result.trackedDotEnv, false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
