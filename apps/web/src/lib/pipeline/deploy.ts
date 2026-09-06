import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE, TICKET_STATUS } from "@/lib/constants";
import { config } from "@/lib/config";
import { runNowSdk } from "@/lib/nowsdk/cli";
import { readKeys, withProjectLock } from "@/lib/nowsdk/workspace";
import { keysAdded, parseKeys } from "@/lib/nowsdk/keys";
import { commitAll, discardTree, stageTicketOntoDefault } from "@/lib/git/repo";
import { toProjectContext } from "@/lib/projects/resolve";
import { ticketBranchName, ticketDirName } from "@/lib/pipeline/parse";
import { verifyDeployment } from "@/lib/servicenow/verify";

export interface DeployResult {
  ok: boolean;
  ticketId: string;
  status: string;
  error?: string;
}

function section(title: string, body: string): string {
  return `\n## ${title}\n\n\`\`\`text\n${body.trim() || "(no output)"}\n\`\`\`\n`;
}

/**
 * Build + deploy a ticket's generated ServiceNow code to its project's
 * instance, then verify.
 *
 * The ONLY entry point to deploy logic. Hard-requires `READY_FOR_REVIEW` — there
 * is no path that deploys any other status, and nothing calls this without an
 * explicit human action (the Approve button or the manual dev script).
 */
export async function deployTicket(ticketId: string, reviewerId?: string | null): Promise<DeployResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { artifacts: { orderBy: { createdAt: "asc" } }, project: true },
  });
  if (!ticket) return { ok: false, ticketId, status: "?", error: "ticket not found" };
  if (ticket.status !== TICKET_STATUS.READY_FOR_REVIEW) {
    return {
      ok: false,
      ticketId,
      status: ticket.status,
      error: `ticket is ${ticket.status}; only READY_FOR_REVIEW tickets can be deployed`,
    };
  }

  // Native tier (NATIVE_ENGINE_BRIEF Phase 5): apply the reviewer-approved
  // CHANGE_PLAN via the Table-API + update-set engine instead of Fluent.
  if (ticket.executionTier?.startsWith("NATIVE")) {
    const { deployNativeTicket } = await import("@/lib/pipeline/deploy-native");
    return deployNativeTicket(ticketId, reviewerId);
  }

  if (!ticket.project) {
    return { ok: false, ticketId, status: ticket.status, error: "ticket has no FluentProject assigned" };
  }
  const project = toProjectContext(ticket.project);
  const ticketDir = ticket.gitBranch?.replace(/^ticket\//, "") || ticketDirName(ticketId, ticket.title);
  const branch = ticketBranchName(ticketDir);
  const base = project.defaultBranch;
  const ticketPaths = [`src/fluent/${ticketDir}`, `src/server/${ticketDir}`];

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: TICKET_STATUS.DEPLOYING, ...(reviewerId ? { reviewedById: reviewerId } : {}) },
  });

  let log =
    `# Deploy — ${ticket.title}\n\nStarted: ${new Date().toISOString()}\n` +
    `Project: \`${project.id}\` (${project.kind})\nBranch: \`${branch}\` → \`${base}\`\n`;

  const finishFailed = async (extra: string) => {
    log += extra;
    await storeLog(ticketId, log);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
    return { ok: false, ticketId, status: TICKET_STATUS.FAILED, error: extra.slice(0, 500) };
  };

  return withProjectLock(project.repoPath, async () => {
    try {
      // 1. Bring just this ticket's source dirs from its branch onto a clean
      //    checkout of the default branch (no git merge → no keys.ts conflict).
      const { staged, missing } = await stageTicketOntoDefault(project.repoPath, base, branch, ticketPaths);
      if (staged.length === 0) {
        await discardTree(project.repoPath, base);
        return await finishFailed(
          section("Merge", `No source found for this ticket on \`${branch}\` — the build gate must run first.`),
        );
      }
      log += section(
        "Merge",
        `Onto \`${base}\`: ${staged.join(", ")}${missing.length ? `  (no ${missing.join(", ")})` : ""}`,
      );

      const keysBefore = readKeys(project.repoPath);

      // 2. Build the whole project — regenerates keys.ts for default + this ticket.
      const build = await runNowSdk(["build"], { cwd: project.repoPath, timeoutMs: 180_000, maxChars: 24_000 });
      log += section(`now-sdk build  (exit ${build.code})`, [build.stdout, build.stderr].filter(Boolean).join("\n"));
      if (build.code !== 0) {
        await discardTree(project.repoPath, base);
        return await finishFailed(
          "\n**Build failed on the default branch (conflicts with already-delivered work). Send back for rework.**\n",
        );
      }

      // 3. --frozenKeys CI check: keys.ts must be internally consistent now.
      const frozen = await runNowSdk(["build", "--frozenKeys"], {
        cwd: project.repoPath,
        timeoutMs: 180_000,
        maxChars: 12_000,
      });
      if (frozen.code !== 0) {
        log += section(
          "now-sdk build --frozenKeys  (FAILED)",
          [frozen.stdout, frozen.stderr].filter(Boolean).join("\n"),
        );
        await discardTree(project.repoPath, base);
        return await finishFailed("\n**Key / sys_id consistency check failed. Send back for rework.**\n");
      }
      log += section("now-sdk build --frozenKeys", "✓ keys / sys_ids up to date");

      const keysAfter = readKeys(project.repoPath);
      const created = keysAdded(keysBefore, keysAfter);
      const allRecords = parseKeys(keysAfter);

      // 4. Install to the instance.
      const install = await runNowSdk(["install", "--auth", config.SN_AUTH_ALIAS], {
        cwd: project.repoPath,
        timeoutMs: 300_000,
        maxChars: 24_000,
      });
      log += section(
        `now-sdk install --auth ${config.SN_AUTH_ALIAS}  (exit ${install.code})`,
        [install.stdout, install.stderr].filter(Boolean).join("\n"),
      );
      if (install.code !== 0) {
        await discardTree(project.repoPath, base);
        return await finishFailed("\n**Install failed — the default branch was left unchanged.**\n");
      }

      // 5. Install landed — commit the merged state on the default branch.
      const commit = await commitAll(project.repoPath, `Deploy ${ticketId.slice(-6)}: ${ticket.title}`.slice(0, 100));
      log += section("git commit", (commit.stdout || commit.stderr || "(committed)").trim());

      await storeLog(ticketId, log + "\n**Build + install exited cleanly. Verifying…**\n");

      // 6. Verify against the live instance.
      const verification = await verifyDeployment({
        scope: project.kind,
        scopeName: project.scope,
        projectDir: project.repoPath,
        created,
        allRecords,
      });
      await prisma.artifact.create({
        data: { ticketId, type: ARTIFACT_TYPE.DEPLOY_VERIFICATION, content: verification.markdown },
      });

      if (!verification.confirmed) {
        await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
        return {
          ok: false,
          ticketId,
          status: TICKET_STATUS.FAILED,
          error: `install exited clean but verification failed: ${verification.reason}`,
        };
      }

      await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.DEPLOYED } });
      return { ok: true, ticketId, status: TICKET_STATUS.DEPLOYED };
    } catch (err) {
      await discardTree(project.repoPath, base).catch(() => {});
      return await finishFailed(
        section("Error", err instanceof Error ? err.stack ?? err.message : String(err)),
      );
    }
  });
}

