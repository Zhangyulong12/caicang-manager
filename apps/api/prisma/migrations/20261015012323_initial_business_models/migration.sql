BEGIN;
-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "barcode" VARCHAR(128),
    "name" VARCHAR(200) NOT NULL,
    "specification" VARCHAR(200),
    "unit" VARCHAR(20) NOT NULL DEFAULT '件',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "order_no" VARCHAR(50) NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "platform_order_no" VARCHAR(100),
    "supplier_name" VARCHAR(200),
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "recipient_name" VARCHAR(100),
    "recipient_phone" VARCHAR(50),
    "recipient_address" TEXT,
    "freight_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "created_by" UUID NOT NULL,
    "placed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "landed_unit_cost" DECIMAL(20,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "carrier_code" VARCHAR(40),
    "tracking_no" VARCHAR(128),
    "status" VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    "receiving_closed_at" TIMESTAMPTZ(6),
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_expected_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_order_id" UUID NOT NULL,

    CONSTRAINT "package_expected_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "receipt_no" VARCHAR(50) NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "client_operation_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    "received_by" UUID NOT NULL,
    "remark" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "landed_unit_cost" DECIMAL(20,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchase_order_id" UUID NOT NULL,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "outbound_no" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "customer_name" VARCHAR(100),
    "customer_phone" VARCHAR(50),
    "customer_address" TEXT,
    "carrier_code" VARCHAR(40),
    "tracking_no" VARCHAR(128),
    "confirm_operation_id" UUID,
    "confirm_request_hash" CHAR(64),
    "remark" TEXT,
    "created_by" UUID NOT NULL,
    "shipped_by" UUID,
    "shipped_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "outbound_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "shipped_unit_cost" DECIMAL(20,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reason" VARCHAR(100) NOT NULL,
    "unit_cost_snapshot" DECIMAL(20,4) NOT NULL,
    "client_operation_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source_type" VARCHAR(20) NOT NULL,
    "source_item_id" UUID NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "cost_delta" DECIMAL(20,4) NOT NULL,
    "quantity_before" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "total_cost_before" DECIMAL(20,4) NOT NULL,
    "total_cost_after" DECIMAL(20,4) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "object_type" VARCHAR(80) NOT NULL,
    "object_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_membership_user" ON "tenant_memberships"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_id_key" ON "tenant_memberships"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_id_key" ON "warehouses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "warehouses"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "idx_product_search" ON "products"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_barcode_key" ON "products"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "idx_po_tenant_status_time" ON "purchase_orders"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_po_platform_order" ON "purchase_orders"("tenant_id", "platform", "platform_order_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_id_key" ON "purchase_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_order_no_key" ON "purchase_orders"("tenant_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_id_warehouse_id_key" ON "purchase_orders"("tenant_id", "id", "warehouse_id");

-- CreateIndex
CREATE INDEX "idx_po_item_po" ON "purchase_order_items"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_id_key" ON "purchase_order_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_purchase_order_id_product_id_key" ON "purchase_order_items"("tenant_id", "purchase_order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_id_purchase_order_id_key" ON "purchase_order_items"("tenant_id", "id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_tenant_id_id_purchase_order_id_product_key" ON "purchase_order_items"("tenant_id", "id", "purchase_order_id", "product_id");

-- CreateIndex
CREATE INDEX "idx_pkg_scan" ON "packages"("tenant_id", "tracking_no");

-- CreateIndex
CREATE INDEX "idx_pkg_order" ON "packages"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_tenant_id_id_key" ON "packages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_tenant_id_id_purchase_order_id_key" ON "packages"("tenant_id", "id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "packages_tenant_id_carrier_code_tracking_no_key" ON "packages"("tenant_id", "carrier_code", "tracking_no");

-- CreateIndex
CREATE UNIQUE INDEX "package_expected_items_tenant_id_package_id_purchase_order__key" ON "package_expected_items"("tenant_id", "package_id", "purchase_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_expected_items_tenant_id_id_key" ON "package_expected_items"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "idx_receipt_pkg" ON "receipts"("tenant_id", "package_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_id_key" ON "receipts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_receipt_no_key" ON "receipts"("tenant_id", "receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_client_operation_id_key" ON "receipts"("tenant_id", "client_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenant_id_id_purchase_order_id_key" ON "receipts"("tenant_id", "id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_items_tenant_id_id_key" ON "receipt_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_items_tenant_id_receipt_id_purchase_order_item_id_key" ON "receipt_items"("tenant_id", "receipt_id", "purchase_order_item_id");

-- CreateIndex
CREATE INDEX "idx_stock_product" ON "stock_balances"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_tenant_id_warehouse_id_product_id_key" ON "stock_balances"("tenant_id", "warehouse_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_tenant_id_id_key" ON "stock_balances"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "idx_outbound_status" ON "outbound_orders"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_orders_tenant_id_id_key" ON "outbound_orders"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_orders_tenant_id_outbound_no_key" ON "outbound_orders"("tenant_id", "outbound_no");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_orders_tenant_id_confirm_operation_id_key" ON "outbound_orders"("tenant_id", "confirm_operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_order_items_tenant_id_id_key" ON "outbound_order_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_order_items_tenant_id_outbound_order_id_product_id_key" ON "outbound_order_items"("tenant_id", "outbound_order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_tenant_id_id_key" ON "stock_adjustments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_tenant_id_client_operation_id_key" ON "stock_adjustments"("tenant_id", "client_operation_id");

-- CreateIndex
CREATE INDEX "idx_movement_filter" ON "stock_movements"("tenant_id", "warehouse_id", "product_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_tenant_id_source_type_source_item_id_key" ON "stock_movements"("tenant_id", "source_type", "source_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_tenant_id_id_key" ON "stock_movements"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "idx_audit_tenant_time" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_tenant_id_id_key" ON "audit_logs"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_tenant_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id") REFERENCES "purchase_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "package_expected_items" ADD CONSTRAINT "package_expected_items_tenant_id_package_id_purchase_order_fkey" FOREIGN KEY ("tenant_id", "package_id", "purchase_order_id") REFERENCES "packages"("tenant_id", "id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "package_expected_items" ADD CONSTRAINT "package_expected_items_tenant_id_purchase_order_item_id_pu_fkey" FOREIGN KEY ("tenant_id", "purchase_order_item_id", "purchase_order_id") REFERENCES "purchase_order_items"("tenant_id", "id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "package_expected_items" ADD CONSTRAINT "package_expected_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_received_by_fkey" FOREIGN KEY ("tenant_id", "received_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_purchase_order_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "purchase_order_id", "warehouse_id") REFERENCES "purchase_orders"("tenant_id", "id", "warehouse_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_package_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "package_id", "purchase_order_id") REFERENCES "packages"("tenant_id", "id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_tenant_id_receipt_id_purchase_order_id_fkey" FOREIGN KEY ("tenant_id", "receipt_id", "purchase_order_id") REFERENCES "receipts"("tenant_id", "id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_tenant_id_purchase_order_item_id_purchase_or_fkey" FOREIGN KEY ("tenant_id", "purchase_order_item_id", "purchase_order_id", "product_id") REFERENCES "purchase_order_items"("tenant_id", "id", "purchase_order_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_tenant_id_shipped_by_fkey" FOREIGN KEY ("tenant_id", "shipped_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbound_orders" ADD CONSTRAINT "outbound_orders_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_tenant_id_outbound_order_id_fkey" FOREIGN KEY ("tenant_id", "outbound_order_id") REFERENCES "outbound_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "outbound_order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_actor_id_fkey" FOREIGN KEY ("tenant_id", "actor_id") REFERENCES "tenant_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Reference CHECK constraints plus database-maintained timestamps.
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "ck_tenant_memberships_1" CHECK (role IN ('OWNER','ADMIN','BUYER','WAREHOUSE','VIEWER'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "ck_purchase_orders_1" CHECK (platform IN ('TAOBAO','JD','PDD','OTHER'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "ck_purchase_orders_2" CHECK (status IN ('DRAFT','PLACED','PARTIAL_RECEIVED','RECEIVED','CANCELLED'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "ck_purchase_orders_3" CHECK (freight_amount >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "ck_purchase_order_items_1" CHECK (quantity > 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "ck_purchase_order_items_2" CHECK (unit_price >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "ck_purchase_order_items_3" CHECK (discount_amount >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "ck_purchase_order_items_4" CHECK (landed_unit_cost IS NULL OR landed_unit_cost >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "ck_purchase_order_items_5" CHECK (discount_amount <= quantity * unit_price);
ALTER TABLE "packages" ADD CONSTRAINT "ck_packages_1" CHECK (status IN ('CREATED','IN_TRANSIT','ARRIVED','PARTIAL_RECEIVED','RECEIVED','EXCEPTION'));
ALTER TABLE "packages" ADD CONSTRAINT "ck_packages_2" CHECK ((carrier_code IS NULL) = (tracking_no IS NULL));
ALTER TABLE "package_expected_items" ADD CONSTRAINT "ck_package_expected_items_1" CHECK (expected_quantity > 0);
ALTER TABLE "receipts" ADD CONSTRAINT "ck_receipts_1" CHECK (status = 'CONFIRMED');
ALTER TABLE "receipt_items" ADD CONSTRAINT "ck_receipt_items_1" CHECK (quantity > 0);
ALTER TABLE "receipt_items" ADD CONSTRAINT "ck_receipt_items_2" CHECK (landed_unit_cost >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "ck_stock_balances_1" CHECK (quantity_on_hand >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "ck_stock_balances_2" CHECK (total_cost >= 0);
ALTER TABLE "outbound_orders" ADD CONSTRAINT "ck_outbound_orders_1" CHECK (status IN ('DRAFT','SHIPPED','CANCELLED'));
ALTER TABLE "outbound_orders" ADD CONSTRAINT "ck_outbound_orders_2" CHECK (status <> 'SHIPPED' OR (shipped_at IS NOT NULL AND confirm_operation_id IS NOT NULL AND confirm_request_hash IS NOT NULL));
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "ck_outbound_order_items_1" CHECK (quantity > 0);
ALTER TABLE "outbound_order_items" ADD CONSTRAINT "ck_outbound_order_items_2" CHECK (shipped_unit_cost IS NULL OR shipped_unit_cost >= 0);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "ck_stock_adjustments_1" CHECK (quantity_delta <> 0);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "ck_stock_adjustments_2" CHECK (unit_cost_snapshot >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_1" CHECK (source_type IN ('RECEIPT','OUTBOUND','ADJUSTMENT'));
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_2" CHECK (quantity_delta <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_3" CHECK (quantity_before >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_4" CHECK (quantity_after >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_5" CHECK (total_cost_before >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_6" CHECK (total_cost_after >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_7" CHECK (quantity_before + quantity_delta = quantity_after);
ALTER TABLE "stock_movements" ADD CONSTRAINT "ck_stock_movements_8" CHECK (total_cost_before + cost_delta = total_cost_after);
ALTER TABLE products ADD CONSTRAINT ck_product_sku_nonempty CHECK (btrim(sku) <> '');
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END; $$;
CREATE TRIGGER tr_tenants_updated_at BEFORE UPDATE ON "tenants" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_users_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_tenant_memberships_updated_at BEFORE UPDATE ON "tenant_memberships" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_warehouses_updated_at BEFORE UPDATE ON "warehouses" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_products_updated_at BEFORE UPDATE ON "products" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_purchase_orders_updated_at BEFORE UPDATE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_purchase_order_items_updated_at BEFORE UPDATE ON "purchase_order_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_packages_updated_at BEFORE UPDATE ON "packages" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_package_expected_items_updated_at BEFORE UPDATE ON "package_expected_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_receipts_updated_at BEFORE UPDATE ON "receipts" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_receipt_items_updated_at BEFORE UPDATE ON "receipt_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_stock_balances_updated_at BEFORE UPDATE ON "stock_balances" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_outbound_orders_updated_at BEFORE UPDATE ON "outbound_orders" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_outbound_order_items_updated_at BEFORE UPDATE ON "outbound_order_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_stock_adjustments_updated_at BEFORE UPDATE ON "stock_adjustments" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_stock_movements_updated_at BEFORE UPDATE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tr_audit_logs_updated_at BEFORE UPDATE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
