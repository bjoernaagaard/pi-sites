import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Snapshot of the git state of a working tree. */
export interface GitState {
  branch: string | null;
  dirty: boolean;
  error: string | null;
  hasRepo: boolean;
  headSha: string | null;
}

const GIT_TIMEOUT_MS = 10_000;
const MAX_GIT_BUFFER = 16 * 1024 * 1024;

const LINE_SPLIT_RE = /\r?\n/;

/**
 * Read the git state of `dir` with `git rev-parse --verify HEAD`,
 * `git status --porcelain`, and `git branch --show-current`. Non-repos and
 * timeouts are reported in `error`; this never throws.
 */
export async function getGitState(dir: string): Promise<GitState> {
  let headOut: string;
  try {
    headOut = (await runGit(dir, ["rev-parse", "--verify", "HEAD"])).stdout;
  } catch (err) {
    return gitErrorState(err);
  }
  const headSha = firstLine(headOut);
  try {
    const [status, branch] = await Promise.all([
      runGit(dir, ["status", "--porcelain"]),
      runGit(dir, ["branch", "--show-current"]),
    ]);
    return {
      branch: nonEmptyOrNull(branch.stdout.trim()),
      dirty: status.stdout.trim() !== "",
      error: null,
      hasRepo: true,
      headSha,
    };
  } catch (err) {
    return {
      branch: null,
      dirty: false,
      error: gitErrorState(err).error,
      hasRepo: true,
      headSha,
    };
  }
}

function gitErrorState(err: unknown): GitState {
  const message = messageOf(err);
  if (message.includes("not a git repository")) {
    return {
      branch: null,
      dirty: false,
      error: "not a git repository",
      hasRepo: false,
      headSha: null,
    };
  }
  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return {
      branch: null,
      dirty: false,
      error: `git timed out after ${GIT_TIMEOUT_MS}ms`,
      hasRepo: false,
      headSha: null,
    };
  }
  return {
    branch: null,
    dirty: false,
    error: message,
    hasRepo: false,
    headSha: null,
  };
}

function runGit(dir: string, args: string[]): Promise<{ stdout: string }> {
  return execFileAsync("git", args, {
    cwd: dir,
    maxBuffer: MAX_GIT_BUFFER,
    signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
  });
}

function firstLine(text: string): string | null {
  const line = text.split(LINE_SPLIT_RE)[0]?.trim() ?? "";
  return line === "" ? null : line;
}

function nonEmptyOrNull(value: string): string | null {
  return value === "" ? null : value;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
