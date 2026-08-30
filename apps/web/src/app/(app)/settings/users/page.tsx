import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageUsers } from "@/lib/auth/rbac";
import { UserTable } from "@/components/settings/UserTable";
import type { AdminUserJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (!canManageUsers(me)) redirect("/");

  const rows = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: {
      id: true, email: true, name: true, role: true, active: true,
      lastLoginAt: true, createdAt: true,
      _count: { select: { createdTickets: true, reviewedTickets: true } },
    },
  });
  const users = JSON.parse(JSON.stringify(rows)) as AdminUserJson[];

  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">User management</h1>
          <p className="lede">
            Invite teammates and set what they can do. Reviewers and admins can approve or
            reject at the review gate; requesters can only submit and watch.
          </p>
        </div>
      </div>
      <UserTable initialUsers={users} currentUserId={me.id} />
    </div>
  );
}
