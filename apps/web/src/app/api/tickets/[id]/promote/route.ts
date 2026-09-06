import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { RELEASE_GATE } from "@/lib/constants";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { promote } from "@/lib/nativeengine/promote";

export const dynamic = "force-dynamic";

const Body = z.object({ toGate: z.enum(["TEST", "PROD"]) });

/**
 * Promote a native deployment dev→test or test→prod (NATIVE_ENGINE_BRIEF §5.4).
 * TEST needs a reviewer; PROD needs an admin AND a change-request reference on
 * the ticket. Promotion itself is code, never an agent tool.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser(["ADMIN", "REVIEWER"]);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.kind === "forbidden" ? 403 : 401 });
    throw e;
  }

  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  const toGate = parsed.data.toGate;

  if (toGate === "PROD" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "prod promotion requires an admin" }, { status: 403 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { customer: { include: { instances: true } }, nativeDeployment: true },
  });
  if (!ticket) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!ticket.nativeDeployment) return NextResponse.json({ error: "ticket has no native deployment to promote" }, { status: 409 });
  if (toGate === "PROD" && !ticket.changeRequestRef) {
    return NextResponse.json({ error: "prod promotion requires a change-request reference on the ticket" }, { status: 409 });
  }

  const fromEnv = toGate === "TEST" ? "dev" : "test";
  const toEnv = toGate === "TEST" ? "test" : "prod";
  const instances = ticket.customer?.instances ?? [];
  const fromInstance = instances.find((i) => i.id === ticket.nativeDeployment!.instanceId) ?? instances.find((i) => i.env === fromEnv);
  const toInstance = instances.find((i) => i.env === toEnv);
  if (!fromInstance) return NextResponse.json({ error: `no ${fromEnv} instance for this customer` }, { status: 409 });
  if (!toInstance) return NextResponse.json({ error: `no ${toEnv} instance for this customer` }, { status: 409 });

  const result = await promote({ ticketId: id, fromInstance, toInstance, toGate: RELEASE_GATE[toGate], actorId: user.id });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, blocked: result.blocked ?? false }, { status: result.blocked ? 409 : 502 });
  }
  return NextResponse.json({ ok: true, toGate, remoteUpdateSetId: result.remoteUpdateSetId });
}
