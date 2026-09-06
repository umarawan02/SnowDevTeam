import type { Instance } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ARTIFACT_TYPE, NATIVE_DEPLOY_STATE, RELEASE_GATE } from "@/lib/constants";
import { SnowClient, SnowError } from "@/lib/servicenow/client";
import { cicdCall, CicdError, type CicdProgress } from "@/lib/servicenow/cicd";

/**
 * dev → test → prod promotion for a native deployment (NATIVE_ENGINE_BRIEF
 * §5.3). retrieve → preview → commit, each an async `sn_cicd` job polled to
 * completion — HTTP 200 is never treated as success. Any unresolved
 * `sys_update_preview_problem` blocks and is surfaced as a `PREVIEW_PROBLEMS`
 * artifact.
 *
 * Not an agent tool — called only from the promote/rollback API routes behind a
 * reviewer (TEST) or admin + change-request (PROD) check.
 */

export interface PromoteResult {
  ok: boolean;
  blocked?: boolean;
  toGate: (typeof RELEASE_GATE)[keyof typeof RELEASE_GATE];
  remoteUpdateSetId?: string;
  error?: string;
}

function linkId(p: CicdProgress, key: string): string | undefined {
  const links = p.links as { [k: string]: { id?: string; url?: string } } | undefined;
  return links?.[key]?.id;
}

/** The `sys_update_set_source` on `target` that points back at `source`, or null. */
async function updateSource(target: SnowClient, sourceUrl: string): Promise<{ sysId: string; name: string } | null> {
  const host = new URL(sourceUrl).host;
  const rows = await target.table.list<{ sys_id: string; name: string; url: string; active: string }>(
    "sys_update_set_source",
    { query: "active=true", fields: "sys_id,name,url,active", limit: 50 },
  );
  const match = rows.find((r) => {
    try {
      return new URL(r.url).host === host;
    } catch {
      return false;
    }
  });
  return match ? { sysId: match.sys_id, name: match.name } : null;
}

async function upsertArtifact(ticketId: string, type: string, content: string): Promise<void> {
  const existing = await prisma.artifact.findFirst({ where: { ticketId, type } });
  if (existing) await prisma.artifact.update({ where: { id: existing.id }, data: { content } });
  else await prisma.artifact.create({ data: { ticketId, type, content } });
}

