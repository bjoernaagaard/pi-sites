const TRUNCATION_MARK = "\n[output truncated]";

const LINE_SPLIT_RE = /\r?\n/;

/**
 * Bound `text` to `maxBytes` UTF-8 bytes (default 40000), appending a
 * truncation marker when the input was cut. Never splits a multi-byte
 * character.
 */
export function boundText(text: string, maxBytes = 40_000): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return text;
  }
  let cut = buffer.subarray(0, maxBytes).toString("utf8");
  while (cut.length > 0 && cut.endsWith("\uFFFD")) {
    cut = cut.slice(0, -1);
  }
  return `${cut}${TRUNCATION_MARK}`;
}

/** Format a byte count as a human-readable size (e.g. "1.5 MB"). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0 B";
  }
  if (n < 1024) {
    return `${n} B`;
  }
  const units = ["KB", "MB", "GB", "TB", "PB"] as const;
  let value = n;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  const rendered = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${rendered} ${units[unit]}`;
}

/** The last `n` lines of `text`, ignoring trailing blank lines. */
export function lastLines(text: string, n: number): string {
  if (n <= 0) {
    return "";
  }
  const lines = text.split(LINE_SPLIT_RE);
  while (lines.length > 0 && (lines.at(-1) ?? "") === "") {
    lines.pop();
  }
  return lines.slice(-n).join("\n");
}
