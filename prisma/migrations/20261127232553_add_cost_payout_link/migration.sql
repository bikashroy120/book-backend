ALTER TABLE "CostEntry" ADD COLUMN "payoutId" TEXT;

CREATE UNIQUE INDEX "CostEntry_payoutId_key" ON "CostEntry"("payoutId");

ALTER TABLE "CostEntry"
ADD CONSTRAINT "CostEntry_payoutId_fkey"
FOREIGN KEY ("payoutId") REFERENCES "PayoutRequest"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
