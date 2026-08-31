import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { latestGathering, createConversation } from "@/lib/intake/store";

export const dynamic = "force-dynamic";

export default async function IntakeIndex() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const existing = await latestGathering(user.id);
  if (existing) redirect(`/intake/${existing.id}`);

  const created = await createConversation(user.id);
  redirect(`/intake/${created.id}`);
}
