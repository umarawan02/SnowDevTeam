import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT } from "@/lib/config";

const execFileAsync = promisify(execFile);

// Big enough for the longest `explain` topic (action-api ≈ 57 KB). `query` and
// build/deploy logs pass a smaller cap so live data / logs can't blow context.
const DEFAULT_MAX_CHARS = 64_000;

function truncate(s: string, max: number): string {
  return s.length > max
    ? s.slice(0, max) + `\n… [truncated ${s.length - max} chars]`
    : s;
}

/**
 * The now-sdk CLI JS entrypoint for a given project directory. Invoking it
 * with `node <entry>` avoids the Windows `.cmd` shim (which execFile can't
 * run without `shell: true`) and works the same on every platform.
 *
 * Every FluentProject (REFACTOR_BRIEF Phase 1) has its own `npm install`, so
 * its own now-sdk lives in its own `node_modules` — try that first. Fall back
 * to this monorepo's hoisted install only for legacy callers that haven't
 * migrated to a real project yet (e.g. `servicenow/delivery-app` itself).
 */
function resolveNowSdkEntry(cwd: string): string {
  const candidates = [
    path.join(cwd, "node_modules", "@servicenow", "sdk", "bin", "index.js"),
    path.join(REPO_ROOT, "node_modules", "@servicenow", "sdk", "bin", "index.js"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Could not locate the now-sdk CLI entrypoint. Looked in:\n${candidates.join("\n")}`);
  }
  return found;
}

export interface NowSdkResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run the `now-sdk` CLI in `cwd` — always a Fluent project directory (a
 * FluentProject's `repoPath`, or `servicenow/delivery-app` for legacy
 * callers). There is no default: every caller must say which project it
 * means, now that more than one exists.
 */
export async function runNowSdk(
  args: string[],
  opts: { cwd: string; timeoutMs?: number; maxChars?: number },
): Promise<NowSdkResult> {
  const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const entry = resolveNowSdkEntry(opts.cwd);
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [entry, ...args],
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 90_000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return { stdout: truncate(stdout, max), stderr: truncate(stderr, max), code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    return {
      stdout: truncate(e.stdout ?? "", max),
      stderr: truncate(e.stderr ?? String(e.message ?? e), max),
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}
