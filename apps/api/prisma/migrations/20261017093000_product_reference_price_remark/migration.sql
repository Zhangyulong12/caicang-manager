BEGIN;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "reference_purchase_price" DECIMAL(18,2),
ADD COLUMN     "remark" TEXT;

-- CreateIndex
CREATE INDEX "idx_product_tenant_active_time" ON "products"("tenant_id", "is_active", "created_at" DESC, "id" DESC);

-- Reference prices are optional, finite and nonnegative. Existing rows remain unchanged/null.
ALTER TABLE products ADD CONSTRAINT ck_product_reference_price
CHECK (reference_purchase_price IS NULL OR
  (reference_purchase_price >= 0 AND reference_purchase_price <= 9999999999999999.99));
ALTER TABLE products ADD CONSTRAINT ck_product_remark_length CHECK (char_length(remark) <= 2000);

COMMIT;
