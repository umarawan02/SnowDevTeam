import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { backOut } from "@/lib/nativeengine/promote";

export const dynamic = "force-dynamic";

const Body = z.object({ env: z.enum(["dev", "test", "prod"]).default("dev") });

/**
 * Roll back a native deployment's update set on one instance (admin only,
 * NATIVE_ENGINE_BRIEF §5.3). `env` picks which instance's committed copy to
 * back out — defaults to the dev apply.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser(["ADMIN"]);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
    throw e;
  }

  const { id } = await params;
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* body optional */
  }
  const parsed = Body.safeParse(json ?? {});
  const env = parsed.success ? parsed.data.env : "dev";

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { customer: { include: { instances: true } }, nativeDeployment: true },
  });
  if (!ticket) return NextResponse.json({ error: "not found" }, { status: 404 });
  const dep = ticket.nativeDeployment;
  if (!dep) return NextResponse.json({ error: "ticket has no native deployment" }, { status: 409 });

  const instances = ticket.customer?.instances ?? [];
  const instance = env === "dev" ? instances.find((i) => i.id === dep.instanceId) : instances.find((i) => i.env === env);
  if (!instance) return NextResponse.json({ error: `no ${env} instance for this customer` }, { status: 409 });

  // On dev the local update set is dep.updateSetSysId; on test/prod it's the
  // committed local copy of the remote set (same sys_id after commit).
  const updateSetSysId =
    env === "dev" ? dep.updateSetSysId : env === "test" ? (dep.remoteUpdateSetTest ?? dep.updateSetSysId) : (dep.remoteUpdateSetProd ?? dep.updateSetSysId);

  const result = await backOut({ ticketId: id, instance, updateSetSysId, actorId: user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
