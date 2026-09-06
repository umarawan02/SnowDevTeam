import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { FLUENT_GLOBAL_APPS_MIN, atLeast, familyOf } from "@/lib/servicenow/releases";

/**
 * Instance release detection (NATIVE_ENGINE_BRIEF Phase 3, §3.4). Reads
 * `glide.war` / `glide.buildname` from `sys_properties`, parses the release
 * family, and persists it on the `Instance` row.
 */

export interface ProbeResult {
  releaseName: string | null;
  releaseBuild: string | null;
  family: string;
  glideWar: string | null;
  supportsFluentGlobalApps: boolean;
}

type InstanceRow = {
  id: string;
  url: string;
  credentialRef: string;
  readOnlyCredentialRef: string | null;
};

export async function probeInstance(instance: InstanceRow): Promise<ProbeResult> {
  const readProps = async (client: SnowClient) =>
    client.table.list<{ name: string; value: string }>("sys_properties", {
      query: "nameINglide.war,glide.buildname,glide.buildtag,glide.product.description",
      fields: "name,value",
      limit: 10,
    });

  // The read-only role may not cover `sys_properties`; fall back to the main credential.
  let props = await readProps(SnowClient.forInstance(instance, { readOnly: true }));
  if (props.length === 0) props = await readProps(SnowClient.forInstance(instance));
  const byName = Object.fromEntries(props.map((p) => [p.name, p.value]));

  const glideWar = byName["glide.war"] ?? null;
  const releaseBuild = byName["glide.buildtag"] ?? glideWar ?? null;
  const releaseName = byName["glide.buildname"] ?? null;
  const family = familyOf(releaseName ?? glideWar ?? "");

  await prisma.instance.update({
    where: { id: instance.id },
    data: {
      releaseName: releaseName ?? family,
      releaseBuild,
      releaseDetectedAt: new Date(),
    },
  });

  return {
    releaseName,
    releaseBuild,
    family,
    glideWar,
    supportsFluentGlobalApps: atLeast(releaseName ?? family, FLUENT_GLOBAL_APPS_MIN),
  };
}

/** Cheap check against the already-probed release on the row. */
export function supportsFluentGlobalApps(instance: { releaseName?: string | null }): boolean {
  return atLeast(instance.releaseName, FLUENT_GLOBAL_APPS_MIN);
}