async function storeLog(ticketId: string, content: string): Promise<void> {
  const existing = await prisma.artifact.findFirst({
    where: { ticketId, type: ARTIFACT_TYPE.DEPLOY_LOG },
  });
  if (existing) {
    await prisma.artifact.update({ where: { id: existing.id }, data: { content } });
  } else {
    await prisma.artifact.create({
      data: { ticketId, type: ARTIFACT_TYPE.DEPLOY_LOG, content },
    });
  }
}

/** Reject a ticket with a required note. */
export async function rejectTicket(
  ticketId: string,
  note: string,
  reviewerId?: string | null,
): Promise<DeployResult> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { ok: false, ticketId, status: "?", error: "ticket not found" };
  if (ticket.status !== TICKET_STATUS.READY_FOR_REVIEW) {
    return {
      ok: false,
      ticketId,
      status: ticket.status,
      error: `ticket is ${ticket.status}; only READY_FOR_REVIEW tickets can be rejected`,
    };
  }
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, ticketId, status: ticket.status, error: "a rejection note is required" };

  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: TICKET_STATUS.REJECTED,
      reviewNote: trimmed,
      ...(reviewerId ? { reviewedById: reviewerId } : {}),
    },
  });
  return { ok: true, ticketId, status: TICKET_STATUS.REJECTED };
}
