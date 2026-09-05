import fs from "node:fs";
import path from "node:path";
import { runNowSdk } from "@/lib/nowsdk/cli";
import type { GeneratedFile } from "@/lib/pipeline/parse";

/**
 * Per-project Fluent workspace operations (REFACTOR_BRIEF Phase 1 + 2). Each
 * customer FluentProject is its own directory under WORKSPACES_ROOT. Phase 2:
 * the project *accumulates* — every ticket's generated code lives in its own
 * subdirectory (`src/fluent/<ticketDir>/…`, `src/server/<ticketDir>/…`) and
 * stays; the whole project compiles as one. `now.config.json` is never
 * rewritten at runtime.
 *
 * Nothing here takes a lock: `buildProject` assumes the caller already holds
 * `withProjectLock(projectDir, …)` (the build gate, the Developer's `build`
 * tool, and deploy each hold it for the duration of one atomic tree op).
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

// Per-project serialisation. Only acquired by the three tree-touching call
// sites (build gate / Developer `build` tool / deploy), never nested.
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

/** Read the SDK-managed keys.ts, or null if it doesn't exist yet. */
export function readKeys(projectDir: string): string | null {
  try {
    const f = keysFile(projectDir);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  } catch {
    return null;
  }
}

/** Remove one ticket's generated sources — NOT the rest of the project. */
export function cleanTicketDir(projectDir: string, ticketDir: string): void {
  for (const base of [fluentDir(projectDir), serverDir(projectDir)]) {
    const d = path.join(base, ticketDir);
    fs.rmSync(d, { recursive: true, force: true });
  }
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

const TICKET_DIR_RE = /^t-[a-z0-9]{6}-/;

/**
 * File everything the Developer emitted under `src/fluent/<ticketDir>/` and
 * `src/server/<ticketDir>/`, preserving the sub-path. A path already inside
 * *this* ticket's dir is left alone; a path inside a *different* ticket's dir
 * (looks like `t-xxxxxx-…`) is rejected — editing another ticket's file is a
 * build-gate failure the reviewer must see (REFACTOR_BRIEF 2.1).
 */
export function relocateIntoTicketDir(
  files: GeneratedFile[],
  ticketDir: string,
): { files: GeneratedFile[]; rejected: string[] } {
  const out: GeneratedFile[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    const p = f.path.replace(/\\/g, "/");
    const m = p.match(/^src\/(fluent|server)\/(.+)$/);
    if (!m) {
      rejected.push(`${p} (not under src/fluent/ or src/server/)`);
      continue;
    }
    const [, area, rest] = m;
    const firstSeg = rest.split("/")[0];
    if (firstSeg === ticketDir) {
      out.push(f); // already correctly placed
    } else if (TICKET_DIR_RE.test(firstSeg)) {
      rejected.push(`${p} (belongs to another ticket's directory)`);
    } else {
      out.push({ path: `src/${area}/${ticketDir}/${rest}`, content: f.content });
    }
  }
  return { files: out, rejected };
}

export interface BuildResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Just the error / diagnostic lines, for feeding back to the agent. */
  diagnostics: string;
  fileCount: number;
}

function extractDiagnostics(out: string): string {
  const lines = out
    .split(/\r?\n/)
    .filter((l) => /\bERROR\b|error TS\d|diagnostic|not allowed|No overload/i.test(l));
  return lines.join("\n").trim() || out.trim().slice(0, 4000);
}

/**
 * Write `files` into `projectDir/src/{fluent,server}/<ticketDir>/` (replacing
 * only that dir) and run `now-sdk build` over the WHOLE project. The caller
 * holds `withProjectLock` and is responsible for the git state (branch,
 * commit-or-discard) around this call.
 */
export async function buildProject(
  projectDir: string,
  ticketDir: string,
  files: GeneratedFile[],
): Promise<BuildResult> {
  cleanTicketDir(projectDir, ticketDir);
  writeGeneratedFiles(projectDir, files);
  const { stdout, stderr, code } = await runNowSdk(["build"], {
    cwd: projectDir,
    timeoutMs: 180_000,
    maxChars: 20_000,
  });
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  return { code, stdout, stderr, diagnostics: extractDiagnostics(combined), fileCount: files.length };
}
