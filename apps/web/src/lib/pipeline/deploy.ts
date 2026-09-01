import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE, TICKET_STATUS } from "@/lib/constants";
import { config, NOW_SDK_CWD } from "@/lib/config";
import { runNowSdk } from "@/lib/nowsdk/cli";
import { parseGeneratedFiles } from "@/lib/pipeline/parse";
import { verifyDeployment } from "@/lib/servicenow/verify";

export interface DeployResult {
  ok: boolean;
  ticketId: string;
  status: string;
  error?: string;
}

const FLUENT_DIR = path.join(NOW_SDK_CWD, "src", "fluent");
const SERVER_DIR = path.join(NOW_SDK_CWD, "src", "server");

/** Remove previously-written generated sources, keeping SDK-managed files. */
function cleanWorkspace(): string[] {
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

function writeGeneratedFile(relPath: string, content: string): void {
  const abs = path.join(NOW_SDK_CWD, relPath);
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(path.resolve(NOW_SDK_CWD) + path.sep)) {
    throw new Error(`Refusing to write outside the workspace: ${relPath}`);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content.endsWith("\n") ? content : content + "\n", "utf8");
}

function section(title: string, body: string): string {
  return `\n## ${title}\n\n\`\`\`text\n${body.trim() || "(no output)"}\n\`\`\`\n`;
}

/**
 * Build + deploy a ticket's generated ServiceNow code to the PDI, then verify.
 *
 * The ONLY entry point to deploy logic. Hard-requires `READY_FOR_REVIEW` — there
 * is no path that deploys any other status, and nothing calls this without an
 * explicit human action (the Approve button or the manual dev script).
 */
export async function deployTicket(ticketId: string, reviewerId?: string | null): Promise<DeployResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { artifacts: { orderBy: { createdAt: "asc" } } },
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

  // Latest CODE artifact — a rework loop may have produced more than one.
  const codeArtifact = [...ticket.artifacts].reverse().find((a) => a.type === ARTIFACT_TYPE.CODE);
  const { files, warnings } = parseGeneratedFiles(codeArtifact?.content ?? "");

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: TICKET_STATUS.DEPLOYING, ...(reviewerId ? { reviewedById: reviewerId } : {}) },
  });

  let log = `# Deploy — ${ticket.title}\n\nStarted: ${new Date().toISOString()}\nWorkspace: \`${NOW_SDK_CWD}\`\n`;

  const finishFailed = async (extra: string) => {
    log += extra;
    await storeLog(ticketId, log);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: TICKET_STATUS.FAILED } });
    return { ok: false, ticketId, status: TICKET_STATUS.FAILED, error: extra.slice(0, 500) };
  };

  try {
    if (files.length === 0) {
      return await finishFailed(
        section("Parse", `No deployable files in the Developer output.\n${warnings.join("\n")}`),
      );
    }

    const removed = cleanWorkspace();
    for (const f of files) writeGeneratedFile(f.path, f.content);
    log +=
      section(
        "Files",
        `Removed: ${removed.join(", ") || "(none)"}\n\nWrote ${files.length} file(s):\n` +
          files.map((f) => `  ${f.path}`).join("\n") +
          (warnings.length ? `\n\nParser warnings:\n${warnings.join("\n")}` : ""),
      );

    // 1. build
    const build = await runNowSdk(["build"], { timeoutMs: 180_000, maxChars: 24_000 });
    log += section(
      `now-sdk build  (exit ${build.code})`,
      [build.stdout, build.stderr].filter(Boolean).join("\n"),
    );
    if (build.code !== 0) {
      return await finishFailed("\n**Build failed — install was not attempted.**\n");
    }

    // 2. install (deploy)
    const install = await runNowSdk(["install", "--auth", config.SN_AUTH_ALIAS], {
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
    const verification = await verifyDeployment();
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
    return await finishFailed(section("Error", err instanceof Error ? err.stack ?? err.message : String(err)));
  }
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
