import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE, TICKET_STATUS } from "@/lib/constants";
import { config } from "@/lib/config";
import { runNowSdk } from "@/lib/nowsdk/cli";
import { cleanWorkspace, writeGeneratedFiles, snapshotKeys, restoreKeys, withProjectLock } from "@/lib/nowsdk/workspace";
import { keysAdded, parseKeys } from "@/lib/nowsdk/keys";
import { toProjectContext } from "@/lib/projects/resolve";
import { parseGeneratedFiles } from "@/lib/pipeline/parse";
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
  if (!ticket.project) {
    return { ok: false, ticketId, status: ticket.status, error: "ticket has no FluentProject assigned" };
  }
  const project = toProjectContext(ticket.project);

  // Latest CODE artifact — a rework loop may have produced more than one.
  const codeArtifact = [...ticket.artifacts].reverse().find((a) => a.type === ARTIFACT_TYPE.CODE);
  const { files, warnings } = parseGeneratedFiles(codeArtifact?.content ?? "");

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: TICKET_STATUS.DEPLOYING, ...(reviewerId ? { reviewedById: reviewerId } : {}) },
  });

  let log =
    `# Deploy — ${ticket.title}\n\nStarted: ${new Date().toISOString()}\n` +
    `Project: \`${project.id}\` (${project.kind})\nWorkspace: \`${project.repoPath}\`\n`;

  const finishFailed = async (extra: string) => {
    log += extra;
    await storeLog(ticketId, log);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
    return { ok: false, ticketId, status: TICKET_STATUS.FAILED, error: extra.slice(0, 500) };
  };

  return withProjectLock(project.repoPath, async () => {
    const keysSnapshot = snapshotKeys(project.repoPath);
    let deployed = false;
    try {
      if (files.length === 0) {
        return await finishFailed(
          section("Parse", `No deployable files in the Developer output.\n${warnings.join("\n")}`),
        );
      }

      const removed = cleanWorkspace(project.repoPath);
      writeGeneratedFiles(project.repoPath, files);
      log += section(
        "Files",
        `Removed: ${removed.join(", ") || "(none)"}\n\nWrote ${files.length} file(s):\n` +
          files.map((f) => `  ${f.path}`).join("\n") +
          (warnings.length ? `\n\nParser warnings:\n${warnings.join("\n")}` : ""),
      );

      // 1. build (the pipeline gate already verified this, but the workspace may
      //    hold stale files and demo data differs — build again).
      const build = await runNowSdk(["build"], { cwd: project.repoPath, timeoutMs: 180_000, maxChars: 24_000 });
      log += section(
        `now-sdk build  (exit ${build.code})`,
        [build.stdout, build.stderr].filter(Boolean).join("\n"),
      );
      if (build.code !== 0) {
        return await finishFailed("\n**Build failed — install was not attempted.**\n");
      }

      // What this build added to keys.ts — verification queries these exact
      // sys_ids. On a re-deploy the records may already be in the baseline, so
      // also pass the full set as a fallback.
      const keysAfter = snapshotKeys(project.repoPath);
      const created = keysAdded(keysSnapshot, keysAfter);
      const allRecords = parseKeys(keysAfter);

      // 2. install (deploy)
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
        return await finishFailed("\n**Install failed.**\n");
      }

      await storeLog(ticketId, log + "\n**Build + install exited cleanly. Verifying…**\n");

      // 3. verify against the live instance
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
      deployed = true;
      return { ok: true, ticketId, status: TICKET_STATUS.DEPLOYED };
    } catch (err) {
      return await finishFailed(
        section("Error", err instanceof Error ? err.stack ?? err.message : String(err)),
      );
    } finally {
      // keys.ts is regenerated by `now-sdk build`; keep it only on a real deploy.
      if (!deployed) restoreKeys(project.repoPath, keysSnapshot);
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
