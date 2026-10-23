/**
 * 商品没有单独填名称时，用业务上真正用来识别商品的三个属性拼一个可读名称。
 * 全部为空就退回 SKU —— SKU 在同商家内唯一，永远能区分。
 */
export interface ProductNameParts {
  articleNo?: string | null;
  color?: string | null;
  size?: string | null;
  sku: string;
}

export function derivedProductName(parts: ProductNameParts): string {
  const segments = [parts.articleNo, parts.color, parts.size]
    .map((value) => (value ?? '').trim())
    .filter((value) => value.length > 0);
  return segments.join(' ') || parts.sku;
}
