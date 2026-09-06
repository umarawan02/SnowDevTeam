-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "allowFluentFlows" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "routeScope" TEXT;
