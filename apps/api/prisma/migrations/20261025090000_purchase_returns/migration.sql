BEGIN;
-- New supplier-return records only. Existing purchases, receipts and balances are not rewritten.
-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "return_no" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(500) NOT NULL,
    "return_date" DATE NOT NULL,
    "refund_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remark" VARCHAR(2000),
    "created_by" UUID NOT NULL,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "confirm_operation_id" UUID,
    "confirm_request_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_return_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "requested_receipt_item_id" UUID,
    "quantity" INTEGER NOT NULL,
    "sku_snapshot" VARCHAR(80) NOT NULL,
    "name_snapshot" VARCHAR(200) NOT NULL,
    "unit_snapshot" VARCHAR(20) NOT NULL,
    "stock_unit_cost" DECIMAL(20,4),
    "stock_cost" DECIMAL(20,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_return_item_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "receipt_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "received_unit_cost" DECIMAL(20,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_return_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_purchase_return_order" ON "purchase_returns"("tenant_id", "purchase_order_id", "status");

-- CreateIndex
CREATE INDEX "idx_purchase_return_date" ON "purchase_returns"("tenant_id", "status", "return_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_tenant_id_id_key" ON "purchase_returns"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_tenant_id_id_purchase_order_id_key" ON "purchase_returns"("tenant_id", "id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_tenant_id_return_no_key" ON "purchase_returns"("tenant_id", "return_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_tenant_id_confirm_operation_id_key" ON "purchase_returns"("tenant_id", "confirm_operation_id");

-- CreateIndex
CREATE INDEX "idx_purchase_return_item_source" ON "purchase_return_items"("tenant_id", "purchase_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_return_items_tenant_id_id_key" ON "purchase_return_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_return_items_tenant_id_purchase_return_id_purchase_key" ON "purchase_return_items"("tenant_id", "purchase_return_id", "purchase_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_return_items_tenant_id_id_purchase_order_item_id_p_key" ON "purchase_return_items"("tenant_id", "id", "purchase_order_item_id", "purchase_order_id", "product_id");

-- CreateIndex
CREATE INDEX "idx_purchase_return_allocation_receipt" ON "purchase_return_allocations"("tenant_id", "receipt_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_return_allocations_tenant_id_id_key" ON "purchase_return_allocations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_return_allocations_tenant_id_purchase_return_item__key" ON "purchase_return_allocations"("tenant_id", "purchase_return_item_id", "receipt_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_items_tenant_id_id_purchase_order_item_id_purchase__key" ON "receipt_items"("tenant_id", "id", "purchase_order_item_id", "purchase_order_id", "product_id");

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_purchase_order_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id", "warehouse_id") REFERENCES "purchase_orders"("tenant_id", "id", "warehouse_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_confirmed_by_fkey" FOREIGN KEY ("tenant_id", "confirmed_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_tenant_id_purchase_return_id_purchas_fkey" FOREIGN KEY ("tenant_id", "purchase_return_id", "purchase_order_id") REFERENCES "purchase_returns"("tenant_id", "id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_tenant_id_purchase_order_item_id_pur_fkey" FOREIGN KEY ("tenant_id", "purchase_order_item_id", "purchase_order_id", "product_id") REFERENCES "purchase_order_items"("tenant_id", "id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_tenant_id_requested_receipt_item_id__fkey" FOREIGN KEY ("tenant_id", "requested_receipt_item_id", "purchase_order_item_id", "purchase_order_id", "product_id") REFERENCES "receipt_items"("tenant_id", "id", "purchase_order_item_id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_allocations" ADD CONSTRAINT "purchase_return_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_allocations" ADD CONSTRAINT "purchase_return_allocations_tenant_id_purchase_return_item_fkey" FOREIGN KEY ("tenant_id", "purchase_return_item_id", "purchase_order_item_id", "purchase_order_id", "product_id") REFERENCES "purchase_return_items"("tenant_id", "id", "purchase_order_item_id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_allocations" ADD CONSTRAINT "purchase_return_allocations_tenant_id_purchase_order_item__fkey" FOREIGN KEY ("tenant_id", "purchase_order_item_id", "purchase_order_id", "product_id") REFERENCES "purchase_order_items"("tenant_id", "id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_return_allocations" ADD CONSTRAINT "purchase_return_allocations_tenant_id_receipt_item_id_purc_fkey" FOREIGN KEY ("tenant_id", "receipt_item_id", "purchase_order_item_id", "purchase_order_id", "product_id") REFERENCES "receipt_items"("tenant_id", "id", "purchase_order_item_id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE purchase_returns ADD CONSTRAINT ck_purchase_return_status CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED'));
ALTER TABLE purchase_returns ADD CONSTRAINT ck_purchase_return_reason CHECK (length(btrim(reason)) > 0);
ALTER TABLE purchase_returns ADD CONSTRAINT ck_purchase_return_refund CHECK (refund_amount >= 0 AND refund_amount <> 'NaN'::numeric);
ALTER TABLE purchase_returns ADD CONSTRAINT ck_purchase_return_confirmation CHECK (
  (status='CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirm_operation_id IS NOT NULL AND confirm_request_hash IS NOT NULL) OR
  (status IN ('DRAFT','CANCELLED') AND confirmed_by IS NULL AND confirmed_at IS NULL AND confirm_operation_id IS NULL AND confirm_request_hash IS NULL)
);
ALTER TABLE purchase_return_items ADD CONSTRAINT ck_purchase_return_item_quantity CHECK (quantity > 0);
ALTER TABLE purchase_return_items ADD CONSTRAINT ck_purchase_return_item_cost CHECK (
  (stock_unit_cost IS NULL AND stock_cost IS NULL) OR
  (stock_unit_cost IS NOT NULL AND stock_cost IS NOT NULL AND stock_unit_cost >= 0 AND stock_cost >= 0 AND stock_unit_cost <> 'NaN'::numeric AND stock_cost <> 'NaN'::numeric)
);
ALTER TABLE purchase_return_allocations ADD CONSTRAINT ck_purchase_return_allocation_quantity CHECK (quantity > 0);
ALTER TABLE purchase_return_allocations ADD CONSTRAINT ck_purchase_return_allocation_cost CHECK (received_unit_cost >= 0 AND received_unit_cost <> 'NaN'::numeric);
CREATE TRIGGER tr_purchase_returns_updated_at BEFORE UPDATE ON purchase_returns FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_purchase_return_items_updated_at BEFORE UPDATE ON purchase_return_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_purchase_return_allocations_updated_at BEFORE UPDATE ON purchase_return_allocations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keep all existing source types while distinguishing supplier returns from adjustments/customer returns.
ALTER TABLE stock_movements DROP CONSTRAINT ck_stock_movements_1;
ALTER TABLE stock_movements ADD CONSTRAINT ck_stock_movements_1 CHECK (source_type IN ('RECEIPT','OUTBOUND','ADJUSTMENT','PURCHASE_RETURN'));
COMMIT;
