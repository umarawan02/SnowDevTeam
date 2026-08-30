import { IntakeWizard } from "@/components/intake/IntakeWizard";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const user = await getCurrentUser();
  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">New feature request</h1>
          <p className="lede">
            Describe what the business needs. The Business Analyst turns it into requirements;
            the rest of the team designs, builds, and QAs it for your review.
          </p>
        </div>
      </div>
      <IntakeWizard defaultRequester={user?.name ?? user?.email ?? ""} />
    </div>
  );
}
