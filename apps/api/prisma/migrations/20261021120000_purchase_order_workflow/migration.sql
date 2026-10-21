BEGIN;
-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "freight_allocated" DECIMAL(18,2),
ADD COLUMN     "line_no" INTEGER,
ADD COLUMN     "name_snapshot" VARCHAR(200),
ADD COLUMN     "sku_snapshot" VARCHAR(80),
ADD COLUMN     "unit_snapshot" VARCHAR(20);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "purchase_date" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_purchase_order_id_line_no_key" ON "purchase_order_items"("tenant_id", "purchase_order_id", "line_no");


ALTER TABLE purchase_order_items ADD CONSTRAINT ck_po_item_line_no CHECK (line_no IS NULL OR line_no > 0);
ALTER TABLE purchase_order_items ADD CONSTRAINT ck_po_item_freight_allocated CHECK (freight_allocated IS NULL OR (freight_allocated >= 0 AND freight_allocated <> 'NaN'::numeric));
COMMIT;
