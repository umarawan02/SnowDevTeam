-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "reworkReason" TEXT,
ADD COLUMN     "reworkRound" INTEGER NOT NULL DEFAULT 0;
