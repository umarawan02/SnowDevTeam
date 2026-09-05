import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Thin `git` wrappers for the per-ticket branch workflow (REFACTOR_BRIEF
 * Phase 2). Each customer FluentProject is its own git repo under
 * WORKSPACES_ROOT; a ticket runs on its own `ticket/<dir>` branch, is
 * committed after a passing build gate, and is rebuilt onto the default
 * branch at deploy.
 *
 * None of these take a lock — every caller already holds
 * `withProjectLock(repoPath, …)` from `@/lib/nowsdk/workspace`. `git` is a
 * real `.exe` (execFile resolves it via PATHEXT); no shell, so a commit
 * message can't inject.
 */

const execFileAsync = promisify(execFile);

// The machine has no global git identity — set one inline on every commit.
const IDENT = ["-c", "user.email=snowdevteam@local", "-c", "user.name=SnowDevTeam"];

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function git(repoPath: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: repoPath,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(e.message ?? e),
    };
  }
}

/** Run `git`, throwing on a non-zero exit — for the tree-state ops where a
 *  silent failure would leave the working tree on the wrong branch. */
async function gitOrThrow(repoPath: string, args: string[]): Promise<GitResult> {
  const r = await git(repoPath, args);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${r.code}) in ${repoPath}:\n${r.stderr || r.stdout}`);
  }
  return r;
}

/** Force the working tree to a clean checkout of `ref` (drops tracked + untracked changes). */
export async function discardTree(repoPath: string, ref: string): Promise<void> {
  await gitOrThrow(repoPath, ["checkout", "-f", ref]);
  await git(repoPath, ["clean", "-fd"]);
}

/**
 * Reset `branch` to `base` and check it out, forcing past any local state.
 * Leaves a clean tree at `base` on `branch` — the caller then writes the
 * ticket's files.
 */
export async function resetTicketBranch(repoPath: string, branch: string, base: string): Promise<void> {
  await gitOrThrow(repoPath, ["checkout", "-f", "-B", branch, base]);
  await git(repoPath, ["clean", "-fd"]);
}

/** Stage everything and commit (no-op tolerated via --allow-empty). */
export async function commitAll(repoPath: string, message: string): Promise<GitResult> {
  await git(repoPath, ["add", "-A"]);
  return git(repoPath, [...IDENT, "commit", "-q", "-m", message, "--allow-empty"]);
}

/**
 * Bring just `relPaths` (existing ones) from `branch` onto a clean checkout of
 * `base`, staged. Used at deploy: the ticket's source dirs land on the default
 * branch and `now-sdk build` regenerates keys.ts for the union.
 */
export async function stageTicketOntoDefault(
  repoPath: string,
  base: string,
  branch: string,
  relPaths: string[],
): Promise<{ staged: string[]; missing: string[] }> {
  await discardTree(repoPath, base);
  if (!(await branchExists(repoPath, branch))) {
    throw new Error(`ticket branch ${branch} does not exist in ${repoPath}`);
  }
  const staged: string[] = [];
  const missing: string[] = [];
  for (const p of relPaths) {
    const r = await git(repoPath, ["checkout", branch, "--", p]);
    if (r.code === 0) staged.push(p);
    else missing.push(p);
  }
  return { staged, missing };
}

/** `true` if `branch` exists locally. */
export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const r = await git(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.code === 0;
}

/** Porcelain status — empty string means a clean tree. */
export async function statusPorcelain(repoPath: string): Promise<string> {
  const r = await git(repoPath, ["status", "--porcelain"]);
  return r.stdout.trim();
}
