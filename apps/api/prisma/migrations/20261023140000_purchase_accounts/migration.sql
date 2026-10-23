BEGIN;
-- Additive upgrade: legacy orders keep NULL accounts; never infer history.
-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "purchase_account_alias_snapshot" VARCHAR(100),
ADD COLUMN     "purchase_account_id" UUID;

-- CreateTable
CREATE TABLE "purchase_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "alias" VARCHAR(100) NOT NULL,
    "remark" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_purchase_account_active" ON "purchase_accounts"("tenant_id", "is_active", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_accounts_tenant_id_id_key" ON "purchase_accounts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_accounts_tenant_id_platform_alias_key" ON "purchase_accounts"("tenant_id", "platform", "alias");

-- CreateIndex
CREATE INDEX "idx_po_account_date" ON "purchase_orders"("tenant_id", "purchase_account_id", "purchase_date");

-- CreateIndex
CREATE INDEX "idx_po_purchase_date" ON "purchase_orders"("tenant_id", "purchase_date");

-- AddForeignKey
ALTER TABLE "purchase_accounts" ADD CONSTRAINT "purchase_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_purchase_account_id_fkey" FOREIGN KEY ("tenant_id", "purchase_account_id") REFERENCES "purchase_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE purchase_accounts ADD CONSTRAINT ck_purchase_account_platform CHECK (platform IN ('TAOBAO','JD','PDD','OTHER'));
ALTER TABLE purchase_accounts ADD CONSTRAINT ck_purchase_account_alias CHECK (length(btrim(alias)) > 0);
CREATE TRIGGER tr_purchase_accounts_updated_at BEFORE UPDATE ON purchase_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMIT;
