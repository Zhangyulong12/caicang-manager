BEGIN;
-- 商品货号/颜色/尺码：全部可空，老商品保持 NULL，不做任何猜测性回填。
ALTER TABLE "products" ADD COLUMN     "article_no" VARCHAR(80),
ADD COLUMN     "color" VARCHAR(80),
ADD COLUMN     "size" VARCHAR(80);

-- 采购明细冻结下单时的三个属性，商品后续改款不影响历史单据。
ALTER TABLE "purchase_order_items" ADD COLUMN     "article_no_snapshot" VARCHAR(80),
ADD COLUMN     "color_snapshot" VARCHAR(80),
ADD COLUMN     "size_snapshot" VARCHAR(80);
COMMIT;
