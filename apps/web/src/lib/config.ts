import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

/** Walk up from `start` until a directory containing `pnpm-workspace.yaml` is found. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to two levels up (apps/web -> repo root).
  return path.resolve(start, "..", "..");
}

export const REPO_ROOT = findRepoRoot(process.cwd());

// Repo-root .env holds runtime config (Anthropic key, ServiceNow paths).
// apps/web/.env holds only DATABASE_URL (Prisma convention). dotenv does not
// override already-set vars, so load the app-local file first, root second.
loadEnv({ path: path.join(process.cwd(), ".env") });
loadEnv({ path: path.join(REPO_ROOT, ".env") });

const Env = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required (repo-root .env)"),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),
  // Root directory holding every customer's Fluent projects
  // (workspaces/<customer-slug>/<project-slug>/, one per FluentProject row).
  // Each project is its own git repo with its own node_modules — never
  // committed here (see root .gitignore).
  WORKSPACES_ROOT: z.string().min(1).default("./workspaces"),
  SN_AUTH_ALIAS: z.string().min(1).default("pdi"),
  SN_INSTANCE_URL: z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = parsed.data;

/** Absolute path to the workspaces root (WORKSPACES_ROOT resolved against the repo root). */
export const WORKSPACES_ROOT = path.isAbsolute(config.WORKSPACES_ROOT)
  ? config.WORKSPACES_ROOT
  : path.resolve(REPO_ROOT, config.WORKSPACES_ROOT);
