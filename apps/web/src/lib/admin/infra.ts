import { prisma } from "@/lib/db";

/**
 * Shared query for the Settings → Infrastructure page and its API route
 * (NATIVE_ENGINE_BRIEF §7.4). Read-only; the mutations live in the routes.
 */

const instanceSelect = {
  id: true,
  name: true,
  url: true,
  env: true,
  authMode: true,
  credentialRef: true,
  readOnlyCredentialRef: true,
  releaseName: true,
  releaseBuild: true,
  releaseDetectedAt: true,
} as const;

const projectSelect = { id: true, name: true, scope: true, kind: true, defaultBranch: true } as const;

export function listCustomersForAdmin() {
  return prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      allowFluentFlows: true,
      createdAt: true,
      instances: { orderBy: { env: "asc" }, select: instanceSelect },
      projects: { orderBy: { createdAt: "asc" }, select: projectSelect },
      _count: { select: { tickets: true } },
    },
  });
}

/** kebab-case, unique-ified against existing slugs. */
export async function slugFor(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "customer";
  let slug = base;
  for (let n = 2; await prisma.customer.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
  return slug;
}
