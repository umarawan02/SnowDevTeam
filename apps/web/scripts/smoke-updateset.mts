/**
 * Open items #2 + #3 —
 *  #2: the exact `sys_user_preference` name for the current update set, and
 *      whether a plain preference write is honoured;
 *  #3: whether `sn_cicd/update_set/create` also sets the created set current.
 *
 *   pnpm --filter web tsx scripts/smoke-updateset.mts <instanceId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { resolveScope, setCurrentApplication, getDeployUserSysId } from "@/lib/servicenow/scope";
import {
  createUpdateSet,
  capturedUpdates,
  defaultUpdateSet,
  updateCount,
  completeUpdateSet,
} from "@/lib/servicenow/updateset";
import { inertBusinessRule, smokeName, printVerdict, cleanupSmoke, type Verdict } from "@/lib/servicenow/smoke";

const PREF_CANDIDATES = ["sys_update_set", "apps.current_update_set", "glide.update_set"];

async function tryPref(client: SnowClient, userSysId: string, prefName: string, value: string): Promise<boolean> {
  const existing = await client.table.getOne<{ sys_id: string }>("sys_user_preference", {
    query: `user=${userSysId}^name=${prefName}`,
    fields: "sys_id",
  });
  if (existing) await client.table.update("sys_user_preference", existing.sys_id, { value });
  else await client.table.insert("sys_user_preference", { user: userSysId, name: prefName, value, type: "string" });
  const back = await client.table.getOne<{ value: string }>("sys_user_preference", {
    query: `user=${userSysId}^name=${prefName}`,
    fields: "value",
  });
  return back?.value === value;
}

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: smoke-updateset <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id } });
  const client = SnowClient.forInstance(instance);
  const verdicts: Verdict[] = [];

  const global = await resolveScope(client, "global");
  const userSysId = await getDeployUserSysId(client);
  await setCurrentApplication(client, global.sysId);

  const def = await defaultUpdateSet(client, global.sysId);
  const defBaseline = def ? await updateCount(client, def.sysId) : 0;

  const set = await createUpdateSet(client, {
    name: smokeName("US"),
    description: "smoke #2/#3",
    scopeSysId: global.sysId,
  });

  // --- #2: which preference name is honoured, and does the write land in our set?
  let honouredPref: string | null = null;
  for (const p of PREF_CANDIDATES) {
    if (await tryPref(client, userSysId, p, set.sysId)) {
      honouredPref = p;
      break;
    }
  }

  const brName = smokeName("us-capture");
  const br = await client.table.insert<{ sys_id: string }>("sys_script", inertBusinessRule(brName));
  const captured = await capturedUpdates(client, set.sysId);
  const inOurSet = captured.some((c) => c.target_name === brName);
  const defAfter = def ? await updateCount(client, def.sysId) : 0;
  const leakedToDefault = defAfter > defBaseline;
  await client.table.del("sys_script", br.sys_id).catch(() => {});

  verdicts.push({
    name: "updateset / current-set preference",
    openItem: "open item #2",
    status: inOurSet && !leakedToDefault ? "PASS" : honouredPref ? "FAIL" : "INCONCLUSIVE",
    finding:
      inOurSet && !leakedToDefault
        ? `preference "${honouredPref}" is honoured — the write was captured in the ticket set`
        : honouredPref
          ? `preference "${honouredPref}" read back OK but the write ${leakedToDefault ? "leaked to the Default set" : "was not captured anywhere"}`
          : "no candidate preference name was honoured on read-back",
    detail: `honoured pref: ${honouredPref ?? "none"}; captured in our set: ${inOurSet}; leaked to Default: ${leakedToDefault}`,
    action:
      inOurSet && !leakedToDefault
        ? `set CURRENT_UPDATE_SET_PREF = "${honouredPref}" in updateset.ts`
        : "a plain preference write is not enough — need a scripted `GlideUpdateSet.setCurrent` REST resource on the instance",
  });

  // --- #3: does sn_cicd update_set/create set the new set current?
  //     params go on the QUERY STRING, not the body.
  const setName = smokeName("cicd-set");
  const create = await client.post<{
    result?: { status?: string; status_message?: string; update_set_id?: string };
  }>("/api/sn_cicd/update_set/create", {
    query: { update_set_name: setName, description: "smoke #3", scope: "global" },
  });
  const r = create.body?.result;
  if (create.status === 404 || !r) {
    verdicts.push({
      name: "updateset / sn_cicd create",
      openItem: "open item #3",
      status: "INCONCLUSIVE",
      finding: "com.glide.continuousdelivery not available on this instance",
      detail: `status ${create.status}`,
      action: "install com.glide.continuousdelivery + grant sn_cicd.sys_ci_automation before Phase 5",
    });
  } else {
    const ok = String(r.status) === "2" && !!r.update_set_id;
    const pref = ok
      ? await client.table.getOne<{ value: string }>("sys_user_preference", {
          query: `user=${userSysId}^name=sys_update_set`,
          fields: "value",
        })
      : null;
    const setsCurrent = ok && pref?.value === r.update_set_id;
    verdicts.push({
      name: "updateset / sn_cicd create",
      openItem: "open item #3",
      status: ok ? "PASS" : "FAIL",
      finding: ok
        ? `sn_cicd update_set/create works (sync here) — it ${setsCurrent ? "DID" : "did NOT"} set the created set current`
        : `sn_cicd update_set/create failed: ${r.status_message ?? r.status}`,
      detail: `params on query string; update_set_id=${r.update_set_id ?? "-"}; sets-current=${setsCurrent}`,
      action: setsCurrent
        ? "promote.ts can rely on the created set being current"
        : "the engine must set the created set current itself (a server-side scripted resource, since a plain preference write is not honoured — see #2)",
    });
    if (r.update_set_id) await client.table.del("sys_update_set", r.update_set_id).catch(() => {});
  }

  for (const v of verdicts) printVerdict(v);

  // cleanup
  await completeUpdateSet(client, set.sysId).catch(() => {});
  await cleanupSmoke(client).catch(() => {});
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("SMOKE FAILED:", e instanceof Error ? (e.stack ?? e.message) : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
