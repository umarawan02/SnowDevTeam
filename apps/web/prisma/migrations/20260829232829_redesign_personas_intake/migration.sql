-- AlterTable
ALTER TABLE "AgentStep" ADD COLUMN "costUsd" REAL;
ALTER TABLE "AgentStep" ADD COLUMN "model" TEXT;
ALTER TABLE "AgentStep" ADD COLUMN "numTurns" INTEGER;
ALTER TABLE "AgentStep" ADD COLUMN "personaName" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "category" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "priority" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "requester" TEXT;

-- CreateTable
CREATE TABLE "AgentPersona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "avatarSeed" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersona_role_key" ON "AgentPersona"("role");
