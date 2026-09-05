/**
 * Delete every `SMOKE-` prefixed record any smoke test may have left on the
 * instance. Run standalone or after a smoke that crashed mid-run.
 *
 *   pnpm --filter web smoke-cleanup <instanceId>
 */
import "@/lib/config";
import { prisma } from "@/lib/db";
import { SnowClient } from "@/lib/servicenow/client";
import { cleanupSmoke } from "@/lib/servicenow/smoke";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: smoke-cleanup <instanceId>");
  const instance = await prisma.instance.findUniqueOrThrow({ where: { id } });
  const client = new SnowClient({
    baseUrl: instance.url,
    credential: { mode: "basic", username: process.env.SN_USERNAME!, password: process.env.SN_PASSWORD! },
  });
  const removed = await cleanupSmoke(client);
  console.log(removed.length ? `removed ${removed.length}:\n  ${removed.join("\n  ")}` : "nothing to clean");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
