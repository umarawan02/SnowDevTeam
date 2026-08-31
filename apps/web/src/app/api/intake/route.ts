import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth/current-user";
import { createConversation, getIntakeConversations } from "@/lib/intake/store";

export const dynamic = "force-dynamic";

function auth401(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
  throw e;
}

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return auth401(e);
  }
  return NextResponse.json({ conversations: await getIntakeConversations(user.id) });
}

export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    return auth401(e);
  }
  const conversation = await createConversation(user.id);
  return NextResponse.json({ id: conversation.id }, { status: 201 });
}
