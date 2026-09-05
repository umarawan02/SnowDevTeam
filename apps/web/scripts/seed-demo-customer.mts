/**
 * One-off seed: register the existing PDI (dev424712) as a demo Customer +
 * Instance, and import its two already-installed apps as FluentProjects —
 * so REFACTOR_BRIEF Phase 1's new data model has something real behind it
 * and nothing regresses.
 *
 *   pnpm --filter web seed-demo-customer
 *
 * Idempotent: safe to re-run — each step skips if its row/project already
 * exists. Both projects are imported via `now-sdk init --from <sys_id>`
 * against the LIVE instance (read-only there) rather than from this repo's
 * local `servicenow/delivery-app` — that directory's Fluent source only
 * reflects whichever ticket deployed last (the scratchpad bug Phase 2 fixes),
 * and its `keys.ts` carries at least one stale deletion tombstone from an
 * earlier ticket. The instance itself is the only reliable source of truth
 * for what's actually installed right now.
 */
import "@/lib/config"; // loads + validates env before anything else
import { prisma } from "@/lib/db";
import { config as appConfig } from "@/lib/config";
import { runNowSdk } from "@/lib/nowsdk/cli";
import { DEMO_CUSTOMER_SLUG } from "@/lib/projects/resolve";
import { importProject, gitAddCommit } from "@/lib/projects/provision";

const INSTANCE_NAME = "dev424712";
const SCOPED_APP_SYS_ID = "f53ca6b11fdb4e81af25056bdf0f44ea"; // x_1460392_delivery / "AI Delivery App"
const GLOBAL_APP_SYS_ID = "a53b8a582a264cb4a8a677e40196a818"; // global / "AI Delivery Global"

function hr() {
  console.log("─".repeat(70));
}

async function sanityBuild(label: string, repoPath: string): Promise<void> {
  const build = await runNowSdk(["build"], { cwd: repoPath, timeoutMs: 180_000, maxChars: 8_000 });
  console.log(`  sanity build (${label}): exit ${build.code}`);
  if (build.code !== 0) {
    throw new Error(`${label} sanity build failed (exit ${build.code}):\n${build.stdout}\n${build.stderr}`);
  }
  // `now-sdk build` generates src/fluent/generated/keys.ts — commit it so the
  // project repo starts in a fully-committed state.
  await gitAddCommit(repoPath, `Build: generate keys.ts (${label})`);
}

async function main() {
  hr();
  console.log("Seeding demo customer from the live PDI");
  hr();

  // 1. Customer
  let customer = await prisma.customer.findUnique({ where: { slug: DEMO_CUSTOMER_SLUG } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { name: `Demo — ${INSTANCE_NAME}`, slug: DEMO_CUSTOMER_SLUG },
    });
    console.log(`✓ created Customer ${customer.id}`);
  } else {
    console.log(`· Customer ${customer.id} already exists`);
  }

  // 2. Instance
  let instance = await prisma.instance.findFirst({
    where: { customerId: customer.id, name: INSTANCE_NAME },
  });
  if (!instance) {
    instance = await prisma.instance.create({
      data: {
        customerId: customer.id,
        name: INSTANCE_NAME,
        url: appConfig.SN_INSTANCE_URL ?? `https://${INSTANCE_NAME}.service-now.com`,
        env: "dev",
        authMode: "basic",
        // Phase 4 replaces this with a real secret-store reference; for now
        // it just documents where the credentials actually live.
        credentialRef: "env:SN_USERNAME,SN_PASSWORD",
      },
    });
    console.log(`✓ created Instance ${instance.id} (${instance.url})`);
  } else {
    console.log(`· Instance ${instance.id} already exists`);
  }

  // 3. Global project — imported from the live instance, not local disk.
  let globalProject = await prisma.fluentProject.findFirst({
    where: { customerId: customer.id, kind: "global" },
  });
  if (!globalProject) {
    console.log(`  importing global project from sys_id ${GLOBAL_APP_SYS_ID} …`);
    const { id, repoPath } = await importProject({
      customerId: customer.id,
      instanceId: instance.id,
      appSysId: GLOBAL_APP_SYS_ID,
      name: "AI Delivery Global",
      kind: "global",
    });
    await sanityBuild("global", repoPath);
    globalProject = await prisma.fluentProject.findUniqueOrThrow({ where: { id } });
    console.log(`✓ created FluentProject ${globalProject.id} → ${repoPath}`);
  } else {
    console.log(`· global FluentProject ${globalProject.id} already exists`);
  }

  // 4. Scoped project — same treatment.
  let scopedProject = await prisma.fluentProject.findFirst({
    where: { customerId: customer.id, kind: "scoped" },
  });
  if (!scopedProject) {
    console.log(`  importing scoped project from sys_id ${SCOPED_APP_SYS_ID} …`);
    const { id, repoPath } = await importProject({
      customerId: customer.id,
      instanceId: instance.id,
      appSysId: SCOPED_APP_SYS_ID,
      name: "AI Delivery App",
      kind: "scoped",
    });
    await sanityBuild("scoped", repoPath);
    scopedProject = await prisma.fluentProject.findUniqueOrThrow({ where: { id } });
    console.log(`✓ created FluentProject ${scopedProject.id} → ${repoPath}`);
  } else {
    console.log(`· scoped FluentProject ${scopedProject.id} already exists`);
  }

  // 5. Backfill existing tickets (only ones not already attributed).
  const globalBackfill = await prisma.ticket.updateMany({
    where: { customerId: null, targetScope: "global" },
    data: {
      customerId: customer.id,
      instanceId: instance.id,
      projectId: globalProject.id,
      executionTier: "FLUENT_GLOBAL_APP",
    },
  });
  const scopedBackfill = await prisma.ticket.updateMany({
    where: { customerId: null, targetScope: "scoped" },
    data: {
      customerId: customer.id,
      instanceId: instance.id,
      projectId: scopedProject.id,
      executionTier: "FLUENT_SCOPED_APP",
    },
  });
  console.log(`✓ backfilled ${globalBackfill.count} global + ${scopedBackfill.count} scoped existing ticket(s)`);

  hr();
  console.log("Done.");
  console.log(`  Customer         ${customer.id}  (${customer.slug})`);
  console.log(`  Instance         ${instance.id}  (${instance.url})`);
  console.log(`  Global project   ${globalProject.id}  → ${globalProject.repoPath}`);
  console.log(`  Scoped project   ${scopedProject.id}  → ${scopedProject.repoPath}`);
  hr();
}

main()
  .catch((err) => {
    console.error("\nSEED FAILED:", err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
