import { NewRequestForm } from "@/components/NewRequestForm";

export const dynamic = "force-dynamic";

export default function IntakePage() {
  return (
    <div className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">New feature request</h1>
          <p className="lede">
            Describe what the business needs. The Business Analyst turns it into requirements,
            and the rest of the team designs, builds, and QAs it for your review.
          </p>
        </div>
      </div>
      <NewRequestForm />
    </div>
  );
}
