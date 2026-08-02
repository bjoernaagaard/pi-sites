import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A conservative secret-detection pattern. Patterns use high-entropy prefixes
 * and key formats to avoid noise; matches are always masked in output.
 */
export interface SecretPattern {
  description: string;
  name: string;
  regex: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    description: "AWS access key ID",
    name: "aws-access-key-id",
    regex: /AKIA[0-9A-Z]{16}/,
  },
  {
    description: "GitHub personal access token (classic)",
    name: "github-personal-access-token",
    regex: /ghp_[A-Za-z0-9]{36,}/,
  },
  {
    description: "GitHub fine-grained personal access token",
    name: "github-fine-grained-token",
    regex: /github_pat_[A-Za-z0-9_]{22,}/,
  },
  {
    description: "OpenAI API key",
    name: "openai-api-key",
    regex: /sk-[A-Za-z0-9_-]{20,}/,
  },
  {
    description: "Slack token",
    name: "slack-token",
    regex: /xox[baprs]-/,
  },
  {
    description: "PEM private key block",
    name: "pem-private-key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    description: "URL with embedded credentials",
    name: "url-userinfo",
    regex: /https?:\/\/[^\s/@]+:[^\s/@]+@/,
  },
];

/** A single detected secret on one line of one file. */
export interface SecretHit {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

/**
 * Mask a secret value: keep the first 4 and last 2 characters when it is
 * long enough to leave both, otherwise replace the whole value.
 */
export function maskSecret(value: string): string {
  if (value.length < 6) {
    return "…";
  }
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/**
 * Scan text line by line for known secret patterns. Snippets are masked and
 * hits are deduplicated per (file, pattern, line).
 */
export function scanText(text: string, fileName: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split(LINE_SPLIT_RE);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    for (const pattern of SECRET_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match !== null) {
        hits.push({
          file: fileName,
          line: i + 1,
          pattern: pattern.name,
          snippet: maskSecret(match[0]),
        });
      }
    }
  }
  return hits;
}

/** Result of scanning a repository's tracked files for secrets. */
export interface TrackedScanResult {
  /** Set when the scan could not run (e.g. not a git repository). */
  error: string | null;
  hits: SecretHit[];
  /** True when a tracked file starts with `.env` and does not end with `.example`. */
  trackedDotEnv: boolean;
}

const MAX_LS_FILES_BUFFER = 64 * 1024 * 1024;

const LINE_SPLIT_RE = /\r?\n/;

/**
 * Scan every tracked file in `dir` (via `git ls-files`) for secrets.
 * Binary files (NUL-byte heuristic) are skipped. Never throws.
 */
export async function scanTrackedFiles(
  dir: string
): Promise<TrackedScanResult> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: dir,
      maxBuffer: MAX_LS_FILES_BUFFER,
    });
    const files = stdout
      .split("\n")
      .map((file) => file.trim())
      .filter((file) => file !== "");
    const hits: SecretHit[] = [];
    let trackedDotEnv = false;
    for (const file of files) {
      if (file.startsWith(".env") && !file.endsWith(".example")) {
        trackedDotEnv = true;
      }
      let content: Buffer;
      try {
        content = readFileSync(join(dir, file));
      } catch {
        // Unreadable or deleted between ls-files and read — skip.
        continue;
      }
      if (content.includes(0)) {
        continue;
      }
      hits.push(...scanText(content.toString("utf8"), file));
    }
    return { error: null, hits, trackedDotEnv };
  } catch (err) {
    const message = messageOf(err);
    if (message.includes("not a git repository")) {
      return { error: "not a git repository", hits: [], trackedDotEnv: false };
    }
    return { error: message, hits: [], trackedDotEnv: false };
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
