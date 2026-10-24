-- 任务 29：库存调整 API。只加列与索引，不改写任何历史行。
-- 四列全部可空：stock_adjustments 此前没有写入入口，老数据即使存在也保持原样（调整单号/哈希由新接口写入）。
ALTER TABLE "stock_adjustments" ADD COLUMN "adjustment_no" VARCHAR(32),
ADD COLUMN "remark" VARCHAR(500),
ADD COLUMN "request_hash" VARCHAR(64),
ADD COLUMN "cost_source" VARCHAR(20);

-- 单号只在商家内唯一；历史行是 NULL，不参与唯一约束（PostgreSQL 允许多个 NULL）。
CREATE UNIQUE INDEX "stock_adjustments_tenant_id_adjustment_no_key" ON "stock_adjustments" ("tenant_id", "adjustment_no");

-- 列表按商家+时间倒序翻页。
CREATE INDEX "idx_adjustment_tenant_time" ON "stock_adjustments" ("tenant_id", "created_at" DESC);

-- 原因写进数据库兜住绕过接口的写入；NOT VALID 只约束新行，
-- 避免历史上可能存在的自由文本原因导致迁移失败。数量非零已由 ck_stock_adjustments_1 覆盖，不再重复加。
ALTER TABLE "stock_adjustments"
ADD CONSTRAINT "stock_adjustments_reason_known" CHECK (
  "reason" IN ('STOCKTAKE_GAIN', 'STOCKTAKE_LOSS', 'DAMAGED', 'LOST', 'OTHER')
) NOT VALID;
