import { NextResponse } from "next/server";
import { getTicketWithSteps } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ticket = await getTicketWithSteps(id);
  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ticket });
}
