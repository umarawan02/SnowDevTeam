import fs from "node:fs";
import path from "node:path";
import { NOW_SDK_CWD } from "@/lib/config";
import type { TargetScope } from "@/lib/constants";
import { runNowSdk } from "@/lib/nowsdk/cli";
import type { GeneratedFile } from "@/lib/pipeline/parse";

/**
 * The single now-sdk workspace. The build gate, the Developer's `build` tool,
 * and the deploy step all write generated code here and run `now-sdk build`.
 * All of it is serialised through `withWorkspaceLock` — there is one workspace.
 */

const FLUENT_DIR = path.join(NOW_SDK_CWD, "src", "fluent");
const SERVER_DIR = path.join(NOW_SDK_CWD, "src", "server");
const KEYS_FILE = path.join(FLUENT_DIR, "generated", "keys.ts");
const CONFIG_FILE = path.join(NOW_SDK_CWD, "now.config.json");

const SCOPED_FALLBACK: Record<string, unknown> = {
  scope: "x_1460392_delivery",
  scopeId: "f53ca6b11fdb4e81af25056bdf0f44ea",
  name: "AI Delivery App",
  tsconfigPath: "./src/server/tsconfig.json",
};

/** The on-disk config is the scoped-app baseline; read it once. If the file is
 *  missing or somehow left on the global scope (crashed deploy), fall back. */
const SCOPED_CONFIG: Record<string, unknown> = (() => {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Record<string, unknown>;
    return typeof parsed.scope === "string" && parsed.scope.startsWith("x_") ? parsed : SCOPED_FALLBACK;
  } catch {
    return SCOPED_FALLBACK;
  }
})();

// A global-scope SDK app is still its own app container with a real scopeId —
// the literal "global" scopeId fails install ("RollbackContext invalid state").
// This app ("AI Delivery Global", installed on the PDI) owns the net-new records
// the pipeline builds for GLOBAL tickets; those records land in `sys_scope =
// Global` and may reference OOB records freely.
const GLOBAL_CONFIG: Record<string, unknown> = {
  scope: "global",
  scopeId: "a53b8a582a264cb4a8a677e40196a818",
  name: "AI Delivery Global",
  // "Must be 2.0.0+ for Global apps" — per `now-sdk explain now-config-reference`.
  packageResolverVersion: "2.0.0",
  tsconfigPath: "./src/server/tsconfig.json",
};

function configFor(scope: TargetScope): Record<string, unknown> {
  return scope === "global" ? GLOBAL_CONFIG : SCOPED_CONFIG;
}

export function snapshotConfig(): string | null {
  try {
    return fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, "utf8") : null;
  } catch {
    return null;
  }
}
export function restoreConfig(snap: string | null): void {
  try {
    if (snap != null) fs.writeFileSync(CONFIG_FILE, snap, "utf8");
  } catch {
    /* best effort */
  }
}

/** Point the workspace at the global or the scoped app before a build. */
export function writeProjectConfig(scope: TargetScope): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configFor(scope), null, 4) + "\n", "utf8");
}

let chain: Promise<unknown> = Promise.resolve();
/** Run `fn` after every earlier workspace operation has finished. */
export function withWorkspaceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

/** Remove previously-written generated sources, keeping SDK-managed files. */
export function cleanWorkspace(): string[] {
  const removed: string[] = [];
  if (fs.existsSync(FLUENT_DIR)) {
    for (const entry of fs.readdirSync(FLUENT_DIR)) {
      if (entry === "generated") continue; // keys.ts is SDK-managed
      fs.rmSync(path.join(FLUENT_DIR, entry), { recursive: true, force: true });
      removed.push(`src/fluent/${entry}`);
    }
  }
  if (fs.existsSync(SERVER_DIR)) {
    for (const entry of fs.readdirSync(SERVER_DIR)) {
      if (entry === "tsconfig.json") continue;
      fs.rmSync(path.join(SERVER_DIR, entry), { recursive: true, force: true });
      removed.push(`src/server/${entry}`);
    }
  }
  return removed;
}

export function writeGeneratedFiles(files: GeneratedFile[]): void {
  for (const f of files) {
    const resolved = path.resolve(path.join(NOW_SDK_CWD, f.path));
    if (!resolved.startsWith(path.resolve(NOW_SDK_CWD) + path.sep)) {
      throw new Error(`Refusing to write outside the workspace: ${f.path}`);
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
export function snapshotKeys(): string | null {
  try {
    return fs.existsSync(KEYS_FILE) ? fs.readFileSync(KEYS_FILE, "utf8") : null;
  } catch {
    return null;
  }
}
export function restoreKeys(snap: string | null): void {
  try {
    if (snap != null && fs.existsSync(path.dirname(KEYS_FILE))) {
      fs.writeFileSync(KEYS_FILE, snap, "utf8");
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
 * Write `files` and run `now-sdk build` — serialised, and `keys.ts` is always
 * restored afterwards. For the build gate and the Developer's `build` tool;
 * `deployTicket` orchestrates its own build + install + keys.
 */
export function buildWorkspace(
  files: GeneratedFile[],
  opts: { scope?: TargetScope } = {},
): Promise<BuildResult> {
  return withWorkspaceLock(async () => {
    const keys = snapshotKeys();
    const cfg = snapshotConfig();
    try {
      if (opts.scope) writeProjectConfig(opts.scope);
      const removed = cleanWorkspace();
      writeGeneratedFiles(files);
      const { stdout, stderr, code } = await runNowSdk(["build"], {
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
      restoreKeys(keys);
      restoreConfig(cfg);
    }
  });
}
