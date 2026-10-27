import type {
  InventoryBalanceData,
  InventoryMovementData,
  StockMovementType,
} from '@caicang/api-contract';

export function movementSourcePath(
  row: Pick<InventoryMovementData, 'type' | 'sourceDocumentId'>,
): string | null {
  const id = row.sourceDocumentId;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return null;
  if (row.type === 'ADJUSTMENT') return '/inventory/adjustments/' + id;
  if (row.type === 'RECEIPT') return '/receipts/' + id;
  if (row.type === 'PURCHASE_RETURN') return '/purchase-returns/' + id;
  return null;
}

/** 数量：整数加千分位；负数保留符号（出库时前端要看得清）。 */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

/** 金额固定两位展示（接口给的是四位小数字符串，展示时不再自己算）。 */
export function formatMoney(value: string | null | undefined): string {
  const parsed = Number(value ?? '0');
  if (!Number.isFinite(parsed)) return '¥0.00';
  return (
    '¥' + parsed.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** 单价四位小数，成本精度比金额更高。 */
export function formatUnitCost(value: string | null | undefined): string {
  const parsed = Number(value ?? '0');
  if (!Number.isFinite(parsed)) return '0.0000';
  return parsed.toFixed(4);
}

/** 只显示日期（采购日期本身是 DATE 列）。 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const text = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '—';
}

export const movementTypeNames: Record<StockMovementType, string> = {
  RECEIPT: '验收入库',
  OUTBOUND: '出库发货',
  ADJUSTMENT: '库存调整',
  PURCHASE_RETURN: '采购退货',
};

/** 模板里 row.type 是 any，这里用接受 string 的包装，避免索引类型报错。 */
export function movementLabel(type: string): string {
  return movementTypeNames[type as StockMovementType] ?? type;
}

export function movementTone(type: StockMovementType): 'success' | 'warning' | 'info' | 'primary' {
  if (type === 'RECEIPT') return 'success';
  if (type === 'OUTBOUND') return 'warning';
  return 'info';
}

/** "有货 / 待入库 / 无货" 三态，列表里用颜色区分，避免只靠数字。 */
export function stockState(
  row: Pick<InventoryBalanceData, 'quantityOnHand' | 'pendingInboundQuantity'>,
) {
  if (row.quantityOnHand > 0) return { label: '有库存', tone: 'success' as const };
  if (row.pendingInboundQuantity > 0) return { label: '待入库', tone: 'warning' as const };
  return { label: '无库存', tone: 'info' as const };
}

/** 列表底部"共 N 条"的文案。 */
export function pageSummary(total: number, page: number, pageSize: number): string {
  if (total === 0) return '共 0 条';
  return `共 ${total} 条 · 第 ${page} / ${Math.max(1, Math.ceil(total / pageSize))} 页`;
}

/** 两个日期区间的合法性；返回提示文案或空字符串。 */
export function rangeProblem(from: string, to: string): string {
  if (from && to && from > to) return '开始日期不能晚于结束日期';
  return '';
}
