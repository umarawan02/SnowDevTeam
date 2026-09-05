import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { config, WORKSPACES_ROOT } from "@/lib/config";
import { type TargetScope } from "@/lib/constants";
import { runNowSdk, type NowSdkResult } from "@/lib/nowsdk/cli";
import type { ProjectContext } from "@/lib/projects/resolve";

/**
 * Project provisioning (REFACTOR_BRIEF Phase 1) — scaffold / import a
 * customer-owned Fluent project. Each project is a standalone `now-sdk`
 * project: its own directory under WORKSPACES_ROOT, its own `package.json` +
 * `node_modules` (a real `npm install`, not shared with this monorepo), its
 * own git repo.
 *
 * Heavy (`fs` / `child_process`) — only imported by scripts and future admin
 * actions, never by request-path route handlers. Request-path resolution is
 * in `./resolve`.
 */

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === "win32";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** Real per-project install — every FluentProject has its own node_modules. */
export async function npmInstall(dir: string): Promise<void> {
  // On Windows `npm` is `npm.cmd`; recent Node refuses to spawn `.cmd` via
  // execFile without a shell (EINVAL). `shell: true` resolves it on both.
  await execFileAsync("npm", ["install"], {
    cwd: dir,
    timeout: 5 * 60_000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    shell: IS_WIN,
  });
}

// git is a real .exe — execFile resolves it via PATHEXT; no shell needed
// (and no shell wanted: `message` is interpolated into args).
const git = (dir: string, args: string[]) => execFileAsync("git", args, { cwd: dir, windowsHide: true });

/** Stage everything in `dir` and commit it (no-op if nothing changed). */
export async function gitAddCommit(dir: string, message: string): Promise<void> {
  await git(dir, ["add", "-A"]);
  // No global git identity is assumed on this machine — set one inline.
  await git(dir, [
    "-c",
    "user.email=snowdevteam@local",
    "-c",
    "user.name=SnowDevTeam",
    "commit",
    "-q",
    "-m",
    message,
    "--allow-empty",
  ]);
}

/** `git init` + one commit of everything currently in `dir`. */
export async function gitInitialCommit(dir: string, message: string): Promise<void> {
  await git(dir, ["init", "-q"]);
  await gitAddCommit(dir, message);
}

export function readNowConfig(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, "now.config.json"), "utf8"));
}

export function writeNowConfig(dir: string, cfg: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, "now.config.json"), JSON.stringify(cfg, null, 4) + "\n", "utf8");
}

function patchNowConfig(dir: string, patch: Record<string, unknown>): void {
  writeNowConfig(dir, { ...readNowConfig(dir), ...patch });
}

/**
 * Scaffold a brand-new Fluent project (`now-sdk init`), give it a real
 * `npm install`, commit it, and register the FluentProject row.
 */
export async function createProject(input: {
  customerId: string;
  instanceId?: string | null;
  kind: TargetScope;
  /** Human-readable app name, e.g. "Acme Platform Customizations". */
  name: string;
  /** "global" or "x_<vendor>_<name>". */
  scopeName: string;
}): Promise<{ id: string; repoPath: string }> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: input.customerId } });
  const relPath = path.join(customer.slug, slugify(input.name));
  const dir = path.join(WORKSPACES_ROOT, relPath);
  if (fs.existsSync(dir)) throw new Error(`Project directory already exists: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });

  const packageName = `${slugify(customer.slug)}-${slugify(input.name)}`;
  const initRes = await runNowSdk(
    ["init", "--appName", input.name, "--packageName", packageName, "--scopeName", input.scopeName, "--template", "base"],
    { cwd: dir, timeoutMs: 120_000 },
  );
  if (initRes.code !== 0) {
    throw new Error(`now-sdk init failed (exit ${initRes.code}):\n${initRes.stderr || initRes.stdout}`);
  }

  const packageResolverVersion = input.kind === "global" ? "2.0.0" : undefined;
  if (packageResolverVersion) patchNowConfig(dir, { packageResolverVersion });

  await npmInstall(dir);
  await gitInitialCommit(dir, `Scaffold ${input.name}`);

  const cfg = readNowConfig(dir);
  const project = await prisma.fluentProject.create({
    data: {
      customerId: input.customerId,
      instanceId: input.instanceId ?? null,
      name: input.name,
      scope: String(cfg.scope),
      scopeId: String(cfg.scopeId),
      kind: input.kind,
      repoPath: relPath,
      defaultBranch: "main",
      createdVia: "init",
      packageResolverVersion: packageResolverVersion ?? null,
    },
  });
  return { id: project.id, repoPath: dir };
}

/**
 * Register an *existing* ServiceNow app as a Fluent project (`now-sdk init
 * --from <sys_id>`) — for a customer who already has an app on their
 * instance. Pulls the current metadata down as XML; converting it to
 * readable `.now.ts` via `now-sdk transform` is a separate, later step.
 */
export async function importProject(input: {
  customerId: string;
  instanceId?: string | null;
  /** sys_id of the app on the instance (sys_app / sys_scope). */
  appSysId: string;
  name: string;
  kind: TargetScope;
}): Promise<{ id: string; repoPath: string }> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: input.customerId } });
  const relPath = path.join(customer.slug, slugify(input.name));
  const dir = path.join(WORKSPACES_ROOT, relPath);
  if (fs.existsSync(dir)) throw new Error(`Project directory already exists: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });

  const packageName = `${slugify(customer.slug)}-${slugify(input.name)}`;
  const initRes = await runNowSdk(
    ["init", "--from", input.appSysId, "--packageName", packageName, "--auth", config.SN_AUTH_ALIAS],
    { cwd: dir, timeoutMs: 180_000 },
  );
  if (initRes.code !== 0) {
    throw new Error(`now-sdk init --from failed (exit ${initRes.code}):\n${initRes.stderr || initRes.stdout}`);
  }

  // "Must be 2.0.0+ for Global apps" — now-config-reference.
  if (input.kind === "global") patchNowConfig(dir, { packageResolverVersion: "2.0.0" });

  await npmInstall(dir);
  await gitInitialCommit(dir, `Import ${input.name} from ${input.appSysId}`);

  const cfg = readNowConfig(dir);
  const project = await prisma.fluentProject.create({
    data: {
      customerId: input.customerId,
      instanceId: input.instanceId ?? null,
      name: input.name,
      scope: String(cfg.scope),
      scopeId: String(cfg.scopeId),
      kind: input.kind,
      repoPath: relPath,
      defaultBranch: "main",
      createdVia: "init_from",
      packageResolverVersion: cfg.packageResolverVersion ? String(cfg.packageResolverVersion) : null,
    },
  });
  return { id: project.id, repoPath: dir };
}

/** `now-sdk dependencies` — fetch type definitions for the connected instance. */
export function ensureDependencies(project: ProjectContext): Promise<NowSdkResult> {
  return runNowSdk(["dependencies"], { cwd: project.repoPath, timeoutMs: 120_000 });
}
