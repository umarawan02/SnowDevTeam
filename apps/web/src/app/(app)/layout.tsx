import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { getCurrentUser } from "@/lib/auth/current-user";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Middleware already gates this, but re-check so RSC has the real user and a
  // deactivated / deleted account can't ride a still-valid cookie.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <AppShell user={user}>{children}</AppShell>;
}
