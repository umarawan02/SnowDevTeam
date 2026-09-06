-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "changeRequestRef" TEXT;

-- CreateTable
CREATE TABLE "NativeDeployment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeSysId" TEXT NOT NULL,
    "updateSetSysId" TEXT NOT NULL,
    "updateSetName" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'APPLYING',
    "appliedChanges" JSONB NOT NULL DEFAULT '[]',
    "remoteUpdateSetTest" TEXT,
    "remoteUpdateSetProd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NativeDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NativeDeployment_ticketId_key" ON "NativeDeployment"("ticketId");

-- AddForeignKey
ALTER TABLE "NativeDeployment" ADD CONSTRAINT "NativeDeployment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NativeDeployment" ADD CONSTRAINT "NativeDeployment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
