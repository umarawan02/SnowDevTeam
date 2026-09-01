/**
 * Best-effort parsers for the Developer's file-block output and the QA verdict.
 * These NEVER throw — a malformed artifact is a QA finding, not a pipeline crash.
 * Phase 3 consumes `parseGeneratedFiles` to write code into the now-sdk workspace.
 */

export interface GeneratedFile {
  path: string;
  content: string;
}

const FILE_BLOCK_RE =
  /===\s*FILE:\s*(.+?)\s*===\s*\r?\n```[a-zA-Z0-9]*\r?\n([\s\S]*?)\r?\n```\s*\r?\n===\s*END FILE\s*===/g;

const ALLOWED_EXT = [".now.ts", ".ts", ".js", ".html", ".css"];

export function parseGeneratedFiles(text: string): {
  files: GeneratedFile[];
  warnings: string[];
} {
  const files: GeneratedFile[] = [];
  const warnings: string[] = [];

  let match: RegExpExecArray | null;
  FILE_BLOCK_RE.lastIndex = 0;
  while ((match = FILE_BLOCK_RE.exec(text)) !== null) {
    const rawPath = match[1].trim().replace(/\\/g, "/");
    const content = match[2];

    if (rawPath.startsWith("/") || rawPath.includes("..")) {
      warnings.push(`Rejected file path (absolute or traversing): ${rawPath}`);
      continue;
    }
    if (!rawPath.startsWith("src/")) {
      warnings.push(`Rejected file path (not under src/): ${rawPath}`);
      continue;
    }
    if (!ALLOWED_EXT.some((ext) => rawPath.endsWith(ext))) {
      warnings.push(`Rejected file path (extension not allowed): ${rawPath}`);
      continue;
    }
    files.push({ path: rawPath, content });
  }

  if (files.length === 0) {
    warnings.push("No valid `=== FILE: … ===` blocks found in the Developer output.");
  }
  return { files, warnings };
}

export type QaVerdict = "READY_FOR_HUMAN_REVIEW" | "NEEDS_REWORK" | null;

export function parseQaVerdict(text: string): QaVerdict {
  const m = text.match(/VERDICT:\s*(READY_FOR_HUMAN_REVIEW|NEEDS_REWORK)/);
  return (m?.[1] as QaVerdict) ?? null;
}

export type ReworkFrom = "ARCHITECT" | "SENIOR_DEV" | "DEVELOPER";

/** The stage QA wants the rework to start from, from a `REWORK_FROM:` line. */
export function parseReworkFrom(text: string): ReworkFrom | null {
  const m = text.match(/REWORK_FROM:\s*(ARCHITECT|SENIOR_DEV|DEVELOPER)/);
  return (m?.[1] as ReworkFrom) ?? null;
}
