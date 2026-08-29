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
  NOW_SDK_WORKSPACE: z.string().min(1).default("./servicenow/delivery-app"),
  SN_AUTH_ALIAS: z.string().min(1).default("pdi"),
  SN_INSTANCE_URL: z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = parsed.data;

/** Absolute path to the now-sdk workspace (NOW_SDK_WORKSPACE resolved against the repo root). */
export const NOW_SDK_CWD = path.isAbsolute(config.NOW_SDK_WORKSPACE)
  ? config.NOW_SDK_WORKSPACE
  : path.resolve(REPO_ROOT, config.NOW_SDK_WORKSPACE);
