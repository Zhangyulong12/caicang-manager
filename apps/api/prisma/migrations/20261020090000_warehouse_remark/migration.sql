BEGIN;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "remark" TEXT;

ALTER TABLE warehouses ADD CONSTRAINT ck_warehouse_remark_length CHECK (char_length(remark) <= 2000);

COMMIT;
