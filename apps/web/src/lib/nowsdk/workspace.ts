import fs from "node:fs";
import path from "node:path";
import { runNowSdk } from "@/lib/nowsdk/cli";
import type { GeneratedFile } from "@/lib/pipeline/parse";

/**
 * Per-project Fluent workspace operations (REFACTOR_BRIEF Phase 1). Every
 * function here takes a `projectDir` — a FluentProject's `repoPath`, resolved
 * against WORKSPACES_ROOT by the caller — instead of a single hard-coded
 * workspace. `now.config.json` is never rewritten at runtime: each project's
 * own committed file is authoritative, and picking *which* project a ticket
 * builds against is the caller's job (`resolveProjectForTicket` today,
 * `tier.ts` from Phase 3 on).
 */

function fluentDir(projectDir: string): string {
  return path.join(projectDir, "src", "fluent");
}
function serverDir(projectDir: string): string {
  return path.join(projectDir, "src", "server");
}
function keysFile(projectDir: string): string {
  return path.join(fluentDir(projectDir), "generated", "keys.ts");
}

// Per-project serialisation: concurrent tickets on different projects must
// not wait on each other, but two tickets on the *same* project still need
// to run their builds one at a time (they share one `src/fluent` + keys.ts).
const chains = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier operation on this same project has finished. */
export function withProjectLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  const prior = chains.get(projectDir) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  chains.set(
    projectDir,
    run.catch(() => {}),
  );
  return run;
}

/** Remove previously-written generated sources, keeping SDK-managed files. */
export function cleanWorkspace(projectDir: string): string[] {
  const removed: string[] = [];
  const fDir = fluentDir(projectDir);
  const sDir = serverDir(projectDir);
  if (fs.existsSync(fDir)) {
    for (const entry of fs.readdirSync(fDir)) {
      if (entry === "generated") continue; // keys.ts is SDK-managed
      fs.rmSync(path.join(fDir, entry), { recursive: true, force: true });
      removed.push(`src/fluent/${entry}`);
    }
  }
  if (fs.existsSync(sDir)) {
    for (const entry of fs.readdirSync(sDir)) {
      if (entry === "tsconfig.json") continue;
      fs.rmSync(path.join(sDir, entry), { recursive: true, force: true });
      removed.push(`src/server/${entry}`);
    }
  }
  return removed;
}

export function writeGeneratedFiles(projectDir: string, files: GeneratedFile[]): void {
  const root = path.resolve(projectDir);
  for (const f of files) {
    const resolved = path.resolve(path.join(projectDir, f.path));
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error(`Refusing to write outside the project: ${f.path}`);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, f.content.endsWith("\n") ? f.content : f.content + "\n", "utf8");
  }
}

/**
 * `keys.ts` is a tracked file that `now-sdk build` rewrites from the current
 * `src/fluent` contents. Snapshot it so a build that never installs can't dirty
 * it; only a confirmed deploy should keep the regenerated version.
 */
export function snapshotKeys(projectDir: string): string | null {
  try {
    const f = keysFile(projectDir);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  } catch {
    return null;
  }
}
export function restoreKeys(projectDir: string, snap: string | null): void {
  try {
    const f = keysFile(projectDir);
    if (snap != null && fs.existsSync(path.dirname(f))) {
      fs.writeFileSync(f, snap, "utf8");
    }
  } catch {
    /* best effort */
  }
}

export interface BuildResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Just the error / diagnostic lines, for feeding back to the agent. */
  diagnostics: string;
  removed: string[];
  fileCount: number;
}

function extractDiagnostics(out: string): string {
  const lines = out
    .split(/\r?\n/)
    .filter((l) => /\bERROR\b|error TS\d|diagnostic|not allowed|No overload/i.test(l));
  return lines.join("\n").trim() || out.trim().slice(0, 4000);
}

/**
 * Write `files` into `projectDir` and run `now-sdk build` — serialised per
 * project, and `keys.ts` is always restored afterwards. For the build gate
 * and the Developer's `build` tool; `deployTicket` orchestrates its own
 * build + install + keys.
 */
export function buildWorkspace(projectDir: string, files: GeneratedFile[]): Promise<BuildResult> {
  return withProjectLock(projectDir, async () => {
    const keys = snapshotKeys(projectDir);
    try {
      const removed = cleanWorkspace(projectDir);
      writeGeneratedFiles(projectDir, files);
      const { stdout, stderr, code } = await runNowSdk(["build"], {
        cwd: projectDir,
        timeoutMs: 180_000,
        maxChars: 20_000,
      });
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      return {
        code,
        stdout,
        stderr,
        diagnostics: extractDiagnostics(combined),
        removed,
        fileCount: files.length,
      };
    } finally {
      restoreKeys(projectDir, keys);
    }
  });
}
