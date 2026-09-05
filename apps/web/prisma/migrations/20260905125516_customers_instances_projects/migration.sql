-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "executionTier" TEXT,
ADD COLUMN     "gitBranch" TEXT,
ADD COLUMN     "instanceId" TEXT,
ADD COLUMN     "prUrl" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "releaseGate" TEXT,
ADD COLUMN     "tierRationale" TEXT;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "env" TEXT NOT NULL DEFAULT 'dev',
    "releaseName" TEXT,
    "releaseBuild" TEXT,
    "releaseDetectedAt" TIMESTAMP(3),
    "authMode" TEXT NOT NULL DEFAULT 'basic',
    "credentialRef" TEXT NOT NULL,
    "readOnlyCredentialRef" TEXT,
    "isDeployTarget" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FluentProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "gitRemote" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "createdVia" TEXT NOT NULL,
    "packageResolverVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "instanceId" TEXT,

    CONSTRAINT "FluentProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_slug_key" ON "Customer"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_customerId_name_key" ON "Instance"("customerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FluentProject_customerId_scopeId_key" ON "FluentProject"("customerId", "scopeId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FluentProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluentProject" ADD CONSTRAINT "FluentProject_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluentProject" ADD CONSTRAINT "FluentProject_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