export async function promote(opts: {
  ticketId: string;
  fromInstance: Instance;
  toInstance: Instance;
  toGate: typeof RELEASE_GATE.TEST | typeof RELEASE_GATE.PROD;
  actorId?: string | null;
}): Promise<PromoteResult> {
  const { ticketId, fromInstance, toInstance, toGate } = opts;
  const dep = await prisma.nativeDeployment.findUnique({ where: { ticketId } });
  if (!dep) return { ok: false, toGate, error: "no NativeDeployment for this ticket — apply to dev first" };
  if (dep.state === NATIVE_DEPLOY_STATE.APPLYING || dep.state === NATIVE_DEPLOY_STATE.APPLY_FAILED) {
    return { ok: false, toGate, error: `deployment state is ${dep.state} — not ready to promote` };
  }

  const target = SnowClient.forInstance(toInstance);
  const log: string[] = [
    `# Promote Log — ${toGate}`,
    "",
    `${fromInstance.name} → ${toInstance.name}`,
    `Update set: ${dep.updateSetName} (${dep.updateSetSysId})`,
    `Started: ${new Date().toISOString()}`,
    "",
  ];

  const finish = async (extra: string, result: PromoteResult): Promise<PromoteResult> => {
    log.push(extra);
    await upsertArtifact(ticketId, ARTIFACT_TYPE.PROMOTE_LOG, log.join("\n") + "\n");
    return result;
  };

  try {
    // 1. update source configured?
    const src = await updateSource(target, fromInstance.url);
    if (!src) {
      return finish(
        `## Blocked\n\nNo active \`sys_update_set_source\` on **${toInstance.name}** pointing at \`${fromInstance.url}\`.\n` +
          `Configure one (Retrieved Update Sets → Update Sources → New) and re-run. See docs/customer-onboarding.md.`,
        { ok: false, toGate, error: "no update source configured on the target" },
      );
    }
    log.push(`Update source: \`${src.name}\` (${src.sysId}).`);

    await prisma.nativeDeployment.update({ where: { ticketId }, data: { state: NATIVE_DEPLOY_STATE.PROMOTING } });

    // 2. retrieve
    const retrieved = await cicdCall(target, "/api/sn_cicd/update_set/retrieve", {
      query: {
        update_set_id: dep.updateSetSysId,
        update_source_id: src.sysId,
        auto_preview: "true",
        cleanup_retrieved: "true",
      },
    });
    let remoteId = linkId(retrieved, "results");
    if (!remoteId) {
      const remote = await target.table.getOne<{ sys_id: string }>("sys_remote_update_set", {
        query: `update_set=${dep.updateSetSysId}^ORremote_sys_id=${dep.updateSetSysId}`,
        fields: "sys_id",
      });
      remoteId = remote?.sys_id;
    }
    if (!remoteId) {
      return finish(`## Blocked\n\nRetrieve completed but the remote update set id could not be resolved.`, {
        ok: false,
        toGate,
        error: "remote update set id not found after retrieve",
      });
    }
    log.push(`Retrieved → remote update set \`${remoteId}\`.`);

    // 3. preview (auto_preview=true already ran one; run again to be safe + read problems)
    try {
      await cicdCall(target, `/api/sn_cicd/update_set/preview/${remoteId}`);
    } catch (e) {
      if (!(e instanceof CicdError)) throw e;
      log.push(`Preview job reported: ${e.message}`);
    }
    const problems = await target.table.list<Record<string, string>>("sys_update_preview_problem", {
      query: `remote_update_set=${remoteId}^status!=resolved^status!=ignored`,
      fields: "type,description,status,sys_id",
      limit: 200,
    });
    if (problems.length) {
      const md = [
        `# Preview Problems — ${toGate}`,
        "",
        `${problems.length} unresolved problem(s) on remote update set \`${remoteId}\`. Commit is blocked.`,
        "",
        "| Type | Status | Description |",
        "| --- | --- | --- |",
        ...problems.map((p) => `| ${p.type} | ${p.status} | ${String(p.description).replace(/\|/g, "\\|").slice(0, 300)} |`),
        "",
      ].join("\n");
      await upsertArtifact(ticketId, ARTIFACT_TYPE.PREVIEW_PROBLEMS, md);
      await prisma.nativeDeployment.update({
        where: { ticketId },
        data: { state: NATIVE_DEPLOY_STATE.APPLIED, ...(toGate === RELEASE_GATE.TEST ? { remoteUpdateSetTest: remoteId } : { remoteUpdateSetProd: remoteId }) },
      });
      return finish(`## Blocked\n\n${problems.length} unresolved preview problem(s) — see the Preview Problems artifact.`, {
        ok: false,
        blocked: true,
        toGate,
        remoteUpdateSetId: remoteId,
        error: `${problems.length} unresolved preview problem(s)`,
      });
    }
    log.push(`Preview clean — no unresolved problems.`);

    // 4. commit
    await cicdCall(target, `/api/sn_cicd/update_set/commit/${remoteId}`, { body: { force_commit: "false" } });
    log.push(`Committed on ${toInstance.name}.`);

    await prisma.nativeDeployment.update({
      where: { ticketId },
      data: {
        state: toGate === RELEASE_GATE.PROD ? NATIVE_DEPLOY_STATE.IN_PROD : NATIVE_DEPLOY_STATE.IN_TEST,
        ...(toGate === RELEASE_GATE.TEST ? { remoteUpdateSetTest: remoteId } : { remoteUpdateSetProd: remoteId }),
      },
    });
    await prisma.ticket.update({ where: { id: ticketId }, data: { releaseGate: toGate } });

    return finish(`## Result\n\n✓ Promoted to ${toGate}.`, { ok: true, toGate, remoteUpdateSetId: remoteId });
  } catch (e) {
    const msg = e instanceof SnowError || e instanceof CicdError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e);
    await prisma.nativeDeployment.updateMany({ where: { ticketId }, data: { state: NATIVE_DEPLOY_STATE.APPLIED } });
    return finish(`## FAILED\n\n${msg}`, { ok: false, toGate, error: msg });
  }
}

/**
 * Roll a committed update set back out on `instance` (admin-only "Roll back").
 * `updateSetSysId` is the LOCAL committed update set on that instance.
 */
export async function backOut(opts: {
  ticketId: string;
  instance: Instance;
  updateSetSysId: string;
  actorId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const client = SnowClient.forInstance(opts.instance);
  const log = [`# Roll back on ${opts.instance.name}`, "", `Update set \`${opts.updateSetSysId}\``, `Started: ${new Date().toISOString()}`, ""];
  try {
    await cicdCall(client, "/api/sn_cicd/update_set/back_out", {
      query: { update_set_id: opts.updateSetSysId, rollback_installs: "true" },
    });
    log.push("✓ Backed out.");
    await prisma.nativeDeployment.updateMany({ where: { ticketId: opts.ticketId }, data: { state: NATIVE_DEPLOY_STATE.ROLLED_BACK } });
    await upsertArtifact(opts.ticketId, ARTIFACT_TYPE.PROMOTE_LOG, log.join("\n") + "\n");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.push(`✗ ${msg}`);
    await upsertArtifact(opts.ticketId, ARTIFACT_TYPE.PROMOTE_LOG, log.join("\n") + "\n");
    return { ok: false, error: msg };
  }
}
