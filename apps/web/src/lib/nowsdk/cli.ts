import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NOW_SDK_CWD, REPO_ROOT } from "@/lib/config";

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
 * The now-sdk CLI JS entrypoint. Invoking it with `node <entry>` avoids the
 * Windows `.cmd` shim (which execFile can't run without `shell: true`) and works
 * the same on every platform. pnpm's hoisted linker puts the package at the
 * repo-root node_modules.
 */
const NOW_SDK_ENTRY = (() => {
  const candidates = [
    path.join(REPO_ROOT, "node_modules", "@servicenow", "sdk", "bin", "index.js"),
    path.join(NOW_SDK_CWD, "node_modules", "@servicenow", "sdk", "bin", "index.js"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `Could not locate the now-sdk CLI entrypoint. Looked in:\n${candidates.join("\n")}`,
    );
  }
  return found;
})();

export interface NowSdkResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run the workspace-local `now-sdk` CLI against `servicenow/delivery-app`.
 * Used by the agent MCP tools (explain / query) and, later, the Phase 3 deploy flow.
 */
export async function runNowSdk(
  args: string[],
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<NowSdkResult> {
  const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [NOW_SDK_ENTRY, ...args],
      {
        cwd: NOW_SDK_CWD,
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
