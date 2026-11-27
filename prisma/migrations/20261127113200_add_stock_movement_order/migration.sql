ALTER TABLE "StockMovement"
ADD COLUMN "orderId" TEXT;

CREATE INDEX "StockMovement_orderId_idx"
ON "StockMovement"("orderId");

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
