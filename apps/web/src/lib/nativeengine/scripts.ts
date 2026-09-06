import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WORKSPACES_ROOT, REPO_ROOT } from "@/lib/config";
import type { ChangePlan } from "@/lib/nativeengine/plan";
import { ALLOWED } from "@/lib/nativeengine/tables";

/**
 * Script-file handling for the native engine (NATIVE_ENGINE_BRIEF §4.3). A
 * change plan's script bodies live as real `.js` files in the ticket's native
 * directory so they are diffable and Git-tracked, and are inlined into the
 * plan at apply time.
 */

const execFileAsync = promisify(execFile);

/** `<WORKSPACES_ROOT>/<customer-slug>/native/<ticket-dir>/` — absolute. */
export function nativeTicketDir(customerSlug: string, ticketDir: string): string {
  return path.join(WORKSPACES_ROOT, customerSlug, "native", ticketDir);
}

export interface ScriptFile {
  path: string; // relative to the ticket dir, e.g. "assign-approver.js"
  content: string;
}

/** Write script files under `dir`, path-guarded (no escape, no traversal). */
export function writeScriptFiles(dir: string, files: ScriptFile[]): void {
  const root = path.resolve(dir);
  for (const f of files) {
    const resolved = path.resolve(path.join(dir, f.path));
    if (!resolved.startsWith(root + path.sep)) throw new Error(`refusing to write outside the ticket dir: ${f.path}`);
    if (!f.path.endsWith(".js")) throw new Error(`script files must be .js: ${f.path}`);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, f.content.endsWith("\n") ? f.content : f.content + "\n", "utf8");
  }
}

/** Read a script body from the ticket dir, or null. */
export function readScriptFile(dir: string, relPath: string): string | null {
  try {
    const resolved = path.resolve(path.join(dir, relPath));
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) return null;
    return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8") : null;
  } catch {
    return null;
  }
}

const GLOBALS_DTS = `// Injected ServiceNow server globals — minimal shims so \`checkJs\` can flag
// undeclared identifiers and syntax errors. Richer typing is a follow-up.
declare const gs: any;
declare const current: any;
declare const previous: any;
declare const g_form: any;
declare const g_scratchpad: any;
declare const action: any;
declare const event: any;
declare class GlideRecord { constructor(table: string); [k: string]: any; }
declare class GlideAggregate { constructor(table: string); [k: string]: any; }
declare class GlideDateTime { constructor(v?: any); [k: string]: any; }
declare class GlideDate { constructor(v?: any); [k: string]: any; }
declare class GlideDuration { constructor(v?: any); [k: string]: any; }
declare class GlideElement { [k: string]: any; }
declare const GlideStringUtil: any;
declare const JSUtil: any;
declare function Class(): any;
declare namespace Class { function create(): any; }
`;

/**
 * Best-effort JS type-check of the ticket's script files: `tsc --checkJs
 * --noEmit` in a scratch dir with the globals shim above. Returns compiler
 * error lines (empty = clean). Syntax errors and undeclared-identifier use are
 * the main catches.
 */
export async function typecheckScripts(dir: string): Promise<{ errors: string[] }> {
  const jsFiles = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".js")) : [];
  if (jsFiles.length === 0) return { errors: [] };

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "snde-tsc-"));
  try {
    fs.writeFileSync(path.join(scratch, "globals.d.ts"), GLOBALS_DTS, "utf8");
    for (const f of jsFiles) fs.copyFileSync(path.join(dir, f), path.join(scratch, f));
    fs.writeFileSync(
      path.join(scratch, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            allowJs: true,
            checkJs: true,
            noEmit: true,
            strict: false,
            noImplicitAny: false,
            target: "es2021",
            lib: ["es2021"],
            types: [],
            skipLibCheck: true,
          },
          include: ["*.js", "globals.d.ts"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const tscBin = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
    const { stdout } = await execFileAsync(process.execPath, [tscBin, "-p", path.join(scratch, "tsconfig.json")], {
      cwd: scratch,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    }).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? "" }));

    const errors = stdout
      .split(/\r?\n/)
      .filter((l) => /error TS\d+:/.test(l))
      .map((l) => l.trim());
    return { errors };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Inline each `script.file`'s content into its change's script field. For Phase 5 apply. */
export function resolveScripts(plan: ChangePlan, dir: string): ChangePlan {
  return {
    ...plan,
    changes: plan.changes.map((c) => {
      if (!c.script) return c;
      const spec = ALLOWED[c.table];
      const field = spec?.scriptField ?? "script";
      const body = readScriptFile(dir, c.script.file);
      if (body == null) throw new Error(`change "${c.id}": script.file "${c.script.file}" not found`);
      const rest = { ...c };
      delete (rest as { script?: unknown }).script;
      return { ...rest, fields: { ...c.fields, [field]: body } };
    }),
  };
}
