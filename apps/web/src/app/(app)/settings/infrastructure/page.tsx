import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageUsers } from "@/lib/auth/rbac";
import { listCustomersForAdmin } from "@/lib/admin/infra";
import { InfrastructurePanel } from "@/components/settings/InfrastructurePanel";
import type { CustomerAdminJson } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InfrastructurePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (!canManageUsers(me)) redirect("/");

  const rows = await listCustomersForAdmin();
  const customers = JSON.parse(JSON.stringify(rows)) as CustomerAdminJson[];

  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Infrastructure</h1>
          <p className="lede">
            Customers, their ServiceNow instances (dev / test / prod), and the Fluent projects
            behind the flow/app tier. Instance credentials are looked up from the secret
            provider by <code>credentialRef</code> — the value here is a pointer, never a secret.
          </p>
        </div>
      </div>
      <InfrastructurePanel initial={customers} />
    </div>
  );
}
